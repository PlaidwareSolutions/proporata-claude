import { useEffect, useState } from "react";
import { Link } from "wouter";
import { c } from "@/lib/theme";
import { CheckCircle2, AlertCircle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function VerifyEmail() {
  const [status, setStatus] = useState<"pending" | "ok" | "err">("pending");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setStatus("err");
      setMessage("Missing verification token.");
      return;
    }
    fetch(`${BASE}/api/me/email-change/verify`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { error?: string; email?: string };
        if (res.ok) {
          setStatus("ok");
          setMessage(`Your login email is now ${data.email}.`);
        } else {
          setStatus("err");
          setMessage(data.error ?? "Verification failed.");
        }
      })
      .catch(() => {
        setStatus("err");
        setMessage("Verification failed.");
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: c.canvas }}>
      <div className="w-full max-w-sm px-4">
        <div className="rounded-2xl border bg-white p-8 shadow-sm text-center" style={{ borderColor: c.border }}>
          {status === "pending" && (
            <>
              <div className="text-[16px]" style={{ fontWeight: 700 }}>Verifying…</div>
              <div className="text-[13px] mt-2" style={{ color: c.inkMute }}>One moment please.</div>
            </>
          )}
          {status === "ok" && (
            <>
              <CheckCircle2 className="h-10 w-10 mx-auto mb-2" style={{ color: c.emerald }} />
              <div className="text-[16px]" style={{ fontWeight: 700 }}>Email verified</div>
              <div className="text-[13px] mt-2" style={{ color: c.inkMute }}>{message}</div>
            </>
          )}
          {status === "err" && (
            <>
              <AlertCircle className="h-10 w-10 mx-auto mb-2" style={{ color: c.rose }} />
              <div className="text-[16px]" style={{ fontWeight: 700 }}>Verification failed</div>
              <div className="text-[13px] mt-2" style={{ color: c.inkMute }}>{message}</div>
            </>
          )}
          <Link
            href="/portal"
            className="inline-block mt-5 rounded-md px-3 py-1.5 text-[13px]"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          >
            Back to portal
          </Link>
        </div>
      </div>
    </div>
  );
}
