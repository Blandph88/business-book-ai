// Shown when there's no working on-device AI model yet (the broker is on the stub). A graceful setup
// ladder instead of silent failure / placeholder gibberish:
//   1) WebGPU present  → offer the private WebLLM download (primary).
//   2) Chrome built-in (Nano) present → it's used automatically; else show how to enable it.
//   3) Neither → tell them to use desktop Chrome/Edge.
// On-device only for now; a hosted default can sit in front of this later (see memory).
import { useState } from "react";
import { aiCapabilities, startOnDeviceSetup } from "../ai/ai";
import { BusinessBookLogo } from "./Brand";
import "./AiSetupCard.css";

export function AiSetupCard({ onReady }: { onReady: () => void }) {
  const caps = aiCapabilities();
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);

  const setup = async () => {
    setBusy(true);
    setDeclined(false);
    try {
      await startOnDeviceSetup(); // resolves when the model is ready
      onReady();
    } catch {
      setDeclined(true); // they cancelled the download (or it failed) — show the fallbacks
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aisetup">
      <BusinessBookLogo size={42} />
      <h3 className="aisetup-title">Turn on your AI assistant</h3>

      {caps.webgpu ? (
        <>
          <p className="aisetup-lede">It runs <strong>privately on your device</strong> — nothing you type leaves your computer. One-time ~1.9 GB download, then it's instant and works offline.</p>
          <button type="button" className="aisetup-btn" onClick={setup} disabled={busy}>
            {busy ? "Setting up…" : "Set up the private assistant"}
          </button>
          {declined && <p className="aisetup-note">No problem. You can set it up any time — or use Chrome's built-in AI instead (below).</p>}
          <p className="aisetup-alt">
            {caps.builtin
              ? "Chrome's built-in AI is available and will be used automatically if you skip the download."
              : <>Prefer Chrome's built-in AI? Enable <code>chrome://flags/#prompt-api-for-gemini-nano</code>, restart Chrome, then reload. (Chrome downloads a model too.)</>}
          </p>
        </>
      ) : caps.builtin ? (
        <p className="aisetup-lede">Chrome's built-in AI is available — it'll be used automatically. Ask away.</p>
      ) : (
        <p className="aisetup-lede">
          This browser can't run on-device AI. Open Business Book in <strong>desktop Chrome or Edge</strong> to use the assistant, or enable Chrome's built-in AI at <code>chrome://flags/#prompt-api-for-gemini-nano</code>.
        </p>
      )}
    </div>
  );
}
