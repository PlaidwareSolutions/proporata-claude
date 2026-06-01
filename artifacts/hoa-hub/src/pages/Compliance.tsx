// Task #100: Manager admin UI for the compliance CRUD entities — items
// (tax/audit/insurance/regulatory), violations (with stage milestones),
// and hearings. Each save round-trips through the calendar materializer.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Pencil, Trash2, CalendarDays } from "lucide-react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  complianceApi,
  type ComplianceItem,
  type Violation,
  type Hearing,
} from "@/lib/complianceApi";
import { useListUnits } from "@workspace/api-client-react";

type Tab = "items" | "violations" | "hearings";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "items",      label: "Compliance Items" },
  { key: "violations", label: "Violations" },
  { key: "hearings",   label: "Hearings" },
];

export default function CompliancePage() {
  const [tab, setTab] = useState<Tab>("items");
  return (
    <Layout
      title="Compliance"
      subtitle="Tax, audit, insurance, regulatory deadlines, plus violations and hearings"
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-3 py-1.5 rounded-md text-[12.5px] border"
            style={{
              background: tab === t.key ? c.cobalt : "#fff",
              color: tab === t.key ? "#fff" : c.ink,
              borderColor: tab === t.key ? c.cobalt : c.border,
              fontWeight: 600,
            }}
            data-testid={`tab-${t.key}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "items"      && <ItemsPanel />}
      {tab === "violations" && <ViolationsPanel />}
      {tab === "hearings"   && <HearingsPanel />}
    </Layout>
  );
}

// ── Shared primitives (kept local to avoid cross-page coupling) ─────────

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
      <div className={`w-full ${wide ? "max-w-3xl" : "max-w-xl"} max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl`}>
        <div className="sticky top-0 flex items-center justify-between border-b px-4 py-3 bg-white" style={{ borderColor: c.border }}>
          <div className="text-[14px]" style={{ fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11.5px] mb-1" style={{ color: c.inkMute, fontWeight: 600 }}>
        {label.toUpperCase()}
      </div>
      {children}
    </label>
  );
}
function TextInput(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`w-full rounded-md border px-3 py-2 text-[13.5px] ${p.className ?? ""}`} style={{ borderColor: c.border, ...(p.style ?? {}) }} />;
}
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={`w-full rounded-md border px-3 py-2 text-[13.5px] bg-white ${p.className ?? ""}`} style={{ borderColor: c.border, ...(p.style ?? {}) }} />;
}
function TextArea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={`w-full rounded-md border px-3 py-2 text-[13.5px] ${p.className ?? ""}`} style={{ borderColor: c.border, ...(p.style ?? {}) }} />;
}
function PrimaryBtn(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={`px-3 py-1.5 rounded-md text-[12.5px] disabled:opacity-50 ${p.className ?? ""}`} style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }} />;
}
function GhostBtn(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={`px-3 py-1.5 rounded-md text-[12.5px] border ${p.className ?? ""}`} style={{ borderColor: c.border, color: c.ink, fontWeight: 600, background: "#fff" }} />;
}
function ErrorBanner({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="mb-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: c.roseSoft, color: c.rose }}>{msg}</div>;
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>{children}</div>;
}
function Empty({ msg }: { msg: string }) {
  return <div className="py-12 text-center text-[13px]" style={{ color: c.inkMute }}>{msg}</div>;
}
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-[13px]">
      <thead style={{ background: c.canvas }}>
        <tr style={{ color: c.inkMute }} className="text-left text-[11px] uppercase tracking-wider">
          {head.map((h, i) => (<th key={i} className="px-4 py-3" style={{ fontWeight: 700 }}>{h}</th>))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
function Td({ children, mono, capitalize }: { children: React.ReactNode; mono?: boolean; capitalize?: boolean }) {
  return <td className={`px-4 py-2.5 ${mono ? "font-mono-num" : ""} ${capitalize ? "capitalize" : ""}`} style={{ color: c.ink }}>{children}</td>;
}
function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <td className="px-4 py-2.5 text-right">
      <div className="inline-flex gap-1">
        <button onClick={onEdit} className="rounded p-1 hover:bg-slate-100" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
        <button onClick={() => { if (confirm("Delete this item? Calendar events will be removed.")) onDelete(); }} className="rounded p-1 hover:bg-red-50" title="Delete">
          <Trash2 className="h-3.5 w-3.5" style={{ color: c.rose }} />
        </button>
      </div>
    </td>
  );
}
function CalendarHint() {
  return (
    <div className="text-[11.5px] inline-flex items-center gap-1 mt-1" style={{ color: c.inkMute }}>
      <CalendarDays className="h-3 w-3" /> Saving will refresh the compliance calendar.
    </div>
  );
}

// ── Compliance items ────────────────────────────────────────────────────

const ITEM_KINDS: ComplianceItem["kind"][] = ["tax", "audit", "insurance", "regulatory", "other"];
const ITEM_STATUSES: ComplianceItem["status"][] = ["open", "in_progress", "done"];

function ItemsPanel() {
  const qc = useQueryClient();
  const KEY = ["compliance-items"];
  const { data = [], isLoading } = useQuery({ queryKey: KEY, queryFn: complianceApi.listItems });
  const [editing, setEditing] = useState<ComplianceItem | "new" | null>(null);
  const del = useMutation({
    mutationFn: complianceApi.deleteItem,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <div>
      <div className="flex justify-end mb-3">
        <PrimaryBtn onClick={() => setEditing("new")} data-testid="button-new-item">
          <Plus className="h-3.5 w-3.5 inline mr-1" /> New compliance item
        </PrimaryBtn>
      </div>
      <Card>
        {isLoading ? <Empty msg="Loading…" /> : data.length === 0 ? <Empty msg="No compliance items yet." /> : (
          <Table head={["Kind", "Title", "Due", "Status", ""]}>
            {data.map((i) => (
              <tr key={i.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                <Td capitalize>{i.kind}</Td>
                <Td>{i.title}</Td>
                <Td mono>{i.dueDate}</Td>
                <Td capitalize>{i.status.replace("_", " ")}</Td>
                <RowActions onEdit={() => setEditing(i)} onDelete={() => del.mutate(i.id)} />
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <ItemEditor
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: KEY }); }}
        />
      )}
    </div>
  );
}

function ItemEditor({ item, onClose, onSaved }: { item: ComplianceItem | null; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<ComplianceItem["kind"]>(item?.kind ?? "tax");
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [dueDate, setDueDate] = useState(item?.dueDate ?? "");
  const [status, setStatus] = useState<ComplianceItem["status"]>(item?.status ?? "open");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body: Partial<ComplianceItem> = {
        kind, title: title.trim(), description, dueDate, status, notes,
      };
      return item ? complianceApi.updateItem(item.id, body) : complianceApi.createItem(body);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={item ? "Edit compliance item" : "New compliance item"} onClose={onClose} wide>
      <ErrorBanner msg={error} />
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as ComplianceItem["kind"])}>
            {ITEM_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as ComplianceItem["status"])}>
            {ITEM_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </Select>
        </Field>
        <Field label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-item-title" /></Field>
        <Field label="Due date"><TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="input-item-due" /></Field>
      </div>
      <div className="mt-3">
        <Field label="Description"><TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <div className="mt-3">
        <Field label="Notes"><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <CalendarHint />
      <div className="flex justify-end gap-2 mt-4">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn onClick={() => save.mutate()} disabled={save.isPending || !title.trim() || !dueDate} data-testid="button-save-item">
          {save.isPending ? "Saving…" : "Save"}
        </PrimaryBtn>
      </div>
    </Modal>
  );
}

// ── Violations ──────────────────────────────────────────────────────────

const VIOLATION_STATUSES: Violation["status"][] = ["open", "noticed", "hearing", "resolved", "dismissed"];

function ViolationsPanel() {
  const qc = useQueryClient();
  const KEY = ["compliance-violations"];
  const { data = [], isLoading } = useQuery({ queryKey: KEY, queryFn: complianceApi.listViolations });
  const [editing, setEditing] = useState<Violation | "new" | null>(null);
  const del = useMutation({
    mutationFn: complianceApi.deleteViolation,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <div>
      <div className="flex justify-end mb-3">
        <PrimaryBtn onClick={() => setEditing("new")} data-testid="button-new-violation">
          <Plus className="h-3.5 w-3.5 inline mr-1" /> New violation
        </PrimaryBtn>
      </div>
      <Card>
        {isLoading ? <Empty msg="Loading…" /> : data.length === 0 ? <Empty msg="No violations yet." /> : (
          <Table head={["Unit", "Owner", "Category", "Status", "Observed", "Cure due", "Hearing", "Fine", ""]}>
            {data.map((v) => (
              <tr key={v.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                <Td mono>{v.unitId}</Td>
                <Td>{v.ownerName ?? "—"}</Td>
                <Td>{v.category}</Td>
                <Td capitalize>{v.status}</Td>
                <Td mono>{v.observedAt.slice(0, 10)}</Td>
                <Td mono>{v.cureDeadline ?? "—"}</Td>
                <Td mono>{v.hearingDate ?? "—"}</Td>
                <Td mono>{v.fineCents ? `$${(v.fineCents / 100).toFixed(2)}` : "—"}</Td>
                <RowActions onEdit={() => setEditing(v)} onDelete={() => del.mutate(v.id)} />
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <ViolationEditor
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: KEY }); }}
        />
      )}
    </div>
  );
}

function ViolationEditor({ item, onClose, onSaved }: { item: Violation | null; onClose: () => void; onSaved: () => void }) {
  const { data: units = [] } = useListUnits();
  const [unitId, setUnitId] = useState(item?.unitId ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [status, setStatus] = useState<Violation["status"]>(item?.status ?? "open");
  const [observedAt, setObservedAt] = useState(item?.observedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [firstNoticeDate, setFirstNoticeDate] = useState(item?.firstNoticeDate ?? "");
  const [cureDeadline, setCureDeadline] = useState(item?.cureDeadline ?? "");
  const [secondNoticeDate, setSecondNoticeDate] = useState(item?.secondNoticeDate ?? "");
  const [hearingDate, setHearingDate] = useState(item?.hearingDate ?? "");
  const [fineDollars, setFineDollars] = useState(item ? (item.fineCents / 100).toFixed(2) : "0.00");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body: Partial<Violation> = {
        unitId, category: category.trim(), description, status, observedAt,
        firstNoticeDate: firstNoticeDate || null,
        cureDeadline: cureDeadline || null,
        secondNoticeDate: secondNoticeDate || null,
        hearingDate: hearingDate || null,
        fineCents: Math.round(parseFloat(fineDollars || "0") * 100),
      };
      return item ? complianceApi.updateViolation(item.id, body) : complianceApi.createViolation(body);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={item ? "Edit violation" : "New violation"} onClose={onClose} wide>
      <ErrorBanner msg={error} />
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Unit">
          <Select value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={!!item} data-testid="input-violation-unit">
            <option value="">Pick a unit…</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.id}{u.ownerName ? ` — ${u.ownerName}` : ""}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as Violation["status"])}>
            {VIOLATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Category"><TextInput value={category} onChange={(e) => setCategory(e.target.value)} placeholder="parking, landscape, …" data-testid="input-violation-category" /></Field>
        <Field label="Fine ($)"><TextInput type="number" min={0} step="0.01" value={fineDollars} onChange={(e) => setFineDollars(e.target.value)} /></Field>
        <Field label="Observed"><TextInput type="date" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} disabled={!!item} title={item ? "Observed date is fixed once the violation is opened" : undefined} /></Field>
        <div></div>
        <Field label="First notice"><TextInput type="date" value={firstNoticeDate} onChange={(e) => setFirstNoticeDate(e.target.value)} /></Field>
        <Field label="Cure deadline"><TextInput type="date" value={cureDeadline} onChange={(e) => setCureDeadline(e.target.value)} /></Field>
        <Field label="Second notice"><TextInput type="date" value={secondNoticeDate} onChange={(e) => setSecondNoticeDate(e.target.value)} /></Field>
        <Field label="Hearing date"><TextInput type="date" value={hearingDate} onChange={(e) => setHearingDate(e.target.value)} /></Field>
      </div>
      <div className="mt-3">
        <Field label="Description"><TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <CalendarHint />
      <div className="flex justify-end gap-2 mt-4">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn onClick={() => save.mutate()} disabled={save.isPending || !unitId || !category.trim() || !description.trim()} data-testid="button-save-violation">
          {save.isPending ? "Saving…" : "Save"}
        </PrimaryBtn>
      </div>
    </Modal>
  );
}

// ── Hearings ────────────────────────────────────────────────────────────

const HEARING_KINDS: Hearing["kind"][] = ["violation", "appeal", "executive_session", "other"];
const HEARING_STATUSES: Hearing["status"][] = ["scheduled", "held", "cancelled", "rescheduled"];

function HearingsPanel() {
  const qc = useQueryClient();
  const KEY = ["compliance-hearings"];
  const { data = [], isLoading } = useQuery({ queryKey: KEY, queryFn: complianceApi.listHearings });
  const [editing, setEditing] = useState<Hearing | "new" | null>(null);
  const del = useMutation({
    mutationFn: complianceApi.deleteHearing,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <div>
      <div className="flex justify-end mb-3">
        <PrimaryBtn onClick={() => setEditing("new")} data-testid="button-new-hearing">
          <Plus className="h-3.5 w-3.5 inline mr-1" /> New hearing
        </PrimaryBtn>
      </div>
      <Card>
        {isLoading ? <Empty msg="Loading…" /> : data.length === 0 ? <Empty msg="No hearings yet." /> : (
          <Table head={["Kind", "Title", "Scheduled", "Location", "Status", "Outcome", ""]}>
            {data.map((h) => (
              <tr key={h.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                <Td capitalize>{h.kind.replace("_", " ")}</Td>
                <Td>{h.title}</Td>
                <Td mono>{new Date(h.scheduledAt).toLocaleString()}</Td>
                <Td>{h.locationText ?? (h.locationUrl ? "Video" : "—")}</Td>
                <Td capitalize>{h.status}</Td>
                <Td>{h.outcome ?? "—"}</Td>
                <RowActions onEdit={() => setEditing(h)} onDelete={() => del.mutate(h.id)} />
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <HearingEditor
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: KEY }); }}
        />
      )}
    </div>
  );
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function HearingEditor({ item, onClose, onSaved }: { item: Hearing | null; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<Hearing["kind"]>(item?.kind ?? "violation");
  const [title, setTitle] = useState(item?.title ?? "");
  const [scheduledLocal, setScheduledLocal] = useState(toLocalInput(item?.scheduledAt));
  const [locationText, setLocationText] = useState(item?.locationText ?? "");
  const [locationUrl, setLocationUrl] = useState(item?.locationUrl ?? "");
  const [noticeDate, setNoticeDate] = useState(item?.noticeDate ?? "");
  const [status, setStatus] = useState<Hearing["status"]>(item?.status ?? "scheduled");
  const [outcome, setOutcome] = useState(item?.outcome ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const scheduledAt = scheduledLocal ? new Date(scheduledLocal).toISOString() : "";
      const body: Partial<Hearing> = {
        kind, title: title.trim(), scheduledAt,
        locationText: locationText || null, locationUrl: locationUrl || null,
        noticeDate: noticeDate || null, status,
        outcome: outcome || null,
      };
      return item ? complianceApi.updateHearing(item.id, body) : complianceApi.createHearing(body);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={item ? "Edit hearing" : "New hearing"} onClose={onClose} wide>
      <ErrorBanner msg={error} />
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Hearing["kind"])}>
            {HEARING_KINDS.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as Hearing["status"])}>
            {HEARING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-hearing-title" /></Field>
        <Field label="Scheduled"><TextInput type="datetime-local" value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} data-testid="input-hearing-when" /></Field>
        <Field label="Location (in person)"><TextInput value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="Clubhouse — Conf Room A" /></Field>
        <Field label="Video link"><TextInput value={locationUrl} onChange={(e) => setLocationUrl(e.target.value)} placeholder="https://meet…" /></Field>
        <Field label="Notice date"><TextInput type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} /></Field>
        <div></div>
      </div>
      <div className="mt-3">
        <Field label="Outcome (after the hearing)"><TextArea rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} /></Field>
      </div>
      <CalendarHint />
      <div className="flex justify-end gap-2 mt-4">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn onClick={() => save.mutate()} disabled={save.isPending || !title.trim() || !scheduledLocal} data-testid="button-save-hearing">
          {save.isPending ? "Saving…" : "Save"}
        </PrimaryBtn>
      </div>
    </Modal>
  );
}
