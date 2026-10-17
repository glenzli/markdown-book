import { normalizeLanguage, translate } from "./i18n.js";

export const preferencesKey = "markdown-book:preferences";
export function createPreferences({
  storage,
  initial,
  host = {},
  languages = ["en"],
  dark = false,
  onSave,
} = {}) {
  let stored;
  try {
    stored = JSON.parse(storage?.get("localStorage", preferencesKey) ?? "null");
  } catch {
    /* Optional storage. */
  }
  const source = initial ?? stored ?? {};
  let language = ["auto", "zh-CN", "en"].includes(source.language)
    ? source.language
    : "auto";
  const legacy = storage?.get("localStorage", "markdown-book:theme");
  let theme = ["auto", "light", "dark"].includes(source.theme)
    ? source.theme
    : ["light", "dark"].includes(legacy)
      ? legacy
      : "auto";
  const listeners = new Set();
  const api = {
    get language() {
      return language;
    },
    get theme() {
      return theme;
    },
    get locale() {
      return language !== "auto"
        ? language
        : typeof host.locale === "string" && host.locale
          ? (normalizeLanguage(host.locale) ?? "en")
          : (normalizeLanguage(languages[0]) ?? "en");
    },
    get resolvedTheme() {
      return theme !== "auto"
        ? theme
        : ["light", "dark"].includes(host.theme)
          ? host.theme
          : dark
            ? "dark"
            : "light";
    },
    t(key, values) {
      return translate(api.locale, key, values);
    },
    snapshot() {
      return { language, theme };
    },
    subscribe(fn, { signal } = {}) {
      if (signal?.aborted) return () => {};
      listeners.add(fn);
      const off = () => listeners.delete(fn);
      signal?.addEventListener("abort", off, { once: true });
      fn(api);
      return off;
    },
    setLanguage(value) {
      if (!["auto", "zh-CN", "en"].includes(value)) return;
      language = value;
      save();
    },
    setTheme(value) {
      if (!["auto", "light", "dark"].includes(value)) return;
      theme = value;
      save();
    },
    updateHost(patch) {
      host = { ...host, ...patch };
      notify();
    },
    updateSystem(patch) {
      languages = patch.languages ?? languages;
      dark = patch.dark ?? dark;
      notify();
    },
  };
  function notify() {
    for (const listener of listeners) listener(api);
  }
  function save() {
    storage?.set(
      "localStorage",
      preferencesKey,
      JSON.stringify(api.snapshot()),
    );
    onSave?.(api.snapshot());
    notify();
  }
  return api;
}
