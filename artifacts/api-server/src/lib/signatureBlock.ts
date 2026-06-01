// Helper for rendering an officer signature block at the bottom of governance
// PDFs (resolutions, meeting minutes, etc). The decision-letter PDF builder
// in routes/architecturalRequests.ts is the model for our raw PDF generation;
// this helper produces the same `(text, fontSize)` line tuples those builders
// already consume so callers can splice it in without restructuring.
//
// Used by:
//   - routes/architecturalRequests.ts (decision letter)
//   - lib/resolutions.ts (adopted board resolution PDF)
//   - routes/meetings.ts (meeting minutes PDF)
// New governance PDFs should likewise call buildCurrentSignatureBlockLines()
// and append the result to their own `lines` array before laying out the page.

import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";

export type SignatureBlockLine = [string, number];

export interface OfficerForSignature {
  name: string;
  officerTitle: string | null;
}

// Render order matches the conventional ordering in HOA governance docs:
// President first, then VP, Secretary, Treasurer, then any Members-at-Large.
const TITLE_ORDER: Record<string, number> = {
  "President": 0,
  "Vice President": 1,
  "Secretary": 2,
  "Treasurer": 3,
  "Member-at-Large": 4,
};

export function sortOfficersForSignature(officers: OfficerForSignature[]): OfficerForSignature[] {
  return [...officers].sort((a, b) => {
    const ai = a.officerTitle ? (TITLE_ORDER[a.officerTitle] ?? 99) : 99;
    const bi = b.officerTitle ? (TITLE_ORDER[b.officerTitle] ?? 99) : 99;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });
}

// Returns text/font-size tuples ready to push onto a PDF builder's `lines`
// array. Each officer gets a printed-name line, an "X _________" signature
// line, and a title line, separated by blank spacers.
export function buildSignatureBlockLines(
  officers: OfficerForSignature[],
  opts: { heading?: string } = {},
): SignatureBlockLine[] {
  const sorted = sortOfficersForSignature(officers).filter((o) => o.officerTitle);
  const lines: SignatureBlockLine[] = [];
  lines.push(["", 14]);
  lines.push([opts.heading ?? "Signed by the Board of Directors:", 11]);
  lines.push(["", 8]);
  for (const o of sorted) {
    lines.push([`X ____________________________________`, 11]);
    lines.push([`${o.name}, ${o.officerTitle}`, 10]);
    lines.push(["", 10]);
  }
  return lines;
}

// Convenience: query the DB for the currently active officer roster as of
// `date` (defaults to today) and return the signature block. Mirrors the
// /board/at endpoint's term-window logic.
export async function buildCurrentSignatureBlockLines(
  date?: string,
  opts: { heading?: string } = {},
): Promise<SignatureBlockLine[]> {
  const effective = date ?? new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      name: usersTable.name,
      officerTitle: usersTable.officerTitle,
    })
    .from(usersTable)
    .where(and(
      eq(usersTable.boardMember, true),
      or(isNull(usersTable.termStart), lte(usersTable.termStart, effective))!,
      or(isNull(usersTable.termEnd), gte(usersTable.termEnd, effective))!,
    ));
  const officers = rows
    .filter((r) => r.officerTitle)
    .map((r) => ({ name: r.name || "(unnamed)", officerTitle: r.officerTitle }));
  return buildSignatureBlockLines(officers, opts);
}
