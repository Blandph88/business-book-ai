// The router. The regex dictionary (intents.ts) is a fast, cheap PRIOR that handles the clear cases;
// only when it's UNSURE *and* the message smells like an action it might have missed do we spend one
// model call to decide. Plain questions never trigger a model call (they just get answered), so this
// stays snappy on small models while catching the action phrasings the regex doesn't.

import { routeIntent, isActionIntent, type RoutedIntent, type Entity } from "./intents";
import { classifyIntentPrompt, type IntentResult } from "./prompts";
import { aiJson } from "./ai";

const ACTION_HINT = /\b(met|meeting|call(?:ed)?|spoke|spoken|email(?:ed)?|caught up|coffee|lunch|dinner|sync|log(?:ged)?|add(?:ed)?|creat(?:e|ed)|updat(?:e|ed)|set|mark(?:ed)?|sign(?:ed)?|follow[- ]?up|draft|note|reminder|remind)\b/i;

export async function decide(text: string, opts: { hasDoc?: boolean } = {}): Promise<RoutedIntent> {
  const prior = routeIntent(text, opts);
  if (isActionIntent(prior)) return prior; // regex already found an action
  if (prior.confidence !== "low") return prior; // confident query / search / web / workflow / draft …
  if (!ACTION_HINT.test(text)) return prior; // a plain question — no model call, just answer it

  // Ambiguous AND action-ish: one cheap JSON decision call to catch a missed action.
  try {
    const c = await aiJson<IntentResult>(classifyIntentPrompt(text));
    if ((c?.kind === "create" || c?.kind === "update") && c.entity) {
      return { kind: c.kind, entity: c.entity as Entity, op: c.kind, target: c.target ?? text, confidence: "medium", source: "model" };
    }
    if (c?.kind) return { ...prior, kind: c.kind, target: c.target ?? prior.target, source: "model" };
  } catch {
    /* model unavailable / unparseable → keep the regex prior */
  }
  return prior;
}
