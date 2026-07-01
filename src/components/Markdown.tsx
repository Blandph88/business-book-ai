// Minimal, dependency-free Markdown renderer for assistant messages. The model writes Markdown
// (**bold**, bullet lists, and — when asked — GFM tables); rendered as plain text those show literal
// "**" and "*" instead of formatting. This handles the constructs the model actually produces: GFM pipe
// tables, bullet/numbered lists, bold, headings and paragraphs. Bundle-safe under the seal (no external
// library, no CDN). We only ever emit React elements (never dangerouslySetInnerHTML), so there is no
// HTML-injection surface even though the text comes from a model.
import React from "react";
import "./Markdown.css";

// Inline formatting: **bold** / __bold__ → <strong>; everything else is literal text.
function inline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(<strong key={keyBase + "b" + i++}>{m[1] ?? m[2]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}
const isTableSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
const isBullet = (line: string) => /^\s*[*\-+]\s+/.test(line);
const isNumbered = (line: string) => /^\s*\d+[.)]\s+/.test(line);
const isHeading = (line: string) => /^#{1,6}\s+/.test(line);
const isTableStart = (lines: string[], i: number) => lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]);

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Fenced code block ``` … ``` — models often wrap a whitespace-aligned "table" in one. Render as a
    // contained, scrollable monospace block (so the backticks don't leak and a long block doesn't run on).
    if (/^\s*```/.test(line)) {
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < lines.length) i++; // consume the closing fence
      // Drop leading/trailing blank lines inside the fence for a tighter block.
      while (buf.length && !buf[0].trim()) buf.shift();
      while (buf.length && !buf[buf.length - 1].trim()) buf.pop();
      blocks.push(<div className="md-prewrap" key={"c" + key++}><pre className="md-pre">{buf.join("\n")}</pre></div>);
      continue;
    }

    // GFM table: a header row immediately followed by a |---|---| separator.
    if (isTableStart(lines, i)) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) { rows.push(splitRow(lines[i])); i++; }
      // Drop columns that are empty in every body row (e.g. a "Contact" column the model left blank) —
      // keep all columns only when there are no rows to judge by, and never drop everything.
      let cols = header.map((_, c) => c);
      if (rows.length) {
        const kept = cols.filter((c) => rows.some((r) => (r[c] ?? "").trim() !== ""));
        if (kept.length) cols = kept;
      }
      blocks.push(
        <div className="md-tablewrap" key={"t" + key++}>
          <table className="md-table">
            <thead><tr>{cols.map((c) => <th key={c}>{inline(header[c] ?? "", "th" + c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{cols.map((c) => <td key={c}>{inline(r[c] ?? "", "td" + ri + c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Bullet list.
    if (isBullet(line)) {
      const items: string[] = [];
      while (i < lines.length && isBullet(lines[i])) { items.push(lines[i].replace(/^\s*[*\-+]\s+/, "")); i++; }
      blocks.push(<ul className="md-list" key={"u" + key++}>{items.map((it, ii) => <li key={ii}>{inline(it, "li" + key + ii)}</li>)}</ul>);
      continue;
    }

    // Numbered list.
    if (isNumbered(line)) {
      const items: string[] = [];
      while (i < lines.length && isNumbered(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, "")); i++; }
      blocks.push(<ol className="md-list" key={"o" + key++}>{items.map((it, ii) => <li key={ii}>{inline(it, "ol" + key + ii)}</li>)}</ol>);
      continue;
    }

    // Heading → a bold line (no oversized type inside a chat bubble).
    const hm = /^#{1,6}\s+(.*)$/.exec(line);
    if (hm) { blocks.push(<p className="md-h" key={"h" + key++}>{inline(hm[1], "h" + key)}</p>); i++; continue; }

    // Paragraph: gather consecutive plain lines.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBullet(lines[i]) && !isNumbered(lines[i]) && !isHeading(lines[i]) && !isTableStart(lines, i)) { para.push(lines[i]); i++; }
    blocks.push(
      <p className="md-p" key={"p" + key++}>
        {para.flatMap((p, pi) => [...inline(p, "p" + key + pi), pi < para.length - 1 ? <br key={"br" + pi} /> : null])}
      </p>,
    );
  }
  return <>{blocks}</>;
}
