import { useEffect, useMemo, useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import {
  BookOpen, Search, Plus, Edit3, Save, Trash2, History, MessageSquare,
  CheckCircle2, XCircle, Clock, ExternalLink, ChevronRight,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import {
  useListGlossaryTerms,
  useGetGlossaryCoverage,
  useListGlossarySuggestions,
  useListGlossaryHistory,
  useCreateGlossaryTerm,
  useUpdateGlossaryTerm,
  useDeleteGlossaryTerm,
  useSuggestGlossaryEdit,
  useAcceptGlossarySuggestion,
  useRejectGlossarySuggestion,
  getListGlossaryTermsQueryKey,
  getGetGlossaryCoverageQueryKey,
  getListGlossarySuggestionsQueryKey,
  getListGlossaryHistoryQueryKey,
  getGetGlossaryTermQueryKey,
  type GlossaryTerm,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { c } from "@/lib/theme";

const CATEGORIES = ["governance", "maintenance", "property", "compliance", "financials", "community"] as const;
type Cat = (typeof CATEGORIES)[number];

const CAT_LABELS: Record<Cat, string> = {
  governance: "Governance",
  maintenance: "Maintenance",
  property: "Property",
  compliance: "Compliance",
  financials: "Financials",
  community: "Community",
};

export default function HelpGlossary() {
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";
  const [, params] = useRoute("/help/glossary/:key");
  const focusedKey = params?.key ?? null;

  const initialTab = (() => {
    if (focusedKey) return "browse";
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get("tab");
      if (t === "suggestions" && isManager) return "suggestions";
      if (t === "coverage" && isManager) return "coverage";
      if (t === "browse") return "browse";
    }
    return "browse";
  })();

  const [q, setQ] = useState("");
  const [category, setCategory] = useState<Cat | "all">("all");
  const [showUnpublished, setShowUnpublished] = useState(false);
  const [tab, setTab] = useState(initialTab);

  const [routerLocation] = useLocation();
  useEffect(() => {
    if (focusedKey) return;
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("tab");
    if (t === "suggestions" && isManager) setTab("suggestions");
    else if (t === "coverage" && isManager) setTab("coverage");
    else if (t === "browse") setTab("browse");
  }, [routerLocation, isManager, focusedKey]);

  const { data: terms = [] } = useListGlossaryTerms({
    q: q || undefined,
    category: category === "all" ? undefined : category,
    includeUnpublished: isManager && showUnpublished ? true : undefined,
  });

  // Auto-scroll to focused term when deep-linked
  useEffect(() => {
    if (focusedKey) {
      setTimeout(() => {
        const el = document.getElementById(`term-${focusedKey}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
    }
  }, [focusedKey, terms.length]);

  return (
    <Layout title="Help & Glossary" subtitle="Plain-language definitions for everything in the hub">
      <div className="max-w-[1100px]" data-testid="help-glossary-page">
        <div className="flex items-center gap-2 text-[12px] mb-2" style={{ color: c.inkMute }}>
          <BookOpen className="h-3.5 w-3.5" /> Help &amp; Glossary
        </div>
        <h1 className="text-[26px]" style={{ color: c.ink, fontWeight: 800, letterSpacing: "-0.01em" }}>
          Help &amp; Glossary
        </h1>
        <p className="mt-1 text-[13.5px]" style={{ color: c.inkMute }}>
          Plain-language definitions for everything in the HOA Operations Hub.
          {focusedKey ? ` Showing: ${focusedKey}` : ""}
        </p>

        <Tabs value={tab} onValueChange={setTab} className="mt-5">
          <TabsList>
            <TabsTrigger value="browse" data-testid="tab-browse">Browse</TabsTrigger>
            {isManager && <TabsTrigger value="suggestions" data-testid="tab-suggestions">Suggestions</TabsTrigger>}
            {isManager && <TabsTrigger value="coverage" data-testid="tab-coverage">Coverage</TabsTrigger>}
          </TabsList>

          <TabsContent value="browse" className="mt-4">
            <BrowseTab
              terms={terms}
              q={q}
              setQ={setQ}
              category={category}
              setCategory={setCategory}
              isManager={isManager}
              showUnpublished={showUnpublished}
              setShowUnpublished={setShowUnpublished}
              focusedKey={focusedKey}
            />
          </TabsContent>
          {isManager && (
            <TabsContent value="suggestions" className="mt-4">
              <SuggestionsTab />
            </TabsContent>
          )}
          {isManager && (
            <TabsContent value="coverage" className="mt-4">
              <CoverageTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </Layout>
  );
}

function BrowseTab({
  terms, q, setQ, category, setCategory, isManager, showUnpublished, setShowUnpublished, focusedKey,
}: {
  terms: GlossaryTerm[];
  q: string; setQ: (v: string) => void;
  category: Cat | "all"; setCategory: (v: Cat | "all") => void;
  isManager: boolean;
  showUnpublished: boolean; setShowUnpublished: (v: boolean) => void;
  focusedKey: string | null;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof terms>();
    for (const t of terms) {
      if (!m.has(t.category)) m.set(t.category, []);
      m.get(t.category)!.push(t);
    }
    return m;
  }, [terms]);

  return (
    <div className="space-y-4">
      <Card className="p-4" style={{ borderColor: c.border }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: c.inkMute }} />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search definitions…"
              className="pl-8 h-9 text-[13px]"
              data-testid="glossary-search"
            />
          </div>
          <Select value={category} onValueChange={(v) => setCategory(v as Cat | "all")}>
            <SelectTrigger className="w-[180px] h-9 text-[13px]" data-testid="glossary-category">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>{CAT_LABELS[cat]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isManager && (
            <>
              <label className="flex items-center gap-2 text-[12.5px]" style={{ color: c.inkMute }}>
                <input
                  type="checkbox"
                  checked={showUnpublished}
                  onChange={(e) => setShowUnpublished(e.target.checked)}
                  data-testid="glossary-show-unpublished"
                />
                Show unpublished
              </label>
              <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="glossary-create-btn">
                <Plus className="h-3.5 w-3.5 mr-1" /> New term
              </Button>
            </>
          )}
        </div>
      </Card>

      {terms.length === 0 ? (
        <Card className="p-8 text-center" style={{ borderColor: c.border }}>
          <BookOpen className="mx-auto h-6 w-6 mb-2" style={{ color: c.inkMute, opacity: 0.5 }} />
          <p className="text-[13px]" style={{ color: c.inkMute }}>No glossary terms match.</p>
        </Card>
      ) : (
        <div className="space-y-5">
          {Array.from(grouped.entries()).map(([cat, list]) => (
            <div key={cat}>
              <h2 className="text-[11px] uppercase tracking-wider mb-2" style={{ color: c.inkMute, fontWeight: 700 }}>
                {CAT_LABELS[cat as Cat] ?? cat}
              </h2>
              <div className="space-y-2">
                {list.map((t) => (
                  <TermRow
                    key={t.termKey}
                    term={t}
                    isManager={isManager}
                    initiallyExpanded={focusedKey === t.termKey}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {isManager && <CreateTermDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </div>
  );
}

function TermRow({
  term, isManager, initiallyExpanded,
}: {
  term: GlossaryTerm;
  isManager: boolean;
  initiallyExpanded: boolean;
}) {
  const [open, setOpen] = useState(initiallyExpanded);
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  return (
    <Card
      id={`term-${term.termKey}`}
      className="overflow-hidden"
      style={{ borderColor: c.border, ...(initiallyExpanded ? { boxShadow: `0 0 0 2px ${c.cobaltSoft}` } : {}) }}
      data-testid={`glossary-term-${term.termKey}`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronRight
            className="h-3.5 w-3.5 transition-transform shrink-0"
            style={{ color: c.inkMute, transform: open ? "rotate(90deg)" : undefined }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px]" style={{ fontWeight: 700, color: c.ink }}>{term.title}</span>
              {!term.published && <Badge variant="outline" className="text-[10px]">Unpublished</Badge>}
            </div>
            <p className="text-[12.5px] truncate" style={{ color: c.inkSoft }}>{term.shortDef}</p>
          </div>
        </div>
        <a
          href={`/help/glossary/${term.termKey}`}
          onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(window.location.origin + `/help/glossary/${term.termKey}`); }}
          title="Copy direct link"
          className="ml-3 shrink-0 hidden sm:inline-flex items-center gap-1 text-[11px] hover:underline"
          style={{ color: c.inkMute }}
        >
          <ExternalLink className="h-3 w-3" /> {term.termKey}
        </a>
      </button>

      {open && (
        <div className="border-t px-4 py-4" style={{ borderColor: c.border, background: c.canvas }}>
          {term.longDef && (
            <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: c.inkSoft }}>
              {term.longDef}
            </p>
          )}
          {term.routes.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider" style={{ color: c.inkMute, fontWeight: 700 }}>
                Used on
              </span>
              {term.routes.map((r) => (
                <Link
                  key={r}
                  href={r}
                  className="text-[11.5px] rounded px-1.5 py-0.5 hover:underline"
                  style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}
                >
                  {r}
                </Link>
              ))}
            </div>
          )}
          {term.seeAlsoRoute && (
            <div className="mt-2">
              <Link href={term.seeAlsoRoute} className="text-[12.5px] hover:underline" style={{ color: c.cobalt, fontWeight: 600 }}>
                Go to related page →
              </Link>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSuggestOpen(true)} data-testid={`glossary-suggest-${term.termKey}`}>
              <MessageSquare className="h-3 w-3 mr-1" /> Suggest an edit
            </Button>
            {isManager && (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} data-testid={`glossary-edit-${term.termKey}`}>
                  <Edit3 className="h-3 w-3 mr-1" /> Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)} data-testid={`glossary-history-${term.termKey}`}>
                  <History className="h-3 w-3 mr-1" /> History
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <SuggestDialog open={suggestOpen} onOpenChange={setSuggestOpen} term={term} />
      {isManager && <EditTermDialog open={editOpen} onOpenChange={setEditOpen} term={term} />}
      {isManager && <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} termKey={term.termKey} title={term.title} />}
    </Card>
  );
}

function CreateTermDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const create = useCreateGlossaryTerm({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListGlossaryTermsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetGlossaryCoverageQueryKey() });
        onOpenChange(false);
      },
    },
  });
  const [form, setForm] = useState({
    termKey: "", title: "", category: "governance" as Cat, shortDef: "", longDef: "",
    routes: "", seeAlsoRoute: "", published: true,
  });

  function submit() {
    create.mutate({
      data: {
        termKey: form.termKey,
        title: form.title,
        category: form.category,
        shortDef: form.shortDef,
        longDef: form.longDef,
        routes: form.routes.split(",").map((r) => r.trim()).filter(Boolean),
        seeAlsoRoute: form.seeAlsoRoute || null,
        published: form.published,
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New glossary term</DialogTitle>
          <DialogDescription>Add a definition that residents and managers can look up.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Term key (URL slug)</Label>
              <Input value={form.termKey} onChange={(e) => setForm({ ...form, termKey: e.target.value })} placeholder="e.g. work-order" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as Cat })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => <SelectItem key={cat} value={cat}>{CAT_LABELS[cat]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Work order" />
          </div>
          <div>
            <Label>Short definition</Label>
            <Textarea rows={2} value={form.shortDef} onChange={(e) => setForm({ ...form, shortDef: e.target.value })} />
          </div>
          <div>
            <Label>Long definition (optional)</Label>
            <Textarea rows={4} value={form.longDef} onChange={(e) => setForm({ ...form, longDef: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Routes (comma-sep)</Label>
              <Input value={form.routes} onChange={(e) => setForm({ ...form, routes: e.target.value })} placeholder="/work-orders, /vendors" />
            </div>
            <div>
              <Label>See-also route</Label>
              <Input value={form.seeAlsoRoute} onChange={(e) => setForm({ ...form, seeAlsoRoute: e.target.value })} placeholder="/work-orders" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: c.inkSoft }}>
            <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
            Publish immediately
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending || !form.termKey || !form.title || !form.shortDef}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTermDialog({ open, onOpenChange, term }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  term: GlossaryTerm;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: term.title,
    category: term.category as Cat,
    shortDef: term.shortDef,
    longDef: term.longDef,
    routes: term.routes.join(", "),
    seeAlsoRoute: term.seeAlsoRoute ?? "",
    published: term.published,
  });
  useEffect(() => {
    if (open) setForm({
      title: term.title, category: term.category as Cat, shortDef: term.shortDef,
      longDef: term.longDef, routes: term.routes.join(", "),
      seeAlsoRoute: term.seeAlsoRoute ?? "", published: term.published,
    });
  }, [open, term]);

  const update = useUpdateGlossaryTerm({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListGlossaryTermsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetGlossaryTermQueryKey(term.termKey) });
        qc.invalidateQueries({ queryKey: getGetGlossaryCoverageQueryKey() });
        onOpenChange(false);
      },
    },
  });
  const del = useDeleteGlossaryTerm({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListGlossaryTermsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetGlossaryCoverageQueryKey() });
        onOpenChange(false);
      },
    },
  });

  function submit() {
    update.mutate({
      key: term.termKey,
      data: {
        title: form.title,
        category: form.category,
        shortDef: form.shortDef,
        longDef: form.longDef,
        routes: form.routes.split(",").map((r) => r.trim()).filter(Boolean),
        seeAlsoRoute: form.seeAlsoRoute || null,
        published: form.published,
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit “{term.title}”</DialogTitle>
          <DialogDescription>Changes are recorded in audit history.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as Cat })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => <SelectItem key={cat} value={cat}>{CAT_LABELS[cat]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Short definition</Label>
            <Textarea rows={2} value={form.shortDef} onChange={(e) => setForm({ ...form, shortDef: e.target.value })} />
          </div>
          <div>
            <Label>Long definition</Label>
            <Textarea rows={5} value={form.longDef} onChange={(e) => setForm({ ...form, longDef: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Routes (comma-sep)</Label>
              <Input value={form.routes} onChange={(e) => setForm({ ...form, routes: e.target.value })} />
            </div>
            <div>
              <Label>See-also route</Label>
              <Input value={form.seeAlsoRoute} onChange={(e) => setForm({ ...form, seeAlsoRoute: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: c.inkSoft }}>
            <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
            Published
          </label>
        </div>
        <DialogFooter className="justify-between">
          <Button
            variant="outline"
            onClick={() => { if (confirm(`Delete glossary term "${term.title}"? This cannot be undone.`)) del.mutate({ key: term.termKey }); }}
            disabled={del.isPending}
            style={{ color: c.rose }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={update.isPending}>
              <Save className="h-3.5 w-3.5 mr-1" /> Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ open, onOpenChange, termKey, title }: { open: boolean; onOpenChange: (o: boolean) => void; termKey: string; title: string }) {
  const { data: rows = [] } = useListGlossaryHistory(termKey, { query: { enabled: open, queryKey: getListGlossaryHistoryQueryKey(termKey) } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>History — {title}</DialogTitle>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-[13px]" style={{ color: c.inkMute }}>No history yet.</p>
        ) : (
          <ul className="space-y-2 max-h-[400px] overflow-y-auto">
            {rows.map((r) => (
              <li key={r.id} className="rounded border p-3" style={{ borderColor: c.border }}>
                <div className="flex items-center justify-between text-[12px]">
                  <span style={{ fontWeight: 700, color: c.ink }}>
                    {r.action.replace(/_/g, " ")}
                  </span>
                  <span style={{ color: c.inkMute }}>
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-[12px] mt-1" style={{ color: c.inkMute }}>by {r.actorName}</p>
                {r.diff ? (
                  <pre className="mt-1.5 text-[11px] rounded p-2 overflow-x-auto" style={{ background: c.canvas, color: c.inkSoft }}>
                    {JSON.stringify(r.diff, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SuggestDialog({ open, onOpenChange, term }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  term: GlossaryTerm;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ proposedTitle: "", proposedShortDef: "", proposedLongDef: "", reason: "" });
  useEffect(() => {
    if (open) setForm({ proposedTitle: term.title, proposedShortDef: term.shortDef, proposedLongDef: term.longDef, reason: "" });
  }, [open, term]);
  const m = useSuggestGlossaryEdit({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListGlossarySuggestionsQueryKey() });
        onOpenChange(false);
      },
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Suggest an edit — {term.title}</DialogTitle>
          <DialogDescription>A manager will review your suggestion.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Proposed title</Label>
            <Input value={form.proposedTitle} onChange={(e) => setForm({ ...form, proposedTitle: e.target.value })} />
          </div>
          <div>
            <Label>Proposed short definition</Label>
            <Textarea rows={2} value={form.proposedShortDef} onChange={(e) => setForm({ ...form, proposedShortDef: e.target.value })} />
          </div>
          <div>
            <Label>Proposed long definition</Label>
            <Textarea rows={4} value={form.proposedLongDef} onChange={(e) => setForm({ ...form, proposedLongDef: e.target.value })} />
          </div>
          <div>
            <Label>Why does this need to change?</Label>
            <Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="What's unclear or wrong?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => m.mutate({ key: term.termKey, data: form })} disabled={m.isPending}>
            Submit suggestion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuggestionsTab() {
  const [filter, setFilter] = useState<"pending" | "accepted" | "rejected" | "all">("pending");
  const { data: list = [] } = useListGlossarySuggestions({
    status: filter === "all" ? undefined : filter,
  });
  const qc = useQueryClient();
  const accept = useAcceptGlossarySuggestion({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListGlossarySuggestionsQueryKey() });
        qc.invalidateQueries({ queryKey: getListGlossaryTermsQueryKey() });
      },
    },
  });
  const reject = useRejectGlossarySuggestion({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListGlossarySuggestionsQueryKey() }) },
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        {(["pending", "accepted", "rejected", "all"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
            data-testid={`suggestion-filter-${f}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>
      {list.length === 0 ? (
        <Card className="p-8 text-center" style={{ borderColor: c.border }}>
          <p className="text-[13px]" style={{ color: c.inkMute }}>No suggestions in this view.</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {list.map((s) => (
            <Card key={s.id} className="p-4" style={{ borderColor: c.border }} data-testid={`suggestion-${s.id}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[14px]" style={{ fontWeight: 700, color: c.ink }}>{s.termTitle}</span>
                  <Badge variant="outline" className="text-[10px]">{s.termKey}</Badge>
                  <StatusBadge status={s.status} />
                </div>
                <span className="text-[11.5px]" style={{ color: c.inkMute }}>
                  {new Date(s.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-[12px]" style={{ color: c.inkMute }}>From {s.submittedByName}</p>
              {s.reason && (
                <p className="mt-2 text-[12.5px]" style={{ color: c.inkSoft }}>
                  <em>“{s.reason}”</em>
                </p>
              )}
              {s.proposedTitle && (
                <p className="mt-2 text-[12.5px]" style={{ color: c.inkSoft }}>
                  <strong>Proposed title:</strong> {s.proposedTitle}
                </p>
              )}
              {s.proposedShortDef && (
                <p className="mt-1 text-[12.5px]" style={{ color: c.inkSoft }}>
                  <strong>Short:</strong> {s.proposedShortDef}
                </p>
              )}
              {s.proposedLongDef && (
                <p className="mt-1 text-[12.5px] whitespace-pre-line" style={{ color: c.inkSoft }}>
                  <strong>Long:</strong> {s.proposedLongDef}
                </p>
              )}
              {s.status === "pending" && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => accept.mutate({ id: s.id, data: { reviewNote: "" } })} data-testid={`suggestion-accept-${s.id}`}>
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Accept &amp; apply
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => reject.mutate({ id: s.id, data: { reviewNote: "" } })} data-testid={`suggestion-reject-${s.id}`}>
                    <XCircle className="h-3 w-3 mr-1" /> Reject
                  </Button>
                </div>
              )}
              {s.status !== "pending" && s.reviewedByName && (
                <p className="mt-2 text-[11.5px]" style={{ color: c.inkMute }}>
                  Reviewed by {s.reviewedByName}{s.reviewedAt ? ` on ${new Date(s.reviewedAt).toLocaleString()}` : ""}
                </p>
              )}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { bg, fg, Icon } = (() => {
    if (status === "accepted") return { bg: c.emeraldSoft, fg: c.emerald, Icon: CheckCircle2 };
    if (status === "rejected") return { bg: c.roseSoft, fg: c.rose, Icon: XCircle };
    return { bg: c.amberSoft, fg: c.amber, Icon: Clock };
  })();
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-wider rounded px-1.5 py-0.5" style={{ background: bg, color: fg, fontWeight: 700 }}>
      <Icon className="h-3 w-3" /> {status}
    </span>
  );
}

function CoverageTab() {
  const { data } = useGetGlossaryCoverage();
  if (!data) return <Card className="p-6" style={{ borderColor: c.border }}><p className="text-[13px]" style={{ color: c.inkMute }}>Loading…</p></Card>;
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <Card className="p-4" style={{ borderColor: c.border }}>
        <h3 className="text-[13px] mb-2" style={{ fontWeight: 700, color: c.ink }}>Pages without any glossary terms</h3>
        <p className="text-[12px] mb-2" style={{ color: c.inkMute }}>
          Consider mapping at least one term to each of these so the help panel has something to show.
        </p>
        {data.pagesWithoutTerms.length === 0 ? (
          <p className="text-[12.5px]" style={{ color: c.emerald, fontWeight: 600 }}>All pages have at least one term.</p>
        ) : (
          <ul className="space-y-1">
            {data.pagesWithoutTerms.map((r) => (
              <li key={r}>
                <Link href={r} className="text-[12.5px] hover:underline font-mono" style={{ color: c.cobalt }}>{r}</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-4" style={{ borderColor: c.border }}>
        <h3 className="text-[13px] mb-2" style={{ fontWeight: 700, color: c.ink }}>Terms not mapped to any page</h3>
        <p className="text-[12px] mb-2" style={{ color: c.inkMute }}>
          Edit each term to add the routes where it appears.
        </p>
        {data.termsWithoutPages.length === 0 ? (
          <p className="text-[12.5px]" style={{ color: c.emerald, fontWeight: 600 }}>All terms are mapped.</p>
        ) : (
          <ul className="space-y-1">
            {data.termsWithoutPages.map((t) => (
              <li key={t.termKey}>
                <Link href={`/help/glossary/${t.termKey}`} className="text-[12.5px] hover:underline" style={{ color: c.cobalt }}>
                  {t.title}
                </Link>
                <span className="ml-1.5 text-[11px]" style={{ color: c.inkMute }}>({t.termKey})</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
