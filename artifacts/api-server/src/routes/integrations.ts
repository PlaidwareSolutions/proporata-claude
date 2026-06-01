import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { orgSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { driveService } from "../lib/driveService";
import { ObjectStorageService } from "../lib/objectStorage";
import { requireAdmin } from "../middleware/auth.js";

const router: IRouter = Router();
const storage = new ObjectStorageService();

router.get("/integrations/google-drive/status", async (req, res) => {
  const [settings] = await db.select().from(orgSettingsTable).where(eq(orgSettingsTable.id, 1));
  if (!settings || !settings.driveRefreshToken) {
    res.json({
      connected: false,
      accountEmail: null,
      connectedAt: null,
      enabled: false,
      lastSyncAt: null,
      lastSyncCount: null,
      lastSyncFailures: 0,
      syncInProgress: false,
      syncProgressDone: 0,
      syncProgressTotal: 0,
    });
    return;
  }
  res.json({
    connected: true,
    accountEmail: settings.driveAccountEmail ?? null,
    connectedAt: settings.driveConnectedAt ?? null,
    enabled: settings.driveEnabled ?? false,
    lastSyncAt: settings.driveLastSyncAt ?? null,
    lastSyncCount: settings.driveLastSyncCount ?? null,
    lastSyncFailures: settings.driveLastSyncFailures ?? 0,
    syncInProgress: settings.driveSyncInProgress ?? false,
    syncProgressDone: settings.driveSyncProgressDone ?? 0,
    syncProgressTotal: settings.driveSyncProgressTotal ?? 0,
  });
});

router.get("/integrations/google-drive/connect", (req, res) => {
  try {
    const url = driveService.getAuthUrl();
    res.redirect(url);
  } catch (err) {
    res.status(503).json({ error: "Google Drive OAuth not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI environment variables." });
  }
});

router.get("/integrations/google-drive/callback", async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).json({ error: "Missing OAuth code" });
    return;
  }

  try {
    const { refreshToken, email } = await driveService.exchangeCode(code);

    await db
      .insert(orgSettingsTable)
      .values({
        id: 1,
        driveRefreshToken: refreshToken,
        driveAccountEmail: email,
        driveConnectedAt: new Date().toISOString(),
        driveEnabled: true,
      })
      .onConflictDoUpdate({
        target: orgSettingsTable.id,
        set: {
          driveRefreshToken: refreshToken,
          driveAccountEmail: email,
          driveConnectedAt: new Date().toISOString(),
          driveEnabled: true,
        },
      });

    res.redirect("/?drive_connected=1");
  } catch (err) {
    req.log.error({ err }, "Google Drive OAuth callback failed");
    res.status(500).json({ error: "OAuth exchange failed" });
  }
});

router.post("/integrations/google-drive/disconnect", async (req, res) => {
  await db
    .insert(orgSettingsTable)
    .values({
      id: 1,
      driveRefreshToken: null,
      driveAccountEmail: null,
      driveConnectedAt: null,
      driveEnabled: false,
    })
    .onConflictDoUpdate({
      target: orgSettingsTable.id,
      set: {
        driveRefreshToken: null,
        driveAccountEmail: null,
        driveConnectedAt: null,
        driveEnabled: false,
      },
    });

  res.json({
    connected: false,
    accountEmail: null,
    connectedAt: null,
    enabled: false,
    lastSyncAt: null,
    lastSyncCount: null,
    lastSyncFailures: 0,
    syncInProgress: false,
    syncProgressDone: 0,
    syncProgressTotal: 0,
  });
});

router.post("/integrations/google-drive/resync", requireAdmin, async (req, res) => {
  const [settings] = await db.select().from(orgSettingsTable).where(eq(orgSettingsTable.id, 1));
  if (!settings?.driveEnabled || !settings.driveRefreshToken) {
    res.status(400).json({ error: "Google Drive is not connected" });
    return;
  }
  if (settings.driveSyncInProgress) {
    res.status(409).json({ error: "A sync is already in progress" });
    return;
  }

  // Mark in-progress synchronously *before* returning so any immediate
  // /status poll from the UI sees syncInProgress=true and starts polling.
  await db
    .update(orgSettingsTable)
    .set({
      driveSyncInProgress: true,
      driveSyncProgressDone: 0,
      driveSyncProgressTotal: 0,
    })
    .where(eq(orgSettingsTable.id, 1));

  // Kick off the actual work in the background; UI polls /status.
  const log = req.log;
  void driveService
    .resyncAll((storageKey) => storage.downloadObjectToBuffer(storageKey))
    .catch(async (err) => {
      log.error({ err }, "Google Drive resync failed");
      // Make sure the flag clears even on hard failures.
      await db
        .update(orgSettingsTable)
        .set({ driveSyncInProgress: false })
        .where(eq(orgSettingsTable.id, 1))
        .catch(() => {});
    });

  res.status(202).json({ started: true });
});

export default router;
