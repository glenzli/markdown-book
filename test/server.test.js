import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { serveBook } from "../src/server.js";
import { fixture, waitFor } from "./fixtures.js";

test("preview serves the same static reader and refreshes only after successful source rebuilds", async (t) => {
  const book = await fixture();
  const errors = [];
  const preview = await serveBook(book.root, {
    base: "/preview/",
    onError: (error) => errors.push(error.message),
  });
  t.after(async () => {
    await preview.close();
    await rm(book.root, { recursive: true, force: true });
  });
  const response = await fetch(`${preview.url}first/`);
  assert.equal(response.status, 200);
  const first = await response.text();
  assert.match(first, /"liveReload":true/);
  assert.match(first, /data-mb-component="sample"/);
  const javascript = first.match(/<script type="module" src="([^"]+)"/)[1];
  const script = await fetch(new URL(javascript, preview.url));
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);
  const chapters = path.join(book.root, "second.md");
  await writeFile(chapters, "# 第二章\n\n## 第二节\n\nLive update proof.");
  await waitFor(async () =>
    (await (await fetch(`${preview.url}second/`)).text()).includes(
      "Live update proof.",
    ),
  );
  const manifestPath = path.join(book.root, "book.json");
  const manifest = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, "{ invalid");
  await waitFor(() => errors.length > 0);
  assert.match(
    await (await fetch(`${preview.url}second/`)).text(),
    /Live update proof/,
  );
  await writeFile(manifestPath, manifest);
  await writeFile(chapters, "# 第二章\n\n## 第二节\n\nRecovered.");
  await waitFor(async () =>
    (await (await fetch(`${preview.url}second/`)).text()).includes(
      "Recovered.",
    ),
  );
  assert.equal((await fetch(preview.url, { method: "POST" })).status, 405);
  assert.equal((await fetch(new URL("/book.json", preview.url))).status, 404);
  await preview.close();
});
