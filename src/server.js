import { createServer } from "node:http";
import path from "node:path";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { watch } from "chokidar";
import { buildBook } from "./build.js";
import { inside, normalizeBase } from "./manifest.js";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export async function serveBook(input = ".", options = {}) {
  const temporary = await realpath(
    await mkdtemp(path.join(tmpdir(), "markdown-book-preview-")),
  );
  const outDir = path.join(temporary, "site");
  const base = normalizeBase(options.base ?? "/");
  let result;
  try {
    result = await buildBook(input, { base, outDir, liveReload: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  const root = (await import("./manifest.js")).loadBook;
  const bookRoot = (await root(input)).root;
  const clients = new Set();
  let stopped = false;
  let running = false;
  let pending = false;
  let timer;
  let activeBuild = Promise.resolve();
  const publish = (event, data) => {
    for (const client of clients)
      client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? "";
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
        response.writeHead(403).end("Loopback host required");
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      const url = new URL(request.url, `http://${host}`);
      if (!url.pathname.startsWith(base)) {
        response.writeHead(404).end();
        return;
      }
      if (url.pathname === `${base}__markdown_book/events`) {
        if (request.method === "HEAD") {
          response.writeHead(200).end();
          return;
        }
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        response.write(": connected\n\n");
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
      }
      const relative = decodeURIComponent(url.pathname.slice(base.length));
      let filename = path.resolve(outDir, relative || "index.html");
      if (!inside(outDir, filename)) {
        response.writeHead(403).end();
        return;
      }
      if ((await stat(filename)).isDirectory()) {
        if (!url.pathname.endsWith("/")) {
          response
            .writeHead(308, { location: `${url.pathname}/${url.search}` })
            .end();
          return;
        }
        filename = path.join(filename, "index.html");
      }
      if (!inside(outDir, await realpath(filename))) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(filename);
      response.writeHead(200, {
        "content-type":
          types[path.extname(filename)] ?? "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-length": body.length,
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 400).end("Not found");
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }

  const rebuild = async () => {
    if (running || stopped) {
      pending = true;
      return;
    }
    running = true;
    do {
      pending = false;
      try {
        result = await buildBook(input, { base, outDir, liveReload: true });
        if (!stopped) {
          publish("reload", { digest: result.digest });
          options.onUpdate?.(result);
        }
      } catch (error) {
        if (!stopped) {
          publish("build-error", { message: error.message });
          options.onError?.(error);
        }
      }
    } while (pending && !stopped);
    running = false;
  };
  const watcher =
    options.watch === false
      ? null
      : watch(bookRoot, {
          ignoreInitial: true,
          ignored: (filename) =>
            filename
              .split(path.sep)
              .some(
                (part) =>
                  ["node_modules", ".git", "dist"].includes(part) ||
                  part.startsWith(".markdown-book-build-"),
              ),
          awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
        });
  watcher?.on("all", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      activeBuild = rebuild();
    }, 120);
  });
  watcher?.on("error", (error) => options.onError?.(error));
  const address = server.address();
  let closing;
  return {
    url: `http://127.0.0.1:${address.port}${base}`,
    get result() {
      return result;
    },
    close() {
      return (closing ??= (async () => {
        stopped = true;
        clearTimeout(timer);
        await watcher?.close();
        for (const client of clients) client.end();
        clients.clear();
        await activeBuild;
        await new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        });
        await rm(temporary, { recursive: true, force: true });
      })());
    },
  };
}
