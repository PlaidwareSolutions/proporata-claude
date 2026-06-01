import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Lock, Mail, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { c } from "@/lib/theme";

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const DEMO_EMAIL = "admin@quailvalleyhoa.org";
  const DEMO_PASSWORD = "admin123";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      setLocation("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: c.canvas }}
    >
      <div className="w-full max-w-sm px-4">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img
            src="/favicon-color.png"
            alt="Quail Valley logo"
            className="h-16 w-16 object-contain"
          />
          <div className="text-center">
            <h1
              className="text-[22px]"
              style={{ fontWeight: 700, letterSpacing: "-0.02em", color: c.ink }}
            >
              Quail Valley HOA
            </h1>
            <p className="text-[14px] mt-1" style={{ color: c.inkMute, fontWeight: 500 }}>
              Sign in to your workspace
            </p>
          </div>
        </div>

        <div
          className="rounded-2xl border bg-white p-8 shadow-sm"
          style={{ borderColor: c.border }}
        >
          <div
            className="mb-5 rounded-md border px-3 py-2.5 text-[12.5px]"
            style={{
              background: "#EFF4FF",
              borderColor: "#C7D2FE",
              color: c.ink,
            }}
          >
            <div
              className="text-[11px] uppercase tracking-wider mb-1"
              style={{ color: c.inkSoft, fontWeight: 700 }}
            >
              Demo credentials
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div>
                  <span style={{ color: c.inkMute }}>user:</span>{" "}
                  <span style={{ fontFamily: "ui-monospace, monospace" }}>
                    {DEMO_EMAIL}
                  </span>
                </div>
                <div>
                  <span style={{ color: c.inkMute }}>pass:</span>{" "}
                  <span style={{ fontFamily: "ui-monospace, monospace" }}>
                    {DEMO_PASSWORD}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEmail(DEMO_EMAIL);
                  setPassword(DEMO_PASSWORD);
                }}
                className="rounded-md px-2.5 py-1 text-[11.5px] hover:opacity-90 transition-opacity whitespace-nowrap"
                style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
              >
                Use
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                className="block text-[12px] mb-1.5 uppercase tracking-wider"
                style={{ color: c.inkSoft, fontWeight: 700 }}
              >
                Email
              </label>
              <div className="relative">
                <Mail
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                  style={{ color: c.inkMute }}
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  className="w-full rounded-md border pl-9 pr-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-500/30"
                  style={{ borderColor: c.border, color: c.ink }}
                />
              </div>
            </div>

            <div>
              <label
                className="block text-[12px] mb-1.5 uppercase tracking-wider"
                style={{ color: c.inkSoft, fontWeight: 700 }}
              >
                Password
              </label>
              <div className="relative">
                <Lock
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
                  style={{ color: c.inkMute }}
                />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full rounded-md border pl-9 pr-10 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-blue-500/30"
                  style={{ borderColor: c.border, color: c.ink }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: c.inkMute }}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                className="rounded-md px-3 py-2.5 text-[13px]"
                style={{ background: "#FEF2F2", color: "#B91C1C", fontWeight: 500 }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md px-4 py-2.5 text-[14px] hover:opacity-90 disabled:opacity-60 transition-opacity"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div
            className="mt-5 pt-4 border-t text-center text-[12.5px]"
            style={{ borderColor: c.border, color: c.inkMute }}
          >
            Have an invite link? Open it to set your password and activate your account.
          </div>
        </div>
      </div>
    </div>
  );
}
