import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fixture } from "./fixtures.js";
import { checkBook, buildBook } from "../src/build.js";
import { ReaderGateway } from "../src/reader-gateway.js";
import { renderChapters } from "../src/markdown.js";
import { loadBook } from "../src/manifest.js";
const question =
  '<div data-mb-exercise="ex-one">\n\n**Exercise 1.** Compute $2^2$.\n\n</div>\n';
const answer =
  '<div data-mb-solution="ans-one" data-mb-for="ex-one">\n\n**Answer 1.** $4$.\n\n</div>\n';
async function setup(t, first = question, second = answer) {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  await writeFile(`${book.root}/first.md`, `# Question\n\n${first}`);
  await writeFile(`${book.root}/second.md`, `# Answer\n\n${second}`);
  return book;
}
test("explicit question/answer identities create static links under a nonroot base, and retain formulas and index source", async (t) => {
  const book = await setup(t);
  const checked = await checkBook(book.root, { base: "/books/example/" });
  const [q, a] = checked.chapters;
  assert.match(q.html, /id="mb-exercise-ex-one"/);
  assert.match(q.html, /href="\/books\/example\/second\/#mb-solution-ans-one"/);
  assert.match(q.html, /查看解答/);
  assert.match(a.html, /href="\/books\/example\/first\/#mb-exercise-ex-one"/);
  assert.match(a.html, /返回习题/);
  assert.match(q.html, /katex/);
  assert.equal(
    q.readingEntries.some((e) => e.text.includes("查看解答")),
    false,
  );
  assert.equal(
    q.readingEntries.some((e) => e.text.includes("Exercise 1.")),
    true,
  );
  assert.equal(q.exercises[0].id, "ex-one");
  const built = await buildBook(book.root, { base: "/books/example/" });
  assert.match(
    await readFile(`${built.outDir}/first/index.html`, "utf8"),
    /href="\/books\/example\/second\/#mb-solution-ans-one"/,
  );
  assert.equal(checked.manifest.formatVersion, 1);
});
test("same-page and multiple answers have deterministic links; unanswered exercises remain readable", async (t) => {
  const book = await setup(
    t,
    `${question}\n${answer}\n<div data-mb-exercise="unanswered">\n\nOpen question.\n\n</div>`,
  );
  // The fixture's second answer has its own identity and appears after the local one.
  await writeFile(
    `${book.root}/second.md`,
    answer.replaceAll("ans-one", "ans-two"),
  );
  const [first, second] = await renderChapters(await loadBook(book.root), "/");
  assert.match(first.html, /href="#mb-solution-ans-one"[^>]*>查看解答 1/);
  assert.match(
    first.html,
    /href="\/second\/#mb-solution-ans-two"[^>]*>查看解答 2/,
  );
  assert.match(first.html, /href="#mb-exercise-ex-one"/);
  assert.match(second.html, /href="\/first\/#mb-exercise-ex-one"/);
  assert.equal((first.html.match(/data-mb-generated-links/g) || []).length, 2);
  assert.match(first.html, /Open question/);
});
test("English static links follow book language without rewriting question text", async (t) => {
  const book = await setup(t, question.replace("Exercise", "练习"));
  book.manifest.language = "en";
  await book.manifestWrite();
  const [q, a] = await renderChapters(await loadBook(book.root));
  assert.match(q.html, />View solution</);
  assert.match(a.html, />Back to exercise</);
  assert.match(q.html, /练习 1/);
});
test("invalid or ambiguous relationships fail instead of guessing from numbering", async (t) => {
  const book = await setup(t);
  for (const [first, second, error] of [
    [
      question.replaceAll("div", "section"),
      answer,
      /Invalid exercise\/solution/,
    ],
    [
      '<div data-mb-exercise="ex-one"></div>',
      answer,
      /Empty exercise\/solution/,
    ],
    [
      question,
      '<div data-mb-solution="ans-one" data-mb-for="ex-one"></div>',
      /Empty exercise\/solution/,
    ],
    [
      question.replace("<div ", '<div data-mb-component="sample" '),
      answer,
      /Invalid exercise\/solution/,
    ],
    [question, answer + answer, /Duplicate exercise\/solution id/],
    [question + question, answer, /Duplicate exercise\/solution id/],
    [
      question,
      answer.replace("ex-one", "missing"),
      /Solution target must be an exercise/,
    ],
    [
      question,
      answer.replace("ex-one", "ans-one"),
      /Solution target must be an exercise/,
    ],
    [
      question,
      answer.replace(' data-mb-for="ex-one"', ""),
      /Invalid exercise\/solution/,
    ],
    [
      question.replace("ex-one", "Bad ID"),
      answer,
      /Invalid exercise\/solution/,
    ],
    [question.replace("</div>", `${answer}</div>`), "", /must not be nested/],
    [
      question.replaceAll("div", "blockquote"),
      answer,
      /Invalid exercise\/solution/,
    ],
    [`## mb-exercise-ex-one\n\n${question}`, answer, /anchor collision/],
  ]) {
    await writeFile(`${book.root}/first.md`, first);
    await writeFile(`${book.root}/second.md`, second);
    await assert.rejects(renderChapters(await loadBook(book.root)), error);
  }
});
test("Markdown links can reference generated exercise anchors; literal code cannot register relationships", async (t) => {
  const book = await setup(
    t,
    `${question}\n[Answer](second.md#mb-solution-ans-one)\n\n\`\`\`html\n<div data-mb-exercise="ex-one">\n\`\`\``,
  );
  const result = await checkBook(book.root);
  assert.equal(result.chapters[0].exercises.length, 1);
  assert.match(
    result.chapters[0].html,
    /href="\/second\/#mb-solution-ans-one"/,
  );
});

test("native gateway carries both directions through the same built pages", async (t) => {
  const book = await setup(t);
  const stateFilePath = `${book.root}/recent.json`;
  const gateway = new ReaderGateway({ stateFilePath });
  t.after(() => gateway.close());
  const viewKey = "e".repeat(32);
  await gateway.view(viewKey, book.root);
  const q = await gateway.page(viewKey, "first");
  const a = await gateway.page(viewKey, "second");
  assert.match(q.body, /href="\/second\/#mb-solution-ans-one"/);
  assert.match(a.body, /href="\/first\/#mb-exercise-ex-one"/);
  assert.match(a.body, /id="mb-solution-ans-one"/);
  assert.match(q.stylesheet, /mb-anchor-target/);
});
