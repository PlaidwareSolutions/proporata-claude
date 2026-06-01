// Task #48: shared password policy used by /me/password and the invite
// /auth/accept-invite flow. Returns a list of human-readable rule failures
// so callers can surface field-level validation errors and the frontend
// strength meter can mirror the same rules.

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

export const PASSWORD_RULES = [
  { key: "length", label: "At least 10 characters" },
  { key: "classes", label: "Mix of 3 of: uppercase, lowercase, number, symbol" },
  { key: "notCommon", label: "Not a commonly-used password" },
  { key: "notEmail", label: "Doesn't reuse your email address" },
] as const;

export function evaluatePassword(password: string, email?: string | null): PasswordRuleResults {
  const pw = typeof password === "string" ? password : "";
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

export interface PasswordCheckResult {
  ok: boolean;
  error?: string;
}

export function checkPassword(password: unknown, email?: string | null): PasswordCheckResult {
  if (typeof password !== "string" || !password) {
    return { ok: false, error: "Password is required" };
  }
  const r = evaluatePassword(password, email);
  if (!r.length) return { ok: false, error: "Password must be at least 10 characters" };
  if (!r.classes) return { ok: false, error: "Password must include a mix of at least 3 of: uppercase, lowercase, number, and symbol" };
  if (!r.notCommon) return { ok: false, error: "That password is too common — please choose a less predictable one" };
  if (!r.notEmail) return { ok: false, error: "Password must not include your email address" };
  return { ok: true };
}
