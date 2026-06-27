// Read an uploaded document to text so the copilot can answer about it or use it as input to an action
// (e.g. a meeting transcript → capture-meeting). All client-side; the file never leaves the machine.
//
// IMPORTANT — the seal: a Freehold app runs with connect-src 'none' and no Workers, so it can't fetch a
// PDF.js CDN or spawn a worker to parse a PDF (and Freehold curation blocks any external URL anyway).
// So we read TEXT-based files directly (txt, md, csv, tsv, json, vtt, srt — covers transcripts/notes),
// and ask the user to paste/convert a PDF. (Bundled, worker-less PDF parsing is a future option.)

export type LoadedDoc = { name: string; text: string };

const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "log", "vtt", "srt", "rtf", "text"]);

export async function readDoc(file: File): Promise<LoadedDoc> {
  const name = file.name;
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf" || file.type === "application/pdf") {
    throw new Error("PDFs can't be read inside the sealed app yet — copy the text out, or save it as a .txt and attach that.");
  }
  const looksText = TEXT_EXT.has(ext) || file.type.startsWith("text/") || file.type === "application/json" || file.type === "";
  if (!looksText) {
    throw new Error(`Can't read “.${ext}” here — attach a text file (.txt, .md, .csv) or paste the text.`);
  }
  const text = await file.text();
  if (!text.trim()) throw new Error("That file looks empty.");
  return { name, text };
}
