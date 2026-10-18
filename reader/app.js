import { createBrowserPreferences } from "./preferences.js";
import { prepareNavigation } from "./navigation.js";
import { renderLibrary } from "./library.js";
import { canDraftDiscussion, discussionRequest } from "./reference-data.js";
const appInfo = { name: "markdown-book", version: "0.7.5" };
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
  pageGeneration = 0,
  renderedPageGeneration = 0,
  renderedPage;
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
  initializedPanel = false,
  hostInitialized = false,
  selectionStarted = false,
  recovery,
  viewRevision = 0;
// Cache source text, not mounted components: every chapter still gets its own lifecycle.
const pageScripts = new Map();
let experimentWrites = Promise.resolve(),
  experimentRevision = 0;
const pendingExperiments = new Map(
  Object.entries(saved.pendingExperiments ?? {}).filter(
    ([, entry]) =>
      entry &&
      typeof entry.bookId === "string" &&
      entry.values &&
      typeof entry.values === "object" &&
      !Array.isArray(entry.values),
  ),
);
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

function activeBook(selected) {
  if (stopped || !selected || book !== selected)
    throw new Error(t("positionChanged"));
}
async function recoverView(selected, revision) {
  activeBook(selected);
  if (recovery?.book === selected) return recovery.promise;
  if (revision !== viewRevision) return;
  const work = { book: selected };
  work.promise = (async () => {
    const opened = await call("reader_view", { viewKey, root: selected.root });
    activeBook(selected);
    if (opened.root !== selected.root) throw new Error(t("positionChanged"));
    cursor = 0;
    viewRevision++;
  })().finally(() => {
    if (recovery === work) recovery = undefined;
  });
  recovery = work;
  return work.promise;
}
// Recreate only this selection. The only write using this path is an idempotent
// assignment of experiment parameters; conversation messages never use it.
async function viewCall(name, args, selected = book, allowStopped = false) {
  const revision = viewRevision;
  if (!stopped && recovery?.book === selected) await recovery.promise;
  try {
    return await call(name, args, allowStopped);
  } catch (error) {
    if (error.message !== "Reader view not found." || stopped || !selected)
      throw error;
    await recoverView(selected, revision);
    activeBook(selected);
    return call(name, args, allowStopped);
  }
}
function persistPending() {
  saved = {
    ...saved,
    pendingExperiments: Object.fromEntries(pendingExperiments),
  };
  window.openai?.setWidgetState?.(saved);
}
function savePending(selected) {
  experimentWrites = experimentWrites
    .then(async () => {
      const entry = pendingExperiments.get(selected.root);
      if (!entry || entry.bookId !== selected.bookId) return;
      const values = { ...entry.values };
      if (!Object.keys(values).length) return;
      await viewCall(
        "save_reader_experiments",
        {
          viewKey,
          root: selected.root,
          bookId: entry.bookId,
          values,
        },
        selected,
        true,
      );
      const current = pendingExperiments.get(selected.root);
      if (current !== entry) return;
      for (const [key, value] of Object.entries(values))
        if (current.values[key] === value) delete current.values[key];
      if (!Object.keys(current.values).length)
        pendingExperiments.delete(selected.root);
      persistPending();
    })
    .catch((error) => {
      if (!stopped)
        showError(
          new Error(t("experimentSaveFailed", { error: error.message })),
        );
    });
}
function experimentSnapshot(remote, selected) {
  const pending = pendingExperiments.get(selected.root);
  if (!pending || pending.bookId !== selected.bookId) return remote;
  const values = { ...remote.values, ...pending.values };
  for (const [key, value] of Object.entries(values))
    if (value === null) delete values[key];
  return { ...remote, values };
}
function launchSeed(result) {
  return (
    result?._meta?.reader ??
    result?.structuredContent?.reader ??
    (result?.structuredContent?.ready === true && result.structuredContent.root
      ? {
          root: result.structuredContent.root,
          chapterId: result.structuredContent.chapterId,
        }
      : undefined)
  );
}

function readingPosition() {
  const occurrences = new Map();
  for (const element of document.querySelectorAll("[data-mb-component]")) {
    if (!element.getBoundingClientRect) continue;
    const component = element.dataset.mbComponent;
    const occurrence = occurrences.get(component) ?? 0;
    occurrences.set(component, occurrence + 1);
    const rect = element.getBoundingClientRect();
    if (rect.bottom > 90 && rect.top < window.innerHeight)
      return { component, occurrence, offset: rect.top };
  }
  return null;
}
function persist() {
  if (!book) return;
  saved = {
    ...saved,
    root: book.root,
    chapterId: currentChapter,
    scrollTop: window.scrollY,
    readingPosition: readingPosition(),
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
      if (book)
        launch(book.root, currentChapter, window.scrollY, readingPosition());
      else if (lastLaunch) launch(...lastLaunch);
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
      readingPosition: readingPosition(),
    };
  const previous = libraryReturn;
  const generation = ++openingGeneration;
  ++pollGeneration;
  wakeWatch?.();
  ++pageGeneration;
  document.dispatchEvent(new Event("mb:save-navigation"));
  document.dispatchEvent(new Event("mb:save-experiments"));
  if (book) savePending(book);
  disposePage();
  await experimentWrites;
  book = null;
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
      ? () =>
          launch(
            previous.root,
            previous.chapterId,
            previous.scrollTop,
            previous.readingPosition,
          )
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
function replacePageBody(body, retainShell) {
  const sidebar = document.getElementById("book-sidebar");
  if (!retainShell || !sidebar || !document.querySelector(".reader-layout")) {
    document.body.innerHTML = body;
    return;
  }
  const template = document.createElement("template");
  template.innerHTML = body;
  const next = template.content;
  const nextSidebar = next?.querySelector("#book-sidebar");
  const directory = sidebar.querySelector("#book-chapters");
  const nextDirectory = nextSidebar?.querySelector("#book-chapters");
  const replacements = [".topbar", "#main", ".on-this-page", "#mb-state"].map(
    (selector) => [
      document.querySelector(selector),
      next?.querySelector(selector),
    ],
  );
  if (
    !next?.querySelector(".reader-layout") ||
    !directory ||
    !nextDirectory ||
    replacements.some(([current, replacement]) => !current || !replacement)
  ) {
    document.body.innerHTML = body;
    return;
  }
  const links = [...directory.querySelectorAll("a")];
  const nextLinks = [...nextDirectory.querySelectorAll("a")];
  const sameDirectory =
    links.length === nextLinks.length &&
    links.every(
      (link, index) =>
        link.getAttribute("href") === nextLinks[index].getAttribute("href") &&
        link.textContent === nextLinks[index].textContent,
    );
  if (sameDirectory)
    links.forEach((link, index) => {
      const current = nextLinks[index].getAttribute("aria-current");
      if (current) link.setAttribute("aria-current", current);
      else link.removeAttribute("aria-current");
    });
  else directory.replaceChildren(...nextDirectory.childNodes);
  for (const selector of [".book-name", ".sidebar-label", ".sidebar-footer"]) {
    const current = sidebar.querySelector(selector),
      replacement = nextSidebar.querySelector(selector);
    if (current && replacement) current.replaceWith(replacement);
  }
  // Keep the scrolling element and focused directory links attached. Only the
  // chapter, outline, header and state belong to the incoming page lifecycle.
  for (const [current, replacement] of replacements)
    current.replaceWith(replacement);
}

async function page(
  chapterId = null,
  anchor = "",
  scrollTop = 0,
  resumePosition = null,
  keepUnchanged = false,
) {
  let generation = keepUnchanged ? pageGeneration : ++pageGeneration;
  document.dispatchEvent(new Event("mb:save-navigation"));
  document.dispatchEvent(new Event("mb:save-experiments"));
  if (book) savePending(book);
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
    result = await viewCall("reader_page", args);
  } catch (error) {
    if (stopped || generation !== pageGeneration) return;
    throw error;
  }
  if (stopped || generation !== pageGeneration) return;
  if (
    keepUnchanged &&
    result.digest &&
    renderedPage?.book === book &&
    renderedPage.chapterId === chapterId &&
    renderedPage.digest === result.digest &&
    styleId === result.stylesheetId &&
    renderedPage.javascriptId === result.javascriptId
  ) {
    cursor = result.cursor;
    renderedPageGeneration = generation;
    if (result.error)
      showError(new Error(t("updateFailed", { error: result.error })));
    persist();
    return;
  }
  const javascript = result.javascript ?? pageScripts.get(result.javascriptId);
  if (typeof javascript !== "string") throw new Error(t("scriptUnavailable"));
  rememberScript(result.javascriptId, javascript);
  if (keepUnchanged) generation = ++pageGeneration;
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
  replacePageBody(result.body, renderedPage?.book === book);
  prepareNavigation({
    preference: saved.readerLayout,
    root: book.root,
    state: { bookId: result.bookId, chapterId },
  });
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
  renderedPage = {
    book: pageBook,
    chapterId,
    digest: result.digest,
    javascriptId: result.javascriptId,
  };
  pageBook.bookId = result.bookId;
  if (result.experiments && experimentRevision === savedRevision)
    saved = {
      ...saved,
      experiments: {
        ...saved.experiments,
        [pageBook.root]: experimentSnapshot(result.experiments, pageBook),
      },
    };
  const current = () => {
    if (stopped || generation !== pageGeneration || book !== pageBook)
      throw new Error(t("positionChanged"));
  };
  globalThis.__markdownBookHost = Object.freeze({
    root: pageBook.root,
    appVersion: appInfo.version,
    preferences,
    getLayout: () => saved.readerLayout,
    getReadingPosition: () => resumePosition,
    restoreReadingPosition: (element) => {
      if (stopped || generation !== pageGeneration || book !== pageBook) return;
      window.scrollTo(
        0,
        window.scrollY +
          element.getBoundingClientRect().top -
          resumePosition.offset,
      );
      persist();
    },
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
      let pending = pendingExperiments.get(pageBook.root);
      if (!pending || pending.bookId !== result.bookId) {
        pending = { bookId: result.bookId, values: {} };
        pendingExperiments.set(pageBook.root, pending);
      }
      Object.assign(pending.values, changes);
      while (pendingExperiments.size > 8)
        pendingExperiments.delete(pendingExperiments.keys().next().value);
      persistPending();
      savePending(pageBook);
    },
    loadIndex: async () => {
      current();
      const result = await viewCall("reader_index", { viewKey }, pageBook);
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
  renderedPageGeneration = generation;
  persist();
  if (result.error)
    showError(new Error(t("updateFailed", { error: result.error })));
  else if (pendingExperiments.get(pageBook.root)?.bookId === result.bookId)
    showError(new Error(t("experimentSavePending")));
}
async function open(root, chapterId, resumeScroll = 0, resumePosition = null) {
  const selection = ++openingGeneration;
  ++pollGeneration;
  wakeWatch?.();
  ++pageGeneration;
  persist();
  document.dispatchEvent(new Event("mb:save-navigation"));
  document.dispatchEvent(new Event("mb:save-experiments"));
  if (book) savePending(book);
  disposePage();
  await experimentWrites;
  if (stopped || selection !== openingGeneration) return;
  book = null;
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
  viewRevision++;
  await page(chapterId ?? null, "", resumeScroll, resumePosition);
  if (stopped || selection !== openingGeneration) return;
  const generation = ++pollGeneration;
  void watch(generation).catch(showError);
}
async function watch(generation) {
  while (!stopped && generation === pollGeneration) {
    try {
      const observedPage = pageGeneration;
      const observedView = viewRevision;
      const update = await viewCall("reader_updates", {
        viewKey,
        cursor,
        // Some hosts serialize app calls. Do not hold that queue during idle watches.
        waitMs: 0,
      });
      if (stopped || generation !== pollGeneration) return;
      if (
        observedPage === pageGeneration &&
        pageGeneration === renderedPageGeneration
      ) {
        if (update.closed) await recoverView(book, observedView);
        if (stopped || generation !== pollGeneration) return;
        if (observedPage === pageGeneration) {
          if (viewRevision !== observedView) {
            await page(
              currentChapter,
              "",
              window.scrollY,
              readingPosition(),
              true,
            );
          } else if (update.cursor !== cursor) {
            cursor = update.cursor;
            if (update.error)
              showError(new Error(t("updateFailed", { error: update.error })));
            else await page(currentChapter, "", window.scrollY);
          }
        }
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
function launch(root, chapterId, scrollTop, resumePosition = null) {
  // The book buttons remain present until the page arrives. Coalesce repeated clicks.
  if (openingPromise) {
    if (root !== lastLaunch?.[0] || chapterId !== lastLaunch?.[1])
      queuedLaunch = [root, chapterId, scrollTop, resumePosition];
    return openingPromise;
  }
  lastLaunch = [root, chapterId, scrollTop, resumePosition];
  const generation = openingGeneration + 1;
  loading(true);
  openingPromise = open(root, chapterId, scrollTop, resumePosition)
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
      // A live rebuild can add chapters after reader_view was opened. The
      // rendered directory is current; the backend validates the requested ID.
      const inDirectory = [
        ...document.querySelectorAll("#book-chapters a[href]"),
      ].some(
        (entry) =>
          entry.getAttribute("href").split("/").filter(Boolean)[0] === id,
      );
      if (!id || inDirectory) void page(id ?? null, anchor).catch(showError);
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
    const seed = launchSeed(message.params);
    if (!seed || stopped) return;
    initial = seed;
    if (receiveSeed) receiveSeed();
    else if (initializedPanel) {
      // A reused native panel must honor a subsequent explicit Open Reader action.
      void selectSeed(seed).catch(showError);
    }
  } else if (message.method === "ui/notifications/host-context-changed") {
    preferences.updateHost(message.params ?? {});
  } else if (message.method === "ui/resource-teardown") {
    document.dispatchEvent(new Event("mb:save-navigation"));
    document.dispatchEvent(new Event("mb:save-experiments"));
    persist();
    if (book) savePending(book);
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
function selectSeed(seed) {
  const resume = !selectionStarted;
  selectionStarted = true;
  if (seed.choose) return showLibrary(seed.root);
  if (!seed.root && !saved.root) return showLibrary();
  const sameBook = !seed.root || seed.root === saved.root;
  return launch(
    seed.root ?? saved.root,
    seed.chapterId ?? (resume && sameBook ? saved.chapterId : null),
    seed.chapterId ? 0 : resume && sameBook ? (saved.scrollTop ?? 0) : 0,
    !seed.chapterId && resume && sameBook ? saved.readingPosition : null,
  );
}
async function initialize() {
  if (!hostInitialized) {
    const initialized = await request("ui/initialize", {
      appInfo,
      appCapabilities: {},
      protocolVersion: "2026-01-26",
    });
    discussionAvailable = canDraftDiscussion(initialized.hostCapabilities);
    preferences.updateHost(initialized.hostContext ?? {});
    hostInitialized = true;
    send({ method: "ui/notifications/initialized" });
  }
  initial ??= launchSeed({ structuredContent: window.openai?.toolOutput });
  if (!initial)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        receiveSeed = undefined;
        // A late tool result remains useful; retry must not renegotiate a bridge
        // that the host has already initialized.
        initializedPanel = true;
        reject(new Error(t("missingSeed")));
      }, 25000);
      receiveSeed = () => {
        clearTimeout(timer);
        receiveSeed = undefined;
        resolve();
      };
    });
  initializedPanel = true;
  void selectSeed(initial).catch(showError);
}
void initialize().catch(showError);
