import { useState } from "react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useListDocuments } from "@workspace/api-client-react";
import { FileText, Download, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const categoryColors: Record<string, { bg: string; fg: string }> = {
  Bylaws:     { bg: "#E5E8FF", fg: "#3245FF" },
  Insurance:  { bg: "#DCF3EC", fg: "#0E8A6B" },
  Inspection: { bg: "#FBEFD6", fg: "#A66C0E" },
  Financial:  { bg: "#FBE3E9", fg: "#B8264C" },
  Vendor:     { bg: "#F3EEFF", fg: "#7B3FE4" },
  Meeting:    { bg: "#EFF1F8", fg: "#5A6285" },
};

function DownloadButton({ docId, name }: { docId: string; name: string }) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/documents/${docId}/download`, { credentials: "include" });
      if (!res.ok) return;
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/pdf")) {
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      } else {
        const data = await res.json() as { url: string };
        if (data?.url) {
          const url = data.url.startsWith("/api/") ? `${BASE}${data.url}` : data.url;
          const a = document.createElement("a");
          a.href = url;
          a.download = name;
          a.target = "_blank";
          a.click();
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] hover:bg-slate-50 disabled:opacity-60 transition-colors"
      style={{ borderColor: c.border, color: c.inkSoft, fontWeight: 500 }}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      Download
    </button>
  );
}

export default function ResidentDocuments() {
  const { data: documents = [], isLoading } = useListDocuments();

  const byCategory = documents.reduce<Record<string, typeof documents>>((acc, doc) => {
    const cat = doc.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(doc);
    return acc;
  }, {});

  return (
    <Layout title="Documents" subtitle="Community documents for your building">
      <div className="max-w-4xl space-y-5">
        {isLoading ? (
          <div className="flex items-center gap-2 text-[13px]" style={{ color: c.inkMute }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
          </div>
        ) : documents.length === 0 ? (
          <div className="rounded-xl border p-10 text-center" style={{ borderColor: c.border }}>
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-20" style={{ color: c.ink }} />
            <div className="text-[14px]" style={{ fontWeight: 600, color: c.ink }}>No documents yet</div>
            <div className="text-[13px] mt-1" style={{ color: c.inkMute }}>Your building documents will appear here once uploaded by management.</div>
          </div>
        ) : (
          Object.entries(byCategory).map(([cat, docs]) => {
            const cc = categoryColors[cat] ?? { bg: "#EFF1F8", fg: "#5A6285" };
            return (
              <section key={cat} className="rounded-xl border p-5" style={{ background: "#fff", borderColor: c.border }}>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: cc.bg, color: cc.fg, fontWeight: 700 }}>
                    {cat}
                  </span>
                  <span className="text-[12px]" style={{ color: c.inkMute }}>{docs.length} document{docs.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="space-y-2">
                  {docs.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-3 rounded-lg border p-3" style={{ borderColor: c.borderSoft }}>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: cc.bg }}>
                        <FileText className="h-4.5 w-4.5" style={{ color: cc.fg }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] truncate" style={{ fontWeight: 600, color: c.ink }}>{doc.name}</div>
                        <div className="text-[12px]" style={{ color: c.inkMute }}>
                          {doc.size} · Uploaded {doc.uploaded}
                        </div>
                      </div>
                      <DownloadButton docId={doc.id} name={doc.name} />
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </Layout>
  );
}
