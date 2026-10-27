// Enkel lokal server for docs/ (fetch av JSON virker ikke fra file://).  node scripts/serve.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../docs/", import.meta.url));
const PORT = +(process.argv[2] || 8080);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[\\/]+/, "");
  if (!path || path.endsWith("\\") || path.endsWith("/")) path += "index.html";
  if (path.startsWith("..")) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(ROOT + path);
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("Finnes ikke");
  }
}).listen(PORT, () => console.log(`Lyttestasjon: http://localhost:${PORT}`));
