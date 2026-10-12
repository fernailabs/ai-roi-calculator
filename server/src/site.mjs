// Serves the calculator page itself, for the local dev server and for the
// private preview on Cloud Run (PREVIEW=1). In production the page is hosted
// on GitHub Pages / fernai.co.uk and this isn't used.

import { readFile } from "node:fs/promises";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

// The page and the API share an origin here, so the assistant URL is ".":
// the page then calls ./api/estimate on whatever address it was opened at
// (localhost, a Cloud Shell Web Preview, or a Cloud Run proxy).
export function createSiteHandler(root) {
  const serverDir = path.join(root, "server");
  return async function serveSite(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const { pathname } = new URL(req.url, "http://x");
    let rel;
    try {
      rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    const file = path.resolve(root, rel);
    const ext = path.extname(file);
    // Only the site's own file types, inside the site root and not under server/.
    if (!file.startsWith(root + path.sep) || file.startsWith(serverDir + path.sep) || !TYPES[ext]) {
      res.writeHead(404).end();
      return;
    }
    try {
      let body = await readFile(file);
      if (rel === "index.html") {
        body = body
          .toString("utf8")
          .replace(/<meta name="fernai-assistant-url" content="[^"]*">/, '<meta name="fernai-assistant-url" content=".">');
      }
      res.writeHead(200, { "content-type": TYPES[ext], "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404).end();
    }
  };
}

// API paths go to the assistant; everything else is the site.
export function withSite(apiHandler, root) {
  const site = createSiteHandler(root);
  return (req, res) => {
    const { pathname } = new URL(req.url, "http://x");
    if (pathname.startsWith("/api/")) return apiHandler(req, res);
    return site(req, res);
  };
}
