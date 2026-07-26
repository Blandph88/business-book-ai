// NARRATION TRUST BOUNDARY (Batch 2). The interpret layer's prompt BEGS the model not to restate or
// invent figures — the retest proved begging fails on a 14B: five narrations restated numbers wrongly
// (an invented "six deals", a fabricated trend, misattributed rows). This is the mechanical check the
// prompt can't be: every numeric claim in a narration must exist in the computed evidence it narrates,
// or its sentence is dropped. If the narration loses its substance, the caller delivers the table alone.

// Word-numbers the model likes to reach for ("Six of your deals…").
const WORD_NUMS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, dozen: 12, twenty: 20,
};

// Normalise a numeric token to a canonical string: strip currency + commas, expand k/m suffixes,
// keep percentages distinct ("58%" ≠ "58").
function canon(raw: string): string[] {
  const out: string[] = [];
  const pct = /%$/.test(raw);
  const cleaned = raw.replace(/[£$€,%]/g, "").replace(/,/g, "").toLowerCase();
  const m = cleaned.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return out;
  let n = Number(m[1]);
  if (m[2] === "k") n *= 1000;
  if (m[2] === "m") n *= 1_000_000;
  if (pct) { out.push(`${n}%`); return out; }
  out.push(String(n));
  // A £800k claim should match evidence that says "800000" AND evidence that says "£800k" — emit both scales.
  if (n >= 1000 && Number.isInteger(n / 1000)) out.push(String(n / 1000));
  if (n < 1000) out.push(String(n * 1000), String(n * 1_000_000));
  return out;
}

// All numeric claims in a piece of text, canonicalised.
export function numericClaims(text: string): string[] {
  const claims: string[] = [];
  for (const m of text.matchAll(/[£$€]?\d[\d,]*(?:\.\d+)?\s*[km]?%?/gi)) {
    const tok = m[0].trim().replace(/\s+/g, "");
    claims.push(...canon(tok));
  }
  for (const m of text.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|twenty)\b/gi)) {
    claims.push(String(WORD_NUMS[m[1].toLowerCase()]));
  }
  return claims;
}

// Evidence numbers as a set (both scales), from the computed table markdown + intro.
function evidenceSet(evidence: string): Set<string> {
  return new Set(numericClaims(evidence));
}

export type NarrationVerdict = { ok: boolean; cleaned: string; dropped: string[] };

// Parse a markdown evidence table into row cells (loose — any |-delimited line).
function evidenceRows(evidence: string): string[][] {
  return evidence.split("\n").filter((l) => l.trim().startsWith("|"))
    .map((l) => l.split("|").map((c) => c.trim()).filter(Boolean));
}

const SENTIMENTS = ["very positive", "positive", "neutral", "cautious", "negative"];

// ATTRIBUTE-PAIRING check (re-verify addition): a sentence that pairs an entity from the table with a
// SENTIMENT value must match a real row — "General Electric… multiple neutral sentiments" when GE's
// rows are Positive/Very Positive is the recurring garble the numeric check can't see.
function sentimentPairingViolation(sentence: string, rows: string[][]): boolean {
  const sl = sentence.toLowerCase();
  const mentioned = SENTIMENTS.filter((x) => sl.includes(x));
  if (!mentioned.length) return false;
  // "very positive" implies "positive" appears as a substring — keep only the most specific claims.
  const claims = mentioned.filter((x) => !(x === "positive" && sl.includes("very positive") && !/[^y] positive/.test(sl)));
  // Entities = table cells that look like names/companies (non-numeric, length ≥ 4) present in the sentence.
  const entities = new Set<string>();
  for (const r of rows) for (const cell of r) {
    // Sentiment values and date-ish cells are attributes, not entities.
    if (SENTIMENTS.includes(cell.toLowerCase())) continue;
    if (cell.length >= 4 && !/\d/.test(cell) && sl.includes(cell.toLowerCase())) entities.add(cell);
  }
  if (!entities.size) return false; // no table entity named → nothing to validate against
  for (const ent of entities) {
    const entRows = rows.filter((r) => r.some((c) => c === ent));
    if (!entRows.length) continue;
    const entSentiments = new Set(entRows.flatMap((r) => r.map((c) => c.toLowerCase())).filter((c) => SENTIMENTS.includes(c)));
    // AT-LEAST-ONE rule: a multi-entity sentence pairs different sentiments with different entities
    // ("Hannah was Very Positive, Camille read Cautious") — an entity is only a violation when NONE of
    // the sentence's claimed sentiments appear in its rows.
    if (claims.length && !claims.some((claim) => entSentiments.has(claim))) return true;
  }
  return false;
}

// Sentence-level check: a sentence whose numeric claims aren't all present in the evidence is dropped.
// Dates (2026-07-18 / "July 18") and years are exempt — they're framing, not figures, and the formats
// rarely match textually. Small counts 1–3 are exempt when the evidence's ROW COUNT covers them ("both",
// "the two deals" style references to visible rows).
export function checkNarration(narration: string, evidence: string): NarrationVerdict {
  const ev = evidenceSet(evidence);
  const rowsParsed = evidenceRows(evidence);
  const rowCount = rowsParsed.length; // visible entities
  const sentences = narration.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const sent of sentences) {
    // Strip date-like tokens before extracting claims so "July 18, 2026" doesn't count as figures.
    const noDates = sent
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
      .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi, " ")
      .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi, " ")
      .replace(/\b(?:19|20)\d{2}\b/g, " ");
    if (sentimentPairingViolation(sent, rowsParsed)) { dropped.push(sent); continue; }
    const claims = numericClaims(noDates);
    const bad = claims.filter((c) => {
      if (ev.has(c)) return false;
      const n = Number(c.replace("%", ""));
      if (!Number.isNaN(n) && n <= 3 && n <= rowCount) return false; // "both/the two" over visible rows
      return true;
    });
    if (bad.length) dropped.push(sent);
    else kept.push(sent);
  }
  const cleaned = kept.join(" ").trim();
  // Substance test: if the check gutted the narration, the table should stand alone.
  const ok = cleaned.length >= 40 && dropped.length <= sentences.length / 2;
  return { ok, cleaned, dropped };
}

// Disambiguation results carry nothing to interpret — narration over them only injects noise (the
// retest's which-Rachel commentary misattributed rows and lobbied for an arbitrary pick).
export function isDisambiguation(intro: string): boolean {
  return /which one did you mean/i.test(intro);
}
