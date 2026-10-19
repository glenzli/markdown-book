import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile, rm, symlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { checkBook, buildBook } from "../src/build.js";
import { bookSchema, normalizeSite } from "../src/manifest.js";
import { fixture } from "./fixtures.js";

test("website builds preserve reading contracts and carry a portable cover without tool chrome", async (t) => {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  const cover = { src: "figures/cover image.svg", alt: "测试书籍封面" };
  const coverBytes =
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="white"/></svg>';
  await writeFile(path.join(book.root, cover.src), coverBytes);
  await book.manifestWrite({
    ...book.manifest,
    author: "Glen Li",
    cover,
    license: {
      name: "CC BY 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
    },
  });
  await writeFile(
    path.join(book.root, "first.md"),
    (await readFile(path.join(book.root, "first.md"), "utf8")) +
      '\n<div data-mb-exercise="one">\n\n练习一。\n\n</div>\n',
  );
  await writeFile(
    path.join(book.root, "second.md"),
    (await readFile(path.join(book.root, "second.md"), "utf8")) +
      '\n<div data-mb-solution="answer" data-mb-for="one">\n\n答案一。\n\n</div>\n',
  );
  const ordinary = await buildBook(book.root, {
    outDir: path.join(book.root, "ordinary"),
    base: "/reader/",
  });
  const hosted = await buildBook(book.root, {
    outDir: path.join(book.root, "hosted"),
    base: "/reader/",
    site: { home: "/books/", favicon: "/favicon.svg" },
  });
  const ordinaryHtml = await readFile(
    path.join(ordinary.outDir, "first/index.html"),
    "utf8",
  );
  const hostedHtml = await readFile(
    path.join(hosted.outDir, "first/index.html"),
    "utf8",
  );
  const index = await readFile(path.join(hosted.outDir, "index.html"), "utf8");
  assert.match(ordinaryHtml, />Markdown Book</);
  assert.match(ordinaryHtml, /class="sidebar-footer"/);
  assert.doesNotMatch(
    hostedHtml,
    /Markdown Book|MARKDOWN BOOK|class="sidebar-footer"|working tree/,
  );
  assert.match(hostedHtml, /class="brand site-return" href="\/books\/"/);
  assert.match(hostedHtml, /data-mb-label="backToBookshelf"/);
  assert.match(hostedHtml, /href="\/favicon.svg"/);
  assert.match(hostedHtml, /Glen Li/);
  assert.match(hostedHtml, /CC BY 4.0/);
  assert.match(hostedHtml, /class="katex"/);
  assert.match(hostedHtml, /data-mb-component="sample"/);
  assert.match(hostedHtml, /\/reader\/second\/#mb-solution-answer/);
  assert.match(
    await readFile(path.join(hosted.outDir, "second/index.html"), "utf8"),
    /\/reader\/first\/#mb-exercise-one/,
  );
  assert.match(index, /src="\/reader\/media\/figures\/cover%20image.svg"/);
  assert.match(index, /data-mb-label="readingPageCount"/);
  assert.equal(
    await readFile(
      path.join(hosted.outDir, "media/figures/cover image.svg"),
      "utf8",
    ),
    coverBytes,
  );
  const catalog = JSON.parse(
    await readFile(path.join(hosted.outDir, "catalog.json"), "utf8"),
  );
  assert.deepEqual(catalog.cover, {
    href: "/reader/media/figures/cover%20image.svg",
    alt: cover.alt,
  });
  assert.equal(catalog.author, "Glen Li");
  assert.notEqual(hosted.digest, ordinary.digest);
});

test("publisher cover options keep older manifests unchanged and bind cover bytes to build identity", async (t) => {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  const cover = { src: "figures/cover.svg", alt: "Publisher cover" };
  await writeFile(
    path.join(book.root, cover.src),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  const beforeManifest = await readFile(
    path.join(book.root, "book.json"),
    "utf8",
  );
  const first = await checkBook(book.root, { cover });
  assert.equal(first.manifest.cover, undefined);
  assert.equal(first.cover.alt, cover.alt);
  await writeFile(
    path.join(book.root, cover.src),
    '<svg xmlns="http://www.w3.org/2000/svg"><title>Revised cover</title></svg>',
  );
  const second = await checkBook(book.root, { cover });
  assert.notEqual(first.digest, second.digest);
  assert.equal(
    await readFile(path.join(book.root, "book.json"), "utf8"),
    beforeManifest,
  );
});

test("cover and website options reject escaping resources and unsafe navigation", async (t) => {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  for (const src of [
    "../cover.png",
    "https://example.com/cover.png",
    "/cover.png",
    "cover.html",
    "cover.svg?x=1",
  ])
    assert.equal(
      bookSchema.safeParse({ ...book.manifest, cover: { src, alt: "Cover" } })
        .success,
      false,
    );
  await assert.rejects(
    checkBook(book.root, { cover: { src: "missing.png", alt: "Cover" } }),
    /ENOENT/,
  );
  const outside = await mkdtemp(path.join(tmpdir(), "cover-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, "cover.png"), "outside");
  await symlink(
    path.join(outside, "cover.png"),
    path.join(book.root, "escape.png"),
  );
  await assert.rejects(
    checkBook(book.root, { cover: { src: "escape.png", alt: "Cover" } }),
    /Symlink leaves book/,
  );
  for (const home of [
    "javascript:alert(1)",
    "//other.example/books/",
    "books/",
    "/bad\\path",
    "/bad\npath",
  ])
    assert.throws(() => normalizeSite({ home }), /site-absolute path/);
  assert.throws(
    () =>
      normalizeSite({ home: "/books/", favicon: "data:image/svg+xml,unsafe" }),
    /site-absolute path/,
  );
  assert.deepEqual(normalizeSite({ home: "https://example.com/books/" }), {
    home: "https://example.com/books/",
  });
});

test("CLI website build options are explicit and apply the same renderer", async (t) => {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  const cli = path.resolve("bin/markdown-book.js");
  const outDir = path.join(book.root, "web");
  execFileSync(
    process.execPath,
    [
      cli,
      "build",
      book.root,
      "--out",
      outDir,
      "--base",
      "/book/",
      "--site-home",
      "/books/",
      "--site-label",
      "Library",
      "--cover",
      "figures/noise.svg",
      "--cover-alt",
      "Cover",
    ],
    { stdio: "pipe" },
  );
  const index = await readFile(path.join(outDir, "index.html"), "utf8");
  assert.match(index, /site-return/);
  assert.match(index, /<span>Library<\/span>/);
  assert.doesNotMatch(index, /Markdown Book|MARKDOWN BOOK/);
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [cli, "check", book.root, "--site-home", "/books/"],
        { stdio: "pipe" },
      ),
    /build only/,
  );
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [cli, "build", book.root, "--cover", "figures/noise.svg"],
        { stdio: "pipe" },
      ),
    /provided together/,
  );
});

test("external runtime outputs cannot replace a project or a populated directory", async (t) => {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  const script = path.resolve("scripts/bundle-plugin.js");
  const sentinel = path.join(book.root, "figures/noise.svg");
  const original = await readFile(sentinel, "utf8");
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [script, "--out", path.dirname(sentinel)],
        { stdio: "pipe" },
      ),
    /must be empty/,
  );
  assert.equal(await readFile(sentinel, "utf8"), original);
  assert.throws(
    () =>
      execFileSync(process.execPath, [script, "--out", process.cwd()], {
        stdio: "pipe",
      }),
    /must not replace/,
  );
});
