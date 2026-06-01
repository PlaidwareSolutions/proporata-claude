import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { db } from "@workspace/db";
import { workOrderAttachmentsTable, workOrdersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const objectStorageService = new ObjectStorageService();

/**
 * storagePublicRouter — no authentication required
 * GET /storage/public-objects/*  — serve public/branding assets
 */
export const storagePublicRouter: IRouter = Router();

storagePublicRouter.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * storageReadRouter — requires authenticateJwt only (manager OR resident)
 * GET /storage/objects/*  — serve private stored documents
 */
export const storageReadRouter: IRouter = Router();

storageReadRouter.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // If this object is a work-order attachment, enforce per-work-order
    // authorization (residents can only see their own unit's photos).
    const [attachment] = await db
      .select({ workOrderId: workOrderAttachmentsTable.workOrderId })
      .from(workOrderAttachmentsTable)
      .where(eq(workOrderAttachmentsTable.storageKey, objectPath))
      .limit(1);
    if (attachment) {
      const [wo] = await db
        .select({ unit: workOrdersTable.unit })
        .from(workOrdersTable)
        .where(eq(workOrdersTable.id, attachment.workOrderId))
        .limit(1);
      if (!wo) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      if (req.user?.role === "resident" && req.user.unitId !== wo.unit) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

/**
 * storageWriteRouter (default export) — requires requireManager
 * POST /storage/uploads/request-url  — request presigned upload URL
 */
const storageWriteRouter: IRouter = Router();

storageWriteRouter.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

export default storageWriteRouter;
