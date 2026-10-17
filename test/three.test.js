import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { checkBook } from "../src/build.js";
import { ReaderGateway } from "../src/reader-gateway.js";
import { fixture } from "./fixtures.js";

test("a book uses the tool-owned Three.js without local dependencies; native pages only receive their own components", async (t) => {
  const book = await fixture();
  const gateway = new ReaderGateway({
    stateFilePath: `${book.root}.recent.json`,
  });
  t.after(async () => {
    await gateway.close();
    await rm(`${book.root}.recent.json`, { force: true });
    await rm(book.root, { recursive: true, force: true });
  });
  await writeFile(
    path.join(book.root, "components/sample.js"),
    'import { REVISION, Scene } from "@glenzli/markdown-book/three"; export function mount({element}) { const scene = new Scene(); element.textContent = "three-runtime-marker-" + REVISION + scene.type; }',
  );
  const checked = await checkBook(book.root);
  const entry = checked.outputFiles.find(
    (file) => path.basename(file.path) === checked.javascript,
  ).text;
  assert.ok(
    !entry.includes("three-runtime-marker-"),
    "The ordinary entry must keep the 3D component lazy",
  );
  assert.ok(
    checked.outputFiles.some((file) =>
      file.text.includes("three-runtime-marker-"),
    ),
  );
  const key = "f".repeat(32);
  await gateway.view(key, book.root);
  const interactive = await gateway.page(key, "first");
  const plain = await gateway.page(key, "second");
  assert.ok(interactive.javascript.includes("three-runtime-marker-"));
  assert.ok(!plain.javascript.includes("three-runtime-marker-"));
  assert.ok(plain.javascript.length < interactive.javascript.length);
});
