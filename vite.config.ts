import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";
// NOTE: the personal app's dev-only file-persistence plugin (owner-data-plugin) was REMOVED from
// this marketplace fork — in the product, owned data lives in the buyer's own file via the seal's
// data adapter, not a dev-server file. (It also caused stale demo data to reload across boots.)

// Minimal Vite setup: React plugin + a FIXED dev-server port so the URL is
// predictable. Everything runs locally; no proxies or external services.
//
// strictPort is critical: the owner's hand-entered data (notes, priorities,
// meetings, …) lives in the browser's localStorage, which is scoped to the exact
// origin — http://localhost:5173. Without strictPort, if 5173 is already in use
// Vite silently starts on 5174 instead — a DIFFERENT origin with an EMPTY store, so
// all that data appears blank. We'd rather it fail loudly ("port in use") and make
// you reuse the one true server than fork your data across two origins.
// Seal-transport safety: a minifier can emit a RAW U+0000 (NUL) byte inside a regex/string
// literal — e.g. papaparse ships /[^\u0000-ɏ]/ and esbuild's default (utf8) charset keeps
// the NUL raw. When Freehold seals an UPLOADED bundle it stores the files in Postgres (text/JSON
// columns, which CANNOT hold U+0000), so the NUL is replaced with U+FFFD — corrupting the literal
// (`/[^�-ɏ]/` → "range out of order") and making the whole inlined <script> unparseable,
// which blanks the sealed app. It runs fine unsealed because the dev/static server serves the raw
// .js and never round-trips through Postgres. Escaping the NUL to the 6-char sequence \u0000 is
// byte-safe (pure ASCII) and semantically identical in every JS context it can appear in.
function escapeNulForSealTransport() {
  return {
    name: "escape-nul-for-seal-transport",
    renderChunk(code: string) {
      return code.includes("\u0000") ? { code: code.replace(/\u0000/g, "\\u0000"), map: null } : null;
    },
  };
}

export default defineConfig({
  // Relative base so the built bundle runs from ANY path, not just the server root.
  // This lets the app be delivered as a marketplace product and served from a subpath
  // like /products/heirloom-bd-crm/v1/ — asset URLs become relative to index.html.
  // (At the dev/root origin it behaves exactly as before.)
  base: "./",
  // Exposed to the app for the bug-report / diagnostics footer (a real identifier in flagged answers).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), escapeNulForSealTransport()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
