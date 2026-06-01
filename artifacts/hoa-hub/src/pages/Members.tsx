// Membership roster (manager-only).
//
// One row per unit. Tenants are NOT shown here — they are not legal
// members. Managers can see who is in good standing (eligible to vote)
// vs. who has been suspended (past-due dues or admin override). Admins
// can manually override an owner's ownership_status from this page.

import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Users, AlertTriangle, RefreshCcw, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type OwnershipStatus = "active" | "suspended_voting" | "closed";

type Member = {
  unitId: string;
  unit: string;
  building: number;
  ownerName: string;
  ownerEmail: string | null;
  ownerUserId: number | null;
  boardMember: boolean;
  ownershipStatus: OwnershipStatus;
  ownershipStatusChangedAt: string | null;
  ownershipStatusReason: string | null;
  hasOwnerAccount: boolean;
  balanceCents: number;
  oldestUnpaidChargeAt: string | null;
  daysPastDue: number;
  inGoodStanding: boolean;
  ineligibilityReason: string | null;
};

function fmtUSD(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents) / 100;
  return `${sign}$${abs.toFixed(2)}`;
}

type Roster = {
  members: Member[];
  counts: { total: number; inGoodStanding: number; notInGoodStanding: number };
};

const STATUS_LABEL: Record<OwnershipStatus, string> = {
  active: "Active",
  suspended_voting: "Suspended (no vote)",
  closed: "Closed",
};

export default function MembersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [roster, setRoster] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "good" | "not_good">("all");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const base = import.meta.env.BASE_URL;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${base}api/members`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as Roster;
      setRoster(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function recompute() {
    setBusy(true);
    try {
      await fetch(`${base}api/members/recompute`, { method: "POST", credentials: "include" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(unitId: string, status: OwnershipStatus) {
    const reason = window.prompt(`Reason for changing ownership status to "${STATUS_LABEL[status]}":`);
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`${base}api/members/${encodeURIComponent(unitId)}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: reason.trim() }),
      });
      if (!r.ok) {
        const txt = await r.text();
        alert(`Update failed: ${txt}`);
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const rows = roster?.members ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((m) => {
      if (filter === "good" && !m.inGoodStanding) return false;
      if (filter === "not_good" && m.inGoodStanding) return false;
      if (q) {
        const hay = `${m.unit} ${m.ownerName} ${m.ownerEmail ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [roster, filter, search]);

  return (
    <Layout
      title="Members"
      subtitle="Legal HOA members (one row per unit, owners only). Tenants and portal-only users are not members."
      actions={
        <button
          onClick={recompute}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-[13px] hover:bg-slate-50 disabled:opacity-50"
          style={{ borderColor: c.border }}
          data-testid="members-recompute"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          Recompute eligibility
        </button>
      }
    >
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        {error && (
          <div className="rounded-md border bg-red-50 px-3 py-2 text-[13px] text-red-700" style={{ borderColor: "#fecaca" }}>
            {error}
          </div>
        )}

        <section className="rounded-xl border bg-white p-4" style={{ borderColor: c.border }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" style={{ color: c.cobalt }} />
              <span className="text-[13px] font-semibold">Roster</span>
            </div>
            {roster && (
              <div className="text-[12px]" style={{ color: c.inkMute }}>
                <span data-testid="members-total">{roster.counts.total}</span> total ·{" "}
                <span className="text-emerald-700" data-testid="members-good">{roster.counts.inGoodStanding}</span> in good standing ·{" "}
                <span className="text-amber-700" data-testid="members-not-good">{roster.counts.notInGoodStanding}</span> suspended/closed
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search unit, owner, email"
                className="rounded-md border px-2 py-1 text-[13px]"
                style={{ borderColor: c.border }}
                data-testid="members-search"
              />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as typeof filter)}
                className="rounded-md border px-2 py-1 text-[13px]"
                style={{ borderColor: c.border }}
                data-testid="members-filter"
              >
                <option value="all">All</option>
                <option value="good">In good standing</option>
                <option value="not_good">Not in good standing</option>
              </select>
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider" style={{ color: c.inkMute }}>
              <tr>
                <th className="px-3 py-2">Building</th>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2 text-right">Days past due</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Eligible</th>
                <th className="px-3 py-2">Unit page</th>
                {isAdmin && <th className="px-3 py-2">Override</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={isAdmin ? 10 : 9} className="px-3 py-6 text-center" style={{ color: c.inkMute }}>Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={isAdmin ? 10 : 9} className="px-3 py-6 text-center" style={{ color: c.inkMute }}>No members match.</td></tr>
              )}
              {!loading && filtered.map((m) => (
                <tr key={m.unitId} className="border-t" style={{ borderColor: c.border }} data-testid={`member-row-${m.unitId}`}>
                  <td className="px-3 py-2 font-mono-num">{m.building}</td>
                  <td className="px-3 py-2 font-mono-num">{m.unit}</td>
                  <td className="px-3 py-2">
                    {m.ownerName}
                    {m.boardMember && (
                      <span className="ml-1.5 inline-flex items-center rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                        Board
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2" style={{ color: c.inkMute }}>{m.ownerEmail ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono-num">
                    <span style={{ color: m.balanceCents > 0 ? "#B8264C" : c.inkMute }}>{fmtUSD(m.balanceCents)}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono-num">
                    {m.daysPastDue > 0 ? <span style={{ color: "#92400E" }}>{m.daysPastDue}</span> : <span style={{ color: c.inkMute }}>—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold"
                      style={
                        m.ownershipStatus === "active"
                          ? { background: "#DCF3EC", color: "#0E8A6B" }
                          : m.ownershipStatus === "suspended_voting"
                            ? { background: "#FEF3C7", color: "#92400E" }
                            : { background: "#F3F4F6", color: "#6B7280" }
                      }
                    >
                      {STATUS_LABEL[m.ownershipStatus]}
                    </span>
                    {m.ownershipStatusReason && (
                      <div className="text-[11px] mt-0.5" style={{ color: c.inkMute }}>{m.ownershipStatusReason}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {m.inGoodStanding ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700"><Check className="h-3.5 w-3.5" /> Yes</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700" title={m.ineligibilityReason ?? undefined}><AlertTriangle className="h-3.5 w-3.5" /> No</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/units/${encodeURIComponent(m.unitId)}`}
                      className="text-[12px] underline"
                      style={{ color: c.cobalt }}
                      data-testid={`member-unit-link-${m.unitId}`}
                    >
                      View
                    </Link>
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2">
                      <select
                        value={m.ownershipStatus}
                        disabled={busy}
                        onChange={(e) => setStatus(m.unitId, e.target.value as OwnershipStatus)}
                        className="rounded border px-1 py-0.5 text-[12px]"
                        style={{ borderColor: c.border }}
                        data-testid={`member-status-${m.unitId}`}
                      >
                        <option value="active">Active</option>
                        <option value="suspended_voting">Suspend voting</option>
                        <option value="closed">Close account</option>
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </Layout>
  );
}
