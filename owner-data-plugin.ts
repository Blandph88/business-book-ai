// Dev-server endpoint that persists the owner's hand-entered data to a real file on
// disk, so it survives anything that can wipe browser localStorage (clearing browser
// data, switching browser/machine, an origin change). Pairs with the client mirror in
// src/storage/persist.ts.
//
//   GET  /api/owner-data  → returns the JSON file (or {} if it doesn't exist yet)
//   POST /api/owner-data  → overwrites the file with the posted JSON (atomically)
//
// The file lives at <repo>/data/owner_data.json — alongside the pipeline outputs, and
// gitignored (it contains personal notes/PII). This middleware only runs under
// `vite` (dev); a production build has no server, and the client degrades to
// localStorage-only in that case.

import type { Plugin } from "vite";
import { promises as fs } from "fs";
import path from "path";

export function ownerDataPersistence(): Plugin {
  return {
    name: "owner-data-persistence",
    configureServer(server) {
      // Vite's root is the web/ dir; the file sits one level up, in the repo's data/.
      const file = path.resolve(server.config.root, "../data/owner_data.json");

      server.middlewares.use("/api/owner-data", (req, res, next) => {
        if (req.method === "GET") {
          fs.readFile(file, "utf8")
            .then((text) => {
              res.setHeader("Content-Type", "application/json");
              res.end(text);
            })
            .catch(() => {
              // No file yet → empty object, so the client knows there's nothing to restore.
              res.setHeader("Content-Type", "application/json");
              res.end("{}");
            });
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", async () => {
            try {
              JSON.parse(body); // validate before touching disk — never write garbage
              await fs.mkdir(path.dirname(file), { recursive: true });
              // Atomic write: a crash mid-write can't corrupt the real file.
              const tmp = `${file}.tmp`;
              await fs.writeFile(tmp, body, "utf8");
              await fs.rename(tmp, file);
              res.statusCode = 204;
              res.end();
            } catch (err) {
              res.statusCode = 400;
              res.end(`Invalid owner-data payload: ${String(err)}`);
            }
          });
          return;
        }

        next();
      });
    },
  };
}
