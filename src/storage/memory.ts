// The AI's durable MEMORY of the book — short, standalone facts distilled from past chats (decisions,
// priorities, preferences, key relationship facts), NOT raw transcripts. Injected into the grounding so
// the assistant "remembers" across conversations. Stored like every other owner store: scoped +
// disk-mirrored (owner_data.json), so it's durable and travels with the book — not fragile localStorage.
import { persistLocal, scopedKey } from "./persist";

// `model`/`tier` record WHICH model distilled a note (provenance). This lets a later, more capable pass
// re-verify facts a weaker model wrote — and, once model routing is dynamic, stops a cheap model's guess
// becoming indistinguishable canonical memory that a stronger model then inherits. Optional/back-compat:
// notes written before provenance existed simply lack these fields.
export type Note = { id: string; text: string; createdAt: number; source?: string; model?: string; tier?: string };

const KEY = scopedKey("bob.memory.v1");
const MAX_NOTES = 200; // keep the most recent; memory is curated, not a transcript dump

function noteId(): string {
  return "note_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function listNotes(): Note[] {
  try {
    const raw = localStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as Note[]) : [];
    return Array.isArray(all) ? all.slice().sort((a, b) => b.createdAt - a.createdAt) : [];
  } catch {
    return [];
  }
}

function writeAll(notes: Note[]): void {
  try { persistLocal(KEY, JSON.stringify(notes.slice(0, MAX_NOTES))); } catch { /* best-effort */ }
}

// Add distilled facts, skipping near-duplicates of what we already remember. `meta` records the model/tier
// that produced them (provenance). Returns the notes actually added.
export function addNotes(texts: string[], source = "chat", meta?: { model?: string; tier?: string }): Note[] {
  const existing = listNotes();
  const seen = new Set(existing.map((n) => norm(n.text)));
  const added: Note[] = [];
  let t = Date.now();
  for (const raw of texts) {
    const text = (raw || "").trim();
    const key = norm(text);
    if (!text || key.length < 4 || seen.has(key)) continue;
    seen.add(key);
    added.push({ id: noteId(), text, createdAt: t++, source, model: meta?.model, tier: meta?.tier });
  }
  if (added.length) writeAll([...added, ...existing]);
  return added;
}

export function deleteNote(id: string): void { writeAll(listNotes().filter((n) => n.id !== id)); }
export function clearNotes(): void { writeAll([]); }

// The notes most relevant to a message (keyword overlap), newest as the tiebreak. When the store is small
// we just return everything (cheap to include all). Used to inject ambient memory into the grounding.
export function relevantNotes(query: string, limit = 8): Note[] {
  const all = listNotes();
  if (all.length <= limit) return all;
  const q = new Set(norm(query).split(" ").filter((w) => w.length > 3));
  return all
    .map((n) => ({ n, score: norm(n.text).split(" ").filter((w) => q.has(w)).length }))
    .sort((a, b) => b.score - a.score || b.n.createdAt - a.n.createdAt)
    .filter((x) => x.score > 0)
    .slice(0, limit)
    .map((x) => x.n);
}
