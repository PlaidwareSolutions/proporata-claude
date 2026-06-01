import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { authenticateJwt } from "../middleware/auth.js";

const router: IRouter = Router();

router.get("/notifications", authenticateJwt, async (req, res) => {
  try {
    const userId = req.user!.id;
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, userId))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(50);
    res.json(rows.map(toNotification));
  } catch (err) {
    console.error("GET /notifications error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/notifications/:id/read", authenticateJwt, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid notification id" });
    return;
  }
  try {
    const userId = req.user!.id;
    const [updated] = await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json(toNotification(updated));
  } catch (err) {
    console.error("PATCH /notifications/:id/read error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/notifications/read-all", authenticateJwt, async (req, res) => {
  try {
    const userId = req.user!.id;
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));
    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /notifications/read-all error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function toNotification(row: typeof notificationsTable.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    message: row.message,
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    read: row.read,
    createdAt: row.createdAt,
  };
}

export default router;
