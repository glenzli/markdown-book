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
  moduleUrl,
  openingPromise,
  lastLaunch,
  queuedLaunch,
  wakeWatch,
  initializedPanel = false;
// Cache source text, not mounted components: every chapter still gets its own lifecycle.
const pageScripts = new Map();
let experimentWrites = Promise.resolve(),
  experimentRevision = 0;
const scriptBudget = 8 * 1024 * 1024;
let scriptBytes = 0;
function rememberScript(id, source) {
  if (!id || source.length * 2 > scriptBudget) return;
  if (pageScripts.has(id)) {
    scriptBytes -= pageScripts.get(id).length * 2;
    pageScripts.delete(id);
  }
  pageScripts.set(id, source);
  scriptBytes += source.length * 2;
  while (scriptBytes > scriptBudget || pageScripts.size > 32) {
    const oldest = pageScripts.keys().next().value;
    scriptBytes -= pageScripts.get(oldest).length * 2;
    pageScripts.delete(oldest);
  }
}
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
        : method === "tools/call" &&
            ["reader_view", "reader_page"].includes(params.name)
          ? 60000
          : 25000,
    );
    pending.set(id, { resolve, reject, timer, allowStopped });
    try {
      send({ id, method, params });
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error);
    }
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
  let retry = document.getElementById("mb-retry-reading");
  if (!retry && !stopped) {
    retry = document.createElement("button");
    retry.id = "mb-retry-reading";
    retry.type = "button";
    retry.textContent = t("retryReading");
    retry.addEventListener("click", () => {
      if (lastLaunch) launch(...lastLaunch);
      else void initialize().catch(showError);
    });
    notice.after(retry);
  }
}
function loading(active) {
  if (active) document.getElementById("mb-retry-reading")?.remove();
  let status = document.getElementById("mb-opening-status");
  if (active) {
    document.querySelector('[role="alert"]')?.setAttribute("hidden", "");
    if (!status) {
      status = document.createElement("p");
      status.id = "mb-opening-status";
      status.setAttribute("role", "status");
      document.body.prepend(status);
    }
    status.textContent = t("openingBook");
  } else status?.remove();
  for (const button of document.querySelectorAll(
    ".mb-book-open, .mb-choose-directory, .mb-refresh-library, .mb-path-details button",
  ))
    button.disabled = active;
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
  wakeWatch?.();
  ++pageGeneration;
  book = null;
  disposePage();
  await experimentWrites;
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
  document.dispatchEvent(new Event("mb:save-experiments"));
  await experimentWrites;
  if (stopped || generation !== pageGeneration) return;
  const savedRevision = experimentRevision;
  const styleId = document.getElementById("mb-book-style")?.dataset.assetId;
  const args = {
    viewKey,
    ...(chapterId ? { chapterId } : {}),
    assets: {
      ...(styleId ? { stylesheetId: styleId } : {}),
      javascriptIds: [...pageScripts.keys()],
    },
  };
  let result;
  try {
    result = await call("reader_page", args);
  } catch (error) {
    // The host may restart the MCP process while keeping this panel open.
    if (stopped || generation !== pageGeneration) return;
    if (error.message !== "Reader view not found." || !book) throw error;
    await call("reader_view", { viewKey, root: book.root });
    if (stopped || generation !== pageGeneration) return;
    result = await call("reader_page", args);
  }
  if (stopped || generation !== pageGeneration) return;
  const javascript = result.javascript ?? pageScripts.get(result.javascriptId);
  if (typeof javascript !== "string") throw new Error(t("scriptUnavailable"));
  rememberScript(result.javascriptId, javascript);
  disposePage();
  currentChapter = chapterId;
  cursor = result.cursor;
  let style = document.getElementById("mb-book-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "mb-book-style";
    document.head.append(style);
  }
  // Keep parsed formula fonts and CSS in place when the bytes have not changed.
  if (!result.stylesheetId || style.dataset.assetId !== result.stylesheetId) {
    style.textContent = result.stylesheet;
    if (result.stylesheetId) style.dataset.assetId = result.stylesheetId;
    else delete style.dataset.assetId;
  }
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
  if (result.experiments && experimentRevision === savedRevision)
    saved = {
      ...saved,
      experiments: {
        ...saved.experiments,
        [pageBook.root]: result.experiments,
      },
    };
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
    getExperiments: () => saved.experiments?.[pageBook.root],
    setExperiments: (value, changes = value.values) => {
      experimentRevision++;
      const experiments = { ...saved.experiments };
      delete experiments[pageBook.root];
      experiments[pageBook.root] = value;
      while (Object.keys(experiments).length > 8)
        delete experiments[Object.keys(experiments)[0]];
      saved = { ...saved, experiments };
      window.openai?.setWidgetState?.(saved);
      experimentWrites = experimentWrites
        .then(() =>
          call(
            "save_reader_experiments",
            {
              viewKey,
              root: pageBook.root,
              bookId: result.bookId,
              values: changes,
            },
            true,
          ),
        )
        .catch((error) => {
          if (!stopped)
            showError(
              new Error(t("experimentSaveFailed", { error: error.message })),
            );
        });
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
        `if (document.documentElement.dataset.mbPage === ${JSON.stringify(String(generation))}) {\n${javascript}\n}`,
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
  wakeWatch?.();
  ++pageGeneration;
  disposePage();
  await experimentWrites;
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
  void watch(generation).catch(showError);
}
async function watch(generation) {
  while (!stopped && generation === pollGeneration) {
    try {
      const update = await call("reader_updates", {
        viewKey,
        cursor,
        // Some hosts serialize app calls. Do not hold that queue during idle watches.
        waitMs: 0,
      });
      if (stopped || generation !== pollGeneration) return;
      if (update.closed) {
        await call("reader_view", { viewKey, root: book.root });
        if (stopped || generation !== pollGeneration) return;
        await page(currentChapter, "", window.scrollY);
      }
      if (update.cursor !== cursor) {
        cursor = update.cursor;
        if (update.error)
          showError(new Error(t("updateFailed", { error: update.error })));
        else await page(currentChapter, "", window.scrollY);
      }
    } catch (error) {
      if (stopped || generation !== pollGeneration) return;
      showError(error);
      return; // A visible retry replaces endless failing background requests.
    }
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (wakeWatch === done) wakeWatch = undefined;
        resolve();
      };
      const timer = setTimeout(done, document.hidden ? 10000 : 2000);
      wakeWatch = done;
    });
  }
}
// Run the watch loop independently of the opening request and report its errors.
function launch(root, chapterId, scrollTop) {
  // The book buttons remain present until the page arrives. Coalesce repeated clicks.
  if (openingPromise) {
    if (root !== lastLaunch?.[0] || chapterId !== lastLaunch?.[1])
      queuedLaunch = [root, chapterId, scrollTop];
    return openingPromise;
  }
  lastLaunch = [root, chapterId, scrollTop];
  const generation = openingGeneration + 1;
  loading(true);
  openingPromise = open(root, chapterId, scrollTop)
    .catch((error) => {
      if (generation === openingGeneration) showError(error);
    })
    .finally(() => {
      openingPromise = undefined;
      loading(false);
      const next = queuedLaunch;
      queuedLaunch = undefined;
      if (next && !stopped) launch(...next);
    });
  return openingPromise;
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
    const seed =
      message.params?._meta?.reader ??
      message.params?.structuredContent?.reader;
    if (!seed || stopped) return;
    initial = seed;
    if (receiveSeed) receiveSeed();
    else if (initializedPanel) {
      // A reused native panel must honor a subsequent explicit Open Reader action.
      if (seed.choose) void showLibrary(seed.root).catch(showError);
      else if (seed.root) launch(seed.root, seed.chapterId, 0);
    }
  } else if (message.method === "ui/notifications/host-context-changed") {
    preferences.updateHost(message.params ?? {});
  } else if (message.method === "ui/resource-teardown") {
    preferenceSession.dispose();
    stopped = true;
    queuedLaunch = undefined;
    ++pollGeneration;
    wakeWatch?.();
    disposePage();
    pageScripts.clear();
    scriptBytes = 0;
    for (const [id, work] of pending) {
      if (work.allowStopped) continue;
      pending.delete(id);
      clearTimeout(work.timer);
      work.reject(new Error(t("panelClosed")));
    }
    void experimentWrites
      .then(() => call("close_reader_view", { viewKey }, true))
      .catch(() => {})
      .finally(() => {
        if (message.id !== undefined) send({ id: message.id, result: {} });
      });
  } else if (message.id !== undefined && pending.has(message.id)) {
    const work = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(work.timer);
    // Opaque parent origins cannot be used as postMessage targetOrigin.
    if (origin === "*" && event.origin !== "null") origin = event.origin;
    if (message.error) work.reject(new Error(message.error.message));
    else work.resolve(message.result);
  }
});
async function initialize() {
  const initialized = await request("ui/initialize", {
    appInfo: { name: "markdown-book", version: "0.7.1" },
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
  initializedPanel = true;
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
