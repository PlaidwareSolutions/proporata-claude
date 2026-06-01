// Task #89: Admin UI for amenity compliance & safety records.
// Lists amenities with their rolled-up status, drilling into per-amenity
// management of postings, certificates, annual inspections, incidents,
// emergency procedure, and safety pins.

import { useMemo, useState } from "react";
import { c } from "@/lib/theme";
import {
  AlertTriangle, FileText, ShieldCheck, Pin, Loader2,
  Printer, Plus, Trash2, ClipboardList, Siren,
} from "lucide-react";
import {
  useListAmenities,
  useGetAmenityComplianceSummary,
  useListAmenityPostings,
  useListAmenityPostingIssuances,
  useCreateAmenityPosting,
  useDeleteAmenityPosting,
  useIssueAmenityPosting,
  useRemoveAmenityPostingIssuance,
  useListAmenityCertificates,
  useCreateAmenityCertificate,
  useDeleteAmenityCertificate,
  useListAmenityAnnualInspections,
  useCreateAmenityAnnualInspection,
  useListAmenityIncidents,
  useCreateAmenityIncident,
  useUpdateAmenityIncident,
  useGetAmenityEmergencyProcedure,
  usePutAmenityEmergencyProcedure,
  useListAmenitySafetyPins,
  useCreateAmenitySafetyPin,
  useDeleteAmenitySafetyPin,
  getGetAmenityComplianceSummaryQueryKey,
  getGetAmenityComplianceQueryKey,
  getListAmenityPostingsQueryKey,
  getListAmenityPostingIssuancesQueryKey,
  getListAmenityCertificatesQueryKey,
  getListAmenityAnnualInspectionsQueryKey,
  getListAmenityIncidentsQueryKey,
  getGetAmenityEmergencyProcedureQueryKey,
  getListAmenitySafetyPinsQueryKey,
  type Amenity,
  type AmenityComplianceSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

function StatusDot({ color }: { color: "green" | "amber" | "red" }) {
  const fg = color === "green" ? "#0E6F45" : color === "amber" ? "#9A6500" : "#9A2542";
  const bg = color === "green" ? "#DCF3EC" : color === "amber" ? "#FFF6D6" : "#FCE5EC";
  const label = color === "green" ? "OK" : color === "amber" ? "Warning" : "Action";
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: bg, color: fg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: fg }} />
      {label}
    </span>
  );
}

export function AmenityComplianceSettings() {
  const { data: amenities, isLoading } = useListAmenities();
  const { data: summary } = useGetAmenityComplianceSummary();
  const [selected, setSelected] = useState<Amenity | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[13px]" style={{ color: c.inkMute }}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading amenities…
      </div>
    );
  }
  if (!amenities?.length) {
    return <div className="text-[13px]" style={{ color: c.inkMute }}>No amenities configured.</div>;
  }

  const summaryById = new Map<number, AmenityComplianceSummary>();
  for (const s of summary ?? []) summaryById.set(s.amenityId, s);

  if (selected) {
    return <AmenityDrawer amenity={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
      <h3 className="text-[16px] mb-1" style={{ fontWeight: 700 }}>Amenity Compliance & Safety</h3>
      <p className="text-[13px] mb-4" style={{ color: c.inkMute, fontWeight: 500 }}>
        Required postings, certificates of insurance, annual inspections, incidents, and emergency procedures for each amenity.
      </p>
      <div className="space-y-2">
        {amenities.map((a) => (
          <AmenityRow key={a.id} amenity={a} summary={summaryById.get(a.id)} onOpen={() => setSelected(a)} />
        ))}
      </div>
    </section>
  );
}

function AmenityRow({ amenity, summary, onOpen }: { amenity: Amenity; summary: AmenityComplianceSummary | undefined; onOpen: () => void }) {
  const overall = summary?.overall ?? "amber";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border bg-white p-3 text-left hover:bg-slate-50"
      style={{ borderColor: c.border }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[14px]" style={{ fontWeight: 600, color: c.ink }}>{amenity.name}</div>
          <div className="text-[12px]" style={{ color: c.inkMute }}>
            {summary
              ? `${countByColor(summary, "red")} red · ${countByColor(summary, "amber")} amber · ${summary.openIncidents} open incident${summary.openIncidents === 1 ? "" : "s"}`
              : "—"}
          </div>
        </div>
        <StatusDot color={overall} />
      </div>
    </button>
  );
}

function countByColor(s: AmenityComplianceSummary, color: "red" | "amber" | "green"): number {
  let n = 0;
  for (const p of s.postings) if (p.color === color) n++;
  for (const cert of s.certificates) if (cert.color === color) n++;
  if (s.inspection.color === color) n++;
  return n;
}

type Tab = "postings" | "certs" | "inspections" | "incidents" | "emergency" | "pins";

function AmenityDrawer({ amenity, onBack }: { amenity: Amenity; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("postings");
  const tabs: { key: Tab; label: string; icon: typeof FileText }[] = [
    { key: "postings", label: "Postings", icon: FileText },
    { key: "certs", label: "Certificates", icon: ShieldCheck },
    { key: "inspections", label: "Annual inspection", icon: ClipboardList },
    { key: "incidents", label: "Incidents", icon: AlertTriangle },
    { key: "emergency", label: "Emergency procedure", icon: Siren },
    { key: "pins", label: "Safety pins", icon: Pin },
  ];
  return (
    <section className="rounded-xl border bg-white p-6" style={{ borderColor: c.border }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <button onClick={onBack} className="text-[12px] underline mb-1" style={{ color: c.inkMute }}>← Back to all amenities</button>
          <h3 className="text-[16px]" style={{ fontWeight: 700 }}>{amenity.name} — Compliance & Safety</h3>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2 border-b" style={{ borderColor: c.border }}>
        {tabs.map((t) => {
          const I = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px]"
              style={{
                borderBottom: active ? `2px solid ${c.cobalt}` : "2px solid transparent",
                color: active ? c.cobalt : c.inkSoft,
                fontWeight: active ? 600 : 500,
              }}>
              <I className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === "postings" && <PostingsTab amenity={amenity} />}
      {tab === "certs" && <CertsTab amenity={amenity} />}
      {tab === "inspections" && <InspectionsTab amenity={amenity} />}
      {tab === "incidents" && <IncidentsTab amenity={amenity} />}
      {tab === "emergency" && <EmergencyTab amenity={amenity} />}
      {tab === "pins" && <PinsTab amenity={amenity} />}
    </section>
  );
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>, slug: string) {
  qc.invalidateQueries({ queryKey: getGetAmenityComplianceSummaryQueryKey() });
  qc.invalidateQueries({ queryKey: getGetAmenityComplianceQueryKey(slug) });
}

// ── Postings ───────────────────────────────────────────────────────────────
function PostingsTab({ amenity }: { amenity: Amenity }) {
  const qc = useQueryClient();
  const { data: detail } = useListAmenityPostings(amenity.slug);
  const { data: issuances } = useListAmenityPostingIssuances(amenity.slug);
  const create = useCreateAmenityPosting();
  const del = useDeleteAmenityPosting();
  const issue = useIssueAmenityPosting();
  const remove = useRemoveAmenityPostingIssuance();
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ kind: "policy", title: "", description: "", templateBody: "", replaceEveryDays: 365, required: true, citation: "" });

  function refresh() {
    qc.invalidateQueries({ queryKey: getListAmenityPostingsQueryKey(amenity.slug) });
    qc.invalidateQueries({ queryKey: getListAmenityPostingIssuancesQueryKey(amenity.slug) });
    invalidateAll(qc, amenity.slug);
  }

  const activeByPostingId = useMemo(() => {
    const m = new Map<number, NonNullable<typeof issuances>[number]>();
    for (const i of issuances ?? []) if (i.status === "active") m.set(i.postingId, i);
    return m;
  }, [issuances]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowNew((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold"
          style={{ background: c.cobalt, color: "#fff" }}>
          <Plus className="h-4 w-4" /> Add posting
        </button>
      </div>
      {showNew && (
        <div className="rounded-md border p-3 space-y-2" style={{ borderColor: c.border }}>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Kind" value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v })} />
            <Input label="Title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
            <Input label="Citation (e.g. TX state code §)" value={draft.citation} onChange={(v) => setDraft({ ...draft, citation: v })} />
            <Input label="Replace every (days)" type="number" value={String(draft.replaceEveryDays)} onChange={(v) => setDraft({ ...draft, replaceEveryDays: Number(v) || 0 })} />
          </div>
          <Textarea label="Description" rows={2} value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
          <Textarea label="Template body — use {{amenityName}}, {{managerName}}, {{managerPhone}}, {{currentDate}}, {{nextReplacement}}" rows={6} value={draft.templateBody} onChange={(v) => setDraft({ ...draft, templateBody: v })} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowNew(false)} className="rounded-md border px-3 py-1.5 text-[12.5px]" style={{ borderColor: c.border }}>Cancel</button>
            <button
              onClick={async () => {
                if (!draft.title || !draft.templateBody) return;
                await create.mutateAsync({ slug: amenity.slug, data: draft });
                setDraft({ kind: "policy", title: "", description: "", templateBody: "", replaceEveryDays: 365, required: true, citation: "" });
                setShowNew(false);
                refresh();
              }}
              className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: c.cobalt, color: "#fff" }}>
              Create
            </button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {(detail ?? []).map((p) => {
          const active = activeByPostingId.get(p.id);
          const expiresAt = active?.expiresAt ?? (active && p.replaceEveryDays > 0
            ? new Date(new Date(active.postedAt).getTime() + p.replaceEveryDays * 86400000).toISOString()
            : null);
          let color: "green" | "amber" | "red" = "red";
          let reason = "Not posted";
          if (active) {
            if (!expiresAt) { color = "green"; reason = `Posted ${new Date(active.postedAt).toLocaleDateString()}`; }
            else {
              const days = Math.round((new Date(expiresAt).getTime() - Date.now()) / 86400000);
              if (days < 0) { color = "red"; reason = `Replacement overdue by ${-days}d`; }
              else if (days <= 30) { color = "amber"; reason = `Replace in ${days}d`; }
              else { color = "green"; reason = `Replace in ${days}d`; }
            }
          }
          return (
            <div key={p.id} className="rounded-md border p-3" style={{ borderColor: c.border }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13.5px]" style={{ fontWeight: 600 }}>{p.title}</div>
                  <div className="text-[12px]" style={{ color: c.inkMute }}>
                    {p.kind} · replace every {p.replaceEveryDays}d{p.citation ? ` · ${p.citation}` : ""}
                  </div>
                  <div className="text-[12px] mt-1" style={{ color: c.inkSoft }}>{reason}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusDot color={color} />
                  <button title="Issue / replace posting"
                    onClick={async () => {
                      const issuance = await issue.mutateAsync({ id: p.id, data: {} });
                      const safe = issuance.renderedBody.replace(/[<>]/g, (m: string) => m === "<" ? "&lt;" : "&gt;");
                      const html = `<!doctype html><html><head><title>${p.title}</title><style>body{font-family:Georgia,serif;padding:48px;max-width:8in;margin:auto}h1{font-size:20pt}.body{font-size:12pt;line-height:1.55;white-space:pre-wrap}.foot{margin-top:48px;font-size:10pt;color:#555}</style></head><body><h1>${p.title}</h1><div class="body">${safe}</div><div class="foot">Posted ${new Date(issuance.postedAt).toLocaleString()} by ${issuance.postedByName}${p.citation ? ` · ${p.citation}` : ""}</div></body></html>`;
                      const w = window.open("", "_blank");
                      if (w) { w.document.write(html); w.document.close(); w.print(); }
                      refresh();
                    }}
                    className="rounded-md border px-2 py-1 text-[12px]" style={{ borderColor: c.border }}>
                    <Printer className="h-3.5 w-3.5 inline" /> Issue & print
                  </button>
                  {active && (
                    <button title="Mark removed"
                      onClick={async () => {
                        await remove.mutateAsync({ id: active.id, data: { reason: "removed by admin" } });
                        refresh();
                      }}
                      className="rounded-md border px-2 py-1 text-[12px]" style={{ borderColor: c.border }}>Remove</button>
                  )}
                  <button onClick={async () => { if (confirm(`Delete posting "${p.title}"?`)) { await del.mutateAsync({ id: p.id }); refresh(); } }}
                    className="rounded-md border px-2 py-1 text-[12px]" style={{ borderColor: c.border, color: "#9A2542" }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {!detail?.length && <Empty>No required postings configured.</Empty>}
      </div>
    </div>
  );
}

// ── Certificates ───────────────────────────────────────────────────────────
function CertsTab({ amenity }: { amenity: Amenity }) {
  const qc = useQueryClient();
  const { data: certs } = useListAmenityCertificates(amenity.slug);
  const create = useCreateAmenityCertificate();
  const del = useDeleteAmenityCertificate();
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ kind: "insurance", title: "", issuer: "", identifier: "", effectiveOn: "", expiresOn: "", notes: "" });
  function refresh() {
    qc.invalidateQueries({ queryKey: getListAmenityCertificatesQueryKey(amenity.slug) });
    invalidateAll(qc, amenity.slug);
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowNew((v) => !v)} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: c.cobalt, color: "#fff" }}>
          <Plus className="h-4 w-4" /> Add certificate
        </button>
      </div>
      {showNew && (
        <div className="rounded-md border p-3 space-y-2" style={{ borderColor: c.border }}>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Kind (insurance / permit / vendor_coi / other)" value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v })} />
            <Input label="Title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
            <Input label="Issuer" value={draft.issuer} onChange={(v) => setDraft({ ...draft, issuer: v })} />
            <Input label="Policy / permit #" value={draft.identifier} onChange={(v) => setDraft({ ...draft, identifier: v })} />
            <Input label="Effective on" type="date" value={draft.effectiveOn} onChange={(v) => setDraft({ ...draft, effectiveOn: v })} />
            <Input label="Expires on" type="date" value={draft.expiresOn} onChange={(v) => setDraft({ ...draft, expiresOn: v })} />
          </div>
          <Textarea label="Notes" rows={2} value={draft.notes} onChange={(v) => setDraft({ ...draft, notes: v })} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowNew(false)} className="rounded-md border px-3 py-1.5 text-[12.5px]" style={{ borderColor: c.border }}>Cancel</button>
            <button onClick={async () => {
              if (!draft.title) return;
              await create.mutateAsync({ slug: amenity.slug, data: { ...draft, effectiveOn: draft.effectiveOn || null, expiresOn: draft.expiresOn || null } });
              setDraft({ kind: "insurance", title: "", issuer: "", identifier: "", effectiveOn: "", expiresOn: "", notes: "" });
              setShowNew(false);
              refresh();
            }} className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: c.cobalt, color: "#fff" }}>Create</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {(certs ?? []).map((cert) => {
          const days = cert.expiresOn ? Math.round((new Date(cert.expiresOn).getTime() - Date.now()) / 86400000) : null;
          const color: "green" | "amber" | "red" = days === null ? "amber" : days < 0 ? "red" : days <= 30 ? "amber" : "green";
          return (
            <div key={cert.id} className="rounded-md border p-3 flex items-start justify-between gap-3" style={{ borderColor: c.border }}>
              <div>
                <div className="text-[13.5px]" style={{ fontWeight: 600 }}>{cert.title}</div>
                <div className="text-[12px]" style={{ color: c.inkMute }}>
                  {cert.kind} · {cert.issuer || "—"} · {cert.identifier || "—"}
                </div>
                <div className="text-[12px] mt-0.5" style={{ color: c.inkSoft }}>
                  {cert.effectiveOn ? `Effective ${cert.effectiveOn}` : ""}{cert.expiresOn ? ` · Expires ${cert.expiresOn}${days !== null ? ` (${days}d)` : ""}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusDot color={color} />
                <button onClick={async () => { if (confirm(`Delete certificate?`)) { await del.mutateAsync({ id: cert.id }); refresh(); } }}
                  className="rounded-md border px-2 py-1 text-[12px]" style={{ borderColor: c.border, color: "#9A2542" }}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          );
        })}
        {!certs?.length && <Empty>No certificates on file.</Empty>}
      </div>
    </div>
  );
}

// ── Annual Inspections ─────────────────────────────────────────────────────
function InspectionsTab({ amenity }: { amenity: Amenity }) {
  const qc = useQueryClient();
  const { data: insps } = useListAmenityAnnualInspections(amenity.slug);
  const create = useCreateAmenityAnnualInspection();
  const [showNew, setShowNew] = useState(false);
  const year = new Date().getFullYear();
  const [draft, setDraft] = useState({ year, scheduledOn: "", inspectorName: "", inspectorAgency: "", notes: "" });
  function refresh() {
    qc.invalidateQueries({ queryKey: getListAmenityAnnualInspectionsQueryKey(amenity.slug) });
    invalidateAll(qc, amenity.slug);
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowNew((v) => !v)} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: c.cobalt, color: "#fff" }}>
          <Plus className="h-4 w-4" /> Schedule inspection
        </button>
      </div>
      {showNew && (
        <div className="rounded-md border p-3 space-y-2" style={{ borderColor: c.border }}>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Year" type="number" value={String(draft.year)} onChange={(v) => setDraft({ ...draft, year: Number(v) || year })} />
            <Input label="Scheduled on" type="date" value={draft.scheduledOn} onChange={(v) => setDraft({ ...draft, scheduledOn: v })} />
            <Input label="Inspector name" value={draft.inspectorName} onChange={(v) => setDraft({ ...draft, inspectorName: v })} />
            <Input label="Inspector agency" value={draft.inspectorAgency} onChange={(v) => setDraft({ ...draft, inspectorAgency: v })} />
          </div>
          <Textarea label="Notes" rows={2} value={draft.notes} onChange={(v) => setDraft({ ...draft, notes: v })} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowNew(false)} className="rounded-md border px-3 py-1.5 text-[12.5px]" style={{ borderColor: c.border }}>Cancel</button>
            <button onClick={async () => {
              if (!draft.scheduledOn) return;
              await create.mutateAsync({ slug: amenity.slug, data: draft });
              setShowNew(false);
              refresh();
            }} className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: c.cobalt, color: "#fff" }}>Schedule</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {(insps ?? []).map((i) => (
          <div key={i.id} className="rounded-md border p-3 flex items-start justify-between gap-3" style={{ borderColor: c.border }}>
            <div>
              <div className="text-[13.5px]" style={{ fontWeight: 600 }}>FY {i.year} — {i.status}</div>
              <div className="text-[12px]" style={{ color: c.inkMute }}>
                Scheduled {i.scheduledOn}{i.performedOn ? ` · Performed ${i.performedOn}` : ""}{i.inspectorName ? ` · ${i.inspectorName}` : ""}{i.inspectorAgency ? ` (${i.inspectorAgency})` : ""}
              </div>
              {i.notes && <div className="text-[12px] mt-0.5" style={{ color: c.inkSoft }}>{i.notes}</div>}
            </div>
            <StatusBadge label={i.status} color={i.status === "passed" ? "green" : i.status === "failed" ? "red" : "amber"} />
          </div>
        ))}
        {!insps?.length && <Empty>No annual inspections on record.</Empty>}
      </div>
    </div>
  );
}

// ── Incidents ───────────────────────────────────────────────────────────────
function IncidentsTab({ amenity }: { amenity: Amenity }) {
  const qc = useQueryClient();
  const { data: incidents } = useListAmenityIncidents({ amenitySlug: amenity.slug });
  const create = useCreateAmenityIncident();
  const update = useUpdateAmenityIncident();
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({
    occurredAt: new Date().toISOString().slice(0, 16),
    kind: "injury",
    severity: "minor" as "minor" | "moderate" | "major",
    narrative: "",
    immediateActions: "",
    emsCalled: false,
    policeCalled: false,
    insuranceNotified: false,
  });
  function refresh() {
    qc.invalidateQueries({ queryKey: getListAmenityIncidentsQueryKey({ amenitySlug: amenity.slug }) });
    invalidateAll(qc, amenity.slug);
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowNew((v) => !v)} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: c.cobalt, color: "#fff" }}>
          <Plus className="h-4 w-4" /> Report incident
        </button>
      </div>
      {showNew && (
        <div className="rounded-md border p-3 space-y-2" style={{ borderColor: c.border }}>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Occurred at" type="datetime-local" value={draft.occurredAt} onChange={(v) => setDraft({ ...draft, occurredAt: v })} />
            <Input label="Kind (injury / property / hazard / other)" value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v })} />
            <Select label="Severity" value={draft.severity} onChange={(v) => setDraft({ ...draft, severity: v as typeof draft.severity })} options={["minor", "moderate", "major"]} />
          </div>
          <Textarea label="Narrative" rows={3} value={draft.narrative} onChange={(v) => setDraft({ ...draft, narrative: v })} />
          <Textarea label="Immediate actions taken" rows={2} value={draft.immediateActions} onChange={(v) => setDraft({ ...draft, immediateActions: v })} />
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={draft.emsCalled} onChange={(e) => setDraft({ ...draft, emsCalled: e.target.checked })} /> EMS called</label>
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={draft.policeCalled} onChange={(e) => setDraft({ ...draft, policeCalled: e.target.checked })} /> Police called</label>
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={draft.insuranceNotified} onChange={(e) => setDraft({ ...draft, insuranceNotified: e.target.checked })} /> Insurance notified</label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowNew(false)} className="rounded-md border px-3 py-1.5 text-[12.5px]" style={{ borderColor: c.border }}>Cancel</button>
            <button onClick={async () => {
              if (!draft.narrative) return;
              await create.mutateAsync({
                slug: amenity.slug,
                data: { ...draft, occurredAt: new Date(draft.occurredAt).toISOString() },
              });
              setShowNew(false);
              refresh();
            }} className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: c.cobalt, color: "#fff" }}>Submit</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {(incidents ?? []).map((i) => (
          <div key={i.id} className="rounded-md border p-3" style={{ borderColor: c.border }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[13.5px]" style={{ fontWeight: 600 }}>#{i.id} — {i.kind} ({new Date(i.occurredAt).toLocaleString()})</div>
                <div className="text-[12px]" style={{ color: c.inkMute }}>
                  Severity: {i.severity} · Reported by {i.reportedByName} ({i.reportedByRole})
                </div>
                {i.narrative && <div className="text-[12px] mt-1" style={{ color: c.inkSoft }}>{i.narrative}</div>}
                {i.followUpDueOn && <div className="text-[12px] mt-1" style={{ color: c.inkSoft }}>Follow-up due {i.followUpDueOn}</div>}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge label={i.status} color={i.status === "closed" ? "green" : "amber"} />
                {i.severity === "major" && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">MAJOR</span>}
                {i.status !== "closed" && (
                  <button onClick={async () => { await update.mutateAsync({ id: i.id, data: { status: "closed" } }); refresh(); }}
                    className="rounded-md border px-2 py-1 text-[12px]" style={{ borderColor: c.border }}>Close</button>
                )}
              </div>
            </div>
          </div>
        ))}
        {!incidents?.length && <Empty>No incidents reported.</Empty>}
      </div>
    </div>
  );
}

// ── Emergency Procedure ────────────────────────────────────────────────────
function EmergencyTab({ amenity }: { amenity: Amenity }) {
  const qc = useQueryClient();
  const { data } = useGetAmenityEmergencyProcedure(amenity.slug);
  const put = usePutAmenityEmergencyProcedure();
  const [draft, setDraft] = useState<{ emergencyContact: string; managerOnCallName: string; managerOnCallPhone: string; evacuationRoute: string; shelterLocation: string; hazardNotes: string; steps: string }>({
    emergencyContact: "", managerOnCallName: "", managerOnCallPhone: "", evacuationRoute: "", shelterLocation: "", hazardNotes: "", steps: "",
  });
  const [hydrated, setHydrated] = useState(false);
  if (data && !hydrated) {
    setHydrated(true);
    setDraft({
      emergencyContact: data.emergencyContact || "",
      managerOnCallName: data.managerOnCallName || "",
      managerOnCallPhone: data.managerOnCallPhone || "",
      evacuationRoute: data.evacuationRoute || "",
      shelterLocation: data.shelterLocation || "",
      hazardNotes: data.hazardNotes || "",
      steps: (data.steps || []).join("\n"),
    });
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Input label="Emergency contact (e.g. 911)" value={draft.emergencyContact} onChange={(v) => setDraft({ ...draft, emergencyContact: v })} />
        <Input label="Manager on call (name)" value={draft.managerOnCallName} onChange={(v) => setDraft({ ...draft, managerOnCallName: v })} />
        <Input label="Manager on call (phone)" value={draft.managerOnCallPhone} onChange={(v) => setDraft({ ...draft, managerOnCallPhone: v })} />
        <Input label="Evacuation route" value={draft.evacuationRoute} onChange={(v) => setDraft({ ...draft, evacuationRoute: v })} />
        <Input label="Shelter / muster location" value={draft.shelterLocation} onChange={(v) => setDraft({ ...draft, shelterLocation: v })} />
      </div>
      <Textarea label="Hazard notes" rows={2} value={draft.hazardNotes} onChange={(v) => setDraft({ ...draft, hazardNotes: v })} />
      <Textarea label="Step-by-step procedure (one step per line)" rows={6} value={draft.steps} onChange={(v) => setDraft({ ...draft, steps: v })} />
      <div className="flex justify-end gap-2">
        <button onClick={() => {
          const html = `<!doctype html><html><head><title>${amenity.name} — Emergency Procedure</title><style>body{font-family:Georgia,serif;padding:48px;max-width:8in;margin:auto}h1{font-size:22pt}h2{font-size:14pt;margin-top:24px}ol{font-size:12pt;line-height:1.55}</style></head><body><h1>${amenity.name} — Emergency Procedure</h1><p><strong>Emergency:</strong> ${draft.emergencyContact}</p><p><strong>Manager on call:</strong> ${draft.managerOnCallName} — ${draft.managerOnCallPhone}</p><h2>Evacuation</h2><p>${draft.evacuationRoute}</p><p><strong>Shelter:</strong> ${draft.shelterLocation}</p><h2>Hazards</h2><p>${draft.hazardNotes}</p><h2>Procedure</h2><ol>${draft.steps.split("\n").filter(Boolean).map((s) => `<li>${s}</li>`).join("")}</ol></body></html>`;
          const w = window.open("", "_blank");
          if (w) { w.document.write(html); w.document.close(); w.print(); }
        }} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px]" style={{ borderColor: c.border }}>
          <Printer className="h-4 w-4" /> Print poster
        </button>
        <button onClick={async () => {
          await put.mutateAsync({
            slug: amenity.slug,
            data: { ...draft, steps: draft.steps.split("\n").map((s) => s.trim()).filter(Boolean) },
          });
          qc.invalidateQueries({ queryKey: getGetAmenityEmergencyProcedureQueryKey(amenity.slug) });
          invalidateAll(qc, amenity.slug);
        }} className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: c.cobalt, color: "#fff" }}>
          Save procedure
        </button>
      </div>
    </div>
  );
}

// ── Safety Pins (AED, fire extinguishers, etc.) ────────────────────────────
function PinsTab({ amenity }: { amenity: Amenity }) {
  const qc = useQueryClient();
  const { data: pins } = useListAmenitySafetyPins(amenity.slug);
  const create = useCreateAmenitySafetyPin();
  const del = useDeleteAmenitySafetyPin();
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ kind: "aed", label: "AED", locationDescription: "", lastCheckedOn: "", lastCheckedByName: "", serviceDueOn: "", notes: "" });
  function refresh() {
    qc.invalidateQueries({ queryKey: getListAmenitySafetyPinsQueryKey(amenity.slug) });
    invalidateAll(qc, amenity.slug);
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowNew((v) => !v)} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: c.cobalt, color: "#fff" }}>
          <Plus className="h-4 w-4" /> Add safety pin
        </button>
      </div>
      {showNew && (
        <div className="rounded-md border p-3 space-y-2" style={{ borderColor: c.border }}>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Kind (aed / fire_extinguisher / first_aid / shutoff / hose / other)" value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v })} />
            <Input label="Label" value={draft.label} onChange={(v) => setDraft({ ...draft, label: v })} />
            <Input label="Last checked on" type="date" value={draft.lastCheckedOn} onChange={(v) => setDraft({ ...draft, lastCheckedOn: v })} />
            <Input label="Last checked by" value={draft.lastCheckedByName} onChange={(v) => setDraft({ ...draft, lastCheckedByName: v })} />
            <Input label="Service due on" type="date" value={draft.serviceDueOn} onChange={(v) => setDraft({ ...draft, serviceDueOn: v })} />
          </div>
          <Textarea label="Location description" rows={2} value={draft.locationDescription} onChange={(v) => setDraft({ ...draft, locationDescription: v })} />
          <Textarea label="Notes" rows={2} value={draft.notes} onChange={(v) => setDraft({ ...draft, notes: v })} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowNew(false)} className="rounded-md border px-3 py-1.5 text-[12.5px]" style={{ borderColor: c.border }}>Cancel</button>
            <button onClick={async () => {
              if (!draft.label) return;
              await create.mutateAsync({ slug: amenity.slug, data: { ...draft, lastCheckedOn: draft.lastCheckedOn || null, serviceDueOn: draft.serviceDueOn || null } });
              setShowNew(false);
              refresh();
            }} className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: c.cobalt, color: "#fff" }}>Add</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {(pins ?? []).map((p) => (
          <div key={p.id} className="rounded-md border p-3 flex items-start justify-between gap-3" style={{ borderColor: c.border }}>
            <div>
              <div className="text-[13.5px]" style={{ fontWeight: 600 }}>{p.label} <span className="text-[11px]" style={{ color: c.inkMute }}>({p.kind})</span></div>
              <div className="text-[12px]" style={{ color: c.inkMute }}>{p.locationDescription || "—"}</div>
              <div className="text-[12px] mt-0.5" style={{ color: c.inkSoft }}>
                {p.lastCheckedOn ? `Last checked ${p.lastCheckedOn}` : ""}{p.serviceDueOn ? ` · Service due ${p.serviceDueOn}` : ""}
              </div>
            </div>
            <button onClick={async () => { if (confirm("Delete this safety pin?")) { await del.mutateAsync({ id: p.id }); refresh(); } }}
              className="rounded-md border px-2 py-1 text-[12px]" style={{ borderColor: c.border, color: "#9A2542" }}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {!pins?.length && <Empty>No safety equipment recorded.</Empty>}
      </div>
    </div>
  );
}

// ── small helpers ──────────────────────────────────────────────────────────
function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <div className="text-[11.5px] mb-0.5" style={{ color: c.inkMute }}>{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border px-2.5 py-1.5 text-[13px]" style={{ borderColor: c.border, color: c.ink }} />
    </label>
  );
}
function Textarea({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <div className="text-[11.5px] mb-0.5" style={{ color: c.inkMute }}>{label}</div>
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border px-2.5 py-1.5 text-[13px] font-mono" style={{ borderColor: c.border, color: c.ink }} />
    </label>
  );
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <div className="text-[11.5px] mb-0.5" style={{ color: c.inkMute }}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border px-2.5 py-1.5 text-[13px]" style={{ borderColor: c.border, color: c.ink }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
function StatusBadge({ label, color }: { label: string; color: "green" | "amber" | "red" }) {
  const fg = color === "green" ? "#0E6F45" : color === "amber" ? "#9A6500" : "#9A2542";
  const bg = color === "green" ? "#DCF3EC" : color === "amber" ? "#FFF6D6" : "#FCE5EC";
  return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: bg, color: fg }}>{label}</span>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed p-4 text-center text-[12.5px]" style={{ borderColor: c.border, color: c.inkMute }}>{children}</div>;
}
