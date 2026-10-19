import {
  createBrowserPreferences,
  browserStorage,
  mountPreferences,
} from "./preferences.js";
import { translateDom } from "./i18n.js";
import { startNavigation, startAnchorNavigation } from "./navigation.js";
import { startSearch } from "./search.js";
import { startReferences } from "./references.js";
import { createExperiments } from "./experiments.js";

const storage = browserStorage();

export function startReader(registry, host) {
  const state = JSON.parse(document.getElementById("mb-state").textContent);
  const controller = new AbortController();
  const preferenceSession = host?.preferences
    ? null
    : createBrowserPreferences();
  const preferences = host?.preferences ?? preferenceSession.preferences;
  const t = (key, values) => preferences.t(key, values);
  mountPreferences(preferences, {
    signal: controller.signal,
    appVersion: host?.appVersion,
  });
  preferences.subscribe(() => translateDom(preferences), {
    signal: controller.signal,
  });
  const cleanups = new Set();
  let stopped = false;
  document.documentElement.dataset.readerReady = "true";
  startNavigation({
    signal: controller.signal,
    storage,
    host,
    preferences,
    state,
  });
  startAnchorNavigation({ signal: controller.signal, host });
  startSearch({ state, signal: controller.signal, host, preferences });
  const experimentKey = [
    "markdown-book:experiments",
    state.base,
    state.bookId,
  ].join(":");
  const experiments = createExperiments({
    chapterId: state.chapterId,
    signal: controller.signal,
    read: () =>
      host?.getExperiments
        ? host.getExperiments()
        : JSON.parse(storage.get("localStorage", experimentKey) ?? "null"),
    write: (value, changes) =>
      host?.setExperiments
        ? host.setExperiments(value, changes)
        : storage.set("localStorage", experimentKey, JSON.stringify(value)),
  });
  document.addEventListener("mb:save-experiments", experiments.flush, {
    signal: controller.signal,
  });
  const references = startReferences({
    state,
    signal: controller.signal,
    host,
    preferences,
    experiments,
  });
  const occurrences = new Map();
  const componentInstances = new WeakMap();
  for (const container of document.querySelectorAll("[data-mb-component]")) {
    const name = container.dataset.mbComponent;
    const occurrence = occurrences.get(name) ?? 0;
    occurrences.set(name, occurrence + 1);
    componentInstances.set(container, occurrence);
  }

  async function mount(container) {
    const name = container.dataset.mbComponent;
    if (!registry[name] || container.dataset.mbStatus) return;
    container.dataset.mbStatus = "loading";
    const element = document.createElement("div");
    element.className = "component-content";
    element.hidden = true;
    container.append(element);
    const fallback = [...container.children].filter(
      (child) => child !== element,
    );
    const abort = new AbortController();
    controller.signal.addEventListener("abort", () => abort.abort(), {
      once: true,
    });
    let cleanup;
    try {
      const module = await registry[name].load();
      if (stopped) return;
      if (typeof module.mount !== "function")
        throw new Error(t("missingMount"));
      cleanup = await module.mount({
        element,
        props: structuredClone(registry[name].props),
        signal: abort.signal,
        session: experiments.session(
          name,
          componentInstances.get(container),
          container,
        ),
      });
      if (cleanup !== undefined && typeof cleanup !== "function")
        throw new Error(t("invalidCleanup"));
      if (stopped) {
        cleanup?.();
        return;
      }
      if (cleanup) cleanups.add(cleanup);
      fallback.forEach((child) => {
        child.hidden = true;
      });
      element.hidden = false;
      container.dataset.mbStatus = "ready";
      const toggle = document.createElement("button");
      toggle.className = "component-toggle";
      toggle.type = "button";
      preferences.subscribe(
        () => {
          toggle.textContent = t(
            element.hidden ? "returnInteractive" : "staticImage",
          );
        },
        { signal: controller.signal },
      );
      toggle.addEventListener(
        "click",
        () => {
          const showFallback = !element.hidden;
          element.hidden = showFallback;
          fallback.forEach((child) => {
            child.hidden = !showFallback;
          });
          toggle.textContent = t(
            showFallback ? "returnInteractive" : "staticImage",
          );
        },
        { signal: controller.signal },
      );
      const tools = document.createElement("div");
      tools.className = "component-tools";
      tools.append(toggle);
      if (state.chapter && experiments.snapshots(container).length) {
        const discuss = document.createElement("button");
        discuss.className = "component-toggle";
        discuss.type = "button";
        discuss.dataset.mbLabel = "discussExperiment";
        discuss.textContent = t("discussExperiment");
        discuss.addEventListener(
          "click",
          () => references.openExperiment(container),
          { signal: controller.signal },
        );
        preferences.subscribe(
          () => {
            discuss.textContent = t("discussExperiment");
          },
          { signal: controller.signal },
        );
        tools.append(discuss);
      }
      container.append(tools);
    } catch (error) {
      abort.abort();
      element.remove();
      container.dataset.mbStatus = "error";
      const notice = document.createElement("p");
      notice.className = "component-error";
      preferences.subscribe(
        () => {
          notice.textContent = t("componentFailed", { error: error.message });
        },
        { signal: controller.signal },
      );
      container.append(notice);
    }
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          void mount(entry.target);
        }
    },
    { rootMargin: "240px" },
  );
  const containers = [...document.querySelectorAll("[data-mb-component]")];
  const position = host?.getReadingPosition?.();
  const resumeIndex =
    position && Number.isFinite(position.offset)
      ? containers.findIndex(
          (element) =>
            element.dataset.mbComponent === position.component &&
            componentInstances.get(element) === position.occurrence,
        )
      : -1;
  if (resumeIndex >= 0) {
    // A component can be much taller than its static fallback. Restore the
    // semantic location after rebuilding all components above it, not just px.
    void (async () => {
      for (const element of containers.slice(0, resumeIndex + 1)) {
        if (stopped) return;
        await mount(element);
      }
      if (stopped) return;
      host.restoreReadingPosition(containers[resumeIndex]);
      containers
        .slice(resumeIndex + 1)
        .forEach((element) => observer.observe(element));
    })();
  } else containers.forEach((element) => observer.observe(element));
  let events;
  if (
    state.liveReload &&
    !document.documentElement.hasAttribute("data-mb-app")
  ) {
    events = new EventSource(`${state.base}__markdown_book/events`);
    events.addEventListener("reload", () => {
      storage.set(
        "sessionStorage",
        `mb-scroll:${location.pathname}`,
        String(window.scrollY),
      );
      location.reload();
    });
    events.addEventListener("build-error", (event) => {
      const notice = document.getElementById("reader-notice");
      notice.textContent = t("updateFailed", {
        error: JSON.parse(event.data).message,
      });
      notice.hidden = false;
    });
  }
  const scrollKey = `mb-scroll:${location.pathname}`;
  const savedScroll = storage.get("sessionStorage", scrollKey);
  if (savedScroll !== null) {
    storage.remove("sessionStorage", scrollKey);
    requestAnimationFrame(() => window.scrollTo(0, Number(savedScroll)));
  }
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    controller.abort();
    preferenceSession?.dispose();
    events?.close();
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        console.error("Component cleanup:", error);
      }
    }
    cleanups.clear();
    document.removeEventListener("mb:dispose", dispose);
    window.removeEventListener("pagehide", dispose);
  };
  document.addEventListener("mb:dispose", dispose, { once: true });
  window.addEventListener("pagehide", dispose, { once: true });
  return dispose;
}
