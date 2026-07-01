// Shared SECTOR / FUNCTION keyword maps — the bridge from how a user TALKS about an industry or job-family
// ("in banking", "finance leadership roles") to the canonical value stored on a contact (sector_group /
// function). Lives in its own module so BOTH the deterministic router (compute.ts) and the model grounding
// (grounding.ts) use the SAME mapping — otherwise the two drift and a query routes one way but grounds another.
//
// Sector words are checked first (a clear industry), then function words. A match returns the canonical
// sector_group / function string; matchSector("banking") → "Financial Services".
export const SECTOR_KEYWORDS: [RegExp, string][] = [
  [/\b(bank|banking|banks|financial services|finance industry|capital markets|asset management|insurance|insurer|fintech)\b/, "Financial Services"],
  [/\b(pharma|pharmaceutical|healthcare|health care|life sciences|biotech|medical)\b/, "Healthcare & Pharma"],
  [/\b(tech sector|technology sector|software|saas|big tech)\b/, "Technology"],
  [/\b(energy|oil|gas|utilities|industrials?|manufacturing)\b/, "Energy & Industrial"],
  [/\b(retail|consumer goods|fmcg|cpg)\b/, "Consumer & Retail"],
  [/\b(public sector|government|civil service|defen[cs]e|ministry|federal)\b/, "Public Sector"],
  [/\b(consulting|professional services|advisory firm|law firm|legal sector|accountanc)\b/, "Professional Services"],
  [/\b(real estate|property sector|reit)\b/, "Real Estate"],
];
export const FUNCTION_KEYWORDS: [RegExp, string][] = [
  [/\b(risk|compliance|audit|actuar)\b/, "Risk, Audit & Actuarial"],
  [/\b(strategy|corporate development|m&a)\b/, "Strategy & Corporate Development"],
  [/\b(marketing|sales|commercial)\b/, "Sales & Marketing"],
  [/\b(operations|supply chain|procurement)\b/, "Operations & Supply Chain"],
  [/\b(hr|human resources|talent|people team)\b/, "Human Resources"],
  [/\b(data|analytics)\b/, "Data & Analytics"],
  [/\b(product manager|product team|design)\b/, "Product & Design"],
  [/\b(engineering|software engineer|developer)\b/, "Technology & Engineering"],
  [/\b(finance|accounting|cfo|treasur|fp&a)\b/, "Finance & Accounting"],
];

export function matchSector(q: string): string {
  for (const [re, sec] of SECTOR_KEYWORDS) if (re.test(q)) return sec;
  return "";
}
export function matchFunction(q: string): string {
  for (const [re, fn] of FUNCTION_KEYWORDS) if (re.test(q)) return fn;
  return "";
}
