import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
async function app({ origin = "https://host.example", handle } = {}) {
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
    querySelectorAll() {
      return [button];
    },
    getElementById: (id) => ids.get(id),
    createElement: () => new Element(),
    addEventListener() {},
    dispatchEvent(event) {
      events.push(event.type);
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
          params: { _meta: { reader: { choose: true } } },
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
                ? { root: a.root ?? "/book", chapters: [] }
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
    window: { scrollY: 0, scrollTo() {} },
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
  await api.initialize();
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
  const slow = a.api.page("slow"),
    fast = a.api.page("fast");
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
  assert.equal(a.events.filter((x) => x === "mb:dispose").length, 4); // initial library plus three mounts
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
  await a.api.page("second");
  fail();
  await old;
  assert.equal(a.document.title, "second");
  assert.equal(a.document.querySelector('[role="alert"]'), undefined);
  await a.close();
});
