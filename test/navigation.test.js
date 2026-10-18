import test from "node:test";
import assert from "node:assert/strict";
import { startNavigation } from "../reader/navigation.js";

function fixture(
  t,
  {
    saved = {},
    book = "book",
    chapter = "chapter18",
    narrow = false,
    activeOffset = null,
  } = {},
) {
  const controller = new AbortController(),
    writes = [],
    timers = new Map();
  let rafId = 0,
    layoutValue = saved;
  class Element extends EventTarget {
    constructor() {
      super();
      this.scrollTop = 0;
      this.height = 300;
      this.hidden = false;
      this.open = true;
      this.attributes = {};
    }
    get clientHeight() {
      return this.hidden || !this.open ? 0 : this.height;
    }
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
    toggleAttribute(key, value) {
      this.attributes[key] = value;
    }
    querySelector() {
      return activeOffset === null
        ? null
        : {
            getBoundingClientRect: () => ({
              top: 100 + activeOffset - this.scrollTop,
              bottom: 150 + activeOffset - this.scrollTop,
            }),
          };
    }
    getBoundingClientRect() {
      return { top: 100, bottom: 400 };
    }
  }
  const sidebar = new Element(),
    toc = new Element(),
    toggle = new Element(),
    layout = new Element(),
    media = new EventTarget();
  media.matches = narrow;
  const doc = new EventTarget();
  doc.querySelector = (key) =>
    ({
      ".navigation-toggle": toggle,
      ".reader-layout": layout,
      ".on-this-page": toc,
    })[key] ?? null;
  doc.getElementById = () => sidebar;
  const replacements = {
    document: doc,
    matchMedia: () => media,
    requestAnimationFrame: (fn) => {
      const id = ++rafId;
      timers.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => timers.delete(id),
  };
  const descriptors = Object.fromEntries(
    Object.keys(replacements).map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  t.after(() => {
    controller.abort();
    for (const [k, d] of Object.entries(descriptors))
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
  });
  for (const [k, v] of Object.entries(replacements))
    Object.defineProperty(globalThis, k, {
      value: v,
      configurable: true,
      writable: true,
    });
  const storageValues = new Map();
  startNavigation({
    signal: controller.signal,
    state: { base: "/", bookId: book, chapterId: chapter },
    storage: {
      get: () => null,
      set: (kind, key, value) => storageValues.set(key, value),
    },
    host: {
      getLayout: () => layoutValue,
      setLayout: (value) => {
        layoutValue = structuredClone(value);
        writes.push(layoutValue);
      },
    },
    preferences: { t: (k) => k, subscribe: (fn) => fn() },
  });
  for (const fn of timers.values()) fn();
  timers.clear();
  return {
    sidebar,
    toc,
    toggle,
    doc,
    controller,
    writes,
    storageValues,
    get value() {
      return layoutValue;
    },
  };
}
const key = "/:" + "book";
test("directory scroll survives a chapter replacement and is independent of page scroll", (t) => {
  const a = fixture(t, {
    saved: {
      scrollPositions: {
        [key]: { sidebar: 760, toc: 180, chapterId: "chapter18" },
      },
    },
  });
  assert.equal(a.sidebar.scrollTop, 760);
  assert.equal(a.toc.scrollTop, 180);
  a.sidebar.scrollTop = 835;
  a.sidebar.dispatchEvent(new Event("scroll"));
  a.doc.dispatchEvent(new Event("mb:save-navigation"));
  assert.equal(a.value.scrollPositions[key].sidebar, 835);
  a.controller.abort();
  assert.equal(a.value.scrollPositions[key].sidebar, 835);
});
test("a different chapter retains the book directory offset and starts its own heading list at the top", (t) => {
  const a = fixture(t, {
    chapter: "chapter17",
    saved: {
      scrollPositions: {
        [key]: { sidebar: 740, toc: 160, chapterId: "chapter18" },
      },
    },
  });
  assert.equal(a.sidebar.scrollTop, 740);
  assert.equal(a.toc.scrollTop, 0);
});
test("a fresh or out-of-view selected chapter is revealed inside the directory only", (t) => {
  const a = fixture(t, { activeOffset: 900 });
  assert.equal(a.sidebar.scrollTop, 650);
  const box = a.sidebar.querySelector().getBoundingClientRect();
  assert.equal(box.bottom, 400);
});
test("collapse and expand keep the same directory position", (t) => {
  const a = fixture(t, {
    saved: {
      scrollPositions: {
        [key]: { sidebar: 780, toc: 0, chapterId: "chapter18" },
      },
    },
  });
  a.toggle.dispatchEvent(new Event("click"));
  assert.equal(a.sidebar.hidden, true);
  a.sidebar.scrollTop = 0;
  a.toggle.dispatchEvent(new Event("click"));
  assert.equal(a.sidebar.hidden, false);
  assert.equal(a.sidebar.scrollTop, 780);
});
test("mobile opening and book changes do not reuse an unrelated directory position", (t) => {
  const a = fixture(t, {
    narrow: true,
    book: "other",
    saved: {
      scrollPositions: {
        [key]: { sidebar: 780, toc: 90, chapterId: "chapter18" },
      },
    },
  });
  assert.equal(a.sidebar.hidden, true);
  a.toggle.dispatchEvent(new Event("click"));
  assert.equal(a.sidebar.scrollTop, 0);
  a.controller.abort();
  assert.equal(a.value.scrollPositions[key].sidebar, 780);
});
test("corrupt positions are ignored and an unmounted reader cancels pending saves", (t) => {
  const a = fixture(t, {
    saved: {
      scrollPositions: {
        [key]: { sidebar: -1, toc: Infinity, chapterId: "chapter18" },
      },
    },
  });
  assert.equal(a.sidebar.scrollTop, 0);
  assert.equal(a.toc.scrollTop, 0);
  a.sidebar.scrollTop = 140;
  a.sidebar.dispatchEvent(new Event("scroll"));
  a.controller.abort();
  const count = a.writes.length;
  a.sidebar.scrollTop = 200;
  a.sidebar.dispatchEvent(new Event("scroll"));
  assert.equal(a.writes.length, count);
  assert.equal(a.value.scrollPositions[key].sidebar, 140);
});
