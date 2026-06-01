// Task #100: Manager admin UI for the financial CRUD entities introduced
// in task #76 — assessment schedules, special assessments, budget cycles,
// reserve projects, and the singleton collections policy. Each save
// round-trips through the calendar materializer on the server.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Pencil, Trash2, CalendarDays } from "lucide-react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  financialApi,
  type AssessmentSchedule,
  type SpecialAssessment,
  type BudgetCycle,
  type ReserveProject,
  type CollectionsPolicy,
} from "@/lib/financialApi";
import { motionsApi, MOTION_STATUS_LABELS, type MotionListItem } from "@/lib/motionsApi";

type Tab = "schedules" | "specials" | "budgets" | "reserves" | "policy";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "schedules", label: "Assessment Schedules" },
  { key: "specials",  label: "Special Assessments" },
  { key: "budgets",   label: "Budget Cycles" },
  { key: "reserves",  label: "Reserve Projects" },
  { key: "policy",    label: "Collections Policy" },
];

export default function FinancialsPage() {
  const [tab, setTab] = useState<Tab>("schedules");
  return (
    <Layout
      title="Financial Calendar"
      subtitle="Schedules, special assessments, budgets, reserves, and collections policy"
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
      {tab === "schedules" && <SchedulesPanel />}
      {tab === "specials"  && <SpecialsPanel />}
      {tab === "budgets"   && <BudgetsPanel />}
      {tab === "reserves"  && <ReservesPanel />}
      {tab === "policy"    && <PolicyPanel />}
    </Layout>
  );
}

// ── Common UI primitives ────────────────────────────────────────────────

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

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border px-3 py-2 text-[13.5px] ${props.className ?? ""}`}
      style={{ borderColor: c.border, ...(props.style ?? {}) }}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-md border px-3 py-2 text-[13.5px] bg-white ${props.className ?? ""}`}
      style={{ borderColor: c.border, ...(props.style ?? {}) }}
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-md border px-3 py-2 text-[13.5px] ${props.className ?? ""}`}
      style={{ borderColor: c.border, ...(props.style ?? {}) }}
    />
  );
}

function PrimaryBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`px-3 py-1.5 rounded-md text-[12.5px] disabled:opacity-50 ${rest.className ?? ""}`}
      style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
    >
      {children}
    </button>
  );
}

function GhostBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`px-3 py-1.5 rounded-md text-[12.5px] border ${rest.className ?? ""}`}
      style={{ borderColor: c.border, color: c.ink, fontWeight: 600, background: "#fff" }}
    >
      {children}
    </button>
  );
}

function ErrorBanner({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="mb-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: c.roseSoft, color: c.rose }}>
      {msg}
    </div>
  );
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function CalendarHint() {
  return (
    <div className="text-[11.5px] inline-flex items-center gap-1 mt-1" style={{ color: c.inkMute }}>
      <CalendarDays className="h-3 w-3" /> Saving will refresh the financial calendar.
    </div>
  );
}

// ── Assessment Schedules ────────────────────────────────────────────────

const FREQS: Array<AssessmentSchedule["frequency"]> = ["monthly", "quarterly", "semiannual", "annual"];

function SchedulesPanel() {
  const qc = useQueryClient();
  const KEY = ["fin-schedules"];
  const { data = [], isLoading } = useQuery({ queryKey: KEY, queryFn: financialApi.listSchedules });
  const [editing, setEditing] = useState<AssessmentSchedule | "new" | null>(null);
  const del = useMutation({
    mutationFn: financialApi.deleteSchedule,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  return (
    <div>
      <div className="flex justify-end mb-3">
        <PrimaryBtn onClick={() => setEditing("new")} data-testid="button-new-schedule">
          <Plus className="h-3.5 w-3.5 inline mr-1" /> New schedule
        </PrimaryBtn>
      </div>
      <Card>
        {isLoading ? <Empty msg="Loading…" /> : data.length === 0 ? <Empty msg="No assessment schedules yet." /> : (
          <Table head={["Name", "Frequency", "Amount", "Due day", "Window", "Active", ""]}>
            {data.map((s) => (
              <tr key={s.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                <Td>{s.name}</Td>
                <Td capitalize>{s.frequency}</Td>
                <Td mono>{fmtMoney(s.amountCents)}</Td>
                <Td mono>{s.dueDay}</Td>
                <Td mono>{s.startDate}{s.endDate ? ` → ${s.endDate}` : ""}</Td>
                <Td>{s.active ? "Yes" : "No"}</Td>
                <RowActions onEdit={() => setEditing(s)} onDelete={() => del.mutate(s.id)} />
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <ScheduleEditor
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: KEY }); }}
        />
      )}
    </div>
  );
}

function ScheduleEditor({ item, onClose, onSaved }: { item: AssessmentSchedule | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [frequency, setFrequency] = useState<AssessmentSchedule["frequency"]>(item?.frequency ?? "monthly");
  const [amountDollars, setAmountDollars] = useState(item ? (item.amountCents / 100).toFixed(2) : "");
  const [dueDay, setDueDay] = useState(String(item?.dueDay ?? 1));
  const [startDate, setStartDate] = useState(item?.startDate ?? "");
  const [endDate, setEndDate] = useState(item?.endDate ?? "");
  const [active, setActive] = useState(item?.active ?? true);
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body: Partial<AssessmentSchedule> = {
        name: name.trim(), frequency,
        amountCents: Math.round(parseFloat(amountDollars || "0") * 100),
        dueDay: parseInt(dueDay || "1", 10),
        startDate, endDate: endDate || null,
        active, notes,
      };
      return item ? financialApi.updateSchedule(item.id, body) : financialApi.createSchedule(body);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={item ? "Edit assessment schedule" : "New assessment schedule"} onClose={onClose} wide>
      <ErrorBanner msg={error} />
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} data-testid="input-schedule-name" /></Field>
        <Field label="Frequency">
          <Select value={frequency} onChange={(e) => setFrequency(e.target.value as AssessmentSchedule["frequency"])}>
            {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        </Field>
        <Field label="Amount ($)"><TextInput type="number" min={0} step="0.01" value={amountDollars} onChange={(e) => setAmountDollars(e.target.value)} /></Field>
        <Field label="Due day of month"><TextInput type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></Field>
        <Field label="Start date"><TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="input-schedule-start" /></Field>
        <Field label="End date (optional)"><TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
      </div>
      <div className="mt-3">
        <Field label="Notes"><TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <label className="inline-flex items-center gap-2 mt-3 text-[12.5px]">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active (cancelled events are hidden when off)
      </label>
      <CalendarHint />
      <div className="flex justify-end gap-2 mt-4">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn onClick={() => save.mutate()} disabled={save.isPending || !name.trim() || !startDate} data-testid="button-save-schedule">
          {save.isPending ? "Saving…" : "Save"}
        </PrimaryBtn>
      </div>
    </Modal>
  );
}

// ── Special Assessments ─────────────────────────────────────────────────

const SPECIAL_STATUSES: SpecialAssessment["status"][] = ["draft", "noticed", "adopted", "billed", "closed"];

function MotionLinkCell({ motionId, motion }: { motionId: number | null; motion: MotionListItem | undefined }) {
  if (motionId == null) return <span style={{ color: c.inkMute }}>—</span>;
  const label = MOTION_STATUS_LABELS[motion?.status ?? ""]?.label ?? motion?.status ?? "unknown";
  const href = `${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/motions?open=${motionId}`;
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 text-[12.5px] hover:underline"
      style={{ color: c.cobalt, fontWeight: 600 }}
      data-testid={`link-special-motion-${motionId}`}
    >
      M-{motionId}
      <span style={{ color: c.inkMute, fontWeight: 500 }}> · {label.toLowerCase()}</span>
    </a>
  );
}

function SpecialsPanel() {
  const qc = useQueryClient();
  const KEY = ["fin-specials"];
  const { data = [], isLoading } = useQuery({ queryKey: KEY, queryFn: financialApi.listSpecials });
  const { data: motions = [] } = useQuery({ queryKey: ["motions-all"], queryFn: () => motionsApi.list() });
  const motionsById = new Map(motions.map((m) => [m.id, m]));
  const [editing, setEditing] = useState<SpecialAssessment | "new" | null>(null);
  const del = useMutation({
    mutationFn: financialApi.deleteSpecial,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <div>
      <div className="flex justify-end mb-3">
        <PrimaryBtn onClick={() => setEditing("new")} data-testid="button-new-special">
          <Plus className="h-3.5 w-3.5 inline mr-1" /> New special assessment
        </PrimaryBtn>
      </div>
      <Card>
        {isLoading ? <Empty msg="Loading…" /> : data.length === 0 ? <Empty msg="No special assessments yet." /> : (
          <Table head={["Title", "Amount", "Status", "Motion", "Hearing", "Due", ""]}>
            {data.map((s) => (
              <tr key={s.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                <Td>{s.title}</Td>
                <Td mono>{fmtMoney(s.amountCents)}</Td>
                <Td capitalize>{s.status}</Td>
                <Td><MotionLinkCell motionId={s.motionId} motion={s.motionId ? motionsById.get(s.motionId) : undefined} /></Td>
                <Td mono>{s.hearingDate ?? "—"}</Td>
                <Td mono>{s.dueDate ?? "—"}</Td>
                <RowActions onEdit={() => setEditing(s)} onDelete={() => del.mutate(s.id)} />
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <SpecialEditor
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: KEY }); }}
        />
      )}
    </div>
  );
}

function SpecialEditor({ item, onClose, onSaved }: { item: SpecialAssessment | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [amountDollars, setAmountDollars] = useState(item ? (item.amountCents / 100).toFixed(2) : "");
  const [status, setStatus] = useState<SpecialAssessment["status"]>(item?.status ?? "draft");
  const [noticeDate, setNoticeDate] = useState(item?.noticeDate ?? "");
  const [hearingDate, setHearingDate] = useState(item?.hearingDate ?? "");
  const [hearingLocation, setHearingLocation] = useState(item?.hearingLocation ?? "");
  const [adoptionDate, setAdoptionDate] = useState(item?.adoptionDate ?? "");
  const [billingDate, setBillingDate] = useState(item?.billingDate ?? "");
  const [dueDate, setDueDate] = useState(item?.dueDate ?? "");
  const [motionId, setMotionId] = useState<number | null>(item?.motionId ?? null);
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const { data: motions = [] } = useQuery({ queryKey: ["motions-all"], queryFn: () => motionsApi.list() });

  const save = useMutation({
    mutationFn: async () => {
      const body: Partial<SpecialAssessment> = {
        title: title.trim(), description, status,
        amountCents: Math.round(parseFloat(amountDollars || "0") * 100),
        noticeDate: noticeDate || null, hearingDate: hearingDate || null,
        hearingLocation: hearingLocation || null,
        adoptionDate: adoptionDate || null, billingDate: billingDate || null,
        dueDate: dueDate || null, motionId, notes,
      };
      return item ? financialApi.updateSpecial(item.id, body) : financialApi.createSpecial(body);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={item ? "Edit special assessment" : "New special assessment"} onClose={onClose} wide>
      <ErrorBanner msg={error} />
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-special-title" /></Field>
        <Field label="Amount ($)"><TextInput type="number" min={0} step="0.01" value={amountDollars} onChange={(e) => setAmountDollars(e.target.value)} /></Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as SpecialAssessment["status"])}>
            {SPECIAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <div></div>
        <Field label="Notice date"><TextInput type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} /></Field>
        <Field label="Hearing date"><TextInput type="date" value={hearingDate} onChange={(e) => setHearingDate(e.target.value)} /></Field>
        <Field label="Hearing location"><TextInput value={hearingLocation} onChange={(e) => setHearingLocation(e.target.value)} /></Field>
        <Field label="Adoption date"><TextInput type="date" value={adoptionDate} onChange={(e) => setAdoptionDate(e.target.value)} /></Field>
        <Field label="Billing date"><TextInput type="date" value={billingDate} onChange={(e) => setBillingDate(e.target.value)} /></Field>
        <Field label="Due date"><TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        <Field label="Adopting motion">
          <Select
            value={motionId == null ? "" : String(motionId)}
            onChange={(e) => setMotionId(e.target.value ? parseInt(e.target.value, 10) : null)}
            data-testid="select-special-motion"
          >
            <option value="">— No motion linked —</option>
            {motions.map((m) => (
              <option key={m.id} value={m.id}>
                M-{m.id} · {m.title} ({MOTION_STATUS_LABELS[m.status]?.label ?? m.status})
              </option>
            ))}
          </Select>
        </Field>
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
        <PrimaryBtn onClick={() => save.mutate()} disabled={save.isPending || !title.trim()} data-testid="button-save-special">
          {save.isPending ? "Saving…" : "Save"}
        </PrimaryBtn>
      </div>
    </Modal>
  );
}

// ── Budget Cycles ───────────────────────────────────────────────────────

function BudgetsPanel() {
  const qc = useQueryClient();
  const KEY = ["fin-budgets"];
  const { data = [], isLoading } = useQuery({ queryKey: KEY, queryFn: financialApi.listBudgets });
  const [editing, setEditing] = useState<BudgetCycle | "new" | null>(null);
  const del = useMutation({
    mutationFn: financialApi.deleteBudget,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <div>
      <div className="flex justify-end mb-3">
        <PrimaryBtn onClick={() => setEditing("new")} data-testid="button-new-budget">
          <Plus className="h-3.5 w-3.5 inline mr-1" /> New budget cycle
        </PrimaryBtn>
      </div>
      <Card>
        {isLoading ? <Empty msg="Loading…" /> : data.length === 0 ? <Empty msg="No budget cycles yet." /> : (
          <Table head={["FY", "Draft due", "Review", "Ratify", "Publish", "Reserve study", ""]}>
            {data.map((b) => (
              <tr key={b.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                <Td mono>FY{b.fiscalYear}</Td>
                <Td mono>{b.draftDueDate ?? "—"}</Td>
                <Td mono>{b.reviewMeetingDate ?? "—"}</Td>
                <Td mono>{b.ratificationMeetingDate ?? "—"}</Td>
                <Td mono>{b.publicationDate ?? "—"}</Td>
                <Td mono>{b.reserveStudyRefreshDate ?? "—"}</Td>
                <RowActions onEdit={() => setEditing(b)} onDelete={() => del.mutate(b.id)} />
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <BudgetEditor
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: KEY }); }}
        />
      )}
    </div>
  );
}

function BudgetEditor({ item, onClose, onSaved }: { item: BudgetCycle | null; onClose: () => void; onSaved: () => void }) {
  const [fy, setFy] = useState(String(item?.fiscalYear ?? new Date().getFullYear() + 1));
  const [draftDueDate, setDraftDueDate] = useState(item?.draftDueDate ?? "");
  const [reviewMeetingDate, setReviewMeetingDate] = useState(item?.reviewMeetingDate ?? "");
  const [ratificationMeetingDate, setRatificationMeetingDate] = useState(item?.ratificationMeetingDate ?? "");
  const [publicationDate, setPublicationDate] = useState(item?.publicationDate ?? "");
  const [reserveStudyRefreshDate, setReserveStudyRefreshDate] = useState(item?.reserveStudyRefreshDate ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body: Partial<BudgetCycle> = {
        fiscalYear: parseInt(fy, 10),
        draftDueDate: draftDueDate || null,
        reviewMeetingDate: reviewMeetingDate || null,
        ratificationMeetingDate: ratificationMeetingDate || null,
        publicationDate: publicationDate || null,
        reserveStudyRefreshDate: reserveStudyRefreshDate || null,
        notes,
      };
      return item ? financialApi.updateBudget(item.id, body) : financialApi.createBudget(body);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={item ? `Edit FY${item.fiscalYear}` : "New budget cycle"} onClose={onClose} wide>
      <ErrorBanner msg={error} />
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Fiscal year"><TextInput type="number" min={2000} max={2100} value={fy} onChange={(e) => setFy(e.target.value)} disabled={!!item} data-testid="input-budget-fy" /></Field>
        <div></div>
        <Field label="Draft due"><TextInput type="date" value={draftDueDate} onChange={(e) => setDraftDueDate(e.target.value)} /></Field>
        <Field label="Review meeting"><TextInput type="date" value={reviewMeetingDate} onChange={(e) => setReviewMeetingDate(e.target.value)} /></Field>
        <Field label="Ratification meeting"><TextInput type="date" value={ratificationMeetingDate} onChange={(e) => setRatificationMeetingDate(e.target.value)} /></Field>
        <Field label="Publication date"><TextInput type="date" value={publicationDate} onChange={(e) => setPublicationDate(e.target.value)} /></Field>
        <Field label="Reserve study refresh"><TextInput type="date" value={reserveStudyRefreshDate} onChange={(e) => setReserveStudyRefreshDate(e.target.value)} /></Field>
      </div>
      <div className="mt-3">
        <Field label="Notes"><TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <CalendarHint />
      <div className="flex justify-end gap-2 mt-4">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn onClick={() => save.mutate()} disabled={save.isPending || !fy} data-testid="button-save-budget">
          {save.isPending ? "Saving…" : "Save"}
        </PrimaryBtn>
      </div>
    </Modal>
  );
}

// ── Reserve Projects ────────────────────────────────────────────────────

const RESERVE_STATUSES: ReserveProject["status"][] = ["planned", "funded", "in_progress", "complete", "deferred"];

function ReservesPanel() {
  const qc = useQueryClient();
  const KEY = ["fin-reserves"];
  const { data = [], isLoading } = useQuery({ queryKey: KEY, queryFn: financialApi.listReserves });
  const [editing, setEditing] = useState<ReserveProject | "new" | null>(null);
  const del = useMutation({
    mutationFn: financialApi.deleteReserve,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <div>
      <div className="flex justify-end mb-3">
        <PrimaryBtn onClick={() => setEditing("new")} data-testid="button-new-reserve">
          <Plus className="h-3.5 w-3.5 inline mr-1" /> New reserve project
        </PrimaryBtn>
      </div>
      <Card>
        {isLoading ? <Empty msg="Loading…" /> : data.length === 0 ? <Empty msg="No reserve projects yet." /> : (
          <Table head={["Name", "Category", "Cost", "Funding", "Bid window", "Schedule", "Status", ""]}>
            {data.map((p) => (
              <tr key={p.id} className="border-t" style={{ borderColor: c.borderSoft }}>
                <Td>{p.name}</Td>
                <Td>{p.category}</Td>
                <Td mono>{fmtMoney(p.estimatedCostCents)}</Td>
                <Td mono>{p.fundingDate ?? "—"}</Td>
                <Td mono>{p.bidWindowStart ?? "—"}{p.bidWindowEnd ? ` → ${p.bidWindowEnd}` : ""}</Td>
                <Td mono>{p.scheduledStart ?? "—"}{p.scheduledEnd ? ` → ${p.scheduledEnd}` : ""}</Td>
                <Td capitalize>{p.status.replace("_", " ")}</Td>
                <RowActions onEdit={() => setEditing(p)} onDelete={() => del.mutate(p.id)} />
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <ReserveEditor
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: KEY }); }}
        />
      )}
    </div>
  );
}

function ReserveEditor({ item, onClose, onSaved }: { item: ReserveProject | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "other");
  const [estimatedCostDollars, setEstimatedCostDollars] = useState(item ? (item.estimatedCostCents / 100).toFixed(2) : "");
  const [fundingDate, setFundingDate] = useState(item?.fundingDate ?? "");
  const [bidWindowStart, setBidWindowStart] = useState(item?.bidWindowStart ?? "");
  const [bidWindowEnd, setBidWindowEnd] = useState(item?.bidWindowEnd ?? "");
  const [scheduledStart, setScheduledStart] = useState(item?.scheduledStart ?? "");
  const [scheduledEnd, setScheduledEnd] = useState(item?.scheduledEnd ?? "");
  const [status, setStatus] = useState<ReserveProject["status"]>(item?.status ?? "planned");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body: Partial<ReserveProject> = {
        name: name.trim(), category, status,
        estimatedCostCents: Math.round(parseFloat(estimatedCostDollars || "0") * 100),
        fundingDate: fundingDate || null,
        bidWindowStart: bidWindowStart || null,
        bidWindowEnd: bidWindowEnd || null,
        scheduledStart: scheduledStart || null,
        scheduledEnd: scheduledEnd || null,
        notes,
      };
      return item ? financialApi.updateReserve(item.id, body) : financialApi.createReserve(body);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Modal title={item ? "Edit reserve project" : "New reserve project"} onClose={onClose} wide>
      <ErrorBanner msg={error} />
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} data-testid="input-reserve-name" /></Field>
        <Field label="Category"><TextInput value={category} onChange={(e) => setCategory(e.target.value)} placeholder="roofing, paving, …" /></Field>
        <Field label="Estimated cost ($)"><TextInput type="number" min={0} step="0.01" value={estimatedCostDollars} onChange={(e) => setEstimatedCostDollars(e.target.value)} /></Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as ReserveProject["status"])}>
            {RESERVE_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </Select>
        </Field>
        <Field label="Funding date"><TextInput type="date" value={fundingDate} onChange={(e) => setFundingDate(e.target.value)} /></Field>
        <div></div>
        <Field label="Bid window opens"><TextInput type="date" value={bidWindowStart} onChange={(e) => setBidWindowStart(e.target.value)} /></Field>
        <Field label="Bid window closes"><TextInput type="date" value={bidWindowEnd} onChange={(e) => setBidWindowEnd(e.target.value)} /></Field>
        <Field label="Scheduled start"><TextInput type="date" value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} /></Field>
        <Field label="Scheduled end"><TextInput type="date" value={scheduledEnd} onChange={(e) => setScheduledEnd(e.target.value)} /></Field>
      </div>
      <div className="mt-3">
        <Field label="Notes"><TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <CalendarHint />
      <div className="flex justify-end gap-2 mt-4">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <PrimaryBtn onClick={() => save.mutate()} disabled={save.isPending || !name.trim()} data-testid="button-save-reserve">
          {save.isPending ? "Saving…" : "Save"}
        </PrimaryBtn>
      </div>
    </Modal>
  );
}

// ── Collections Policy ──────────────────────────────────────────────────

function PolicyPanel() {
  const KEY = ["fin-policy"];
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: financialApi.getPolicy });
  if (isLoading || !data) {
    return <Card><Empty msg="Loading…" /></Card>;
  }
  return <PolicyForm policy={data} onSaved={() => qc.invalidateQueries({ queryKey: KEY })} />;
}

function PolicyForm({ policy, onSaved }: { policy: CollectionsPolicy; onSaved: () => void }) {
  const [reminderDays, setReminderDays] = useState(String(policy.reminderDays));
  const [lateNoticeDays, setLateNoticeDays] = useState(String(policy.lateNoticeDays));
  const [demandLetterDays, setDemandLetterDays] = useState(String(policy.demandLetterDays));
  const [lienDays, setLienDays] = useState(String(policy.lienDays));
  const [attorneyDays, setAttorneyDays] = useState(String(policy.attorneyDays));
  const [active, setActive] = useState(policy.active);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => financialApi.updatePolicy({
      reminderDays: parseInt(reminderDays, 10),
      lateNoticeDays: parseInt(lateNoticeDays, 10),
      demandLetterDays: parseInt(demandLetterDays, 10),
      lienDays: parseInt(lienDays, 10),
      attorneyDays: parseInt(attorneyDays, 10),
      active,
    }),
    onSuccess: (row) => { setSavedAt(row.updatedAt); onSaved(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Card>
      <div className="p-5">
        <ErrorBanner msg={error} />
        <p className="text-[12.5px] mb-4" style={{ color: c.inkMute }}>
          These five thresholds drive automated reminders, late notices, demand letters,
          lien filings, and attorney handoffs. Days are measured from the original due date.
        </p>
        <div className="grid md:grid-cols-2 gap-3 max-w-2xl">
          <Field label="Reminder (days past due)">
            <TextInput type="number" min={0} value={reminderDays} onChange={(e) => setReminderDays(e.target.value)} data-testid="input-policy-reminder" />
          </Field>
          <Field label="Late notice (days)">
            <TextInput type="number" min={0} value={lateNoticeDays} onChange={(e) => setLateNoticeDays(e.target.value)} data-testid="input-policy-late" />
          </Field>
          <Field label="Demand letter (days)">
            <TextInput type="number" min={0} value={demandLetterDays} onChange={(e) => setDemandLetterDays(e.target.value)} data-testid="input-policy-demand" />
          </Field>
          <Field label="Lien (days)">
            <TextInput type="number" min={0} value={lienDays} onChange={(e) => setLienDays(e.target.value)} data-testid="input-policy-lien" />
          </Field>
          <Field label="Attorney handoff (days)">
            <TextInput type="number" min={0} value={attorneyDays} onChange={(e) => setAttorneyDays(e.target.value)} data-testid="input-policy-attorney" />
          </Field>
        </div>
        <label className="inline-flex items-center gap-2 mt-4 text-[12.5px]">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Policy active
        </label>
        <div className="mt-5 flex items-center gap-3">
          <PrimaryBtn onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-policy">
            {save.isPending ? "Saving…" : "Save policy"}
          </PrimaryBtn>
          {savedAt && (
            <span className="text-[11.5px]" style={{ color: c.inkMute }}>
              Saved {new Date(savedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Tiny shared layout helpers ──────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="py-12 text-center text-[13px]" style={{ color: c.inkMute }}>{msg}</div>;
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-[13px]">
      <thead style={{ background: c.canvas }}>
        <tr style={{ color: c.inkMute }} className="text-left text-[11px] uppercase tracking-wider">
          {head.map((h, i) => (
            <th key={i} className="px-4 py-3" style={{ fontWeight: 700 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Td({ children, mono, capitalize }: { children: React.ReactNode; mono?: boolean; capitalize?: boolean }) {
  return (
    <td className={`px-4 py-2.5 ${mono ? "font-mono-num" : ""} ${capitalize ? "capitalize" : ""}`} style={{ color: c.ink }}>
      {children}
    </td>
  );
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
