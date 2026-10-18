import test from "node:test";
import assert from "node:assert/strict";
import { createExperiments, experimentValue } from "../reader/experiments.js";
import { referenceContent } from "../reader/reference-data.js";
test("experiment sessions isolate chapter and occurrence, clone state and flush on navigation", () => {
  let saved;
  const controller = new AbortController();
  const make = (chapterId) =>
    createExperiments({
      chapterId,
      read: () => saved,
      write: (v) => (saved = v),
      signal: controller.signal,
    });
  const first = make("one"),
    a = first.session("lens", 0, {}),
    b = first.session("lens", 1, {});
  const value = {
    version: 1,
    parameters: { wavelength: 550, seed: 12 },
    progress: 35,
  };
  a.save(value);
  value.parameters.seed = 99;
  assert.equal(a.load().parameters.seed, 12);
  const loaded = a.load();
  loaded.parameters.seed = 88;
  assert.equal(a.load().parameters.seed, 12);
  b.save({ version: 1, parameters: { wavelength: 650 } });
  controller.abort();
  const nextController = new AbortController(),
    next = createExperiments({
      chapterId: "one",
      read: () => saved,
      signal: nextController.signal,
    });
  assert.equal(next.session("lens", 0, {}).load().progress, 35);
  assert.equal(next.session("lens", 1, {}).load().parameters.wavelength, 650);
  const other = createExperiments({
    chapterId: "two",
    read: () => saved,
    signal: nextController.signal,
  });
  assert.equal(other.session("lens", 0, {}).load(), undefined);
  a.save({ version: 2 });
  assert.equal(a.load().version, 1);
  nextController.abort();
});
test("independent session writers merge and finite JSON limits reject corrupt or dangerous values", () => {
  let saved = { version: 1, values: {} };
  const c = new AbortController();
  const options = {
    chapterId: "one",
    read: () => saved,
    write: (v) => (saved = v),
    signal: c.signal,
  };
  const a = createExperiments(options),
    b = createExperiments(options);
  a.session("a", 0, {}).save({ n: 1 });
  b.session("b", 0, {}).save({ n: 2 });
  a.flush();
  b.flush();
  assert.equal(Object.keys(saved.values).length, 2);
  for (const value of [
    { n: NaN },
    { n: Infinity },
    { fn: () => {} },
    new Date(),
    JSON.parse('{"__proto__":{}}'),
    { s: "x".repeat(5000) },
  ])
    assert.throws(() => experimentValue(value));
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => experimentValue(cycle));
  const corrupt = createExperiments({
    ...options,
    read: () => ({ version: 1, values: null }),
  });
  assert.equal(corrupt.session("a", 0, {}).load(), undefined);
  c.abort();
});
test("discussion freezes a labeled component snapshot and never automatically sends it", () => {
  const c = new AbortController(),
    e = createExperiments({ chapterId: "one", signal: c.signal }),
    container = {};
  const session = e.session("wave", 0, container);
  let wavelength = 500;
  session.describe(() => ({
    title: "点像",
    parameters: { wavelengthNm: wavelength },
    readings: { mtf: 0.4 },
  }));
  const captured = e.snapshots(container);
  wavelength = 650;
  const reference = referenceContent(
    {
      bookTitle: "书",
      chapter: { title: "章", file: "chapter.md", source: "# 正文" },
    },
    { lineStart: 1, lineEnd: 1 },
    "解释参数",
    "",
    "zh-CN",
    captured,
  );
  assert.match(reference.content[2].text, /wavelengthNm/);
  assert.match(reference.content[2].text, /500/);
  assert.doesNotMatch(reference.content[2].text, /650/);
  c.abort();
  assert.deepEqual(e.snapshots(container), []);
});
