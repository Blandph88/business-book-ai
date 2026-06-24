import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
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
export default defineConfig({
  // Relative base so the built bundle runs from ANY path, not just the server root.
  // This lets the app be delivered as a marketplace product and served from a subpath
  // like /products/heirloom-bd-crm/v1/ — asset URLs become relative to index.html.
  // (At the dev/root origin it behaves exactly as before.)
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
