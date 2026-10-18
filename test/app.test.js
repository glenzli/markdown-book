import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const flush = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};
async function app({
  origin = "https://host.example",
  handle,
  widgetState = {},
  initialSeed = { choose: true },
  initialize = true,
} = {}) {
  const ids = new Map(),
    elements = [],
    timers = new Map(),
    messages = [],
    listeners = new Map(),
    blobs = [],
    events = [];
  let timerId = 0,
    library;
  class Element {
    constructor() {
      this.listeners = new Map();
      this.dataset = {};
      this.hidden = false;
      elements.push(this);
    }
    set id(v) {
      this._id = v;
      ids.set(v, this);
    }
    get id() {
      return this._id;
    }
    set textContent(value) {
      this.textWrites = (this.textWrites ?? 0) + 1;
      this._text = value;
    }
    get textContent() {
      return this._text;
    }
    setAttribute(k, v) {
      if (k === "hidden") this.hidden = true;
      this[k] = v;
    }
    append() {}
    prepend() {}
    after() {}
    remove() {
      this.removed = true;
      ids.delete(this.id);
    }
    addEventListener(k, fn) {
      this.listeners.set(k, fn);
    }
  }
  const button = new Element(),
    topbar = new Element(),
    body = new Element(),
    head = new Element();
  const document = {
    body,
    head,
    hidden: false,
    documentElement: { dataset: {}, lang: "en" },
    querySelector(s) {
      if (s === ".topbar") return topbar;
      if (s === '[role="alert"]')
        return elements.find((e) => e.role === "alert" && !e.removed);
      return null;
    },
    chapterLinks: [],
    querySelectorAll(selector) {
      if (selector === "#book-chapters a[href]") return this.chapterLinks;
      return [button];
    },
    getElementById: (id) => ids.get(id),
    createElement: () => new Element(),
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
    dispatchEvent(event) {
      events.push(event.type);
      this.listeners.get(event.type)?.(event);
    },
  };
  const emit = (m, source = parent) =>
    listeners.get("message")({
      source,
      origin,
      data: { jsonrpc: "2.0", ...m },
    });
  const page = (id) => ({
    body: `<article>${id ?? "home"}</article>`,
    bookId: "book-id",
    stylesheet: "",
    javascript: "",
    title: id ?? "home",
    cursor: 0,
  });
  const parent = {
    postMessage(m, target) {
      if (target === "null")
        throw Error("opaque origins require wildcard target");
      messages.push(m);
      if (m.method === "ui/initialize")
        emit({ id: m.id, result: { hostCapabilities: {}, hostContext: {} } });
      else if (m.method === "ui/notifications/initialized")
        emit({
          method: "ui/notifications/tool-result",
          params: { _meta: { reader: initialSeed } },
        });
      else if (m.method === "tools/call") {
        const result = handle?.(m, emit, page);
        if (result === false) return;
        const a = m.params.arguments,
          name = m.params.name;
        emit({
          id: m.id,
          result: result ?? {
            content: [],
            structuredContent:
              name === "reader_view"
                ? { root: a.root ?? "/book", bookId: "book-id", chapters: [] }
                : name === "reader_page"
                  ? page(a.chapterId)
                  : name === "reader_updates"
                    ? { cursor: 0 }
                    : {},
          },
        });
      }
    },
  };
  const preferences = { t: (k) => k, updateHost() {} };
  const context = vm.createContext({
    document,
    parent,
    window: {
      scrollY: 0,
      scrollTo(x, y) {
        this.scrollY = y;
      },
      openai: {
        widgetState,
        setWidgetState(value) {
          widgetState = value;
        },
      },
    },
    crypto: { randomUUID },
    URL: {
      createObjectURL(blob) {
        blobs.push(blob);
        return URL.createObjectURL(blob);
      },
      revokeObjectURL: URL.revokeObjectURL,
    },
    Blob,
    Event,
    createBrowserPreferences: () => ({ preferences, dispose() {} }),
    renderLibrary: (options) => {
      library = options;
      return () => {};
    },
    canDraftDiscussion: () => false,
    discussionRequest: (x) => x,
    addEventListener: (type, fn) => listeners.set(type, fn),
    setTimeout: (fn, ms) => {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  let source = await readFile(
    new URL("../reader/app.js", import.meta.url),
    "utf8",
  );
  source = source
    .replace(/^import[\s\S]*?;\n/gm, "")
    .replace(/^void initialize\(\)\.catch\(showError\);$/m, "");
  const api = vm.runInContext(
    source + ";({ initialize,launch,page,showLibrary })",
    context,
  );
  if (initialize) await api.initialize();
  return {
    api,
    emit,
    page,
    messages,
    document,
    button,
    ids,
    timers,
    blobs,
    events,
    get host() {
      return context.__markdownBookHost;
    },
    get widgetState() {
      return widgetState;
    },
    set scrollTop(value) {
      context.window.scrollY = value;
    },
    get scrollTop() {
      return context.window.scrollY;
    },
    get scriptIds() {
      return vm.runInContext("[...pageScripts.keys()]", context);
    },
    get library() {
      return library;
    },
    timeout(ms) {
      const found = [...timers].find(([, v]) => v.ms === ms);
      assert.ok(found, `timer ${ms}`);
      timers.delete(found[0]);
      found[1].fn();
    },
    async close() {
      emit({ method: "ui/resource-teardown" });
      await flush();
      assert.equal(timers.size, 0);
    },
  };
}

test("native opening coalesces repeated book clicks, reports loading and does not hold the host on idle watches", async () => {
  let opening;
  const a = await app({
    handle(m, emit) {
      if (m.params.name === "reader_view") {
        opening = () =>
          emit({
            id: m.id,
            result: { structuredContent: { root: "/book", chapters: [] } },
          });
        return false;
      }
    },
  });
  const first = a.api.launch("/book", "first");
  await flush();
  assert.equal(a.button.disabled, true);
  assert.equal(a.ids.get("mb-opening-status").textContent, "openingBook");
  assert.equal(a.api.launch("/book", "first"), first);
  assert.equal(
    a.messages.filter((m) => m.params?.name === "reader_view").length,
    1,
  );
  opening();
  await first;
  await flush();
  assert.equal(a.document.title, "first");
  assert.equal(a.button.disabled, false);
  assert.equal(
    a.messages.find((m) => m.params?.name === "reader_updates").params.arguments
      .waitMs,
    0,
  );
  assert.ok([...a.timers.values()].some((t) => t.ms === 2000));
  await a.close();
});
test("native timeout offers retry and rejects late opening responses; retry can recover", async () => {
  let late;
  let hold = true;
  const a = await app({
    handle(m, emit) {
      if (hold && m.params.name === "reader_view") {
        late = () =>
          emit({ id: m.id, result: { structuredContent: { root: "/book" } } });
        return false;
      }
    },
  });
  const opening = a.api.launch("/book", "first");
  await flush();
  a.timeout(60000);
  await opening;
  assert.equal(
    a.document.querySelector('[role="alert"]').textContent,
    "connectionTimeout",
  );
  assert.ok(a.ids.get("mb-retry-reading"));
  assert.equal(a.button.disabled, false);
  late();
  await flush();
  assert.notEqual(a.document.title, "first");
  hold = false;
  a.ids.get("mb-retry-reading").listeners.get("click")();
  await flush();
  assert.equal(a.document.title, "first");
  await a.close();
});
test("native reused panels honor fresh launch seeds, queue a newer chapter once, and ignore unrelated tool notifications", async () => {
  let opening;
  let held = false;
  const a = await app({
    handle(m, emit) {
      if (!held && m.params.name === "reader_view") {
        held = true;
        opening = () =>
          emit({
            id: m.id,
            result: { structuredContent: { root: "/book", chapters: [] } },
          });
        return false;
      }
    },
  });
  a.emit({
    method: "ui/notifications/tool-result",
    params: { _meta: { reader: { root: "/book", chapterId: "first" } } },
  });
  await flush();
  a.emit({
    method: "ui/notifications/tool-result",
    params: { structuredContent: { arbitrary: true } },
  });
  a.emit({
    method: "ui/notifications/tool-result",
    params: { _meta: { reader: { root: "/book", chapterId: "second" } } },
  });
  opening();
  await flush();
  assert.equal(a.document.title, "second");
  assert.equal(
    a.messages.filter((m) => m.params?.name === "reader_view").length,
    2,
  );
  await a.close();
});
test("native page requests recreate a lost MCP view and ignore a late superseded chapter", async () => {
  let lost = true;
  const delayed = [];
  const a = await app({
    handle(m, emit, page) {
      if (m.params.name === "reader_page") {
        if (lost) {
          lost = false;
          return {
            isError: true,
            content: [{ type: "text", text: "Reader view not found." }],
          };
        }
        if (["slow", "fast"].includes(m.params.arguments.chapterId)) {
          delayed.push(() =>
            emit({
              id: m.id,
              result: { structuredContent: page(m.params.arguments.chapterId) },
            }),
          );
          return false;
        }
      }
    },
  });
  await a.api.launch("/book", "initial");
  assert.equal(a.document.title, "initial");
  assert.equal(
    a.messages.filter((m) => m.params?.name === "reader_view").length,
    2,
  );
  const slow = a.api.page("slow");
  await flush();
  const fast = a.api.page("fast");
  await flush();
  delayed[1]();
  await fast;
  delayed[0]();
  await slow;
  assert.equal(a.document.title, "fast");
  await a.close();
});
test("native opaque parent origin stays usable and teardown clears pending requests and timers", async () => {
  const a = await app({ origin: "null" });
  await a.api.launch("/book", "first");
  assert.equal(a.document.title, "first");
  assert.ok(a.messages.length > 4);
  await a.close();
});

test("native chapter navigation reuses styles and source bytes but remounts each page", async () => {
  const cssId = "c".repeat(64),
    firstId = "1".repeat(64),
    secondId = "2".repeat(64);
  const a = await app({
    handle(m, emit, page) {
      if (m.params.name !== "reader_page") return;
      const args = m.params.arguments;
      const id = args.chapterId === "second" ? secondId : firstId;
      const result = {
        ...page(args.chapterId),
        stylesheetId: cssId,
        javascriptId: id,
      };
      delete result.stylesheet;
      delete result.javascript;
      if (args.assets?.stylesheetId !== cssId)
        result.stylesheet = "formula fonts";
      if (!args.assets?.javascriptIds.includes(id))
        result.javascript = `// source ${id}`;
      return { structuredContent: result };
    },
  });
  await a.api.launch("/book", "first");
  const style = a.ids.get("mb-book-style");
  assert.equal(style.textWrites, 1);
  await a.api.page("second");
  await a.api.page("first");
  assert.equal(style.textWrites, 1);
  const requests = a.messages.filter((m) => m.params?.name === "reader_page");
  assert.equal(requests[1].params.arguments.assets.stylesheetId, cssId);
  assert.deepEqual(
    Array.from(requests[2].params.arguments.assets.javascriptIds),
    [firstId, secondId],
  );
  assert.equal(a.blobs.length, 3);
  assert.match(await a.blobs[2].text(), new RegExp(`source ${firstId}`));
  assert.equal(a.events.filter((x) => x === "mb:dispose").length, 5); // library, explicit open and three mounts
  await a.api.showLibrary();
  await a.api.launch("/book", "first");
  assert.equal(a.ids.get("mb-book-style").textWrites, 1);
  assert.equal(
    a.messages.filter((m) => m.params?.name === "reader_page").at(-1).params
      .arguments.assets.stylesheetId,
    undefined,
  );
  await a.close();
  assert.equal(a.scriptIds.length, 0);
});

test("native script reuse has a byte budget and does not retain oversized sources", async () => {
  const ids = ["1", "2", "3", "4", "5"].map((x) => x.repeat(64));
  const a = await app({
    handle(m, emit, page) {
      if (m.params.name !== "reader_page") return;
      const n = Number(m.params.arguments.chapterId);
      return {
        structuredContent: {
          ...page(String(n)),
          javascriptId: ids[n],
          javascript: "x".repeat(n === 4 ? 5 * 1024 * 1024 : 1100 * 1024),
        },
      };
    },
  });
  await a.api.launch("/book", "0");
  for (const n of [1, 2, 3, 4]) await a.api.page(String(n));
  assert.deepEqual(Array.from(a.scriptIds), ids.slice(1, 4));
  await a.close();
});

test("native superseded failures cannot replace the current chapter with an error", async () => {
  let fail;
  const a = await app({
    handle(m, emit) {
      if (
        m.params.name === "reader_page" &&
        m.params.arguments.chapterId === "slow"
      ) {
        fail = () =>
          emit({ id: m.id, error: { message: "old request failed" } });
        return false;
      }
    },
  });
  await a.api.launch("/book", "first");
  const old = a.api.page("slow");
  await flush();
  await a.api.page("second");
  fail();
  await old;
  assert.equal(a.document.title, "second");
  assert.equal(a.document.querySelector('[role="alert"]'), undefined);
  await a.close();
});

test("native navigation and book switches drain durable experiment writes before rebinding the view", async () => {
  let finish;
  const a = await app({
    handle(m, emit) {
      if (m.params.name === "save_reader_experiments") {
        finish = () =>
          emit({ id: m.id, result: { structuredContent: { saved: true } } });
        return false;
      }
    },
  });
  await a.api.launch("/first", "one");
  const before = a.messages.filter(
    (m) => m.params?.name === "reader_view",
  ).length;
  a.host.setExperiments({ version: 1, values: { key: { value: 5 } } });
  const opening = a.api.launch("/second", "two");
  await flush();
  assert.equal(
    a.messages.filter((m) => m.params?.name === "reader_view").length,
    before,
  );
  finish();
  await opening;
  assert.equal(a.document.title, "two");
  await a.close();
});

test("missing views in the watcher and search share one recovery and preserve the visible chapter", async () => {
  let lost = false,
    reopen;
  const a = await app({
    handle(m, emit) {
      const name = m.params.name;
      if (lost && name === "reader_view") {
        reopen = () => {
          lost = false;
          emit({
            id: m.id,
            result: {
              structuredContent: {
                root: "/book",
                bookId: "book-id",
                chapters: [],
              },
            },
          });
        };
        return false;
      }
      if (
        lost &&
        ["reader_updates", "reader_index", "reader_page"].includes(name)
      )
        return {
          isError: true,
          content: [{ type: "text", text: "Reader view not found." }],
        };
    },
  });
  await a.api.launch("/book", "first");
  await a.api.page("second");
  a.scrollTop = 420;
  const before = a.messages.filter(
    (m) => m.params?.name === "reader_view",
  ).length;
  lost = true;
  a.timeout(2000);
  await flush();
  const search = a.host.loadIndex();
  await flush();
  assert.equal(
    a.messages.filter((m) => m.params?.name === "reader_view").length,
    before + 1,
  );
  assert.equal(typeof reopen, "function");
  reopen();
  await search;
  await flush();
  assert.equal(a.document.title, "second");
  assert.equal(a.scrollTop, 420);
  assert.equal(
    a.messages.filter((m) => m.params?.name === "reader_view").length,
    before + 1,
  );
  assert.equal(a.document.querySelector('[role="alert"]'), undefined);
  await a.close();
});

test("reconnect retries only the rejected experiment assignment and preserves it across navigation", async () => {
  let lost = false,
    stored = {};
  const a = await app({
    handle(m, emit, page) {
      const name = m.params.name;
      if (lost && name !== "reader_view" && name !== "close_reader_view")
        return {
          isError: true,
          content: [{ type: "text", text: "Reader view not found." }],
        };
      if (name === "reader_view") lost = false;
      if (name === "save_reader_experiments")
        stored = { ...stored, ...m.params.arguments.values };
      if (name === "reader_page")
        return {
          structuredContent: {
            ...page(m.params.arguments.chapterId),
            experiments: { version: 1, values: stored },
          },
        };
    },
  });
  await a.api.launch("/book", "first");
  lost = true;
  const value = {
    version: 1,
    values: {
      experiment: { version: 1, parameters: { ratio: 7 }, replay: { step: 3 } },
    },
  };
  a.host.setExperiments(value);
  await a.api.page("second");
  assert.equal(stored.experiment.parameters.ratio, 7);
  assert.equal(a.host.getExperiments().values.experiment.replay.step, 3);
  assert.equal(a.document.title, "second");
  await a.close();
});

test("failed experiment saves remain overlaid until retry, which resumes the current chapter and scroll", async () => {
  let failing = true;
  const a = await app({
    handle(m, emit, page) {
      if (m.params.name === "save_reader_experiments" && failing)
        return {
          isError: true,
          content: [{ type: "text", text: "storage unavailable" }],
        };
      if (m.params.name === "reader_page")
        return {
          structuredContent: {
            ...page(m.params.arguments.chapterId),
            experiments: {
              version: 1,
              values: { experiment: { version: 1, parameters: { ratio: 4 } } },
            },
          },
        };
    },
  });
  await a.api.launch("/book", "first");
  await a.api.page("second");
  a.host.setExperiments({
    version: 1,
    values: { experiment: { version: 1, parameters: { ratio: 7 } } },
  });
  await flush();
  await a.api.page("third");
  assert.equal(a.host.getExperiments().values.experiment.parameters.ratio, 7);
  a.scrollTop = 640;
  failing = false;
  a.ids.get("mb-retry-reading").listeners.get("click")();
  await flush();
  assert.equal(a.document.title, "third");
  assert.equal(a.scrollTop, 640);
  assert(
    a.messages.filter((m) => m.params?.name === "save_reader_experiments")
      .length >= 2,
  );
  await a.close();
});

test("a restarted watcher cannot cancel a newer pending chapter navigation", async () => {
  let update,
    finishPage,
    hold = false;
  const a = await app({
    handle(m, emit, page) {
      if (hold && m.params.name === "reader_updates") {
        update = () =>
          emit({ id: m.id, result: { structuredContent: { cursor: 2 } } });
        return false;
      }
      if (
        hold &&
        m.params.name === "reader_page" &&
        m.params.arguments.chapterId === "new"
      ) {
        finishPage = () =>
          emit({ id: m.id, result: { structuredContent: page("new") } });
        return false;
      }
    },
  });
  await a.api.launch("/book", "first");
  hold = true;
  a.timeout(2000);
  await flush();
  const navigation = a.api.page("new");
  await flush();
  update();
  await flush();
  finishPage();
  await navigation;
  assert.equal(a.document.title, "new");
  await a.close();
});

test("teardown during recovery cannot reopen or repaint the closed panel", async () => {
  let lost = false,
    late;
  const a = await app({
    handle(m, emit) {
      if (lost && m.params.name === "reader_updates")
        return {
          isError: true,
          content: [{ type: "text", text: "Reader view not found." }],
        };
      if (lost && m.params.name === "reader_view") {
        late = () =>
          emit({
            id: m.id,
            result: { structuredContent: { root: "/book", chapters: [] } },
          });
        return false;
      }
    },
  });
  await a.api.launch("/book", "first");
  lost = true;
  a.timeout(2000);
  await flush();
  assert.equal(typeof late, "function");
  await a.close();
  late();
  await flush();
  assert.equal(a.document.title, "first");
  assert.equal(a.host, undefined);
});

test("late launch seeds recover startup without negotiating the initialized host again", async () => {
  const a = await app({
    initialSeed: null,
    initialize: false,
    widgetState: { root: "/book", chapterId: "second", scrollTop: 512 },
  });
  const startup = a.api.initialize();
  await flush();
  a.timeout(25000);
  await assert.rejects(startup, /missingSeed/);
  const retry = a.api.initialize();
  await flush();
  assert.equal(
    a.messages.filter((m) => m.method === "ui/initialize").length,
    1,
  );
  a.emit({
    method: "ui/notifications/tool-result",
    params: { structuredContent: { ready: true, reader: { root: "/book" } } },
  });
  await retry;
  await flush();
  assert.equal(a.document.title, "second");
  assert.equal(a.scrollTop, 512);
  await a.close();
});

test("a late seed can resume automatically and legacy ready results remain supported", async () => {
  const a = await app({ initialSeed: null, initialize: false });
  const startup = a.api.initialize();
  await flush();
  a.timeout(25000);
  await assert.rejects(startup);
  a.emit({
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: { ready: true, root: "/book", chapterId: "first" },
    },
  });
  await flush();
  assert.equal(a.document.title, "first");
  assert.equal(
    a.messages.filter((m) => m.method === "ui/initialize").length,
    1,
  );
  await a.close();
});

test("a pending experiment snapshot survives panel recreation and is saved before reading", async () => {
  let stored = {};
  const value = { version: 1, parameters: { ratio: 7 } };
  const a = await app({
    initialSeed: { root: "/book", chapterId: "first" },
    widgetState: {
      pendingExperiments: {
        "/book": { bookId: "book-id", values: { experiment: value } },
      },
    },
    handle(m, emit, page) {
      if (m.params.name === "save_reader_experiments")
        stored = { ...stored, ...m.params.arguments.values };
      if (m.params.name === "reader_page")
        return {
          structuredContent: {
            ...page("first"),
            experiments: { version: 1, values: stored },
          },
        };
    },
  });
  await flush();
  assert.equal(stored.experiment.parameters.ratio, 7);
  assert.equal(a.host.getExperiments().values.experiment.parameters.ratio, 7);
  assert.equal(Object.keys(a.widgetState.pendingExperiments).length, 0);
  await a.close();
});

test("switching books fences an older reconnect response", async () => {
  let lost = false,
    late;
  const a = await app({
    handle(m, emit) {
      if (
        m.params.name === "reader_view" &&
        m.params.arguments.root === "/other"
      )
        lost = false;
      if (lost && m.params.name === "reader_updates")
        return {
          isError: true,
          content: [{ type: "text", text: "Reader view not found." }],
        };
      if (
        lost &&
        m.params.name === "reader_view" &&
        m.params.arguments.root === "/book"
      ) {
        late = () =>
          emit({
            id: m.id,
            result: {
              structuredContent: {
                root: "/book",
                bookId: "book-id",
                chapters: [],
              },
            },
          });
        return false;
      }
    },
  });
  await a.api.launch("/book", "first");
  lost = true;
  a.timeout(2000);
  await flush();
  assert.equal(typeof late, "function");
  await a.api.launch("/other", "other");
  late();
  await flush();
  assert.equal(a.document.title, "other");
  assert.equal(a.host.root, "/other");
  assert.equal(a.document.querySelector('[role="alert"]'), undefined);
  await a.close();
});

test("unchanged recovery retains the mounted experiment, its host and reading position", async () => {
  let lost = false;
  const a = await app({
    handle(m, emit, page) {
      const name = m.params.name;
      if (name === "reader_view") lost = false;
      if (name === "reader_page")
        return {
          content: [],
          structuredContent: {
            ...page(m.params.arguments.chapterId),
            digest: "same-inputs",
            javascriptId: "same-script",
          },
        };
      if (lost && name === "reader_updates")
        return {
          isError: true,
          content: [{ type: "text", text: "Reader view not found." }],
        };
    },
  });
  await a.api.launch("/book", "second");
  const host = a.host;
  const mounts = a.blobs.length;
  a.scrollTop = 420;
  lost = true;
  a.timeout(2000);
  await flush();
  assert.equal(a.host, host);
  assert.equal(a.blobs.length, mounts);
  assert.equal(a.scrollTop, 420);
  assert.deepEqual(await host.loadIndex(), {});
  assert.equal(
    a.messages.filter((m) => m.params?.name === "reader_view").length,
    2,
  );
});

test("native links accept a newly rendered chapter after a manifest update, without reopening the book", async () => {
  const a = await app({
    handle(m) {
      if (m.params.name === "reader_view")
        return {
          structuredContent: {
            root: "/book",
            bookId: "book-id",
            chapters: [{ id: "first" }],
          },
        };
    },
  });
  await a.api.launch("/book", "first");
  a.document.chapterLinks = ["first", "lens-engineering"].map((id) => ({
    getAttribute: () => `/${id}/`,
  }));
  const link = { getAttribute: () => "/lens-engineering/#focus" };
  a.document.listeners.get("click")({
    target: { closest: () => link },
    button: 0,
    preventDefault() {},
  });
  await flush();
  assert.equal(a.document.title, "lens-engineering");
  assert.equal(
    a.messages.filter((m) => m.params?.name === "reader_page").at(-1).params
      .arguments.chapterId,
    "lens-engineering",
  );
  await a.close();
});
