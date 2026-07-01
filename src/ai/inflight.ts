// Tracks in-flight answer generations by chat id, OUTSIDE any component, so a generation keeps running
// (and its answer still lands in storage) even when the user navigates to another chat and the chat view
// unmounts. A returning view subscribes to know (a) whether to show a "thinking" state for the chat it's
// showing, and (b) when a generation has finished so it can reload the freshly-persisted answer.
//
// The async work itself isn't cancelled by unmount — JavaScript keeps the promise running — so the only
// job here is to let whichever view is mounted reflect that work and pick up the result.
type Listener = () => void;

const busy = new Set<string>();
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

export function markBusy(id: string): void { busy.add(id); emit(); }
export function markDone(id: string): void { busy.delete(id); emit(); }
export function isBusy(id: string | null | undefined): boolean { return !!id && busy.has(id); }
export function subscribeInflight(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
