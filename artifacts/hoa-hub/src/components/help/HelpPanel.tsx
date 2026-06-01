import { useState } from "react";
import { Link, useLocation } from "wouter";
import { HelpCircle, BookOpen, Compass, ExternalLink, Search } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  useListGlossaryTerms,
  useUpdateMyOnboarding,
  getGetMyOnboardingQueryKey,
  getListGlossaryTermsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { c } from "@/lib/theme";

interface HelpPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HelpPanel({ open, onOpenChange }: HelpPanelProps) {
  const [location] = useLocation();
  const [q, setQ] = useState("");
  const qc = useQueryClient();

  // Match the most-specific known route prefix for this page
  const routeForPage = (() => {
    if (location === "/") return "/";
    // strip trailing detail ids (/buildings/3 → /buildings)
    const parts = location.split("/").filter(Boolean);
    if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1]!)) {
      return "/" + parts.slice(0, -1).join("/");
    }
    return location;
  })();

  const { data: pageTerms = [] } = useListGlossaryTerms(
    { route: routeForPage },
    { query: { enabled: open, queryKey: getListGlossaryTermsQueryKey({ route: routeForPage }) } },
  );
  const { data: searchTerms = [] } = useListGlossaryTerms(
    { q },
    { query: { enabled: open && q.trim().length > 1, queryKey: getListGlossaryTermsQueryKey({ q }) } },
  );

  const replayMutation = useUpdateMyOnboarding({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetMyOnboardingQueryKey() });
        onOpenChange(false);
      },
    },
  });

  function handleReplayTour() {
    replayMutation.mutate({ data: { action: "replay" } });
  }

  const showSearch = q.trim().length > 1;
  const list = showSearch ? searchTerms : pageTerms;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[440px] p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b" style={{ borderColor: c.border }}>
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4.5 w-4.5" style={{ color: c.cobalt }} />
            <SheetTitle style={{ color: c.ink }}>Help on this page</SheetTitle>
          </div>
          <SheetDescription className="text-[12.5px]" style={{ color: c.inkMute }}>
            Quick definitions for what you see, plus full glossary search.
          </SheetDescription>
        </SheetHeader>

        <div className="px-5 py-3 border-b" style={{ borderColor: c.border }}>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: c.inkMute }} />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the glossary…"
              className="pl-8 h-9 text-[13px]"
              data-testid="help-panel-search"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {!showSearch && (
            <p className="text-[11px] uppercase tracking-wider mb-2.5" style={{ color: c.inkMute, fontWeight: 700 }}>
              On this page
            </p>
          )}
          {showSearch && (
            <p className="text-[11px] uppercase tracking-wider mb-2.5" style={{ color: c.inkMute, fontWeight: 700 }}>
              Search results ({list.length})
            </p>
          )}
          {list.length === 0 ? (
            <div className="rounded-lg border px-4 py-6 text-center" style={{ borderColor: c.border, background: c.canvas }}>
              <BookOpen className="mx-auto h-5 w-5 mb-2" style={{ color: c.inkMute, opacity: 0.5 }} />
              <p className="text-[12.5px]" style={{ color: c.inkMute }}>
                {showSearch ? "No glossary terms matched." : "No specific terms tagged for this page yet."}
              </p>
              <Link
                href="/help"
                onClick={() => onOpenChange(false)}
                className="mt-2 inline-block text-[12px] hover:underline"
                style={{ color: c.cobalt, fontWeight: 600 }}
              >
                Open full glossary →
              </Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {list.map((t) => (
                <li key={t.termKey}>
                  <Link
                    href={`/help/glossary/${t.termKey}`}
                    onClick={() => onOpenChange(false)}
                    className="block rounded-lg border px-3.5 py-2.5 transition-colors hover:bg-slate-50"
                    style={{ borderColor: c.border, background: "#fff" }}
                    data-testid={`help-panel-term-${t.termKey}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px]" style={{ fontWeight: 700, color: c.ink }}>{t.title}</span>
                      <span
                        className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5"
                        style={{ background: c.cobaltSoft, color: c.cobalt, fontWeight: 600 }}
                      >
                        {t.category}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-snug" style={{ color: c.inkSoft }}>{t.shortDef}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t px-5 py-4 space-y-2" style={{ borderColor: c.border, background: c.canvas }}>
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={handleReplayTour}
            disabled={replayMutation.isPending}
            data-testid="help-panel-replay-tour"
          >
            <Compass className="h-3.5 w-3.5 mr-2" />
            Replay the welcome tour
          </Button>
          <Link
            href="/help"
            onClick={() => onOpenChange(false)}
            className="flex items-center justify-between rounded-md px-3 py-2 text-[13px] hover:bg-white transition-colors"
            style={{ color: c.ink, fontWeight: 600 }}
            data-testid="help-panel-open-help"
          >
            <span className="flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5" style={{ color: c.cobalt }} />
              Open full Help &amp; Glossary
            </span>
            <ExternalLink className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
