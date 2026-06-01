// Task #86: Provider abstraction for metered amenities (EV charging today,
// reusable for water/electric submetering tomorrow). Two adapters ship: a
// manual-readings adapter where an admin enters meter values after the fact,
// and a stub OCPP-style HTTP adapter that mirrors a typical start/stop/poll
// integration.

import type { ChargingPort } from "@workspace/db/schema";

export interface ProviderStartContext {
  port: ChargingPort;
  ownerUserId: number;
  unitId: string | null;
  scheduledEndAt: string | null;
  reservationId?: number | null;
}

export interface ProviderUsageSnapshot {
  kwh: number;
  powerKw?: number | null;
  status: "active" | "stopped";
  finalKwh?: number | null;
  endedAt?: string | null;
}

export interface MeteredAmenityProvider {
  readonly id: string;
  startSession(ctx: ProviderStartContext): Promise<{ providerSessionRef: string | null; meterStartKwh: number | null }>;
  pollUsage(providerSessionRef: string | null, port: ChargingPort): Promise<ProviderUsageSnapshot>;
  stopSession(providerSessionRef: string | null, port: ChargingPort): Promise<{ finalKwh: number | null; endedAt: string }>;
}

class ManualReadingsProvider implements MeteredAmenityProvider {
  readonly id = "manual";
  async startSession(): Promise<{ providerSessionRef: string | null; meterStartKwh: number | null }> {
    return { providerSessionRef: null, meterStartKwh: null };
  }
  async pollUsage(): Promise<ProviderUsageSnapshot> {
    return { kwh: 0, powerKw: null, status: "active" };
  }
  async stopSession(): Promise<{ finalKwh: number | null; endedAt: string }> {
    return { finalKwh: null, endedAt: new Date().toISOString() };
  }
}

class StubHttpProvider implements MeteredAmenityProvider {
  readonly id = "stub_http";
  async startSession(ctx: ProviderStartContext): Promise<{ providerSessionRef: string | null; meterStartKwh: number | null }> {
    const ref = `stub-${ctx.port.id}-${Date.now()}`;
    return { providerSessionRef: ref, meterStartKwh: 0 };
  }
  async pollUsage(providerSessionRef: string | null, port: ChargingPort): Promise<ProviderUsageSnapshot> {
    if (!providerSessionRef) return { kwh: 0, powerKw: 0, status: "active" };
    const parts = providerSessionRef.split("-");
    const startedMs = Number(parts[parts.length - 1]);
    if (!Number.isFinite(startedMs)) return { kwh: 0, powerKw: 0, status: "active" };
    const elapsedHours = Math.max(0, (Date.now() - startedMs) / (1000 * 60 * 60));
    const power = port.maxKw;
    const kwh = +(elapsedHours * power).toFixed(4);
    return { kwh, powerKw: power, status: "active" };
  }
  async stopSession(providerSessionRef: string | null, port: ChargingPort): Promise<{ finalKwh: number | null; endedAt: string }> {
    const snap = await this.pollUsage(providerSessionRef, port);
    return { finalKwh: snap.kwh, endedAt: new Date().toISOString() };
  }
}

// Lazy-resolved at first use to avoid a circular import at module load
// (ocppProvider.ts imports interfaces from this file).
let ocppProviderRef: MeteredAmenityProvider | null = null;
async function loadOcppProvider(): Promise<MeteredAmenityProvider> {
  if (ocppProviderRef) return ocppProviderRef;
  const mod = await import("./ocppProvider.js");
  ocppProviderRef = mod.ocpp16Provider;
  return ocppProviderRef;
}

const PROVIDERS: Record<string, MeteredAmenityProvider> = {
  manual: new ManualReadingsProvider(),
  stub_http: new StubHttpProvider(),
  // Real OCPP 1.6-J adapter loaded lazily via getProvider().
  ocpp16: new Proxy({} as MeteredAmenityProvider, {
    get(_t, prop: keyof MeteredAmenityProvider) {
      if (prop === "id") return "ocpp16";
      return async (...args: unknown[]) => {
        const real = await loadOcppProvider();
        const fn = (real as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string];
        return fn.apply(real, args);
      };
    },
  }),
};

export function getProvider(port: ChargingPort): MeteredAmenityProvider {
  return PROVIDERS[port.provider] ?? PROVIDERS.manual;
}

// ── Cost engine ──────────────────────────────────────────────────────────

export interface CostInputs {
  kwh: number;
  perKwhCents: number;
  idleMinutes: number;
  idlePerMinuteCents: number;
  idleCapCents: number;
}

export interface CostBreakdown {
  energyCostCents: number;
  idleCostCents: number;
  totalCostCents: number;
}

export function computeSessionCost(input: CostInputs): CostBreakdown {
  const energy = Math.max(0, Math.round(input.kwh * input.perKwhCents));
  const rawIdle = Math.max(0, input.idleMinutes) * Math.max(0, input.idlePerMinuteCents);
  const idle = Math.min(rawIdle, Math.max(0, input.idleCapCents || 0) || rawIdle);
  return { energyCostCents: energy, idleCostCents: idle, totalCostCents: energy + idle };
}

export function computeIdleMinutes(args: {
  scheduledEndAt: string | null;
  endAt: string | null;
  idleGraceMinutes: number;
}): number {
  if (!args.scheduledEndAt || !args.endAt) return 0;
  const sched = new Date(args.scheduledEndAt).getTime();
  const ended = new Date(args.endAt).getTime();
  if (!Number.isFinite(sched) || !Number.isFinite(ended)) return 0;
  const overrunMs = ended - sched - Math.max(0, args.idleGraceMinutes) * 60 * 1000;
  if (overrunMs <= 0) return 0;
  return Math.ceil(overrunMs / (60 * 1000));
}
