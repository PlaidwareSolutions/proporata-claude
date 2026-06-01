// Task #79: Owner-facing Resolutions library.
// Read-only view of adopted-active resolutions with search + category filter
// and PDF download. Drafts, superseded, and rescinded items are hidden by the
// API for non-privileged readers.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Scroll, Search, FileDown, ChevronRight, X } from "lucide-react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import {
  resolutionsApi,
  RESOLUTION_CATEGORIES,
  RESOLUTION_CATEGORY_LABELS,
  type ResolutionListItem,
  type ResolutionDetail,
  type ResolutionCategory,
} from "@/lib/resolutionsApi";

const LIST_KEY = ["resident-resolutions-list"] as const;

export default function ResidentResolutions() {
  const [category, setCategory] = useState<"all" | ResolutionCategory>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: [...LIST_KEY, category, search],
    queryFn: () => resolutionsApi.list({ status: "active", category, search }),
  });

  return (
    <Layout
      title="Resolutions"
      subtitle="Adopted decisions of the Board that govern our community"
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as "all" | ResolutionCategory)}
          className="rounded-md border px-2.5 py-1.5 text-[12.5px] bg-white"
          style={{ borderColor: c.border }}
          data-testid="select-resident-resolutions-category"
        >
          <option value="all">All categories</option>
          {RESOLUTION_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{RESOLUTION_CATEGORY_LABELS[cat]}</option>
          ))}
        </select>
        <div
          className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
          style={{ borderColor: c.border, background: "#fff" }}
        >
          <Search className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or number"
            className="text-[12.5px] outline-none w-56"
            data-testid="input-resident-resolutions-search"
          />
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: c.border }}>
        <div
          className="grid grid-cols-[110px_1fr_160px_140px_24px] items-center gap-3 px-4 py-2.5 border-b text-[11px] uppercase tracking-wider"
          style={{ borderColor: c.border, color: c.inkMute, fontWeight: 700 }}
        >
          <div>Number</div><div>Title</div><div>Category</div><div>Adopted</div><div></div>
        </div>
        {isLoading ? (
          <div className="p-8 text-center" style={{ color: c.inkMute }}>Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center" style={{ color: c.inkMute }}>
            <Scroll className="inline h-5 w-5 mr-2" /> No adopted resolutions match these filters.
          </div>
        ) : items.map((r) => (
          <Row key={r.id} r={r} onOpen={() => setOpenId(r.id)} />
        ))}
      </div>

      <div className="text-[11.5px] mt-3" style={{ color: c.inkMute }}>
        Showing currently in-effect resolutions only. Items that have been superseded or rescinded are not listed.
      </div>

      {openId !== null && (
        <DetailModal id={openId} onClose={() => setOpenId(null)} />
      )}
    </Layout>
  );
}

function Row({ r, onOpen }: { r: ResolutionListItem; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full grid grid-cols-[110px_1fr_160px_140px_24px] items-center gap-3 px-4 py-3 border-b hover:bg-slate-50 cursor-pointer text-left"
      style={{ borderColor: c.borderSoft }}
      data-testid={`resident-resolution-row-${r.id}`}
    >
      <div className="font-mono-num text-[12.5px]" style={{ fontWeight: 700, color: c.cobalt }}>
        {r.number ?? "—"}
      </div>
      <div className="min-w-0">
        <div className="text-[14px] truncate" style={{ fontWeight: 600 }}>{r.title}</div>
        <div className="text-[11.5px]" style={{ color: c.inkMute }}>
          Proposed by {r.createdByName}
        </div>
      </div>
      <div className="text-[12.5px]" style={{ color: c.ink }}>
        {RESOLUTION_CATEGORY_LABELS[r.category as ResolutionCategory] ?? r.category}
      </div>
      <div className="text-[12.5px] font-mono-num" style={{ color: c.ink }}>
        {r.adoptedAt ? r.adoptedAt.slice(0, 10) : "—"}
      </div>
      <ChevronRight className="h-4 w-4" style={{ color: c.inkMute }} />
    </button>
  );
}

function DetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: r, isLoading } = useQuery<ResolutionDetail>({
    queryKey: ["resident-resolution", id],
    queryFn: () => resolutionsApi.get(id),
  });

  return (
    <Modal
      title={r ? `Resolution ${r.number ?? `#${r.id}`}` : "Loading…"}
      onClose={onClose}
    >
      {isLoading || !r ? (
        <div className="p-6 text-center" style={{ color: c.inkMute }}>Loading…</div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-[16px]" style={{ fontWeight: 700 }}>{r.title}</div>
            <div className="text-[12px]" style={{ color: c.inkMute }}>
              {RESOLUTION_CATEGORY_LABELS[r.category as ResolutionCategory] ?? r.category}
              {r.adoptedAt ? ` · Adopted ${r.adoptedAt.slice(0, 10)}` : ""}
              {` · Proposed by ${r.createdByName}`}
            </div>
          </div>
          {r.body && (
            <div
              className="rounded-md border p-3 text-[13px] whitespace-pre-wrap"
              style={{ borderColor: c.borderSoft, background: "#FAFAFB" }}
            >
              {r.body}
            </div>
          )}
          {r.pdfStorageKey && (
            <div>
              <a
                href={resolutionsApi.pdfUrl(r.id)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12.5px] border"
                style={{ borderColor: c.border, color: c.ink, fontWeight: 600 }}
                data-testid="link-resident-resolution-pdf"
              >
                <FileDown className="h-3.5 w-3.5" /> Download adopted PDF
              </a>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl">
        <div
          className="sticky top-0 flex items-center justify-between border-b px-4 py-3 bg-white"
          style={{ borderColor: c.border }}
        >
          <div className="text-[14px]" style={{ fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
