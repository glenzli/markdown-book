import { createBrowserPreferences } from "./preferences.js";
import { renderLibrary } from "./library.js";
import { canDraftDiscussion, discussionRequest } from "./reference-data.js";
const appMark = document.querySelector(".mb-app-mark")?.outerHTML ?? "";
// MCP Apps host bridge. Navigation stays inside this panel, including opaque origins.
const pending = new Map();
const viewKey = crypto.randomUUID().replaceAll("-", "");
let sequence = 0,
  origin = "*",
  stopped = false,
  initial,
  receiveSeed,
  pollGeneration = 0,
  pageGeneration = 0;
let saved = window.openai?.widgetState ?? {};
const preferenceSession = createBrowserPreferences({
  observeHostLanguage: true,
  initial: saved.preferences,
  host: {
    locale: window.openai?.locale ?? document.documentElement.lang,
    theme: window.openai?.theme,
  },
  onSave(preferences) {
    saved = { ...saved, preferences };
    window.openai?.setWidgetState?.(saved);
  },
});
const preferences = preferenceSession.preferences;
const t = (key, values) => preferences.t(key, values);
let disposeLibrary;
const connecting = document.querySelector('[role="status"]');
if (connecting) connecting.textContent = t("connecting");
let book,
  currentChapter = null,
  cursor = 0,
  moduleUrl;
let discussionAvailable = false;
const send = (message) =>
  parent.postMessage({ jsonrpc: "2.0", ...message }, origin);
function request(method, params = {}, allowStopped = false) {
  if (stopped && !allowStopped)
    return Promise.reject(new Error(t("panelClosed")));
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(new Error(t("connectionTimeout")));
      },
      method === "tools/call" && params.name === "choose_book_directory"
        ? 300000
        : 25000,
    );
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
}
async function call(name, args, allowStopped = false) {
  const result = await request(
    "tools/call",
    { name, arguments: args },
    allowStopped,
  );
  if (result.isError)
    throw new Error(
      result.content?.find((item) => item.type === "text")?.text ??
        t("readerUnavailable"),
    );
  return result.structuredContent;
}
function persist() {
  if (!book) return;
  saved = {
    ...saved,
    root: book.root,
    chapterId: currentChapter,
    scrollTop: window.scrollY,
  };
  window.openai?.setWidgetState?.(saved);
}
function disposePage() {
  disposeLibrary?.();
  disposeLibrary = undefined;
  delete globalThis.__markdownBookHost;
  document.dispatchEvent(new Event("mb:dispose"));
  document.getElementById("mb-page-module")?.remove();
  if (moduleUrl) URL.revokeObjectURL(moduleUrl);
  moduleUrl = null;
  delete document.documentElement.dataset.mbPage;
}
function showError(error) {
  let notice =
    document.getElementById("reader-notice") ??
    document.querySelector('[role="alert"]');
  if (!notice) {
    notice = document.createElement("p");
    notice.setAttribute("role", "alert");
    document.body.prepend(notice);
  }
  notice.textContent = error.message ?? String(error);
  notice.hidden = false;
}
let libraryRoot,
  libraryReturn,
  openingGeneration = 0;
async function showLibrary(root = libraryRoot) {
  persist();
  if (book)
    libraryReturn = {
      root: book.root,
      chapterId: currentChapter,
      scrollTop: window.scrollY,
    };
  const previous = libraryReturn;
  const generation = ++openingGeneration;
  ++pollGeneration;
  ++pageGeneration;
  book = null;
  disposePage();
  await call("close_reader_view", { viewKey });
  const data = await call("reader_library", { ...(root ? { root } : {}) });
  if (stopped || generation !== openingGeneration) return;
  libraryRoot = root;
  document.getElementById("mb-book-style")?.remove();
  disposeLibrary = renderLibrary({
    data,
    preferences,
    mark: appMark,
    onError: showError,
    onOpen: (root, chapterId) => {
      launch(root, chapterId);
    },
    onBack: previous
      ? () => launch(previous.root, previous.chapterId, previous.scrollTop)
      : null,
    onRefresh: () => showLibrary(root),
    onForget: async (root) => {
      await call("forget_recent_book", { root });
      await showLibrary();
    },
    onChoose: async () => {
      const selected = await call("choose_book_directory");
      if (selected.cancelled) return;
      if (selected.choices.length === 1) launch(selected.choices[0].root);
      else if (selected.choices.length) await showLibrary(selected.root);
      else showError(new Error(t("noBookFolder")));
    },
  });
  window.scrollTo(0, 0);
}
async function page(chapterId = null, anchor = "", scrollTop = 0) {
  const generation = ++pageGeneration;
  const result = await call("reader_page", {
    viewKey,
    ...(chapterId ? { chapterId } : {}),
  });
  if (stopped || generation !== pageGeneration) return;
  disposePage();
  currentChapter = chapterId;
  cursor = result.cursor;
  let style = document.getElementById("mb-book-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "mb-book-style";
    document.head.append(style);
  }
  style.textContent = result.stylesheet;
  document.body.innerHTML = result.body;
  document.title = result.title;
  const switcher = document.createElement("button");
  switcher.type = "button";
  switcher.className = "mb-switch-book";
  switcher.textContent = t("switchBook");
  switcher.dataset.mbLabel = "switchBook";
  libraryReturn = null;
  switcher.addEventListener("click", () => void showLibrary().catch(showError));
  document.querySelector(".topbar").append(switcher);
  const pageBook = book;
  const current = () => {
    if (stopped || generation !== pageGeneration || book !== pageBook)
      throw new Error(t("positionChanged"));
  };
  globalThis.__markdownBookHost = Object.freeze({
    root: pageBook.root,
    preferences,
    getLayout: () => saved.readerLayout,
    setLayout: (readerLayout) => {
      if (stopped) return;
      saved = { ...saved, readerLayout };
      persist();
    },
    loadIndex: async () => {
      current();
      const result = await call("reader_index", { viewKey });
      current();
      return result;
    },
    ...(discussionAvailable
      ? {
          draftDiscussion: (content) => {
            current();
            return request("ui/message", discussionRequest(content));
          },
        }
      : {}),
  });
  document.documentElement.dataset.mbPage = String(generation);
  moduleUrl = URL.createObjectURL(
    new Blob(
      [
        `if (document.documentElement.dataset.mbPage === ${JSON.stringify(String(generation))}) {\n${result.javascript}\n}`,
      ],
      { type: "text/javascript" },
    ),
  );
  const script = document.createElement("script");
  script.id = "mb-page-module";
  script.type = "module";
  script.src = moduleUrl;
  script.onerror = () => showError(new Error(t("scriptUnavailable")));
  document.head.append(script);
  if (anchor)
    document.getElementById(decodeURIComponent(anchor))?.scrollIntoView();
  else window.scrollTo(0, scrollTop);
  persist();
  if (result.error)
    showError(new Error(t("updateFailed", { error: result.error })));
}
async function open(root, chapterId, resumeScroll = 0) {
  const selection = ++openingGeneration;
  ++pollGeneration;
  ++pageGeneration;
  const result = await call("reader_view", {
    viewKey,
    ...(root ? { root } : {}),
  });
  if (stopped || selection !== openingGeneration) return;
  if (!result.root) {
    await showLibrary(result.workspace);
    return;
  }
  book = result;
  await page(chapterId ?? null, "", resumeScroll);
  if (stopped || selection !== openingGeneration) return;
  const generation = ++pollGeneration;
  while (!stopped && generation === pollGeneration) {
    try {
      const update = await call("reader_updates", {
        viewKey,
        cursor,
        waitMs: 15000,
      });
      if (stopped || generation !== pollGeneration || update.closed) return;
      if (update.cursor !== cursor) {
        cursor = update.cursor;
        if (update.error)
          showError(new Error(t("updateFailed", { error: update.error })));
        else await page(currentChapter, "", window.scrollY);
      }
    } catch (error) {
      if (stopped || generation !== pollGeneration) return;
      showError(error);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}
// Run the watch loop independently of the opening request and report its errors.
function launch(root, chapterId, scrollTop) {
  const generation = openingGeneration + 1;
  void open(root, chapterId, scrollTop).catch((error) => {
    if (generation === openingGeneration) showError(error);
  });
}
document.addEventListener(
  "click",
  (event) => {
    const link = event.target.closest?.("a[href]");
    if (
      !link ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const href = link.getAttribute("href");
    if (href.startsWith("#")) {
      event.preventDefault();
      document
        .getElementById(decodeURIComponent(href.slice(1)))
        ?.scrollIntoView();
      return;
    }
    if (href.startsWith("/")) {
      event.preventDefault();
      const [pathname, anchor = ""] = href.split("#");
      const id = pathname.split("/").filter(Boolean)[0];
      if (!id || book?.chapters.some((chapter) => chapter.id === id))
        void page(id ?? null, anchor).catch(showError);
      return;
    }
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      event.preventDefault();
      void request("ui/open-link", { url: href }).catch(showError);
    }
  },
  true,
);
addEventListener(
  "scroll",
  () => {
    if (book) persist();
  },
  { passive: true },
);
addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== parent ||
    message?.jsonrpc !== "2.0" ||
    (origin !== "*" && event.origin !== origin)
  )
    return;
  if (message.method === "ui/notifications/tool-result") {
    initial =
      message.params?._meta?.reader ??
      message.params?.structuredContent?.reader ??
      {};
    receiveSeed?.();
  } else if (message.method === "ui/notifications/host-context-changed") {
    preferences.updateHost(message.params ?? {});
  } else if (message.method === "ui/resource-teardown") {
    preferenceSession.dispose();
    stopped = true;
    ++pollGeneration;
    disposePage();
    for (const work of pending.values()) {
      clearTimeout(work.timer);
      work.reject(new Error(t("panelClosed")));
    }
    pending.clear();
    void call("close_reader_view", { viewKey }, true)
      .catch(() => {})
      .finally(() => {
        if (message.id !== undefined) send({ id: message.id, result: {} });
      });
  } else if (message.id !== undefined && pending.has(message.id)) {
    const work = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(work.timer);
    if (origin === "*") origin = event.origin;
    if (message.error) work.reject(new Error(message.error.message));
    else work.resolve(message.result);
  }
});
async function initialize() {
  const initialized = await request("ui/initialize", {
    appInfo: { name: "markdown-book", version: "0.6.0" },
    appCapabilities: {},
    protocolVersion: "2026-01-26",
  });
  discussionAvailable = canDraftDiscussion(initialized.hostCapabilities);
  preferences.updateHost(initialized.hostContext ?? {});
  send({ method: "ui/notifications/initialized" });
  initial ??= window.openai?.toolOutput?.reader;
  if (!initial)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        receiveSeed = undefined;
        reject(new Error(t("missingSeed")));
      }, 25000);
      receiveSeed = () => {
        clearTimeout(timer);
        receiveSeed = undefined;
        resolve();
      };
    });
  if (initial.choose) {
    await showLibrary(initial.root);
    return;
  }
  if (!initial.root && !saved.root) {
    await showLibrary();
    return;
  }
  const sameBook = !initial.root || initial.root === saved.root;
  launch(
    initial.root ?? saved.root,
    initial.chapterId ?? (sameBook ? saved.chapterId : null),
    initial.chapterId ? 0 : sameBook ? (saved.scrollTop ?? 0) : 0,
  );
}
void initialize().catch(showError);
