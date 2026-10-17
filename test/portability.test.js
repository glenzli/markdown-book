import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { checkBook } from "../src/build.js";
import { fixture } from "./fixtures.js";

test("moving a book preserves its input digest; component imports stay within its boundary", async (t) => {
  const book = await fixture();
  const destination = await mkdtemp(
    path.join(tmpdir(), "markdown-book-relocated-"),
  );
  t.after(async () => {
    await rm(book.root, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
  });
  await cp(book.root, destination, { recursive: true });
  const original = await checkBook(book.root, { base: "/library/" });
  const moved = await checkBook(destination, { base: "/library/" });
  assert.equal(moved.digest, original.digest);
  const outside = path.join(
    path.dirname(destination),
    path.basename(destination) + "-outside.js",
  );
  t.after(() => rm(outside, { force: true }));
  await writeFile(outside, "export const x = 1;");
  await writeFile(
    path.join(destination, "components/sample.js"),
    `import {x} from ${JSON.stringify(outside)}; export function mount({element}) { element.textContent=String(x); }`,
  );
  await assert.rejects(checkBook(destination), /Component import leaves/);
});
