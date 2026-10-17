import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { ReaderLibrary } from "../src/reader-library.js";
import { ReaderGateway } from "../src/reader-gateway.js";
import { fixture } from "./fixtures.js";

test("recent books persist across restarts, canonicalize aliases and retain chapter bookmarks", async (t) => {
  const book = await fixture(),
    state = await mkdtemp(path.join(tmpdir(), "mb-library-"));
  t.after(async () => {
    await rm(book.root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  });
  const stateFilePath = path.join(state, "recent.json"),
    library = new ReaderLibrary({ stateFilePath });
  await library.remember(book.root, book.manifest.title, "second");
  const alias = path.join(state, "alias");
  await symlink(book.root, alias, "dir");
  await library.remember(alias, book.manifest.title);
  const restarted = new ReaderLibrary({ stateFilePath });
  const choices = await restarted.list();
  assert.equal(choices.length, 1);
  assert.equal(choices[0].chapterId, "second");
  assert.equal(
    choices[0].root,
    await import("node:fs/promises").then((fs) => fs.realpath(book.root)),
  );
  book.manifest.chapters.pop();
  await book.manifestWrite();
  assert.equal((await restarted.list())[0].chapterId, null);
});

test("separate registries merge concurrent writes and forgetting never removes book source", async (t) => {
  const a = await fixture(),
    b = await fixture(),
    state = await mkdtemp(path.join(tmpdir(), "mb-library-"));
  t.after(async () => {
    for (const root of [a.root, b.root, state])
      await rm(root, { recursive: true, force: true });
  });
  const stateFilePath = path.join(state, "recent.json"),
    first = new ReaderLibrary({ stateFilePath }),
    second = new ReaderLibrary({ stateFilePath });
  await Promise.all([
    first.remember(a.root, "A"),
    second.remember(b.root, "B"),
  ]);
  assert.equal((await first.list()).length, 2);
  await first.forget((await first.list())[0].root);
  assert.equal((await second.list()).length, 1);
  await access(path.join(a.root, "book.json"));
  await access(path.join(b.root, "book.json"));
  assert.equal(JSON.parse(await readFile(stateFilePath, "utf8")).version, 1);
});

test("corrupt history and missing folders do not block discovery; picker cancellation is inert", async (t) => {
  const book = await fixture(),
    state = await mkdtemp(path.join(tmpdir(), "mb-library-"));
  t.after(async () => {
    await rm(book.root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  });
  const stateFilePath = path.join(state, "recent.json");
  await writeFile(stateFilePath, "broken");
  const gateway = new ReaderGateway({
    stateFilePath,
    chooseDirectory: async () => undefined,
  });
  t.after(() => gateway.close());
  const data = await gateway.listBooks([
    path.join(state, "missing"),
    book.root,
  ]);
  assert.equal(data.workspaceBooks.length, 1);
  assert.deepEqual(data.recentBooks, []);
  assert.ok(data.warning);
  assert.equal(await gateway.library.choose(), undefined);
  assert.equal(await readFile(stateFilePath, "utf8"), "broken");
  await gateway.library.remember(book.root, book.manifest.title);
  assert.equal((await gateway.library.list()).length, 1);
  await rm(book.root, { recursive: true, force: true });
  assert.deepEqual(await gateway.library.list(), []);
});

test("closing the library cancels its pending directory chooser", async () => {
  const library = new ReaderLibrary({
    chooseDirectory: (signal) =>
      new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        }),
      ),
  });
  const choosing = library.choose();
  const rejected = assert.rejects(choosing, /cancelled/);
  await library.close();
  await rejected;
});
