import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import type { ObjectAclPolicy, ObjectPermission } from "./objectAcl";

export type { ObjectAclPolicy, ObjectPermission };
export {
  ObjectAccessGroupType,
  ObjectPermission as ObjectPermissionEnum,
} from "./objectAcl";
export type { ObjectAccessGroup, ObjectAclRule } from "./objectAcl";

// R2 client — S3-compatible API
export const objectStorageClient = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

const FILES_BUCKET = process.env.R2_FILES_BUCKET ?? "proporata-files";
const PRIVATE_BUCKET = process.env.R2_PRIVATE_BUCKET ?? "proporata-private";

// Internal file descriptor — replaces the GCS File object
export interface R2FileDescriptor {
  bucket: string;
  key: string;
  isPublic: boolean;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  // Search for a public branding asset by relative file path.
  async searchPublicObject(filePath: string): Promise<R2FileDescriptor | null> {
    const key = `public/${filePath}`;
    try {
      await objectStorageClient.send(
        new HeadObjectCommand({ Bucket: FILES_BUCKET, Key: key }),
      );
      return { bucket: FILES_BUCKET, key, isPublic: true };
    } catch {
      return null;
    }
  }

  // Stream a file as a Web Response (callers pipe response.body to Express res).
  async downloadObject(
    file: R2FileDescriptor,
    cacheTtlSec = 3600,
  ): Promise<Response> {
    const s3Res = await objectStorageClient.send(
      new GetObjectCommand({ Bucket: file.bucket, Key: file.key }),
    );
    const bodyBytes = await s3Res.Body?.transformToByteArray();
    if (!bodyBytes) {
      return new Response(null, { status: 404 });
    }
    const headers: Record<string, string> = {
      "Content-Type": s3Res.ContentType ?? "application/octet-stream",
      "Cache-Control": `${file.isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (s3Res.ContentLength) {
      headers["Content-Length"] = String(s3Res.ContentLength);
    }
    return new Response(Buffer.from(bodyBytes), { status: 200, headers });
  }

  // Generate a presigned PUT URL for a new private upload.
  async getObjectEntityUploadURL(): Promise<string> {
    const key = `uploads/${randomUUID()}`;
    return getSignedUrl(
      objectStorageClient,
      new PutObjectCommand({ Bucket: PRIVATE_BUCKET, Key: key }),
      { expiresIn: 900 },
    );
  }

  // Resolve an /objects/* path to an R2 file descriptor, verifying existence.
  async getObjectEntityFile(objectPath: string): Promise<R2FileDescriptor> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const key = objectPath.slice("/objects/".length);
    const bucket = key.startsWith("public/") ? FILES_BUCKET : PRIVATE_BUCKET;
    try {
      await objectStorageClient.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
    } catch {
      throw new ObjectNotFoundError();
    }
    return { bucket, key, isPublic: bucket === FILES_BUCKET };
  }

  // Convert a raw R2 presigned URL back to an /objects/<key> path.
  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith("/objects/")) return rawPath;
    if (rawPath.includes(".r2.cloudflarestorage.com/")) {
      try {
        const url = new URL(rawPath);
        const parts = url.pathname.split("/").filter(Boolean);
        // pathname: /<bucket>/<key...>  — strip the bucket segment
        const key =
          parts[0] === FILES_BUCKET || parts[0] === PRIVATE_BUCKET
            ? parts.slice(1).join("/")
            : parts.join("/");
        return `/objects/${key}`;
      } catch {
        return rawPath;
      }
    }
    return rawPath;
  }

  // ACL stub — R2 uses bucket-level policies, not per-object ACLs.
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    _aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    return this.normalizeObjectEntityPath(rawPath);
  }

  // Download an object to a Buffer (used by OCR scheduler and Drive sync).
  async downloadObjectToBuffer(storageKey: string): Promise<Buffer> {
    const file = await this.getObjectEntityFile(storageKey);
    const s3Res = await objectStorageClient.send(
      new GetObjectCommand({ Bucket: file.bucket, Key: file.key }),
    );
    const bodyBytes = await s3Res.Body?.transformToByteArray();
    if (!bodyBytes) throw new ObjectNotFoundError();
    return Buffer.from(bodyBytes);
  }

  // Delete a stored object by its /objects/* path.
  async deleteObject(objectPath: string): Promise<void> {
    if (!objectPath.startsWith("/objects/")) return;
    const key = objectPath.slice("/objects/".length);
    const bucket = key.startsWith("public/") ? FILES_BUCKET : PRIVATE_BUCKET;
    await objectStorageClient.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
  }

  // ACL check stub — R2 enforces visibility at bucket level.
  async canAccessObjectEntity({
    objectFile,
  }: {
    userId?: string;
    objectFile: R2FileDescriptor;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return objectFile.isPublic;
  }
}
