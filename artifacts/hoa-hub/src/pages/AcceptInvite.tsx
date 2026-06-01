import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useRoute } from "wouter";
import { Lock, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { c } from "@/lib/theme";
import { PasswordStrength, isPasswordStrong } from "@/components/PasswordStrength";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface InvitePreview {
  email: string;
  name: string;
  role: "admin" | "manager" | "resident";
}

export default function AcceptInvite() {
  const [, params] = useRoute<{ token: string }>("/accept-invite/:token");
  const [, setLocation] = useLocation();
  const { refresh } = useAuth();
  const token = params?.token ?? "";

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setLoadError("Invite link is invalid.");
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${BASE}/api/auth/invite/${encodeURIComponent(token)}`, {
          credentials: "include",
        });
        if (cancelled) return;
        if (res.ok) {
          setPreview((await res.json()) as InvitePreview);
        } else {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setLoadError(data.error ?? "Invite link is invalid or has expired.");
        }
      } catch {
        if (!cancelled) setLoadError("Couldn't load invite. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!isPasswordStrong(password, preview?.email)) {
      setSubmitError("Please choose a password that satisfies all rules below.");
      return;
    }
    if (password !== confirm) {
      setSubmitError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/auth/accept-invite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setSubmitError(data.error ?? "Could not set your password");
        setSubmitting(false);
        return;
      }
      await refresh();
      setLocation("/");
    } catch {
      setSubmitError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: c.canvas }}>
      <div className="w-full max-w-sm px-4">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img src="/favicon-color.png" alt="Quail Valley logo" className="h-16 w-16 object-contain" />
          <div className="text-center">
            <h1 className="text-[22px]" style={{ fontWeight: 700, letterSpacing: "-0.02em", color: c.ink }}>
              Quail Valley HOA
            </h1>
            <p className="text-[14px] mt-1" style={{ color: c.inkMute, fontWeight: 500 }}>
              Set your password to activate your account
            </p>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-8 shadow-sm" style={{ borderColor: c.border }}>
          {loading ? (
            <div className="text-center text-[13px]" style={{ color: c.inkMute }}>Loading invite…</div>
          ) : loadError ? (
            <div className="space-y-3">
              <div className="rounded-md px-3 py-2.5 text-[13px]" style={{ background: "#FEF2F2", color: "#B91C1C", fontWeight: 500 }}>
                {loadError}
              </div>
              <button
                onClick={() => setLocation("/login")}
                className="w-full rounded-md px-4 py-2.5 text-[14px] hover:opacity-90 transition-opacity"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              >
                Back to sign in
              </button>
            </div>
          ) : preview ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div
                className="rounded-md border px-3 py-2.5 text-[12.5px]"
                style={{ background: "#EFF4FF", borderColor: "#C7D2FE", color: c.ink }}
              >
                <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: c.inkSoft, fontWeight: 700 }}>
                  Welcome
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{preview.name || preview.email}</div>
                  <div style={{ color: c.inkMute }}>{preview.email} — {preview.role}</div>
                </div>
              </div>

              <div>
                <label className="block text-[12px] mb-1.5 uppercase tracking-wider" style={{ color: c.inkSoft, fontWeight: 700 }}>
                  New password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: c.inkMute }} />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                    placeholder="••••••••••"
                    className="w-full rounded-md border pl-9 pr-10 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-500/30"
                    style={{ borderColor: c.border, color: c.ink }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: c.inkMute }}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <PasswordStrength password={password} email={preview.email} />
              </div>

              <div>
                <label className="block text-[12px] mb-1.5 uppercase tracking-wider" style={{ color: c.inkSoft, fontWeight: 700 }}>
                  Confirm password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: c.inkMute }} />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    placeholder="••••••••••"
                    className="w-full rounded-md border pl-9 pr-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-500/30"
                    style={{ borderColor: c.border, color: c.ink }}
                  />
                </div>
              </div>

              {submitError && (
                <div className="rounded-md px-3 py-2.5 text-[13px]" style={{ background: "#FEF2F2", color: "#B91C1C", fontWeight: 500 }}>
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md px-4 py-2.5 text-[14px] hover:opacity-90 disabled:opacity-60 transition-opacity"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              >
                {submitting ? "Setting password…" : "Set password & sign in"}
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
