// Persistence for the "ask your book" conversations, so a user can leave a chat and come back to it
// later from the Chats list and keep talking. Stored locally (the book's own data never leaves), like
// every other store here. One key holds the list; each chat is a title + its turns.

import type { ActionCardData } from "../components/ActionCard";
import type { ComputeResult } from "../ai/compute";
import { persistLocal, scopedKey } from "./persist";

// The persisted turn shape. A superset of the model-facing ChatTurn: it also carries an unconfirmed DRAFT
// action card (`action`) so a propose→confirm card survives the user leaving and returning to the thread
// (the card is fully serializable — no functions). Saved/undone cards collapse to a plain text line before
// persisting (their undo can't be restored), so only a live DRAFT is stored as an action turn.
export type StoredTurn = {
  role: "you" | "ai" | "action";
  text: string;
  chips?: { label: string; prompt: string }[];
  action?: ActionCardData;
  // A computed table, persisted so reloaded answers keep their CLICKABLE rows (Gate-0: persisted compute
  // answers used to degrade to a static markdown table on reload — ephemeral/persistent parity).
  compute?: ComputeResult;
  // A permanent action RECEIPT ("✓ Updated X — marked lost") — the audit-trail row a saved card collapses
  // to. Undo is deliberately NOT persisted (live-toast only — a live Undo in old history is a hazard).
  receipt?: boolean;
};

export type SavedChat = {
  id: string;
  title: string; // derived from the first question — what the list shows
  createdAt: number;
  updatedAt: number;
  turns: StoredTurn[];
};

// Scoped + disk-mirrored like the record stores — so chats are durable (survive a cleared browser /
// move with the book via owner_data.json), not stranded in fragile per-browser localStorage.
const KEY = scopedKey("bob.chats.v1");

export function newChatId(): string {
  return "chat_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function listChats(): SavedChat[] {
  try {
    const raw = localStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as SavedChat[]) : [];
    return Array.isArray(all) ? all.slice().sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

export function getChat(id: string): SavedChat | null {
  return listChats().find((c) => c.id === id) ?? null;
}

function writeAll(chats: SavedChat[]): void {
  try {
    persistLocal(KEY, JSON.stringify(chats)); // localStorage + mirror to the durable disk file
  } catch {
    /* best-effort */
  }
}

// Insert or update a chat (keyed by id).
export function saveChat(chat: SavedChat): void {
  const all = listChats().filter((c) => c.id !== chat.id);
  all.push(chat);
  writeAll(all);
}

export function deleteChat(id: string): void {
  writeAll(listChats().filter((c) => c.id !== id));
}

// Build a short list title from the first thing the user asked.
export function titleFromTurns(turns: readonly { role: string; text: string }[]): string {
  const first = turns.find((t) => t.role === "you")?.text?.trim() || "New chat";
  return first.length > 60 ? first.slice(0, 57) + "…" : first;
}
