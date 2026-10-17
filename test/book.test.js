import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { checkBook, buildBook } from "../src/build.js";
import { fixture } from "./fixtures.js";

test("real Markdown, math, local links and fallback pass through one rendering pipeline", async (t) => {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  const result = await checkBook(book.root, { base: "/books/test/" });
  const chapter = result.chapters[0];
  assert.match(chapter.html, /class="katex"/);
  assert.ok(
    chapter.html.includes(
      `href="/books/test/second/#${encodeURIComponent("第二节")}"`,
    ),
  );
  assert.match(chapter.html, /src="\/books\/test\/media\/figures\/noise.svg"/);
  assert.match(chapter.html, /data-mb-component="sample"/);
  assert.doesNotMatch(chapter.html, /<script|onerror|alert\(1\)/);
  assert.deepEqual(chapter.components, ["sample"]);
});

test("validation rejects unsupported formats, duplicate identities and escaping symlinks", async (t) => {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  await book.manifestWrite({ ...book.manifest, formatVersion: 2 });
  await assert.rejects(checkBook(book.root), /formatVersion/);
  await book.manifestWrite({
    ...book.manifest,
    chapters: [book.manifest.chapters[0], book.manifest.chapters[0]],
  });
  await assert.rejects(checkBook(book.root), /Duplicate chapter id/);
  await book.manifestWrite({
    ...book.manifest,
    components: { sample: { entry: "../elsewhere.js" } },
  });
  await assert.rejects(checkBook(book.root), /relative path/);
  await book.manifestWrite();
  const outside = await mkdtemp(path.join(tmpdir(), "markdown-book-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, "secret.svg"), "outside");
  await symlink(
    path.join(outside, "secret.svg"),
    path.join(book.root, "escape.svg"),
  );
  await writeFile(
    path.join(book.root, "second.md"),
    "# 第二章\n\n![outside](escape.svg)",
  );
  await assert.rejects(checkBook(book.root), /Symlink leaves book/);
});

test("missing resources, invalid formulas and invalid component contracts are errors", async (t) => {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  const second = path.join(book.root, "second.md");
  await writeFile(second, "# 第二章\n\n![missing](missing.png)");
  await assert.rejects(checkBook(book.root), /Missing or invalid resource/);
  await writeFile(second, "# 第二章\n\n$\\unknowncommand$");
  await assert.rejects(
    checkBook(book.root),
    /Invalid formula|Undefined control/,
  );
  await writeFile(
    second,
    '# 第二章\n\n<div data-mb-component="absent">\n\n![图](figures/noise.svg)\n\n</div>',
  );
  await assert.rejects(checkBook(book.root), /Unknown or invalid component/);
  await writeFile(second, "# 第二章\n\n## 第二节");
  await writeFile(
    path.join(book.root, "components/sample.js"),
    "export const unrelated = true;",
  );
  await assert.rejects(checkBook(book.root), /must export mount/);
});

test("static output supports a mount prefix, contains local fonts and preserves unknown directories", async (t) => {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  const outDir = path.join(book.root, "dist");
  const result = await buildBook(book.root, { base: "/library/test/", outDir });
  const html = await readFile(path.join(outDir, "first/index.html"), "utf8");
  assert.match(html, /\/library\/test\/assets\/reader-/);
  assert.match(html, /"liveReload":false/);
  assert.match(html, /<img/);
  assert.ok(
    (await readdir(path.join(outDir, "assets"))).some((name) =>
      name.endsWith(".woff2"),
    ),
  );
  assert.equal(
    JSON.parse(await readFile(path.join(outDir, "build.json"), "utf8")).digest,
    result.digest,
  );
  const secondBuild = await buildBook(book.root, {
    base: "/library/test/",
    outDir,
  });
  assert.equal(secondBuild.digest, result.digest);
  await assert.rejects(
    buildBook(book.root, { outDir: book.root }),
    /must not replace/,
  );
  const unknown = path.join(book.root, "figures");
  await assert.rejects(
    buildBook(book.root, { outDir: unknown }),
    /non-owned output/,
  );
  assert.match(await readFile(path.join(unknown, "noise.svg"), "utf8"), /<svg/);
});
