import { google } from "googleapis";
import { db } from "@workspace/db";
import { buildingsTable, unitsTable, orgSettingsTable, documentsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const ROOT_FOLDER_NAME = "Quail Valley HOA Documents";
const MASTER_INDEX_NAME = "01 Master Index";
const SHARED_FOLDER_NAME = "Building (shared)";

// Canonical sub-folder list. Mirror of SUB_FOLDERS in
// artifacts/hoa-hub/src/pages/Documents.tsx — keep in sync.
// Order matches the UI tree. `category` maps a document category to a
// sub-folder; sub-folders without a category (Work Orders) still exist in
// the Drive tree but receive no document uploads from this service.
const SUB_FOLDERS: Array<{ label: string; category: string | null }> = [
  { label: "Work Orders",    category: null },
  { label: "Insurance",      category: "Insurance" },
  { label: "Roof Documents", category: "Inspection" },
  { label: "Correspondence", category: "Meeting" },
  { label: "Financial",      category: "Financial" },
  { label: "Vendor Docs",    category: "Vendor" },
  { label: "Bylaws",         category: "Bylaws" },
];
const SUB_FOLDER_LABELS = SUB_FOLDERS.map((s) => s.label);
const CATEGORY_TO_SUB: Record<string, string> = SUB_FOLDERS.reduce((acc, s) => {
  if (s.category) acc[s.category] = s.label;
  return acc;
}, {} as Record<string, string>);

type DriveClient = ReturnType<typeof google.drive>;

export interface DocumentLike {
  id: string;
  name: string;
  category: string;
  building: number | null;
  unit: string | null;
}

interface DriveContext {
  drive: DriveClient;
  refreshToken: string;
}

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth credentials not configured");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function buildDriveClient(refreshToken: string): DriveClient {
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth: oauth2 });
}

async function findFolderByName(
  drive: DriveClient,
  name: string,
  parentId: string | null,
): Promise<string | null> {
  const query = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`,
    parentId ? `'${parentId}' in parents` : undefined,
  ]
    .filter(Boolean)
    .join(" and ");
  const resp = await drive.files.list({ q: query, fields: "files(id,name)", spaces: "drive" });
  return resp.data.files?.[0]?.id ?? null;
}

async function createFolder(
  drive: DriveClient,
  name: string,
  parentId: string | null,
): Promise<string> {
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error("Drive folder create returned no id");
  return created.data.id;
}

/**
 * Resolve a folder id without validating cached ids on every call. Cached ids
 * are trusted until they actually fail at upload time (handled by the upload
 * recovery path). This keeps the typical hot path to **zero** Drive calls
 * before the file create itself.
 */
async function ensureFolder(
  drive: DriveClient,
  cachedId: string | null | undefined,
  name: string,
  parentId: string | null,
): Promise<string> {
  if (cachedId) return cachedId;
  const found = await findFolderByName(drive, name, parentId);
  if (found) return found;
  return await createFolder(drive, name, parentId);
}

function buildingFolderName(num: number, address: string): string {
  return `Bldg ${String(num).padStart(2, "0")} — ${address}`.trim();
}

function unitFolderName(unitNumber: string, address: string): string {
  return `Unit ${unitNumber}${address ? ` ${address}` : ""}`.trim();
}

interface SettingsCache {
  driveRootFolderId: string | null;
  driveMasterIndexFolderId: string | null;
}

async function ensureRootId(
  ctx: DriveContext,
  s: SettingsCache,
): Promise<string> {
  if (s.driveRootFolderId) return s.driveRootFolderId;
  const id = await ensureFolder(ctx.drive, null, ROOT_FOLDER_NAME, null);
  await db
    .update(orgSettingsTable)
    .set({ driveRootFolderId: id })
    .where(eq(orgSettingsTable.id, 1));
  s.driveRootFolderId = id;
  return id;
}

async function ensureMasterIndexId(
  ctx: DriveContext,
  s: SettingsCache,
): Promise<string> {
  if (s.driveMasterIndexFolderId) return s.driveMasterIndexFolderId;
  const rootId = await ensureRootId(ctx, s);
  const id = await ensureFolder(ctx.drive, null, MASTER_INDEX_NAME, rootId);
  await db
    .update(orgSettingsTable)
    .set({ driveMasterIndexFolderId: id })
    .where(eq(orgSettingsTable.id, 1));
  s.driveMasterIndexFolderId = id;
  return id;
}

async function ensureBuildingTree(
  ctx: DriveContext,
  s: SettingsCache,
  buildingNum: number,
): Promise<{
  buildingId: string;
  sharedId: string;
  sharedSubs: Record<string, string>;
}> {
  const [b] = await db.select().from(buildingsTable).where(eq(buildingsTable.num, buildingNum));
  if (!b) throw new Error(`Building ${buildingNum} not found`);

  let buildingId = b.driveFolderId ?? null;
  let sharedId = b.driveSharedFolderId ?? null;
  const subs: Record<string, string> = { ...(b.driveSubfolderIds ?? {}) };

  let dirty = false;
  if (!buildingId) {
    const rootId = await ensureRootId(ctx, s);
    buildingId = await ensureFolder(ctx.drive, null, buildingFolderName(b.num, b.address), rootId);
    dirty = true;
  }
  if (!sharedId) {
    sharedId = await ensureFolder(ctx.drive, null, SHARED_FOLDER_NAME, buildingId);
    dirty = true;
  }
  for (const label of SUB_FOLDER_LABELS) {
    if (!subs[label]) {
      subs[label] = await ensureFolder(ctx.drive, null, label, sharedId);
      dirty = true;
    }
  }
  if (dirty) {
    await db
      .update(buildingsTable)
      .set({ driveFolderId: buildingId, driveSharedFolderId: sharedId, driveSubfolderIds: subs })
      .where(eq(buildingsTable.num, buildingNum));
  }
  return { buildingId, sharedId, sharedSubs: subs };
}

async function ensureUnitTree(
  ctx: DriveContext,
  s: SettingsCache,
  unitId: string,
): Promise<{ unitFolderId: string; subs: Record<string, string> }> {
  const [u] = await db.select().from(unitsTable).where(eq(unitsTable.id, unitId));
  if (!u) throw new Error(`Unit ${unitId} not found`);

  const { buildingId } = await ensureBuildingTree(ctx, s, u.building);
  let unitFolderId = u.driveFolderId ?? null;
  const subs: Record<string, string> = { ...(u.driveSubfolderIds ?? {}) };

  let dirty = false;
  if (!unitFolderId) {
    unitFolderId = await ensureFolder(ctx.drive, null, unitFolderName(u.unit, u.address), buildingId);
    dirty = true;
  }
  for (const label of SUB_FOLDER_LABELS) {
    if (!subs[label]) {
      subs[label] = await ensureFolder(ctx.drive, null, label, unitFolderId);
      dirty = true;
    }
  }
  if (dirty) {
    await db
      .update(unitsTable)
      .set({ driveFolderId: unitFolderId, driveSubfolderIds: subs })
      .where(eq(unitsTable.id, unitId));
  }
  return { unitFolderId, subs };
}

/**
 * Resolve the leaf folder id for a document. In the typical cache-warm path
 * this performs zero Drive API calls — every id comes from the row cache.
 */
async function resolveTargetFolderId(
  ctx: DriveContext,
  s: SettingsCache,
  doc: DocumentLike,
): Promise<string> {
  if (doc.building == null) {
    return await ensureMasterIndexId(ctx, s);
  }
  const subLabel = CATEGORY_TO_SUB[doc.category];
  if (doc.unit) {
    const { unitFolderId, subs } = await ensureUnitTree(ctx, s, doc.unit);
    return subLabel ? subs[subLabel] : unitFolderId;
  }
  const { sharedId, sharedSubs } = await ensureBuildingTree(ctx, s, doc.building);
  return subLabel ? sharedSubs[subLabel] : sharedId;
}

async function getContext(): Promise<{ ctx: DriveContext; settings: SettingsCache } | null> {
  const [settings] = await db.select().from(orgSettingsTable).where(eq(orgSettingsTable.id, 1));
  if (!settings?.driveEnabled || !settings.driveRefreshToken) return null;
  return {
    ctx: { drive: buildDriveClient(settings.driveRefreshToken), refreshToken: settings.driveRefreshToken },
    settings: {
      driveRootFolderId: settings.driveRootFolderId ?? null,
      driveMasterIndexFolderId: settings.driveMasterIndexFolderId ?? null,
    },
  };
}

async function clearCachedFoldersForDoc(doc: DocumentLike): Promise<void> {
  // Best-effort cache invalidation when a cached parent id turns out to be
  // stale (e.g. file create/update hit a 404). Wipe the relevant cached ids
  // — including the root, so a manually-deleted root folder is rediscovered
  // or recreated on the next call. findFolderByName already filters
  // `trashed = false`, so we won't rebind to a trashed folder here.
  await db
    .update(orgSettingsTable)
    .set({ driveRootFolderId: null, driveMasterIndexFolderId: null })
    .where(eq(orgSettingsTable.id, 1));
  if (doc.building == null) return;
  if (doc.unit) {
    await db
      .update(unitsTable)
      .set({ driveFolderId: null, driveSubfolderIds: null })
      .where(eq(unitsTable.id, doc.unit));
  }
  await db
    .update(buildingsTable)
    .set({ driveFolderId: null, driveSharedFolderId: null, driveSubfolderIds: null })
    .where(eq(buildingsTable.num, doc.building));
}

export const driveService = {
  getAuthUrl(): string {
    const oauth2 = getOAuth2Client();
    return oauth2.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent" });
  },

  async exchangeCode(code: string): Promise<{ refreshToken: string; email: string }> {
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    const oauth2Info = google.oauth2({ version: "v2", auth: oauth2 });
    const userInfo = await oauth2Info.userinfo.get();
    return { refreshToken: tokens.refresh_token!, email: userInfo.data.email ?? "unknown" };
  },

  async uploadDocument(doc: DocumentLike, fileBuffer: Buffer, mimeType: string): Promise<string | null> {
    const got = await getContext();
    if (!got) return null;
    const { ctx, settings } = got;
    const { Readable } = await import("stream");

    const attempt = async (): Promise<string | null> => {
      const targetFolderId = await resolveTargetFolderId(ctx, settings, doc);
      const file = await ctx.drive.files.create({
        requestBody: { name: doc.name, parents: [targetFolderId] },
        media: { mimeType, body: Readable.from(fileBuffer) },
        fields: "id",
      });
      return file.data.id ?? null;
    };

    try {
      return await attempt();
    } catch (err: unknown) {
      const status = (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
      if (status === 404) {
        // Stale cached parent id — wipe and retry once.
        await clearCachedFoldersForDoc(doc);
        settings.driveRootFolderId = null;
        settings.driveMasterIndexFolderId = null;
        return await attempt();
      }
      throw err;
    }
  },

  async moveDocument(doc: DocumentLike, fileId: string): Promise<void> {
    const got = await getContext();
    if (!got) return;
    const { ctx, settings } = got;

    const attempt = async () => {
      const targetFolderId = await resolveTargetFolderId(ctx, settings, doc);
      const meta = await ctx.drive.files.get({ fileId, fields: "parents" });
      const oldParents = (meta.data.parents ?? []).join(",");
      await ctx.drive.files.update({
        fileId,
        addParents: targetFolderId,
        removeParents: oldParents || undefined,
        fields: "id,parents",
      });
    };

    try {
      await attempt();
    } catch (err: unknown) {
      const status = (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
      if (status === 404) {
        await clearCachedFoldersForDoc(doc);
        settings.driveRootFolderId = null;
        settings.driveMasterIndexFolderId = null;
        await attempt();
      } else {
        throw err;
      }
    }
  },

  async trashDocument(fileId: string): Promise<void> {
    const got = await getContext();
    if (!got) return;
    await got.ctx.drive.files.update({ fileId, requestBody: { trashed: true } });
  },

  async renameBuildingFolder(buildingNum: number): Promise<void> {
    const got = await getContext();
    if (!got) return;
    const [b] = await db.select().from(buildingsTable).where(eq(buildingsTable.num, buildingNum));
    if (!b?.driveFolderId) return;
    await got.ctx.drive.files.update({
      fileId: b.driveFolderId,
      requestBody: { name: buildingFolderName(b.num, b.address) },
    });
  },

  async renameUnitFolder(unitId: string): Promise<void> {
    const got = await getContext();
    if (!got) return;
    const [u] = await db.select().from(unitsTable).where(eq(unitsTable.id, unitId));
    if (!u?.driveFolderId) return;
    await got.ctx.drive.files.update({
      fileId: u.driveFolderId,
      requestBody: { name: unitFolderName(u.unit, u.address) },
    });
  },

  /**
   * Pre-warm the entire on-screen folder tree (root, master index, every
   * building with shared + 7 subs, every unit with 7 subs), then walk every
   * document and upload anything missing a Drive id (or re-attach files
   * whose parents have drifted). Progress is written to org_settings during
   * the run so the Settings UI can poll for a live counter.
   */
  async resyncAll(
    loadFile: (storageKey: string) => Promise<Buffer>,
  ): Promise<{ synced: number; total: number; failures: number }> {
    const got = await getContext();
    if (!got) return { synced: 0, total: 0, failures: 0 };
    const { ctx, settings } = got;

    const buildings = await db.select().from(buildingsTable);
    const units = await db.select().from(unitsTable);
    const docs = await db.select().from(documentsTable);

    // Total work units: pre-warm steps + each doc.
    const totalSteps = 1 /* master idx */ + buildings.length + units.length + docs.length;
    let done = 0;
    let failures = 0;

    const writeProgress = async () => {
      await db
        .update(orgSettingsTable)
        .set({ driveSyncProgressDone: done, driveSyncProgressTotal: totalSteps })
        .where(eq(orgSettingsTable.id, 1));
    };

    await db
      .update(orgSettingsTable)
      .set({
        driveSyncInProgress: true,
        driveSyncProgressDone: 0,
        driveSyncProgressTotal: totalSteps,
      })
      .where(eq(orgSettingsTable.id, 1));

    try {
      try {
        await ensureMasterIndexId(ctx, settings);
      } catch {
        failures++;
      }
      done++;
      await writeProgress();

      for (const b of buildings) {
        try {
          await ensureBuildingTree(ctx, settings, b.num);
        } catch {
          failures++;
        }
        done++;
        if (done % 5 === 0) await writeProgress();
      }
      for (const u of units) {
        try {
          await ensureUnitTree(ctx, settings, u.id);
        } catch {
          failures++;
        }
        done++;
        if (done % 5 === 0) await writeProgress();
      }
      await writeProgress();

      let synced = 0;
      for (const d of docs) {
        try {
          if (!d.storageKey) {
            done++;
            continue;
          }
          const docLike: DocumentLike = {
            id: d.id,
            name: d.name,
            category: d.category,
            building: d.building ?? null,
            unit: d.unit ?? null,
          };
          if (d.driveFileId) {
            try {
              const targetFolderId = await resolveTargetFolderId(ctx, settings, docLike);
              const meta = await ctx.drive.files.get({
                fileId: d.driveFileId,
                fields: "parents,trashed",
              });
              if (meta.data.trashed) {
                const buf = await loadFile(d.storageKey);
                const newId = await driveService.uploadDocument(docLike, buf, "application/pdf");
                if (newId) {
                  await db
                    .update(documentsTable)
                    .set({ driveFileId: newId })
                    .where(eq(documentsTable.id, d.id));
                  synced++;
                }
              } else {
                const parents = meta.data.parents ?? [];
                if (!parents.includes(targetFolderId)) {
                  await ctx.drive.files.update({
                    fileId: d.driveFileId,
                    addParents: targetFolderId,
                    removeParents: parents.join(",") || undefined,
                    fields: "id,parents",
                  });
                }
                // Count every document successfully verified/re-parented in
                // Drive (not just newly uploaded ones) so the "files synced"
                // total reflects the full set the resync confirmed.
                synced++;
              }
            } catch {
              failures++;
            }
          } else {
            const buf = await loadFile(d.storageKey);
            const newId = await driveService.uploadDocument(docLike, buf, "application/pdf");
            if (newId) {
              await db
                .update(documentsTable)
                .set({ driveFileId: newId })
                .where(eq(documentsTable.id, d.id));
              synced++;
            }
          }
        } catch {
          failures++;
        }
        done++;
        if (done % 3 === 0) await writeProgress();
      }

      const now = new Date().toISOString();
      await db
        .update(orgSettingsTable)
        .set({
          driveLastSyncAt: now,
          driveLastSyncCount: synced,
          driveLastSyncFailures: failures,
          driveSyncInProgress: false,
          driveSyncProgressDone: totalSteps,
          driveSyncProgressTotal: totalSteps,
        })
        .where(eq(orgSettingsTable.id, 1));

      return { synced, total: docs.length, failures };
    } catch (err) {
      await db
        .update(orgSettingsTable)
        .set({ driveSyncInProgress: false })
        .where(eq(orgSettingsTable.id, 1));
      throw err;
    }
  },
};
