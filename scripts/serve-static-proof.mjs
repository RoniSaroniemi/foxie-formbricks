import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const portArgIndex = process.argv.indexOf("--port");
const port = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 4174;
const rootDir = process.cwd();

const contentTypes = {
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer((req, res) => {
  const requestPath = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`).pathname;
  const normalizedPath = normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  let filePath = resolve(join(rootDir, normalizedPath === "/" ? "poc/repeating-group/proof.html" : normalizedPath));

  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.setHeader("Content-Type", contentTypes[extname(filePath)] ?? "application/octet-stream");
  createReadStream(filePath).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`repeating-group proof server listening on http://127.0.0.1:${port}`);
});
