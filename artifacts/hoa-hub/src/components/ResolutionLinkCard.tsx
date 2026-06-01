// Task #80: Inline section that shows the linked board resolution on a record
// (work order, bid request, or ARC request) and lets a manager link/change/clear
// it via the ResolutionPicker. The link remains valid even when the resolution
// is later superseded or rescinded — we render a warning chip but keep the link
// clickable so the historical authority is preserved.
import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Gavel, Pencil, X } from "lucide-react";
import { c } from "@/lib/theme";
import { ResolutionPicker } from "@/components/ResolutionPicker";

export type ResolutionStatus = "adopted" | "superseded" | "rescinded" | null;

export function ResolutionLinkCard(props: {
  resolutionId: number | null;
  resolutionNumber: string | null;
  resolutionTitle: string | null;
  resolutionStatus: ResolutionStatus;
  canEdit: boolean;
  onSave: (resolutionId: number | null) => Promise<void>;
}) {
  const { resolutionId, resolutionNumber, resolutionTitle, resolutionStatus, canEdit, onSave } = props;
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<number | null>(resolutionId);
  const [busy, setBusy] = useState(false);

  const warn = resolutionStatus === "superseded" || resolutionStatus === "rescinded";

  async function save() {
    setBusy(true);
    try {
      await onSave(pending);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-xl border bg-white p-5"
      style={{ borderColor: c.border }}
      data-testid="resolution-link-card"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[14px] flex items-center gap-2" style={{ fontWeight: 700 }}>
          <Gavel className="h-4 w-4" style={{ color: c.cobalt }} />
          Authorizing Resolution
        </h3>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => { setPending(resolutionId); setEditing(true); }}
            className="inline-flex items-center gap-1 text-[12px]"
            style={{ color: c.cobalt, fontWeight: 600 }}
            data-testid="button-edit-resolution"
          >
            <Pencil className="h-3 w-3" /> {resolutionId ? "Change" : "Link"}
          </button>
        )}
      </div>

      {!editing && (
        resolutionId ? (
          <div className="flex items-start gap-2 text-[13px]">
            <Link href={`/resolutions`}>
              <a
                className="font-mono-num hover:underline"
                style={{ color: c.cobalt, fontWeight: 700 }}
                data-testid="link-resolution"
              >
                {resolutionNumber ?? `#${resolutionId}`}
              </a>
            </Link>
            <span style={{ color: c.ink }}>{resolutionTitle ?? "(untitled)"}</span>
            {warn && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ml-1"
                style={{ background: "#FEF3E2", color: "#7A4A0E", fontWeight: 700 }}
                title="The link is preserved but the authorizing resolution has been superseded or rescinded."
              >
                <AlertTriangle className="h-3 w-3" />
                {resolutionStatus === "rescinded" ? "Rescinded" : "Superseded"}
              </span>
            )}
          </div>
        ) : (
          <div className="text-[12.5px]" style={{ color: c.inkMute }}>
            No board resolution linked.
          </div>
        )
      )}

      {editing && (
        <div className="space-y-3">
          <ResolutionPicker
            value={pending}
            onChange={(id) => setPending(id)}
            placeholder="Search adopted resolutions…"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] disabled:opacity-60"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              data-testid="button-save-resolution"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setPending(resolutionId); }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px]"
              style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 600 }}
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
