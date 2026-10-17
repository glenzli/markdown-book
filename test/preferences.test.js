import test from "node:test";
import assert from "node:assert/strict";
import {
  createPreferences,
  preferencesKey,
} from "../reader/preferences-data.js";
import { messages } from "../reader/i18n.js";
import { referenceContent } from "../reader/reference-data.js";
import { fixture } from "./fixtures.js";
import { buildBook } from "../src/build.js";
import { rm, readFile } from "node:fs/promises";

function memory(values = {}) {
  const entries = new Map(Object.entries(values));
  return {
    get: (_, key) => entries.get(key) ?? null,
    set: (_, key, value) => entries.set(key, value),
  };
}
test("automatic preferences follow host then system; manual choices persist and can return to automatic", () => {
  const storage = memory();
  const saved = [];
  const preferences = createPreferences({
    storage,
    languages: ["zh-TW"],
    dark: true,
    onSave: (value) => saved.push(value),
  });
  assert.equal(preferences.locale, "zh-CN");
  assert.equal(preferences.resolvedTheme, "dark");
  preferences.updateHost({ locale: "en-GB", theme: "light" });
  assert.equal(preferences.locale, "en");
  assert.equal(preferences.resolvedTheme, "light");
  preferences.setLanguage("zh-CN");
  preferences.setTheme("dark");
  preferences.updateHost({ locale: "en-US", theme: "light" });
  assert.equal(preferences.locale, "zh-CN");
  assert.equal(preferences.resolvedTheme, "dark");
  const reopened = createPreferences({ storage });
  assert.equal(reopened.language, "zh-CN");
  assert.equal(reopened.theme, "dark");
  preferences.setLanguage("auto");
  preferences.setTheme("auto");
  assert.deepEqual(saved.at(-1), { language: "auto", theme: "auto" });
  assert.equal(preferences.locale, "en");
  assert.equal(preferences.resolvedTheme, "light");
  preferences.updateHost({ locale: undefined, theme: undefined });
  preferences.updateSystem({ languages: ["en"], dark: true });
  assert.equal(preferences.locale, "en");
  assert.equal(preferences.resolvedTheme, "dark");
});
test("opaque storage uses explicit host state; corrupt values, unsupported locales and legacy themes are bounded", () => {
  const storage = memory({
    [preferencesKey]: "{bad",
    "markdown-book:theme": "dark",
  });
  const preferences = createPreferences({
    storage,
    host: { locale: "fr-FR" },
    languages: ["zh-CN"],
  });
  assert.equal(preferences.locale, "en");
  assert.equal(preferences.theme, "dark");
  const host = createPreferences({
    initial: { language: "en", theme: "auto" },
    host: { locale: "zh-CN", theme: "dark" },
  });
  assert.equal(host.locale, "en");
  assert.equal(host.resolvedTheme, "dark");
  host.setLanguage("not-supported");
  host.setTheme("invalid");
  assert.deepEqual(host.snapshot(), { language: "en", theme: "auto" });
  let calls = 0;
  const controller = new AbortController();
  host.subscribe(() => calls++, { signal: controller.signal });
  host.updateHost({ theme: "light" });
  controller.abort();
  host.updateHost({ theme: "dark" });
  assert.equal(calls, 2);
});
test("both UI catalogs preserve placeholders; English references retain original manuscript bytes", () => {
  const tokens = (value) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, values] of Object.entries(messages)) {
    assert.ok(values.en && values["zh-CN"], key);
    assert.deepEqual(tokens(values.en), tokens(values["zh-CN"]), key);
  }
  const source = "# 噪声\n\n$S/\\sqrt{S}$";
  const ref = referenceContent(
    {
      bookTitle: "摄影书",
      chapter: { title: "噪声", file: "noise.md", source },
    },
    { lineStart: 1, lineEnd: 3 },
    "",
    "/books/photo",
    "en",
  );
  assert.equal(ref.source, source);
  assert.match(ref.title, /lines 1–3/);
  assert.match(ref.content[1].text, /Book: 摄影书/);
  assert.match(ref.content[0].text, /Help me understand/);
});
test("English static output has translated no-script navigation and preserves the book language", async (t) => {
  const book = await fixture();
  t.after(() => rm(book.root, { recursive: true, force: true }));
  book.manifest.language = "en";
  await book.manifestWrite();
  const built = await buildBook(book.root);
  const html = await readFile(`${built.outDir}/first/index.html`, "utf8");
  assert.match(html, /<article class="prose" lang="en">/);
  assert.match(html, />All chapters</);
  assert.match(html, /第一章/);
  assert.doesNotMatch(html, /切换明暗主题/);
});
