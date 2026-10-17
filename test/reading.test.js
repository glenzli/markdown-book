import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fixture } from "./fixtures.js";
import { buildBook, checkBook } from "../src/build.js";
import { searchEntries } from "../reader/search-data.js";
import {
  referenceContent,
  discussionRequest,
  canDraftDiscussion,
} from "../reader/reference-data.js";

test("search indexes sanitized text, formulas and interactions with unique anchors and real source lines", async (t) => {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  await writeFile(
    path.join(book.root, "second.md"),
    "# 第二章\n\n## mb-block-1\n\n像素 MTF 与采样。\n\n## 第二节\n",
  );
  const checked = await checkBook(book.root);
  const entries = checked.chapters.flatMap((chapter) => chapter.readingEntries);
  const first = checked.chapters[0];
  assert.ok(entries.some((entry) => entry.text.includes("\\sqrt")));
  assert.ok(entries.every((entry) => !entry.text.includes("alert(1)")));
  const interactive = searchEntries(entries, "", "interactive");
  assert.equal(interactive.total, 1);
  assert.equal(interactive.entries[0].component, "sample");
  assert.ok(first.anchors.includes(interactive.entries[0].anchor));
  assert.match(
    first.source.split("\n")[interactive.entries[0].lineStart - 1],
    /data-mb-component/,
  );
  const found = searchEntries(entries, "ＭＴＦ 像素", "text");
  assert.equal(found.total, 1);
  const entry = found.entries[0];
  assert.equal(entry.chapterTitle, "第二章");
  assert.equal(entry.lineStart, 5);
  assert.equal(entry.lineEnd, 5);
  assert.equal(entry.file, "second.md");
  assert.notEqual(entry.anchor, "mb-block-1");
  const second = checked.chapters[1];
  const ids = [...second.html.matchAll(/\bid="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(new Set(ids).size, ids.length);
  const outDir = path.join(book.root, "dist");
  const built = await buildBook(book.root, { outDir, base: "/library/book/" });
  const index = JSON.parse(
    await readFile(path.join(outDir, "search.json"), "utf8"),
  );
  assert.equal(index.digest, built.digest);
  assert.deepEqual(index.entries, entries);
  const html = await readFile(path.join(outDir, "first/index.html"), "utf8");
  const serialized = html.match(
    /<script id="mb-state" type="application\/json">([\s\S]*?)<\/script>/,
  )[1];
  assert.doesNotMatch(serialized, /<\/script/i);
  const state = JSON.parse(serialized);
  assert.equal(state.chapter.source, first.source);
  assert.equal(state.chapter.file, "first.md");
});

test("discussion drafts carry faithful Markdown and positions to a new editable conversation", () => {
  const state = {
    bookTitle: "摄影书",
    chapter: {
      title: "噪声",
      file: "04_noise.md",
      source: "# 噪声\n\n$S/\\sqrt{S}$\n\n```js\n1 + 1\n```\n",
    },
  };
  const reference = referenceContent(
    state,
    { lineStart: 3, lineEnd: 7 },
    "如何理解这一步？",
    "/books/photo",
  );
  assert.equal(reference.source, "$S/\\sqrt{S}$\n\n```js\n1 + 1\n```");
  assert.equal(reference.location, "/books/photo/04_noise.md:3-7");
  assert.match(reference.content[1].text, /````markdown/);
  assert.equal(reference.content[0].text, "如何理解这一步？");
  const request = discussionRequest(reference.content);
  assert.deepEqual(request._meta["openai/message"], {
    target: "new",
    send: false,
  });
  assert.equal(request.content, reference.content);
  assert.throws(
    () => referenceContent(state, { lineStart: 0, lineEnd: 3 }),
    /位置已变化/,
  );
  assert.throws(
    () => referenceContent(state, { lineStart: 1, lineEnd: 99 }),
    /位置已变化/,
  );
  assert.throws(
    () =>
      referenceContent(
        { ...state, chapter: { ...state.chapter, source: "x".repeat(12001) } },
        { lineStart: 1, lineEnd: 1 },
      ),
    /缩小选区/,
  );
  assert.equal(canDraftDiscussion({}), false);
  assert.equal(canDraftDiscussion({ message: {} }), false);
  assert.equal(
    canDraftDiscussion({ message: {}, experimental: { "openai/message": {} } }),
    true,
  );
  assert.equal(
    canDraftDiscussion({
      message: {},
      experimental: { "openai/message": { draft: false } },
    }),
    false,
  );
});
