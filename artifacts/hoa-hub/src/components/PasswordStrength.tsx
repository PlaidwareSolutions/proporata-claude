import { Check, Circle } from "lucide-react";
import { c } from "@/lib/theme";

// Task #48: client-side mirror of artifacts/api-server/src/lib/password.ts.
// Shown live as the user types so they can see which rules pass before
// they submit. The server is still the source of truth — these checks
// only guide the UX.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "password1234",
  "12345678", "123456789", "1234567890", "qwerty", "qwerty123", "qwertyuiop",
  "letmein", "letmein1", "welcome", "welcome1", "welcome123", "admin",
  "admin123", "administrator", "iloveyou", "monkey", "dragon", "sunshine",
  "princess", "football", "baseball", "michael", "jennifer", "trustno1",
  "abc12345", "11111111", "00000000", "asdfghjkl", "zxcvbnm",
  "passw0rd", "p@ssword", "p@ssw0rd", "changeme", "test1234",
]);

export interface PasswordRuleResults {
  length: boolean;
  classes: boolean;
  notCommon: boolean;
  notEmail: boolean;
}

export function evaluatePassword(password: string, email?: string | null): PasswordRuleResults {
  const pw = password ?? "";
  const classes =
    Number(/[a-z]/.test(pw)) +
    Number(/[A-Z]/.test(pw)) +
    Number(/[0-9]/.test(pw)) +
    Number(/[^A-Za-z0-9]/.test(pw));
  const localPart = (email ?? "").toLowerCase().trim().split("@")[0] ?? "";
  return {
    length: pw.length >= 10,
    classes: classes >= 3,
    notCommon: !COMMON_PASSWORDS.has(pw.toLowerCase()),
    notEmail: localPart.length === 0 || !pw.toLowerCase().includes(localPart),
  };
}

export function isPasswordStrong(password: string, email?: string | null): boolean {
  const r = evaluatePassword(password, email);
  return r.length && r.classes && r.notCommon && r.notEmail;
}

interface Props {
  password: string;
  email?: string | null;
}

export function PasswordStrength({ password, email }: Props) {
  const r = evaluatePassword(password, email);
  const passed = (Number(r.length) + Number(r.classes) + Number(r.notCommon) + Number(r.notEmail));
  // Empty input => neutral state, not "weak red".
  const showBar = password.length > 0;
  const barColor = !showBar
    ? c.borderSoft
    : passed <= 1
      ? "#DC2626"
      : passed === 2
        ? "#D97706"
        : passed === 3
          ? "#CA8A04"
          : "#16A34A";
  const label = !showBar
    ? ""
    : passed <= 1
      ? "Too weak"
      : passed === 2
        ? "Weak"
        : passed === 3
          ? "Almost there"
          : "Strong";

  const rules: Array<{ ok: boolean; label: string }> = [
    { ok: r.length, label: "At least 10 characters" },
    { ok: r.classes, label: "Mix of 3 of: uppercase, lowercase, number, symbol" },
    { ok: r.notCommon, label: "Not a commonly-used password" },
    { ok: r.notEmail, label: "Doesn't reuse your email address" },
  ];

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 flex-1 rounded-full overflow-hidden"
          style={{ background: c.borderSoft }}
        >
          <div
            className="h-full transition-all"
            style={{
              width: showBar ? `${(passed / 4) * 100}%` : "0%",
              background: barColor,
            }}
          />
        </div>
        {label && (
          <span className="text-[11.5px]" style={{ color: barColor, fontWeight: 600 }}>
            {label}
          </span>
        )}
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {rules.map((rule) => (
          <li key={rule.label} className="flex items-center gap-1.5 text-[12px]">
            {rule.ok ? (
              <Check className="h-3.5 w-3.5" style={{ color: "#16A34A" }} />
            ) : (
              <Circle className="h-3.5 w-3.5" style={{ color: c.inkMute }} />
            )}
            <span style={{ color: rule.ok ? "#15803D" : c.inkMute }}>{rule.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
