// Pure helpers for historical-document OCR auto-tag suggestions.
// Given OCR-extracted text, propose category, document date, vendor match,
// and building/unit match. All functions are deterministic and side-effect
// free so they can be unit-tested with fixture text.

export type OcrCategory = "Inspection" | "Insurance" | "Financial" | "Vendor" | "Bylaws" | "Meeting";

export interface OcrSuggestion<T> {
  value: T;
  confidence: number; // 0..1
  snippet: string;    // short excerpt that triggered the suggestion
}

export interface VendorRef { id: number; name: string }
export interface UnitRef { id: string; building: number; unit: string; address: string }
export interface BuildingRef { num: number; address: string; street: string }

export interface OcrSuggestions {
  category: OcrSuggestion<OcrCategory> | null;
  documentDate: OcrSuggestion<string> | null; // YYYY-MM-DD
  vendor: (OcrSuggestion<number> & { name: string }) | null;
  building: OcrSuggestion<number> | null;
  unit: OcrSuggestion<string> | null;
}

const CATEGORY_KEYWORDS: Record<OcrCategory, Array<{ re: RegExp; weight: number }>> = {
  Insurance: [
    { re: /\bdeclarations?\s+page\b/i,        weight: 5 },
    { re: /\binsurance\s+polic(y|ies)\b/i,    weight: 4 },
    { re: /\bcertificate\s+of\s+insurance\b/i,weight: 5 },
    { re: /\bpolicy\s+(no\.?|number)\b/i,     weight: 3 },
    { re: /\bcoverage\s+(amount|limit)\b/i,   weight: 3 },
    { re: /\bpremium\b/i,                     weight: 2 },
    { re: /\binsured\b/i,                     weight: 1 },
    { re: /\bcarrier\b/i,                     weight: 1 },
  ],
  Inspection: [
    { re: /\binspection\s+report\b/i,         weight: 5 },
    { re: /\broof\s+(inspection|condition)\b/i,weight: 5 },
    { re: /\b(inspector|inspected\s+by)\b/i,  weight: 3 },
    { re: /\bfindings?\b/i,                   weight: 2 },
    { re: /\bdeficienc(y|ies)\b/i,            weight: 2 },
    { re: /\bflashing\b/i,                    weight: 2 },
    { re: /\bshingles?\b/i,                   weight: 1 },
  ],
  Financial: [
    { re: /\b(invoice|statement)\s+number\b/i,weight: 3 },
    { re: /\bbalance\s+due\b/i,               weight: 3 },
    { re: /\baccount\s+statement\b/i,         weight: 3 },
    { re: /\bremittance\b/i,                  weight: 2 },
    { re: /\bbudget\b/i,                      weight: 2 },
    { re: /\breserve\s+study\b/i,             weight: 4 },
    { re: /\bdues\b/i,                        weight: 2 },
    { re: /\bassessment\b/i,                  weight: 1 },
  ],
  Vendor: [
    { re: /\bproposal\b/i,                    weight: 3 },
    { re: /\bquote\b/i,                       weight: 3 },
    { re: /\bbid\s+(packet|document|sheet)\b/i, weight: 4 },
    { re: /\bservice\s+agreement\b/i,         weight: 4 },
    { re: /\bcontract\s+for\s+services?\b/i,  weight: 4 },
    { re: /\bw[\s-]?9\b/i,                    weight: 4 },
    { re: /\blicense\s+(no\.?|number)\b/i,    weight: 1 },
  ],
  Bylaws: [
    { re: /\bby[-\s]?laws?\b/i,               weight: 5 },
    { re: /\bcc&rs?\b/i,                      weight: 5 },
    { re: /\bcovenants?,?\s+conditions\b/i,   weight: 5 },
    { re: /\barticles?\s+of\s+incorporation\b/i, weight: 4 },
    { re: /\brules?\s+(and|&)\s+regulations?\b/i, weight: 4 },
  ],
  Meeting: [
    { re: /\bmeeting\s+minutes\b/i,           weight: 5 },
    { re: /\bagenda\b/i,                      weight: 3 },
    { re: /\bcall(ed)?\s+to\s+order\b/i,      weight: 4 },
    { re: /\badjourn(ed|ment)?\b/i,           weight: 3 },
    { re: /\bboard\s+of\s+directors\b/i,      weight: 2 },
    { re: /\bquorum\b/i,                      weight: 3 },
    { re: /\bmotion\s+(carried|passed|adopted)\b/i, weight: 3 },
  ],
};

export function suggestCategory(text: string): OcrSuggestion<OcrCategory> | null {
  if (!text) return null;
  const scores: Record<OcrCategory, { score: number; snippet: string }> = {
    Insurance:  { score: 0, snippet: "" },
    Inspection: { score: 0, snippet: "" },
    Financial:  { score: 0, snippet: "" },
    Vendor:     { score: 0, snippet: "" },
    Bylaws:     { score: 0, snippet: "" },
    Meeting:    { score: 0, snippet: "" },
  };
  for (const [cat, rules] of Object.entries(CATEGORY_KEYWORDS) as Array<[OcrCategory, typeof CATEGORY_KEYWORDS[OcrCategory]]>) {
    for (const { re, weight } of rules) {
      const m = text.match(re);
      if (m) {
        scores[cat].score += weight;
        if (!scores[cat].snippet) scores[cat].snippet = excerpt(text, m.index ?? 0, m[0].length);
      }
    }
  }
  let best: OcrCategory | null = null;
  let bestScore = 0;
  let runnerUp = 0;
  for (const cat of Object.keys(scores) as OcrCategory[]) {
    const s = scores[cat].score;
    if (s > bestScore) { runnerUp = bestScore; bestScore = s; best = cat; }
    else if (s > runnerUp) { runnerUp = s; }
  }
  if (!best || bestScore < 3) return null;
  // Confidence: leader margin, capped at 0.95.
  const margin = bestScore - runnerUp;
  const confidence = Math.min(0.95, 0.4 + 0.1 * margin + 0.05 * bestScore);
  return { value: best, confidence, snippet: scores[best].snippet };
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

interface DateCandidate { date: string; index: number; weight: number; raw: string }

const KEYWORD_NEAR = /\b(date|effective|issued|inspected|policy|expiration|expires?|adopted|signed|completed)\b[^\n]{0,40}$/i;

export function suggestDocumentDate(text: string, today: Date = new Date()): OcrSuggestion<string> | null {
  if (!text) return null;
  const cands: DateCandidate[] = [];
  const todayY = today.getFullYear();

  // 1) Numeric MM/DD/YYYY or M/D/YY
  const numRe = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(text)) !== null) {
    const a = Number(m[1]), b = Number(m[2]); let y = Number(m[3]);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    if (y < 1900 || y > todayY + 1) continue;
    if (a < 1 || a > 12 || b < 1 || b > 31) continue;
    cands.push(makeCand(text, m.index, m[0], y, a, b));
  }
  // 2) ISO YYYY-MM-DD
  const isoRe = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = isoRe.exec(text)) !== null) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (y < 1900 || y > todayY + 1 || mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    cands.push(makeCand(text, m.index, m[0], y, mo, d));
  }
  // 3) "January 5, 2018" / "5 January 2018"
  const word1 = /\b([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/g;
  while ((m = word1.exec(text)) !== null) {
    const mo = MONTHS[m[1].toLowerCase()]; if (!mo) continue;
    const d = Number(m[2]), y = Number(m[3]);
    if (y < 1900 || y > todayY + 1 || d < 1 || d > 31) continue;
    cands.push(makeCand(text, m.index, m[0], y, mo, d));
  }
  const word2 = /\b(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})\b/g;
  while ((m = word2.exec(text)) !== null) {
    const mo = MONTHS[m[2].toLowerCase()]; if (!mo) continue;
    const d = Number(m[1]), y = Number(m[3]);
    if (y < 1900 || y > todayY + 1 || d < 1 || d > 31) continue;
    cands.push(makeCand(text, m.index, m[0], y, mo, d));
  }

  if (cands.length === 0) return null;

  // Score: keyword proximity adds weight; earlier appearance gets a small bonus.
  for (const c of cands) {
    const before = text.slice(Math.max(0, c.index - 60), c.index);
    if (KEYWORD_NEAR.test(before)) c.weight += 5;
    if (c.index < 400) c.weight += 1;
  }
  cands.sort((x, y) => y.weight - x.weight || x.index - y.index);
  const best = cands[0];
  const total = cands.length;
  const confidence = Math.min(0.95, 0.4 + 0.05 * best.weight + (total === 1 ? 0.2 : 0));
  return { value: best.date, confidence, snippet: excerpt(text, best.index, best.raw.length) };
}

function makeCand(text: string, index: number, raw: string, y: number, mo: number, d: number): DateCandidate {
  const date = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { date, index, weight: 1, raw };
}

// ── Vendor fuzzy-match ─────────────────────────────────────────────────
export function suggestVendor(text: string, vendors: VendorRef[]):
  (OcrSuggestion<number> & { name: string }) | null
{
  if (!text || vendors.length === 0) return null;
  const lcText = text.toLowerCase();
  let best: { v: VendorRef; score: number; index: number } | null = null;
  for (const v of vendors) {
    const name = v.name.trim();
    if (!name) continue;
    const lc = name.toLowerCase();
    // Exact substring
    const ix = lcText.indexOf(lc);
    if (ix >= 0) {
      const score = name.length >= 4 ? 10 : 4;
      if (!best || score > best.score) best = { v, score, index: ix };
      continue;
    }
    // Token-overlap fallback: at least 2 distinctive tokens (>= 4 chars)
    const tokens = lc.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
    if (tokens.length === 0) continue;
    let hits = 0; let firstIx = -1;
    for (const tok of tokens) {
      const t = lcText.indexOf(tok);
      if (t >= 0) { hits += 1; if (firstIx < 0) firstIx = t; }
    }
    if (hits >= 2) {
      const score = 3 + hits;
      if (!best || score > best.score) best = { v, score, index: firstIx };
    }
  }
  if (!best || best.score < 4) return null;
  const confidence = Math.min(0.95, 0.4 + 0.05 * best.score);
  return {
    value: best.v.id,
    name: best.v.name,
    confidence,
    snippet: excerpt(text, best.index, best.v.name.length),
  };
}

// ── Building / Unit match ──────────────────────────────────────────────
export interface BuildingUnitMatch {
  building: OcrSuggestion<number> | null;
  unit: OcrSuggestion<string> | null;
}

export function suggestBuildingAndUnit(
  text: string,
  buildings: BuildingRef[],
  units: UnitRef[],
): BuildingUnitMatch {
  if (!text) return { building: null, unit: null };

  let buildingMatch: OcrSuggestion<number> | null = null;
  let unitMatch: OcrSuggestion<string> | null = null;

  // 1) Address match against units (most specific) — use street number + street.
  for (const u of units) {
    const addr = u.address?.trim();
    if (!addr) continue;
    const ix = text.toLowerCase().indexOf(addr.toLowerCase());
    if (ix >= 0) {
      const conf = 0.85;
      if (!unitMatch || conf > unitMatch.confidence) {
        unitMatch = { value: u.id, confidence: conf, snippet: excerpt(text, ix, addr.length) };
        buildingMatch = { value: u.building, confidence: conf, snippet: excerpt(text, ix, addr.length) };
      }
    }
  }

  // 2) "Bldg N" / "Building N" patterns
  if (!buildingMatch) {
    const bRe = /\b(?:bldg|building)\s*[#:.]?\s*(\d{1,3})\b/i;
    const m = text.match(bRe);
    if (m) {
      const num = Number(m[1]);
      if (buildings.some((b) => b.num === num)) {
        buildingMatch = { value: num, confidence: 0.7, snippet: excerpt(text, m.index ?? 0, m[0].length) };
      }
    }
  }

  // 3) "Unit N-NN" / "Unit 12B" / "Apt 12"
  if (!unitMatch) {
    const uRe = /\b(?:unit|apt|apartment|suite|ste)\s*[#:.]?\s*([A-Za-z0-9-]{1,8})\b/i;
    const m = text.match(uRe);
    if (m) {
      const code = m[1];
      // Match by trailing unit number
      const candidates = units.filter((u) => u.unit.toLowerCase() === code.toLowerCase());
      const winner = buildingMatch
        ? candidates.find((u) => u.building === buildingMatch!.value) ?? candidates[0]
        : candidates[0];
      if (winner) {
        const snip = excerpt(text, m.index ?? 0, m[0].length);
        unitMatch = { value: winner.id, confidence: 0.6, snippet: snip };
        if (!buildingMatch) {
          buildingMatch = { value: winner.building, confidence: 0.55, snippet: snip };
        }
      }
    }
  }

  // 4) Building street match (e.g. "1234 Quail Ridge" matches buildings.street).
  if (!buildingMatch) {
    for (const b of buildings) {
      const street = b.street?.trim();
      if (!street || street.length < 5) continue;
      const ix = text.toLowerCase().indexOf(street.toLowerCase());
      if (ix >= 0) {
        buildingMatch = { value: b.num, confidence: 0.55, snippet: excerpt(text, ix, street.length) };
        break;
      }
    }
  }

  return { building: buildingMatch, unit: unitMatch };
}

// ── Combined suggestions ───────────────────────────────────────────────
export interface RunSuggestionsArgs {
  text: string;
  vendors: VendorRef[];
  buildings: BuildingRef[];
  units: UnitRef[];
  today?: Date;
}

export function runSuggestions(args: RunSuggestionsArgs): OcrSuggestions {
  const { text, vendors, buildings, units, today } = args;
  const bu = suggestBuildingAndUnit(text, buildings, units);
  return {
    category: suggestCategory(text),
    documentDate: suggestDocumentDate(text, today),
    vendor: suggestVendor(text, vendors),
    building: bu.building,
    unit: bu.unit,
  };
}

// ── Internals ──────────────────────────────────────────────────────────
function excerpt(text: string, index: number, len: number): string {
  const pad = 30;
  const s = Math.max(0, index - pad);
  const e = Math.min(text.length, index + len + pad);
  return text.slice(s, e).replace(/\s+/g, " ").trim().slice(0, 160);
}
