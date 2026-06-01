import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { c } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import { PasswordStrength, isPasswordStrong } from "@/components/PasswordStrength";
import {
  User, Mail, Phone, Home, MapPin, ShieldAlert, Lock, BellRing, CheckCircle2, AlertCircle,
  MessageSquare,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return res;
}

type Profile = {
  hoaName?: string;
  smsEnabled?: boolean;
  user: {
    id: number;
    email: string;
    pendingEmail: string | null;
    role: string;
    name: string;
    phone: string | null;
    phoneNumber: string | null;
    phoneVerified: boolean;
    createdAt: string;
  };
  unit: {
    id: string;
    address: string;
    unit: string;
    occupancy: string;
    occupancyRole: "owner" | "tenant" | "none";
    ownerName: string;
    ownerPhone: string | null;
    ownerMailingAddress: string | null;
    ownerEmergencyName: string | null;
    ownerEmergencyPhone: string | null;
    tenantName: string | null;
    tenantPhone: string | null;
    tenantEmergencyName: string | null;
    tenantEmergencyPhone: string | null;
  } | null;
  preferences: {
    workOrdersInApp: boolean;
    workOrdersEmail: boolean;
    announcementsInApp: boolean;
    announcementsEmail: boolean;
    billingInApp: boolean;
    billingEmail: boolean;
    accInApp: boolean;
    accEmail: boolean;
    governanceEmail: boolean;
  };
};

type Toast = { kind: "ok" | "err"; msg: string } | null;

function Section({ icon: Icon, title, children, onSave, saving, dirty }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  onSave?: () => void;
  saving?: boolean;
  dirty?: boolean;
}) {
  return (
    <section className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Icon className="h-5 w-5" style={{ color: c.cobalt }} />
          <h2 className="text-[16px]" style={{ fontWeight: 700 }}>{title}</h2>
        </div>
        {onSave && (
          <button
            onClick={onSave}
            disabled={saving || !dirty}
            className="rounded-md px-3 py-1.5 text-[13px] disabled:opacity-50"
            style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold mb-1" style={{ color: c.inkSoft }}>{label}</label>
      {children}
      {hint && <div className="text-[11.5px] mt-1" style={{ color: c.inkMute }}>{hint}</div>}
    </div>
  );
}

const inputCls = "w-full rounded-lg border px-3 py-2 text-[13px]";
const inputStyle = { borderColor: c.border, background: "#fff", color: c.ink } as const;

export default function ResidentProfile() {
  const { user: authUser, refresh } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>(null);

  // Section dirty state
  const [contact, setContact] = useState({ name: "", email: "", phone: "" });
  const [contactDirty, setContactDirty] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);

  const [mail, setMail] = useState({ ownerMailingAddress: "" });
  const [mailDirty, setMailDirty] = useState(false);
  const [mailSaving, setMailSaving] = useState(false);

  const [emerg, setEmerg] = useState({ name: "", phone: "" });
  const [emergDirty, setEmergDirty] = useState(false);
  const [emergSaving, setEmergSaving] = useState(false);

  const [prefs, setPrefs] = useState<Profile["preferences"] | null>(null);
  const [prefsDirty, setPrefsDirty] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);

  // Phone verification (SMS reminders)
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneStage, setPhoneStage] = useState<"idle" | "sent">("idle");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneMsg, setPhoneMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  // Email change
  const [newEmail, setNewEmail] = useState("");
  const [emailPwd, setEmailPwd] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  // Password change
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  function showToast(t: Toast) {
    setToast(t);
    if (t) setTimeout(() => setToast(null), 3000);
  }

  async function load() {
    setLoading(true);
    const res = await api("/api/me/profile");
    if (res.ok) {
      const data = (await res.json()) as Profile;
      setProfile(data);
      setContact({ name: data.user.name, email: data.user.email, phone: data.user.phone ?? "" });
      setMail({ ownerMailingAddress: data.unit?.ownerMailingAddress ?? "" });
      const isOwner = data.unit?.occupancyRole === "owner";
      setEmerg({
        name: (isOwner ? data.unit?.ownerEmergencyName : data.unit?.tenantEmergencyName) ?? "",
        phone: (isOwner ? data.unit?.ownerEmergencyPhone : data.unit?.tenantEmergencyPhone) ?? "",
      });
      setPrefs(data.preferences);
      setContactDirty(false);
      setMailDirty(false);
      setEmergDirty(false);
      setPrefsDirty(false);
    }
    setLoading(false);
  }

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  async function saveContact() {
    if (!profile) return;
    setContactSaving(true);
    const isOwner = profile.unit?.occupancyRole === "owner";
    const body: Record<string, unknown> = { name: contact.name.trim(), phone: contact.phone };
    if (isOwner) {
      body.ownerName = contact.name.trim();
      body.ownerPhone = contact.phone;
    } else if (profile.unit?.occupancyRole === "tenant") {
      body.tenantName = contact.name.trim();
      body.tenantPhone = contact.phone;
    }
    const res = await api("/api/me/profile", { method: "PATCH", body: JSON.stringify(body) });
    setContactSaving(false);
    if (res.ok) {
      showToast({ kind: "ok", msg: "Contact info saved" });
      await refresh();
      await load();
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      showToast({ kind: "err", msg: data.error ?? "Could not save contact info" });
    }
  }

  async function saveMail() {
    if (!profile) return;
    setMailSaving(true);
    const res = await api("/api/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ ownerMailingAddress: mail.ownerMailingAddress }),
    });
    setMailSaving(false);
    if (res.ok) {
      showToast({ kind: "ok", msg: "Mailing address saved" });
      await load();
    } else {
      showToast({ kind: "err", msg: "Could not save mailing address" });
    }
  }

  async function saveEmerg() {
    if (!profile) return;
    setEmergSaving(true);
    const isOwner = profile.unit?.occupancyRole === "owner";
    const body = isOwner
      ? { ownerEmergencyName: emerg.name, ownerEmergencyPhone: emerg.phone }
      : { tenantEmergencyName: emerg.name, tenantEmergencyPhone: emerg.phone };
    const res = await api("/api/me/profile", { method: "PATCH", body: JSON.stringify(body) });
    setEmergSaving(false);
    if (res.ok) {
      showToast({ kind: "ok", msg: "Emergency contact saved" });
      await load();
    } else {
      showToast({ kind: "err", msg: "Could not save emergency contact" });
    }
  }

  async function savePrefs() {
    if (!prefs) return;
    setPrefsSaving(true);
    const res = await api("/api/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ preferences: prefs }),
    });
    setPrefsSaving(false);
    if (res.ok) {
      showToast({ kind: "ok", msg: "Preferences saved" });
      await load();
    } else {
      showToast({ kind: "err", msg: "Could not save preferences" });
    }
  }

  async function requestEmailChange() {
    setEmailMsg(null);
    if (!newEmail || !emailPwd) {
      setEmailMsg({ ok: false, msg: "Enter new email and current password" });
      return;
    }
    setEmailBusy(true);
    const res = await api("/api/me/email-change", {
      method: "POST",
      body: JSON.stringify({ newEmail, password: emailPwd }),
    });
    setEmailBusy(false);
    const data = (await res.json().catch(() => ({}))) as { error?: string; pendingEmail?: string; verificationToken?: string };
    if (res.ok) {
      const link = data.verificationToken ? ` Dev verify link: ${BASE}/verify-email?token=${data.verificationToken}` : "";
      setEmailMsg({ ok: true, msg: `Verification pending for ${data.pendingEmail}.${link}` });
      setNewEmail("");
      setEmailPwd("");
      await load();
    } else {
      setEmailMsg({ ok: false, msg: data.error ?? "Could not request email change" });
    }
  }

  async function sendPhoneCode() {
    setPhoneMsg(null);
    setPhoneBusy(true);
    const res = await api("/api/me/phone/start", {
      method: "POST",
      body: JSON.stringify({ phoneNumber: phoneInput }),
    });
    setPhoneBusy(false);
    const data = (await res.json().catch(() => ({}))) as {
      error?: string; phoneNumber?: string; devCode?: string; smsConfigured?: boolean; smsError?: string;
    };
    if (res.ok) {
      setPhoneStage("sent");
      const dev = data.devCode ? ` Dev code: ${data.devCode}.` : "";
      const noProvider = data.smsConfigured === false ? " (SMS provider not configured — use the dev code shown.)" : "";
      setPhoneMsg({ ok: true, msg: `Verification code sent to ${data.phoneNumber}.${dev}${noProvider}` });
    } else {
      setPhoneMsg({ ok: false, msg: data.error ?? "Could not send code" });
    }
  }

  async function verifyPhoneCode() {
    setPhoneMsg(null);
    setPhoneBusy(true);
    const res = await api("/api/me/phone/verify", {
      method: "POST",
      body: JSON.stringify({ code: phoneCode.trim() }),
    });
    setPhoneBusy(false);
    const data = (await res.json().catch(() => ({}))) as { error?: string; phoneNumber?: string };
    if (res.ok) {
      setPhoneMsg({ ok: true, msg: `Phone verified: ${data.phoneNumber}` });
      setPhoneStage("idle");
      setPhoneCode("");
      setPhoneInput("");
      await load();
    } else {
      setPhoneMsg({ ok: false, msg: data.error ?? "Could not verify code" });
    }
  }

  async function clearPhone() {
    setPhoneMsg(null);
    setPhoneBusy(true);
    const res = await api("/api/me/phone/clear", { method: "POST" });
    setPhoneBusy(false);
    if (res.ok) {
      setPhoneMsg({ ok: true, msg: "Verified phone removed" });
      setPhoneStage("idle");
      setPhoneCode("");
      setPhoneInput("");
      await load();
    } else {
      setPhoneMsg({ ok: false, msg: "Could not remove phone" });
    }
  }

  async function changePassword() {
    setPwMsg(null);
    if (!isPasswordStrong(pw.next, profile?.user.email)) {
      setPwMsg({ ok: false, msg: "Please choose a password that satisfies all rules below." });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwMsg({ ok: false, msg: "New passwords do not match" });
      return;
    }
    setPwBusy(true);
    const res = await api("/api/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }),
    });
    setPwBusy(false);
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) {
      setPw({ current: "", next: "", confirm: "" });
      setPwMsg({ ok: true, msg: "Password changed successfully" });
    } else {
      setPwMsg({ ok: false, msg: data.error ?? "Could not change password" });
    }
  }

  if (loading || !profile || !prefs) {
    return (
      <Layout title="My Profile" subtitle="Loading…">
        <div className="text-[13px]" style={{ color: c.inkMute }}>Loading…</div>
      </Layout>
    );
  }

  const isOwner = profile.unit?.occupancyRole === "owner";

  return (
    <Layout title="My Profile" subtitle="Update your contact info and preferences">
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border px-5 py-4 shadow-lg"
          style={{
            background: c.panel,
            borderColor: toast.kind === "ok" ? c.emerald : c.rose,
            minWidth: 300,
          }}
        >
          {toast.kind === "ok" ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: c.emerald }} />
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0" style={{ color: c.rose }} />
          )}
          <div className="text-[13px]" style={{ fontWeight: 600 }}>{toast.msg}</div>
        </div>
      )}

      <div className="max-w-3xl space-y-5">
        <section className="rounded-xl border p-5" style={{ background: c.panel, borderColor: c.border }}>
          <div className="flex items-center gap-2.5 mb-4">
            <Home className="h-5 w-5" style={{ color: c.cobalt }} />
            <h2 className="text-[16px]" style={{ fontWeight: 700 }}>My Unit</h2>
          </div>
          {profile.unit ? (
            <div className="grid grid-cols-2 gap-3 text-[13px]" style={{ color: c.ink }}>
              {profile.hoaName && (
                <div className="col-span-2"><span style={{ color: c.inkMute }}>HOA of record: </span>{profile.hoaName}</div>
              )}
              <div><span style={{ color: c.inkMute }}>Address: </span>{profile.unit.address}</div>
              <div><span style={{ color: c.inkMute }}>Unit: </span>{profile.unit.unit}</div>
              <div><span style={{ color: c.inkMute }}>Role: </span>{profile.unit.occupancyRole === "owner" ? "Owner" : profile.unit.occupancyRole === "tenant" ? "Tenant" : "Not on file"}</div>
              <div><span style={{ color: c.inkMute }}>Member since: </span>{new Date(profile.user.createdAt).toLocaleDateString()}</div>
            </div>
          ) : (
            <div className="text-[13px]" style={{ color: c.inkMute }}>
              {profile.hoaName ? <div className="mb-2"><span style={{ color: c.inkMute }}>HOA of record: </span>{profile.hoaName}</div> : null}
              You aren't currently assigned to a unit. Contact your property manager.
            </div>
          )}
        </section>

        <Section
          icon={User}
          title="Contact"
          onSave={saveContact}
          saving={contactSaving}
          dirty={contactDirty}
        >
          <Field label="Display name">
            <input
              className={inputCls}
              style={inputStyle}
              value={contact.name}
              onChange={(e) => { setContact((s) => ({ ...s, name: e.target.value })); setContactDirty(true); }}
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputCls}
              style={inputStyle}
              value={contact.phone}
              placeholder="(555) 123-4567"
              onChange={(e) => { setContact((s) => ({ ...s, phone: e.target.value })); setContactDirty(true); }}
            />
          </Field>
          <Field label="Login email" hint="To change your login email, use the section below.">
            <input className={inputCls} style={{ ...inputStyle, background: c.canvas }} value={profile.user.email} readOnly />
          </Field>
          {profile.user.pendingEmail && (
            <div className="text-[12px] rounded-md px-3 py-2" style={{ background: c.amberSoft, color: c.amber }}>
              Pending email change: {profile.user.pendingEmail}. Click the link in your verification email to confirm.
            </div>
          )}
        </Section>

        {isOwner && (
          <Section
            icon={MapPin}
            title="Mailing Address"
            onSave={saveMail}
            saving={mailSaving}
            dirty={mailDirty}
          >
            <Field label="Mailing address" hint="Used when you don't live in the unit.">
              <textarea
                rows={2}
                className={inputCls + " resize-none"}
                style={inputStyle}
                value={mail.ownerMailingAddress}
                onChange={(e) => { setMail({ ownerMailingAddress: e.target.value }); setMailDirty(true); }}
              />
            </Field>
          </Section>
        )}

        <Section
          icon={ShieldAlert}
          title="Emergency Contact"
          onSave={saveEmerg}
          saving={emergSaving}
          dirty={emergDirty}
        >
          <Field label="Contact name">
            <input
              className={inputCls}
              style={inputStyle}
              value={emerg.name}
              onChange={(e) => { setEmerg((s) => ({ ...s, name: e.target.value })); setEmergDirty(true); }}
            />
          </Field>
          <Field label="Contact phone">
            <input
              className={inputCls}
              style={inputStyle}
              value={emerg.phone}
              onChange={(e) => { setEmerg((s) => ({ ...s, phone: e.target.value })); setEmergDirty(true); }}
            />
          </Field>
        </Section>

        <Section icon={Mail} title="Login & Security">
          <div>
            <div className="text-[13px] mb-2" style={{ fontWeight: 600 }}>Change login email</div>
            <Field label="New email">
              <input
                className={inputCls}
                style={inputStyle}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Confirm with current password">
              <input
                type="password"
                className={inputCls}
                style={inputStyle}
                value={emailPwd}
                onChange={(e) => setEmailPwd(e.target.value)}
              />
            </Field>
            <button
              onClick={requestEmailChange}
              disabled={emailBusy}
              className="mt-2 rounded-md px-3 py-1.5 text-[13px] disabled:opacity-50"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            >
              {emailBusy ? "Sending…" : "Send verification"}
            </button>
            {emailMsg && (
              <div
                className="text-[12px] mt-2 rounded-md px-3 py-2 break-all"
                style={{
                  background: emailMsg.ok ? c.emeraldSoft : c.roseSoft,
                  color: emailMsg.ok ? c.emerald : c.rose,
                }}
              >
                {emailMsg.msg}
              </div>
            )}
          </div>

          <div className="border-t pt-4 mt-4" style={{ borderColor: c.borderSoft }}>
            <div className="text-[13px] mb-2 flex items-center gap-2" style={{ fontWeight: 600 }}>
              <Lock className="h-4 w-4" /> Change password
            </div>
            <Field label="Current password">
              <input type="password" className={inputCls} style={inputStyle}
                value={pw.current} onChange={(e) => setPw((s) => ({ ...s, current: e.target.value }))} />
            </Field>
            <Field label="New password">
              <input type="password" className={inputCls} style={inputStyle}
                value={pw.next} onChange={(e) => setPw((s) => ({ ...s, next: e.target.value }))} />
              <PasswordStrength password={pw.next} email={profile?.user.email} />
            </Field>
            <Field label="Confirm new password">
              <input type="password" className={inputCls} style={inputStyle}
                value={pw.confirm} onChange={(e) => setPw((s) => ({ ...s, confirm: e.target.value }))} />
            </Field>
            <button
              onClick={changePassword}
              disabled={pwBusy}
              className="mt-2 rounded-md px-3 py-1.5 text-[13px] disabled:opacity-50"
              style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
            >
              {pwBusy ? "Updating…" : "Change password"}
            </button>
            {pwMsg && (
              <div
                className="text-[12px] mt-2 rounded-md px-3 py-2"
                style={{
                  background: pwMsg.ok ? c.emeraldSoft : c.roseSoft,
                  color: pwMsg.ok ? c.emerald : c.rose,
                }}
              >
                {pwMsg.msg}
              </div>
            )}
          </div>
        </Section>

        <Section icon={MessageSquare} title="Text-Message Reminders">
          <div className="text-[12.5px] mb-2" style={{ color: c.inkMute }}>
            Verify a mobile number to receive text reminders for board meetings and other
            calendar events you've subscribed to. Quiet hours (10pm–7am Central) are honored.
            {profile.smsEnabled === false && (
              <span> SMS provider isn't configured yet — verification still works in dev mode.</span>
            )}
          </div>

          {profile.user.phoneVerified && profile.user.phoneNumber ? (
            <div className="rounded-md border px-3 py-2.5 flex items-center justify-between"
              style={{ background: c.emeraldSoft, borderColor: c.emerald }}>
              <div className="flex items-center gap-2 text-[13px]" style={{ color: c.emerald, fontWeight: 600 }}>
                <CheckCircle2 className="h-4 w-4" />
                Verified: {profile.user.phoneNumber}
              </div>
              <button
                onClick={clearPhone}
                disabled={phoneBusy}
                className="rounded-md px-2.5 py-1 text-[12px] disabled:opacity-50"
                style={{ background: "#fff", color: c.rose, fontWeight: 600, border: `1px solid ${c.rose}` }}
              >
                Remove
              </button>
            </div>
          ) : (
            <>
              <Field label="Mobile number" hint="US numbers default to +1; international numbers must include the country code.">
                <input
                  className={inputCls}
                  style={inputStyle}
                  value={phoneInput}
                  placeholder="(555) 123-4567"
                  onChange={(e) => setPhoneInput(e.target.value)}
                  disabled={phoneStage === "sent"}
                />
              </Field>
              {phoneStage === "idle" ? (
                <button
                  onClick={sendPhoneCode}
                  disabled={phoneBusy || !phoneInput.trim()}
                  className="rounded-md px-3 py-1.5 text-[13px] disabled:opacity-50"
                  style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                >
                  {phoneBusy ? "Sending…" : "Send verification code"}
                </button>
              ) : (
                <>
                  <Field label="Verification code">
                    <input
                      className={inputCls}
                      style={inputStyle}
                      value={phoneCode}
                      placeholder="6-digit code"
                      onChange={(e) => setPhoneCode(e.target.value)}
                      inputMode="numeric"
                    />
                  </Field>
                  <div className="flex gap-2">
                    <button
                      onClick={verifyPhoneCode}
                      disabled={phoneBusy || !phoneCode.trim()}
                      className="rounded-md px-3 py-1.5 text-[13px] disabled:opacity-50"
                      style={{ background: c.cobalt, color: "#fff", fontWeight: 600 }}
                    >
                      {phoneBusy ? "Verifying…" : "Verify code"}
                    </button>
                    <button
                      onClick={() => { setPhoneStage("idle"); setPhoneCode(""); setPhoneMsg(null); }}
                      disabled={phoneBusy}
                      className="rounded-md px-3 py-1.5 text-[13px] disabled:opacity-50"
                      style={{ background: "#fff", color: c.ink, fontWeight: 600, border: `1px solid ${c.border}` }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {phoneMsg && (
            <div
              className="text-[12px] mt-2 rounded-md px-3 py-2 break-all"
              style={{
                background: phoneMsg.ok ? c.emeraldSoft : c.roseSoft,
                color: phoneMsg.ok ? c.emerald : c.rose,
              }}
            >
              {phoneMsg.msg}
            </div>
          )}
        </Section>

        <Section
          icon={BellRing}
          title="Communication Preferences"
          onSave={savePrefs}
          saving={prefsSaving}
          dirty={prefsDirty}
        >
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 text-[13px] items-center">
            <div></div>
            <div className="text-[11.5px] font-semibold text-center" style={{ color: c.inkMute }}>In-app</div>
            <div className="text-[11.5px] font-semibold text-center" style={{ color: c.inkMute }}>Email</div>
            {[
              { label: "Work order updates", inApp: "workOrdersInApp", email: "workOrdersEmail" },
              { label: "Announcements", inApp: "announcementsInApp", email: "announcementsEmail" },
              { label: "Billing", inApp: "billingInApp", email: "billingEmail" },
              { label: "ACC decisions", inApp: "accInApp", email: "accEmail" },
            ].map((row) => (
              <div key={row.label} className="contents">
                <div style={{ color: c.ink }}>{row.label}</div>
                {([row.inApp, row.email] as const).map((key) => (
                  <div key={key} className="flex justify-center">
                    <input
                      type="checkbox"
                      checked={(prefs as Record<string, boolean>)[key]}
                      onChange={(e) => {
                        setPrefs((p) => p ? ({ ...p, [key]: e.target.checked }) : p);
                        setPrefsDirty(true);
                      }}
                    />
                  </div>
                ))}
              </div>
            ))}
            {/* Task #108: governance notices are owner-only and in-app only is always on. */}
            <div className="contents">
              <div style={{ color: c.ink }}>
                Board notices (meetings, minutes, resolutions)
                <div className="text-[11.5px]" style={{ color: c.inkMute }}>
                  In-app notices always appear in your portal.
                </div>
              </div>
              <div className="flex justify-center" style={{ color: c.inkMute }}>—</div>
              <div className="flex justify-center">
                <input
                  type="checkbox"
                  checked={prefs.governanceEmail}
                  onChange={(e) => {
                    setPrefs((p) => p ? ({ ...p, governanceEmail: e.target.checked }) : p);
                    setPrefsDirty(true);
                  }}
                />
              </div>
            </div>
          </div>
        </Section>
        {authUser?.role !== "resident" && (
          <div className="text-[12px]" style={{ color: c.inkMute }}>
            Tip: managers can also use this page to update their own contact info.
          </div>
        )}
      </div>
    </Layout>
  );
}
