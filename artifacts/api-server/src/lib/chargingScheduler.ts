import { db } from "@workspace/db";
import {
  chargingPortsTable,
  chargingSessionsTable,
  chargingSessionUsageSamplesTable,
  chargingReservationsTable,
  ledgerEntriesTable,
  ownerAccountsTable,
} from "@workspace/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { logger } from "./logger.js";
import { getProvider } from "./meteredAmenity.js";
import { processNoShowForfeitures, type NoShowPersistence } from "./chargingPersistence.js";
import { finalizeSession } from "../routes/charging.js";

const TICK_MS = 60 * 1000;

function nowIso(): string { return new Date().toISOString(); }

async function pollActiveSessions(): Promise<void> {
  const active = await db.select().from(chargingSessionsTable)
    .where(eq(chargingSessionsTable.status, "active"));
  if (active.length === 0) return;
  const ports = await db.select().from(chargingPortsTable);
  const portById = new Map(ports.map((p) => [p.id, p]));
  const now = nowIso();
  for (const s of active) {
    const port = portById.get(s.portId);
    if (!port) continue;
    try {
      if (port.provider !== "manual") {
        const provider = getProvider(port);
        const snap = await provider.pollUsage(s.providerSessionRef, port);
        await db.insert(chargingSessionUsageSamplesTable).values({
          sessionId: s.id,
          sampledAt: now,
          kwh: String(snap.kwh),
          powerKw: snap.powerKw != null ? String(snap.powerKw) : null,
        });
        await db.update(chargingSessionsTable).set({
          kwh: String(snap.kwh), lastPolledAt: now, updatedAt: now,
        }).where(eq(chargingSessionsTable.id, s.id));
        if (snap.status === "stopped") {
          await finalizeSession(s.id, { overrideKwh: snap.finalKwh ?? snap.kwh, endAt: snap.endedAt ?? now });
          continue;
        }
      }
      // Auto-finalize once we go idleCap minutes past scheduled end.
      if (s.scheduledEndAt) {
        const end = new Date(s.scheduledEndAt).getTime();
        const capMin = port.idleCapCents > 0 && port.idlePerMinuteCents > 0
          ? Math.ceil(port.idleCapCents / port.idlePerMinuteCents) + port.idleGraceMinutes
          : port.idleGraceMinutes + 60;
        if (Date.now() - end > capMin * 60 * 1000) {
          await finalizeSession(s.id, { endAt: now });
        }
      }
    } catch (err) {
      logger.error({ err, sessionId: s.id }, "EV poll tick failed");
    }
  }
}

function dbNoShowPersistence(): NoShowPersistence {
  return {
    async listStalePendingReservations(now) {
      return db.select().from(chargingReservationsTable)
        .where(and(
          eq(chargingReservationsTable.status, "pending"),
          lt(chargingReservationsTable.startsAt, now),
        ));
    },
    async listPorts() {
      return db.select().from(chargingPortsTable);
    },
    async ensureOwnerAccount(unitId, now) {
      const [acct] = await db.select().from(ownerAccountsTable).where(eq(ownerAccountsTable.unitId, unitId));
      if (acct) return { id: acct.id };
      const [created] = await db.insert(ownerAccountsTable).values({
        unitId, openingBalance: 0, createdAt: now,
      }).returning();
      return { id: created.id };
    },
    async insertNoShowFee(input) {
      const [entry] = await db.insert(ledgerEntriesTable).values({
        ownerAccountId: input.ownerAccountId,
        occurredOn: input.occurredOn,
        postedAt: input.postedAt,
        kind: "charge",
        chargeType: "ev_charging",
        paymentMethod: null,
        amountCents: input.amountCents,
        memo: input.memo,
        postedBy: input.postedBy,
        batchRef: input.batchRef,
      }).returning();
      return { id: entry.id };
    },
    async markReservationNoShow(reservationId, ledgerEntryId, now) {
      await db.update(chargingReservationsTable).set({
        status: "no_show",
        noShowFeeLedgerEntryId: ledgerEntryId,
        updatedAt: now,
      }).where(eq(chargingReservationsTable.id, reservationId));
    },
    logError(err, ctx) {
      logger.error({ err, reservationId: ctx.reservationId }, "Failed to post no-show fee");
    },
  };
}

async function forfeitNoShows(): Promise<void> {
  await processNoShowForfeitures(dbNoShowPersistence(), new Date());
}

export function startChargingScheduler(): void {
  const tick = async () => {
    try {
      await pollActiveSessions();
      await forfeitNoShows();
    } catch (err) {
      logger.error({ err }, "Charging scheduler tick failed");
    }
  };
  setTimeout(tick, 10_000);
  setInterval(tick, TICK_MS);
}
