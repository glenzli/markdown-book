import {
  createBrowserPreferences,
  browserStorage,
  mountPreferences,
} from "./preferences.js";
import { translateDom } from "./i18n.js";
import { startNavigation } from "./navigation.js";
import { startSearch } from "./search.js";
import { startReferences } from "./references.js";

const storage = browserStorage();

export function startReader(registry, host) {
  const state = JSON.parse(document.getElementById("mb-state").textContent);
  const controller = new AbortController();
  const preferenceSession = host?.preferences
    ? null
    : createBrowserPreferences();
  const preferences = host?.preferences ?? preferenceSession.preferences;
  const t = (key, values) => preferences.t(key, values);
  mountPreferences(preferences, { signal: controller.signal });
  preferences.subscribe(() => translateDom(preferences), {
    signal: controller.signal,
  });
  const cleanups = new Set();
  let stopped = false;
  document.documentElement.dataset.readerReady = "true";
  startNavigation({ signal: controller.signal, storage, host, preferences });
  startSearch({ state, signal: controller.signal, host, preferences });
  startReferences({ state, signal: controller.signal, host, preferences });

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
      container.append(toggle);
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
  document
    .querySelectorAll("[data-mb-component]")
    .forEach((element) => observer.observe(element));
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
