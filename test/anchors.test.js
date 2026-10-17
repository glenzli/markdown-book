import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { checkBook } from "../src/build.js";
import { fixture } from "./fixtures.js";

test("footnotes, duplicate headings and cross-chapter anchor errors are handled", async (t) => {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  const second = path.join(book.root, "second.md");
  await writeFile(
    second,
    "# 第二章\n\n## 第二节\n\n## 重复\n\n## 重复\n\n说明[^one]。\n\n[^one]: 注释正文。",
  );
  const checked = await checkBook(book.root);
  assert.ok(checked.chapters[1].anchors.includes("重复-1"));
  assert.match(checked.chapters[1].html, /footnote/);
  await writeFile(second, "# 第二章\n\n## 改名");
  await assert.rejects(checkBook(book.root), /Missing chapter anchor/);
});
