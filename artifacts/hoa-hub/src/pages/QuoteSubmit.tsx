import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Lock, FileText, CheckCircle2, AlertTriangle, Send, Upload, Check } from "lucide-react";
import { quotePublicApi, fmtCents, type QuotePublicView } from "@/lib/bidsApi";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function QuoteSubmit() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [view, setView] = useState<QuotePublicView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [declined, setDeclined] = useState(false);

  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [leadTime, setLeadTime] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [warranty, setWarranty] = useState("");
  const [notes, setNotes] = useState("");
  const [firm, setFirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quotePdfKey, setQuotePdfKey] = useState<string | null>(null);
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  const [coiKey, setCoiKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  async function uploadDoc(kind: "quotePdf" | "license" | "coi", file: File) {
    setUploading(kind);
    try {
      const { uploadURL, objectPath } = await quotePublicApi.uploadUrl(token);
      const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!put.ok) throw new Error("Upload failed");
      if (kind === "quotePdf") setQuotePdfKey(objectPath);
      else if (kind === "license") setLicenseKey(objectPath);
      else setCoiKey(objectPath);
    } catch (e) { alert((e as Error).message); }
    setUploading(null);
  }

  useEffect(() => {
    quotePublicApi.view(token).then((v) => {
      setView(v);
      const init: Record<number, string> = {};
      if (v.existingQuote) {
        for (const l of v.existingQuote.lines) init[l.scopeItemId] = (l.amountCents / 100).toFixed(2);
        setLeadTime(v.existingQuote.leadTimeDays ? String(v.existingQuote.leadTimeDays) : "");
        setPaymentTerms(v.existingQuote.paymentTerms ?? "");
        setWarranty(v.existingQuote.warrantyText ?? "");
        setNotes(v.existingQuote.notes ?? "");
      }
      setAmounts(init);
    }).catch((e) => setError((e as Error).message));
  }, [token]);

  if (error) return <Center><Frame><div className="text-red-700 text-[14px]"><AlertTriangle className="inline h-4 w-4 mr-1" /> {error}</div></Frame></Center>;
  if (!view) return <Center><Frame><div className="text-slate-500">Loading…</div></Frame></Center>;
  if (submitted) return (
    <Center><Frame>
      <CheckCircle2 className="h-10 w-10 text-green-600 mb-2" />
      <h2 className="text-[20px] font-bold mb-1">Quote received</h2>
      <p className="text-[14px] text-slate-600">Thank you for submitting your quote for "{view.bid.title}". {view.orgName} will review and respond by the deadline.</p>
    </Frame></Center>
  );
  if (declined) return (
    <Center><Frame>
      <h2 className="text-[20px] font-bold mb-1">Decline recorded</h2>
      <p className="text-[14px] text-slate-600">Thank you for letting us know. You will not receive further reminders for this bid.</p>
    </Frame></Center>
  );

  const total = view.scopeItems.reduce((s, it) => s + (parseFloat(amounts[it.id] ?? "0") || 0), 0);
  const allFilled = view.scopeItems.every((it) => amounts[it.id] && !isNaN(parseFloat(amounts[it.id]!)));

  return (
    <Center>
      <Frame>
        <div className="text-[12px] text-slate-500 mb-1">{view.orgName}</div>
        <h1 className="text-[24px] font-bold mb-1">Bid Request: {view.bid.title}</h1>
        <div className="text-[13px] text-slate-600 mb-4">
          {view.bid.tradeCategory}
          {view.bid.buildingNum ? ` · Building ${view.bid.buildingNum}` : ""}
          {" · "}Deadline: <strong>{view.bid.deadline.slice(0, 10)}</strong>
        </div>
        {view.bid.sealedBids && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 mb-4 text-[12.5px] flex items-start gap-2">
            <Lock className="h-4 w-4 text-amber-700 mt-0.5" />
            <div>
              <strong>Sealed bid.</strong> Totals are not visible to other vendors and will not be opened until the deadline.
            </div>
          </div>
        )}
        {view.vendor && (
          <div className="rounded-md bg-slate-50 border border-slate-200 p-3 mb-4 text-[13px]">
            Hello <strong>{view.vendor.name}</strong> — please submit your firm-quote prices for each line item below.
          </div>
        )}
        {view.bid.scope && (
          <section className="mb-4">
            <h2 className="text-[14px] font-bold mb-1">Project description</h2>
            <p className="text-[13.5px] text-slate-700 whitespace-pre-wrap">{view.bid.scope}</p>
          </section>
        )}
        {view.attachments.length > 0 && (
          <section className="mb-4">
            <h2 className="text-[14px] font-bold mb-1">Reference attachments</h2>
            <ul className="text-[13px]">
              {view.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-0.5">
                  <FileText className="h-3.5 w-3.5 text-slate-400" />
                  <a href={`${BASE}${a.downloadUrl}`} target="_blank" rel="noopener" className="text-blue-700 hover:underline font-medium">{a.name}</a>
                  <span className="text-[11px] text-slate-400">· {(a.size / 1024).toFixed(0)} KB</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mb-4">
          <h2 className="text-[14px] font-bold mb-2">Line items — please price each</h2>
          <div className="rounded-md border border-slate-200 overflow-hidden">
            {view.scopeItems.map((it, i) => (
              <div key={it.id} className="flex items-center gap-3 px-3 py-2 border-b border-slate-100">
                <div className="font-mono text-[12px] text-slate-400 w-6">{i + 1}.</div>
                <div className="flex-1">
                  <div className="text-[13.5px] font-semibold">{it.label}</div>
                  {it.notes && <div className="text-[12px] text-slate-500">{it.notes}</div>}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[13px] text-slate-500">$</span>
                  <input type="number" min="0" step="0.01" value={amounts[it.id] ?? ""}
                    onChange={(e) => setAmounts({ ...amounts, [it.id]: e.target.value })}
                    className="w-32 rounded border border-slate-300 px-2 py-1 text-[13px] font-mono text-right" />
                </div>
              </div>
            ))}
            <div className="flex items-center gap-3 px-3 py-2 bg-slate-50">
              <div className="flex-1 text-[14px] font-bold">Total</div>
              <div className="font-mono text-[14px] font-bold">{fmtCents(Math.round(total * 100))}</div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block">
            <div className="text-[11.5px] font-semibold text-slate-500 mb-1">LEAD TIME (DAYS)</div>
            <input type="number" min="0" value={leadTime} onChange={(e) => setLeadTime(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-[13px]" />
          </label>
          <label className="block">
            <div className="text-[11.5px] font-semibold text-slate-500 mb-1">PAYMENT TERMS</div>
            <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="e.g. Net 30, 50% deposit"
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-[13px]" />
          </label>
        </div>
        <label className="block mb-3">
          <div className="text-[11.5px] font-semibold text-slate-500 mb-1">WARRANTY</div>
          <input value={warranty} onChange={(e) => setWarranty(e.target.value)}
            placeholder="e.g. 1 year labor, manufacturer warranty on materials"
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-[13px]" />
        </label>
        <label className="block mb-3">
          <div className="text-[11.5px] font-semibold text-slate-500 mb-1">NOTES</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-[13px]" />
        </label>
        <section className="mb-4">
          <h2 className="text-[14px] font-bold mb-2">Attach supporting documents</h2>
          <div className="grid grid-cols-1 gap-2">
            <DocPicker label="Quote PDF" kind="quotePdf" current={quotePdfKey} uploading={uploading} onUpload={uploadDoc} />
            <DocPicker label="Contractor license" kind="license" current={licenseKey} uploading={uploading} onUpload={uploadDoc} />
            <DocPicker label="Certificate of Insurance (COI)" kind="coi" current={coiKey} uploading={uploading} onUpload={uploadDoc} />
          </div>
          <p className="text-[11.5px] text-slate-500 mt-1">Optional but recommended — required for award in most cases.</p>
        </section>

        <label className="flex items-start gap-2 mb-4 text-[13px]">
          <input type="checkbox" checked={firm} onChange={(e) => setFirm(e.target.checked)} className="mt-1" />
          <span>I confirm this is a <strong>firm quote</strong> good through the bid deadline. By submitting I agree the prices above are binding if my company is selected.</span>
        </label>

        <div className="flex justify-between gap-2">
          <button onClick={async () => {
            if (!confirm("Decline to bid on this project?")) return;
            await quotePublicApi.decline(token);
            setDeclined(true);
          }} className="rounded border border-slate-300 px-4 py-2 text-[13px] text-slate-700 hover:bg-slate-50">
            Decline
          </button>
          <button disabled={!firm || !allFilled || submitting} onClick={async () => {
            setSubmitting(true);
            try {
              const lines = view.scopeItems.map((it) => ({
                scopeItemId: it.id,
                amountCents: Math.round((parseFloat(amounts[it.id] ?? "0") || 0) * 100),
              }));
              await quotePublicApi.submit(token, {
                leadTimeDays: leadTime ? Number(leadTime) : undefined,
                paymentTerms: paymentTerms || undefined,
                warrantyText: warranty || undefined,
                notes: notes || undefined,
                firmConfirmation: firm,
                quotePdfStorageKey: quotePdfKey ?? undefined,
                licenseStorageKey: licenseKey ?? undefined,
                coiStorageKey: coiKey ?? undefined,
                lines,
              });
              setSubmitted(true);
            } catch (e) { alert((e as Error).message); }
            setSubmitting(false);
          }} className="rounded px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: "#3245FF", color: "#fff" }}>
            <Send className="inline h-3.5 w-3.5 mr-1" /> {submitting ? "Submitting…" : "Submit quote"}
          </button>
        </div>
      </Frame>
    </Center>
  );
}

function DocPicker({
  label, kind, current, uploading, onUpload,
}: {
  label: string;
  kind: "quotePdf" | "license" | "coi";
  current: string | null;
  uploading: string | null;
  onUpload: (kind: "quotePdf" | "license" | "coi", file: File) => Promise<void>;
}) {
  const isUploading = uploading === kind;
  return (
    <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50">
      {current
        ? <Check className="h-4 w-4 text-green-600" />
        : <Upload className="h-4 w-4 text-slate-400" />}
      <span className="flex-1 text-[13px]">{label}</span>
      <span className="text-[12px] text-slate-500">
        {isUploading ? "Uploading…" : current ? "Replace" : "Choose file"}
      </span>
      <input type="file" className="hidden" disabled={isUploading}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(kind, f); }} />
    </label>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#F6F7FB", fontFamily: "system-ui, sans-serif" }}>{children}</div>;
}
function Frame({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-xl shadow-sm border border-slate-200 max-w-2xl w-full p-6">{children}</div>;
}
