// WebLLM inference host — runs in a Web Worker so all the WebGPU / decode work happens OFF the main thread.
// Without this, in-browser inference starves the UI (typing + the whole machine stall during a bulk pass).
// The engine on the main thread talks to this handler via postMessage (CreateWebWorkerMLCEngine).
//
// We load WebLLM by DYNAMIC import from the CDN (same source the dev broker uses), so messages that arrive
// before the handler is ready are queued and replayed once it initialises.

let handler: { onmessage: (e: MessageEvent) => void } | null = null;
const queue: MessageEvent[] = [];

self.onmessage = (e: MessageEvent) => {
  if (handler) handler.onmessage(e);
  else queue.push(e);
};

const WEBLLM_CDN = "https://esm.run/@mlc-ai/web-llm"; // via a const so TS treats the import as dynamic (not a resolvable literal)

(async () => {
  const webllm = (await import(/* @vite-ignore */ WEBLLM_CDN)) as {
    WebWorkerMLCEngineHandler: new () => { onmessage: (e: MessageEvent) => void };
  };
  handler = new webllm.WebWorkerMLCEngineHandler();
  for (const e of queue) handler.onmessage(e);
  queue.length = 0;
})();
