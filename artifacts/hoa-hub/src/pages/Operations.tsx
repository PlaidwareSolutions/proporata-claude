// Manager admin screens for the calendar-integrated operations data
// (Task #112): inspections, compliance items, lifecycle items, vendor
// contracts, and vendor certificates. Each tab is a thin CRUD over the
// existing Task #75/#76 API routes; every write triggers calendar
// materialization on the server side.
import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListVendors, useListBuildings, type Vendor, type Building } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { apiFetch } from "@/lib/apiFetch";
import { ClipboardCheck, Plus, X, Trash2, Wrench, ShieldCheck, Repeat, FileBadge } from "lucide-react";

type Inspection = {
  id: number; kind: string; title: string; scheduledOn: string;
  durationMinutes: number; assigneeName: string | null;
  buildingNum: number | null; vendorId: number | null;
  agency: string | null; status: string; notes: string;
};
type ComplianceItem = {
  id: number; kind: string; title: string; description: string;
  dueDate: string; status: string; notes: string;
};
type LifecycleItem = {
  id: number; kind: string; title: string; buildingNum: number | null;
  lastDoneOn: string | null; intervalMonths: number;
  equipmentName: string | null; notes: string; active: boolean;
};
type VendorContract = {
  id: number; vendorId: number; serviceType: string; title: string;
  recurrence: { freq: string; interval?: number } | null;
  firstServiceOn: string; durationMinutes: number; active: boolean; notes: string;
};
type VendorCertificate = {
  id: number; vendorId: number; kind: string;
  expiresOn: string; notes: string;
};

type TabKey = "inspections" | "compliance" | "lifecycle" | "contracts" | "certificates";

const TABS: Array<{ key: TabKey; label: string; icon: typeof Wrench }> = [
  { key: "inspections", label: "Inspections", icon: ClipboardCheck },
  { key: "compliance", label: "Compliance", icon: ShieldCheck },
  { key: "lifecycle", label: "Lifecycle", icon: Repeat },
  { key: "contracts", label: "Vendor Contracts", icon: Wrench },
  { key: "certificates", label: "Vendor Certificates", icon: FileBadge },
];

export default function Operations() {
  const [tab, setTab] = useState<TabKey>("inspections");
  return (
    <Layout title="Operations" subtitle="Schedule and govern recurring property operations.">
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <ClipboardCheck size={26} style={{ color: c.cobalt }} />
          <div>
            <h1 className="text-2xl font-semibold">Operations</h1>
            <p className="text-sm" style={{ color: c.inkMute }}>
              Inspections, compliance deadlines, lifecycle upkeep, and vendor service contracts. Every change
              auto-syncs to the central calendar.
            </p>
          </div>
        </div>
        <div className="flex gap-1 mb-6 border-b" style={{ borderColor: c.border }}>
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                data-testid={`tab-${t.key}`}
                className="px-3 py-2 text-sm font-medium flex items-center gap-1.5 -mb-px border-b-2"
                style={{
                  borderColor: active ? c.cobalt : "transparent",
                  color: active ? c.cobalt : c.inkMute,
                }}
              >
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
        {tab === "inspections" && <InspectionsTab />}
        {tab === "compliance" && <ComplianceTab />}
        {tab === "lifecycle" && <LifecycleTab />}
        {tab === "contracts" && <ContractsTab />}
        {tab === "certificates" && <CertificatesTab />}
      </div>
    </Layout>
  );
}

// ── Inspections ──────────────────────────────────────────────────────────
const INSPECTION_KINDS = ["annual_walkthrough", "acc_sweep", "insurance", "reserve_study", "permit", "easement", "other"];

function InspectionsTab() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery<Inspection[]>({
    queryKey: ["/inspections"],
    queryFn: () => apiFetch<Inspection[]>({ url: "/inspections", method: "GET" }),
  });
  const { data: buildings = [] } = useListBuildings();
  const { data: vendors = [] } = useListVendors();
  const [showNew, setShowNew] = useState(false);
  const [edit, setEdit] = useState<Inspection | null>(null);

  const del = useMutation({
    mutationFn: (id: number) => apiFetch({ url: `/inspections/${id}`, method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/inspections"] }),
  });

  return (
    <Section
      title="Inspections"
      onNew={() => setShowNew(true)}
      newLabel="Schedule inspection"
      empty={data.length === 0 && !isLoading}
      emptyText="No inspections scheduled."
      loading={isLoading}
    >
      <Table headers={["Title", "Kind", "Scheduled", "Building", "Assignee / Vendor", "Status", ""]}>
        {data.map((row) => (
          <tr key={row.id} className="border-t" style={{ borderColor: c.border }}>
            <td className="px-4 py-2 font-medium">{row.title}</td>
            <td className="px-4 py-2 text-xs" style={{ color: c.inkMute }}>{row.kind}</td>
            <td className="px-4 py-2 font-mono-num text-xs">{row.scheduledOn}</td>
            <td className="px-4 py-2 text-xs">{row.buildingNum ? `B${row.buildingNum}` : "—"}</td>
            <td className="px-4 py-2 text-xs">
              {row.assigneeName || vendorName(vendors, row.vendorId) || "—"}
            </td>
            <td className="px-4 py-2"><StatusPill value={row.status} /></td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
              <button onClick={() => setEdit(row)} className="text-xs px-2 py-1 rounded border mr-1" style={{ borderColor: c.border }}>Edit</button>
              <button onClick={() => { if (confirm("Delete inspection?")) del.mutate(row.id); }} className="text-xs px-2 py-1 rounded border" style={{ borderColor: c.border }}><Trash2 size={12} /></button>
            </td>
          </tr>
        ))}
      </Table>
      {(showNew || edit) && (
        <InspectionForm
          initial={edit}
          buildings={buildings}
          vendors={vendors}
          onClose={() => { setShowNew(false); setEdit(null); }}
          onSaved={() => { setShowNew(false); setEdit(null); qc.invalidateQueries({ queryKey: ["/inspections"] }); }}
        />
      )}
    </Section>
  );
}

function InspectionForm({ initial, buildings, vendors, onClose, onSaved }: {
  initial: Inspection | null; buildings: Building[]; vendors: Vendor[];
  onClose: () => void; onSaved: () => void;
}) {
  const [kind, setKind] = useState(initial?.kind ?? "annual_walkthrough");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [scheduledOn, setScheduledOn] = useState(toDatetimeLocal(initial?.scheduledOn ?? ""));
  const [durationMinutes, setDurationMinutes] = useState(String(initial?.durationMinutes ?? 120));
  const [assigneeName, setAssigneeName] = useState(initial?.assigneeName ?? "");
  const [buildingNum, setBuildingNum] = useState<string>(initial?.buildingNum ? String(initial.buildingNum) : "");
  const [vendorId, setVendorId] = useState<string>(initial?.vendorId ? String(initial.vendorId) : "");
  const [agency, setAgency] = useState(initial?.agency ?? "");
  const [status, setStatus] = useState(initial?.status ?? "scheduled");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        kind, title: title.trim(), scheduledOn: fromDatetimeLocal(scheduledOn),
        durationMinutes: Number(durationMinutes) || 120,
        assigneeName: assigneeName.trim() || null,
        buildingNum: buildingNum ? Number(buildingNum) : null,
        vendorId: vendorId ? Number(vendorId) : null,
        agency: agency.trim() || null,
        status, notes,
      };
      return initial
        ? apiFetch({ url: `/inspections/${initial.id}`, method: "PATCH", data: payload })
        : apiFetch({ url: "/inspections", method: "POST", data: payload });
    },
    onSuccess: onSaved,
  });
  const valid = title.trim() && scheduledOn;
  return (
    <Modal title={initial ? "Edit inspection" : "Schedule inspection"} onClose={onClose}>
      <Field label="Title"><TextInput value={title} onChange={setTitle} /></Field>
      <Row>
        <Field label="Kind"><Select value={kind} onChange={setKind} options={INSPECTION_KINDS} /></Field>
        <Field label="Status"><Select value={status} onChange={setStatus} options={["scheduled", "completed", "cancelled"]} /></Field>
      </Row>
      <Row>
        <Field label="Scheduled date / time"><TextInput type="datetime-local" value={scheduledOn} onChange={setScheduledOn} /></Field>
        <Field label="Duration (minutes)"><TextInput type="number" value={durationMinutes} onChange={setDurationMinutes} /></Field>
      </Row>
      <Row>
        <Field label="Building (optional)">
          <Select value={buildingNum} onChange={setBuildingNum} options={["", ...buildings.map((b) => String(b.num))]} labels={["—", ...buildings.map((b) => `B${b.num} — ${b.address}`)]} />
        </Field>
        <Field label="Vendor (optional)">
          <Select value={vendorId} onChange={setVendorId} options={["", ...vendors.map((v) => String(v.id))]} labels={["—", ...vendors.map((v) => v.name)]} />
        </Field>
      </Row>
      <Row>
        <Field label="Assignee name (optional)"><TextInput value={assigneeName} onChange={setAssigneeName} /></Field>
        <Field label="Agency (permits/easements)"><TextInput value={agency} onChange={setAgency} /></Field>
      </Row>
      <Field label="Notes"><TextArea value={notes} onChange={setNotes} /></Field>
      <SaveButton onClick={() => save.mutate()} disabled={!valid || save.isPending} />
    </Modal>
  );
}

// ── Compliance ───────────────────────────────────────────────────────────
const COMPLIANCE_KINDS = ["tax", "audit", "insurance", "regulatory", "bank_recon", "other"];

function ComplianceTab() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery<ComplianceItem[]>({
    queryKey: ["/compliance/items"],
    queryFn: () => apiFetch<ComplianceItem[]>({ url: "/compliance/items", method: "GET" }),
  });
  const [showNew, setShowNew] = useState(false);
  const [edit, setEdit] = useState<ComplianceItem | null>(null);
  const del = useMutation({
    mutationFn: (id: number) => apiFetch({ url: `/compliance/items/${id}`, method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/compliance/items"] }),
  });
  return (
    <Section
      title="Compliance items"
      onNew={() => setShowNew(true)}
      newLabel="Add compliance item"
      empty={data.length === 0 && !isLoading}
      emptyText="No compliance items yet."
      loading={isLoading}
    >
      <Table headers={["Title", "Kind", "Due", "Status", ""]}>
        {data.map((row) => (
          <tr key={row.id} className="border-t" style={{ borderColor: c.border }}>
            <td className="px-4 py-2 font-medium">{row.title}</td>
            <td className="px-4 py-2 text-xs" style={{ color: c.inkMute }}>{row.kind}</td>
            <td className="px-4 py-2 font-mono-num text-xs">{row.dueDate}</td>
            <td className="px-4 py-2"><StatusPill value={row.status} /></td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
              <button onClick={() => setEdit(row)} className="text-xs px-2 py-1 rounded border mr-1" style={{ borderColor: c.border }}>Edit</button>
              <button onClick={() => { if (confirm("Delete item?")) del.mutate(row.id); }} className="text-xs px-2 py-1 rounded border" style={{ borderColor: c.border }}><Trash2 size={12} /></button>
            </td>
          </tr>
        ))}
      </Table>
      {(showNew || edit) && (
        <ComplianceForm
          initial={edit}
          onClose={() => { setShowNew(false); setEdit(null); }}
          onSaved={() => { setShowNew(false); setEdit(null); qc.invalidateQueries({ queryKey: ["/compliance/items"] }); }}
        />
      )}
    </Section>
  );
}

function ComplianceForm({ initial, onClose, onSaved }: { initial: ComplianceItem | null; onClose: () => void; onSaved: () => void; }) {
  const [kind, setKind] = useState(initial?.kind ?? "tax");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [status, setStatus] = useState(initial?.status ?? "open");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const save = useMutation({
    mutationFn: () => {
      const payload = { kind, title: title.trim(), description, dueDate, status, notes };
      return initial
        ? apiFetch({ url: `/compliance/items/${initial.id}`, method: "PATCH", data: payload })
        : apiFetch({ url: "/compliance/items", method: "POST", data: payload });
    },
    onSuccess: onSaved,
  });
  const valid = title.trim() && dueDate;
  return (
    <Modal title={initial ? "Edit compliance item" : "Add compliance item"} onClose={onClose}>
      <Field label="Title"><TextInput value={title} onChange={setTitle} /></Field>
      <Row>
        <Field label="Kind"><Select value={kind} onChange={setKind} options={COMPLIANCE_KINDS} /></Field>
        <Field label="Status"><Select value={status} onChange={setStatus} options={["open", "in_progress", "done", "overdue"]} /></Field>
      </Row>
      <Field label="Due date (YYYY-MM-DD or full ISO)"><TextInput value={dueDate} onChange={setDueDate} placeholder="2026-04-15" /></Field>
      <Field label="Description"><TextArea value={description} onChange={setDescription} /></Field>
      <Field label="Notes"><TextArea value={notes} onChange={setNotes} /></Field>
      <SaveButton onClick={() => save.mutate()} disabled={!valid || save.isPending} />
    </Modal>
  );
}

// ── Lifecycle items ──────────────────────────────────────────────────────
const LIFECYCLE_KINDS = ["roof_inspection", "paint_cycle", "fence_repair", "parking_reseal", "drainage_cleanout", "equipment", "seasonal", "other"];

function LifecycleTab() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery<LifecycleItem[]>({
    queryKey: ["/lifecycle-items"],
    queryFn: () => apiFetch<LifecycleItem[]>({ url: "/lifecycle-items", method: "GET" }),
  });
  const { data: buildings = [] } = useListBuildings();
  const [showNew, setShowNew] = useState(false);
  const [edit, setEdit] = useState<LifecycleItem | null>(null);
  const del = useMutation({
    mutationFn: (id: number) => apiFetch({ url: `/lifecycle-items/${id}`, method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/lifecycle-items"] }),
  });
  return (
    <Section
      title="Lifecycle items"
      onNew={() => setShowNew(true)}
      newLabel="Add lifecycle item"
      empty={data.length === 0 && !isLoading}
      emptyText="No lifecycle items yet."
      loading={isLoading}
    >
      <Table headers={["Title", "Kind", "Building", "Last done", "Interval (mo)", "Active", ""]}>
        {data.map((row) => (
          <tr key={row.id} className="border-t" style={{ borderColor: c.border }}>
            <td className="px-4 py-2 font-medium">{row.title}</td>
            <td className="px-4 py-2 text-xs" style={{ color: c.inkMute }}>{row.kind}</td>
            <td className="px-4 py-2 text-xs">{row.buildingNum ? `B${row.buildingNum}` : "—"}</td>
            <td className="px-4 py-2 font-mono-num text-xs">{row.lastDoneOn || "—"}</td>
            <td className="px-4 py-2 text-xs">{row.intervalMonths}</td>
            <td className="px-4 py-2 text-xs">{row.active ? "Yes" : "No"}</td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
              <button onClick={() => setEdit(row)} className="text-xs px-2 py-1 rounded border mr-1" style={{ borderColor: c.border }}>Edit</button>
              <button onClick={() => { if (confirm("Delete item?")) del.mutate(row.id); }} className="text-xs px-2 py-1 rounded border" style={{ borderColor: c.border }}><Trash2 size={12} /></button>
            </td>
          </tr>
        ))}
      </Table>
      {(showNew || edit) && (
        <LifecycleForm
          initial={edit}
          buildings={buildings}
          onClose={() => { setShowNew(false); setEdit(null); }}
          onSaved={() => { setShowNew(false); setEdit(null); qc.invalidateQueries({ queryKey: ["/lifecycle-items"] }); }}
        />
      )}
    </Section>
  );
}

function LifecycleForm({ initial, buildings, onClose, onSaved }: { initial: LifecycleItem | null; buildings: Building[]; onClose: () => void; onSaved: () => void; }) {
  const [kind, setKind] = useState(initial?.kind ?? "roof_inspection");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [buildingNum, setBuildingNum] = useState(initial?.buildingNum ? String(initial.buildingNum) : "");
  const [lastDoneOn, setLastDoneOn] = useState(initial?.lastDoneOn ?? "");
  const [intervalMonths, setIntervalMonths] = useState(String(initial?.intervalMonths ?? 12));
  const [equipmentName, setEquipmentName] = useState(initial?.equipmentName ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        kind, title: title.trim(),
        buildingNum: buildingNum ? Number(buildingNum) : null,
        lastDoneOn: lastDoneOn || null,
        intervalMonths: Number(intervalMonths) || 12,
        equipmentName: equipmentName.trim() || null,
        active, notes,
      };
      return initial
        ? apiFetch({ url: `/lifecycle-items/${initial.id}`, method: "PATCH", data: payload })
        : apiFetch({ url: "/lifecycle-items", method: "POST", data: payload });
    },
    onSuccess: onSaved,
  });
  const valid = title.trim();
  return (
    <Modal title={initial ? "Edit lifecycle item" : "Add lifecycle item"} onClose={onClose}>
      <Field label="Title"><TextInput value={title} onChange={setTitle} /></Field>
      <Row>
        <Field label="Kind"><Select value={kind} onChange={setKind} options={LIFECYCLE_KINDS} /></Field>
        <Field label="Building (optional)">
          <Select value={buildingNum} onChange={setBuildingNum} options={["", ...buildings.map((b) => String(b.num))]} labels={["—", ...buildings.map((b) => `B${b.num} — ${b.address}`)]} />
        </Field>
      </Row>
      <Row>
        <Field label="Last done (YYYY-MM-DD)"><TextInput value={lastDoneOn} onChange={setLastDoneOn} placeholder="2025-09-01" /></Field>
        <Field label="Interval (months)"><TextInput type="number" value={intervalMonths} onChange={setIntervalMonths} /></Field>
      </Row>
      <Field label="Equipment name (for equipment kind)"><TextInput value={equipmentName} onChange={setEquipmentName} /></Field>
      <Field label="Active">
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Generate calendar events
        </label>
      </Field>
      <Field label="Notes"><TextArea value={notes} onChange={setNotes} /></Field>
      <SaveButton onClick={() => save.mutate()} disabled={!valid || save.isPending} />
    </Modal>
  );
}

// ── Vendor contracts ─────────────────────────────────────────────────────
const SERVICE_TYPES = ["landscaping", "pool", "pest", "trash", "gate", "fire", "other"];
const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

function ContractsTab() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery<VendorContract[]>({
    queryKey: ["/vendor-contracts"],
    queryFn: () => apiFetch<VendorContract[]>({ url: "/vendor-contracts", method: "GET" }),
  });
  const { data: vendors = [] } = useListVendors();
  const [showNew, setShowNew] = useState(false);
  const [edit, setEdit] = useState<VendorContract | null>(null);
  const del = useMutation({
    mutationFn: (id: number) => apiFetch({ url: `/vendor-contracts/${id}`, method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/vendor-contracts"] }),
  });
  return (
    <Section
      title="Vendor contracts"
      onNew={() => setShowNew(true)}
      newLabel="Add vendor contract"
      empty={data.length === 0 && !isLoading}
      emptyText="No vendor service contracts yet."
      loading={isLoading}
    >
      <Table headers={["Title", "Vendor", "Service", "First service", "Recurrence", "Active", ""]}>
        {data.map((row) => (
          <tr key={row.id} className="border-t" style={{ borderColor: c.border }}>
            <td className="px-4 py-2 font-medium">{row.title}</td>
            <td className="px-4 py-2 text-xs">{vendorName(vendors, row.vendorId) || `#${row.vendorId}`}</td>
            <td className="px-4 py-2 text-xs" style={{ color: c.inkMute }}>{row.serviceType}</td>
            <td className="px-4 py-2 font-mono-num text-xs">{row.firstServiceOn}</td>
            <td className="px-4 py-2 text-xs">{recurrenceLabel(row.recurrence)}</td>
            <td className="px-4 py-2 text-xs">{row.active ? "Yes" : "No"}</td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
              <button onClick={() => setEdit(row)} className="text-xs px-2 py-1 rounded border mr-1" style={{ borderColor: c.border }}>Edit</button>
              <button onClick={() => { if (confirm("Delete contract?")) del.mutate(row.id); }} className="text-xs px-2 py-1 rounded border" style={{ borderColor: c.border }}><Trash2 size={12} /></button>
            </td>
          </tr>
        ))}
      </Table>
      {(showNew || edit) && (
        <ContractForm
          initial={edit}
          vendors={vendors}
          onClose={() => { setShowNew(false); setEdit(null); }}
          onSaved={() => { setShowNew(false); setEdit(null); qc.invalidateQueries({ queryKey: ["/vendor-contracts"] }); }}
        />
      )}
    </Section>
  );
}

function ContractForm({ initial, vendors, onClose, onSaved }: { initial: VendorContract | null; vendors: Vendor[]; onClose: () => void; onSaved: () => void; }) {
  const [vendorId, setVendorId] = useState(initial?.vendorId ? String(initial.vendorId) : (vendors[0]?.id ? String(vendors[0].id) : ""));
  const [serviceType, setServiceType] = useState(initial?.serviceType ?? "landscaping");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [firstServiceOn, setFirstServiceOn] = useState(initial?.firstServiceOn ?? "");
  const [durationMinutes, setDurationMinutes] = useState(String(initial?.durationMinutes ?? 60));
  const [freq, setFreq] = useState(initial?.recurrence?.freq ?? "WEEKLY");
  const [interval, setInterval] = useState(String(initial?.recurrence?.interval ?? 1));
  const [active, setActive] = useState(initial?.active ?? true);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        vendorId: Number(vendorId), serviceType, title: title.trim(),
        firstServiceOn,
        durationMinutes: Number(durationMinutes) || 60,
        recurrence: { freq, interval: Number(interval) || 1 },
        active, notes,
      };
      return initial
        ? apiFetch({ url: `/vendor-contracts/${initial.id}`, method: "PATCH", data: payload })
        : apiFetch({ url: "/vendor-contracts", method: "POST", data: payload });
    },
    onSuccess: onSaved,
  });
  const valid = vendorId && title.trim() && firstServiceOn;
  return (
    <Modal title={initial ? "Edit vendor contract" : "Add vendor contract"} onClose={onClose}>
      <Field label="Title"><TextInput value={title} onChange={setTitle} /></Field>
      <Row>
        <Field label="Vendor">
          <Select value={vendorId} onChange={setVendorId} options={vendors.map((v) => String(v.id))} labels={vendors.map((v) => v.name)} />
        </Field>
        <Field label="Service type"><Select value={serviceType} onChange={setServiceType} options={SERVICE_TYPES} /></Field>
      </Row>
      <Row>
        <Field label="First service (YYYY-MM-DD or ISO)"><TextInput value={firstServiceOn} onChange={setFirstServiceOn} placeholder="2026-05-04T08:00:00Z" /></Field>
        <Field label="Duration (minutes)"><TextInput type="number" value={durationMinutes} onChange={setDurationMinutes} /></Field>
      </Row>
      <Row>
        <Field label="Recurrence"><Select value={freq} onChange={setFreq} options={FREQS} /></Field>
        <Field label="Interval"><TextInput type="number" value={interval} onChange={setInterval} /></Field>
      </Row>
      <Field label="Active">
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Generate calendar events
        </label>
      </Field>
      <Field label="Notes"><TextArea value={notes} onChange={setNotes} /></Field>
      <SaveButton onClick={() => save.mutate()} disabled={!valid || save.isPending} />
    </Modal>
  );
}

// ── Vendor certificates ──────────────────────────────────────────────────
const CERT_KINDS = ["coi", "w9", "license"];

function CertificatesTab() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery<VendorCertificate[]>({
    queryKey: ["/vendor-certificates"],
    queryFn: () => apiFetch<VendorCertificate[]>({ url: "/vendor-certificates", method: "GET" }),
  });
  const { data: vendors = [] } = useListVendors();
  const [showNew, setShowNew] = useState(false);
  const [edit, setEdit] = useState<VendorCertificate | null>(null);
  const del = useMutation({
    mutationFn: (id: number) => apiFetch({ url: `/vendor-certificates/${id}`, method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/vendor-certificates"] }),
  });
  return (
    <Section
      title="Vendor certificates"
      onNew={() => setShowNew(true)}
      newLabel="Add certificate"
      empty={data.length === 0 && !isLoading}
      emptyText="No vendor certificates tracked yet."
      loading={isLoading}
    >
      <Table headers={["Vendor", "Kind", "Expires", "Notes", ""]}>
        {data.map((row) => (
          <tr key={row.id} className="border-t" style={{ borderColor: c.border }}>
            <td className="px-4 py-2 font-medium">{vendorName(vendors, row.vendorId) || `#${row.vendorId}`}</td>
            <td className="px-4 py-2 text-xs uppercase" style={{ color: c.inkMute }}>{row.kind}</td>
            <td className="px-4 py-2 font-mono-num text-xs">{row.expiresOn}</td>
            <td className="px-4 py-2 text-xs">{row.notes}</td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
              <button onClick={() => setEdit(row)} className="text-xs px-2 py-1 rounded border mr-1" style={{ borderColor: c.border }}>Edit</button>
              <button onClick={() => { if (confirm("Delete certificate?")) del.mutate(row.id); }} className="text-xs px-2 py-1 rounded border" style={{ borderColor: c.border }}><Trash2 size={12} /></button>
            </td>
          </tr>
        ))}
      </Table>
      {(showNew || edit) && (
        <CertificateForm
          initial={edit}
          vendors={vendors}
          onClose={() => { setShowNew(false); setEdit(null); }}
          onSaved={() => { setShowNew(false); setEdit(null); qc.invalidateQueries({ queryKey: ["/vendor-certificates"] }); }}
        />
      )}
    </Section>
  );
}

function CertificateForm({ initial, vendors, onClose, onSaved }: { initial: VendorCertificate | null; vendors: Vendor[]; onClose: () => void; onSaved: () => void; }) {
  const [vendorId, setVendorId] = useState(initial?.vendorId ? String(initial.vendorId) : (vendors[0]?.id ? String(vendors[0].id) : ""));
  const [kind, setKind] = useState(initial?.kind ?? "coi");
  const [expiresOn, setExpiresOn] = useState(initial?.expiresOn ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const save = useMutation({
    mutationFn: () => {
      const payload = { vendorId: Number(vendorId), kind, expiresOn, notes };
      return initial
        ? apiFetch({ url: `/vendor-certificates/${initial.id}`, method: "PATCH", data: payload })
        : apiFetch({ url: "/vendor-certificates", method: "POST", data: payload });
    },
    onSuccess: onSaved,
  });
  const valid = vendorId && kind && expiresOn;
  return (
    <Modal title={initial ? "Edit certificate" : "Add certificate"} onClose={onClose}>
      <Row>
        <Field label="Vendor">
          <Select value={vendorId} onChange={setVendorId} options={vendors.map((v) => String(v.id))} labels={vendors.map((v) => v.name)} />
        </Field>
        <Field label="Kind"><Select value={kind} onChange={setKind} options={CERT_KINDS} /></Field>
      </Row>
      <Field label="Expires on (YYYY-MM-DD)"><TextInput value={expiresOn} onChange={setExpiresOn} placeholder="2026-12-31" /></Field>
      <Field label="Notes"><TextArea value={notes} onChange={setNotes} /></Field>
      <SaveButton onClick={() => save.mutate()} disabled={!valid || save.isPending} />
    </Modal>
  );
}

// ── Shared UI primitives ─────────────────────────────────────────────────
// `datetime-local` inputs require the value formatted as "YYYY-MM-DDTHH:mm"
// (no timezone, no seconds). Server values may come back as full ISO with
// "Z", a date-only string, or already-local — normalize on read/write so
// edits don't lose precision or render blank in browsers.
function toDatetimeLocal(v: string): string {
  if (!v) return "";
  // Date-only stays as-is so the input can keep blank time portion.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromDatetimeLocal(v: string): string {
  if (!v) return "";
  // Treat input as local time and emit a full ISO string for the server.
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toISOString();
}

function vendorName(vendors: Vendor[], id: number | null | undefined): string | null {
  if (!id) return null;
  return vendors.find((v) => v.id === id)?.name ?? null;
}

function recurrenceLabel(r: { freq: string; interval?: number } | null): string {
  if (!r) return "—";
  const i = r.interval && r.interval > 1 ? ` /${r.interval}` : "";
  return `${r.freq.toLowerCase()}${i}`;
}

function Section({ title, onNew, newLabel, children, empty, emptyText, loading }: {
  title: string; onNew: () => void; newLabel: string;
  children: ReactNode; empty: boolean; emptyText: string; loading: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <button onClick={onNew} data-testid="button-new" className="px-3 py-1.5 rounded-lg text-white text-sm font-medium flex items-center gap-1" style={{ background: c.cobalt }}>
          <Plus size={14} /> {newLabel}
        </button>
      </div>
      {loading
        ? <div className="text-sm" style={{ color: c.inkMute }}>Loading…</div>
        : empty
          ? <div className="rounded-2xl border bg-white p-6 text-center text-sm" style={{ borderColor: c.border, color: c.inkMute }}>{emptyText}</div>
          : children}
    </div>
  );
}

function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
      <table className="w-full text-sm">
        <thead style={{ background: "#F6F8FA" }}>
          <tr style={{ color: c.inkMute }}>
            {headers.map((h, i) => (
              <th key={i} className="text-left font-medium px-4 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const ok = value === "completed" || value === "done";
  const warn = value === "overdue" || value === "cancelled";
  const fg = ok ? "#0E6F45" : warn ? "#9A2542" : "#475569";
  const bg = ok ? "#DCF3EC" : warn ? "#FCE5EC" : "#EEF2F7";
  return (
    <span className="text-[11.5px] rounded-full px-2 py-0.5 font-semibold" style={{ color: fg, background: bg }}>
      {value}
    </span>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mb-3"><label className="text-sm font-medium block mb-1">{label}</label>{children}</div>;
}
function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
function TextInput({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: c.border }} />;
}
function TextArea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: c.border }} />;
}
function Select({ value, onChange, options, labels }: { value: string; onChange: (v: string) => void; options: string[]; labels?: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm bg-white" style={{ borderColor: c.border }}>
      {options.map((opt, i) => <option key={`${opt}-${i}`} value={opt}>{labels?.[i] ?? opt}</option>)}
    </select>
  );
}
function SaveButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} data-testid="button-save" className="mt-3 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50" style={{ background: c.cobalt }}>
      Save
    </button>
  );
}
