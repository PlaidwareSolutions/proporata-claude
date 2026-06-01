import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import {
  useGetMyOnboarding,
  useUpdateMyOnboarding,
  getGetMyOnboardingQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { c } from "@/lib/theme";

interface TourStep {
  title: string;
  body: string;
  link?: { label: string; href: string };
}

const MANAGER_TOUR: TourStep[] = [
  {
    title: "Welcome to the HOA Operations Hub",
    body: "This is your day-to-day cockpit for running the community: maintenance, governance, financials, compliance, and resident communications all in one place.",
  },
  {
    title: "Property and units",
    body: "Buildings, units, and the site map give you a real-world view of what you're responsible for. Click any unit to see its owner, balance, work-order history, and architectural changes.",
    link: { label: "Open Buildings", href: "/buildings" },
  },
  {
    title: "Work orders and vendors",
    body: "Track maintenance from a resident request through to vendor completion. Use the bids workspace to run sealed-bid RFPs and award work fairly.",
    link: { label: "Open Work Orders", href: "/work-orders" },
  },
  {
    title: "Governance",
    body: "Motions move through tally → adoption → resolution. The board page shows officers and quorum; meetings hold agendas, attendance, and minutes.",
    link: { label: "Open Motions", href: "/motions" },
  },
  {
    title: "Need a refresher?",
    body: "Click the question-mark next to the bell at any time to see definitions for whatever page you're on, or replay this tour.",
  },
];

const RESIDENT_TOUR: TourStep[] = [
  {
    title: "Welcome to your resident portal",
    body: "Pay dues, view documents, register pets, reserve amenities, and submit architectural requests — all from one place.",
  },
  {
    title: "Your account",
    body: "My Account shows your current balance, recent payments, and printable statements.",
    link: { label: "Open My Account", href: "/portal/account" },
  },
  {
    title: "Architectural changes",
    body: "Planning a fence, paint color, or deck? File an architectural request and the ACC will review it.",
    link: { label: "Open Architectural", href: "/portal/architectural" },
  },
  {
    title: "Amenities and community",
    body: "Reserve the clubhouse, pool, or BBQ, register pets, and check community calendars.",
    link: { label: "Browse Amenities", href: "/portal/amenities" },
  },
  {
    title: "Need help?",
    body: "Click the question-mark icon next to the bell for definitions on whatever page you're on, or to replay this tour.",
  },
];

const BOARD_TOUR: TourStep[] = [
  ...RESIDENT_TOUR.slice(0, 3),
  {
    title: "Your board duties",
    body: "As a board member you can vote on motions, see resolutions, and track meeting minutes.",
    link: { label: "Open Board", href: "/portal/board" },
  },
  RESIDENT_TOUR[RESIDENT_TOUR.length - 1]!,
];

export function OnboardingTour() {
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const enabled = !authLoading && !!user;
  const { data: state, isLoading: stateLoading } = useGetMyOnboarding({
    query: { enabled, queryKey: getGetMyOnboardingQueryKey() },
  });
  const update = useUpdateMyOnboarding({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetMyOnboardingQueryKey() }),
    },
  });

  const steps = useMemo<TourStep[]>(() => {
    if (!user) return [];
    if (user.role === "admin" || user.role === "manager") return MANAGER_TOUR;
    if (user.boardMember) return BOARD_TOUR;
    return RESIDENT_TOUR;
  }, [user]);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [lastReplayedAt, setLastReplayedAt] = useState<string | null>(null);

  // Open when first-time, when "replay" was just signaled, or when an admin
  // has bumped the org-wide tour version above this user's last-seen version
  // (Task #146 — auto-prompt the right audience after major releases). The
  // server stamps `tourVersionSeen = currentTourVersion` whenever the user
  // dismisses the tour, so this never force-replays in a loop.
  useEffect(() => {
    if (!enabled || stateLoading || !state) return;
    if (!state.tourCompleted) {
      setStep(0);
      setOpen(true);
      return;
    }
    if (state.tourReplayedAt && state.tourReplayedAt !== lastReplayedAt) {
      setLastReplayedAt(state.tourReplayedAt);
      setStep(0);
      setOpen(true);
      return;
    }
    // Legacy completions (rows whose `tourVersionSeen` is still NULL because
    // they finished the tour before this feature shipped) are treated as
    // having seen v1. That keeps everyone quiet on the initial v1 rollout
    // but still lets a future admin bump to v2+ pull them back into the
    // tour. The post-merge backfill flips most of these rows to 1 in the
    // DB; this `?? 1` coalesce is the belt-and-suspenders for any rows the
    // backfill missed (e.g. rows created between migration and rollout).
    const seen = state.tourVersionSeen ?? 1;
    if (state.currentTourVersion > seen) {
      setStep(0);
      setOpen(true);
    }
  }, [enabled, stateLoading, state, lastReplayedAt]);

  if (!enabled || steps.length === 0) return null;

  function close(complete: boolean) {
    setOpen(false);
    if (complete) {
      // Optimistically mark the tour as completed in the cache so the
      // dialog doesn't reopen when Layout remounts during navigation
      // (which would otherwise happen before the mutation's refetch
      // lands and updates `tourCompleted`).
      qc.setQueryData(getGetMyOnboardingQueryKey(), (prev: typeof state | undefined) =>
        prev
          ? { ...prev, tourCompleted: true, tourVersionSeen: prev.currentTourVersion }
          : prev,
      );
      update.mutate({ data: { action: "complete" } });
    }
  }

  const total = steps.length;
  const cur = steps[step];
  if (!cur) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(true); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden" data-testid="onboarding-tour">
        <div className="px-5 pt-5 pb-3 flex items-start" style={{ background: c.cobaltSoft }}>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" style={{ color: c.cobalt }} />
            <span className="text-[11px] uppercase tracking-wider" style={{ fontWeight: 700, color: c.cobalt }}>
              Step {step + 1} of {total}
            </span>
          </div>
        </div>
        <div className="px-5 py-5">
          <DialogTitle className="text-[18px]" style={{ color: c.ink }}>{cur.title}</DialogTitle>
          <DialogDescription className="mt-2 text-[13px] leading-relaxed" style={{ color: c.inkSoft }}>
            {cur.body}
          </DialogDescription>
          {cur.link && (
            <Link
              href={cur.link.href}
              onClick={() => close(true)}
              className="mt-3 inline-block text-[12.5px] hover:underline"
              style={{ color: c.cobalt, fontWeight: 600 }}
            >
              {cur.link.label} →
            </Link>
          )}
          <div className="mt-5 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              data-testid="tour-prev"
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
            </Button>
            <div className="flex items-center gap-1.5">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: i === step ? 18 : 6,
                    background: i === step ? c.cobalt : c.border,
                  }}
                />
              ))}
            </div>
            {step < total - 1 ? (
              <Button size="sm" onClick={() => setStep((s) => s + 1)} data-testid="tour-next">
                Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            ) : (
              <Button size="sm" onClick={() => close(true)} data-testid="tour-finish">
                Got it
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
