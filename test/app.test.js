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
    listeners = new Map();
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
    dispatchEvent() {},
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
    URL,
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
    source + ";({ initialize,launch,page })",
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
