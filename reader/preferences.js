import { createPreferences } from "./preferences-data.js";
import { translateDom } from "./i18n.js";

export const preferenceIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></svg>`;
export function browserStorage() {
  return {
    get(store, key) {
      try {
        return window[store].getItem(key);
      } catch {
        return null;
      }
    },
    set(store, key, value) {
      try {
        window[store].setItem(key, value);
      } catch {
        /* Opaque origin. */
      }
    },
    remove(store, key) {
      try {
        window[store].removeItem(key);
      } catch {
        /* Optional persistence. */
      }
    },
  };
}
export function createBrowserPreferences(options = {}) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const preferences = createPreferences({
    storage: browserStorage(),
    languages: navigator.languages,
    dark: media.matches,
    ...options,
  });
  const controller = new AbortController();
  media.addEventListener(
    "change",
    () => preferences.updateSystem({ dark: media.matches }),
    { signal: controller.signal },
  );
  addEventListener(
    "languagechange",
    () => preferences.updateSystem({ languages: navigator.languages }),
    { signal: controller.signal },
  );
  let observer;
  preferences.subscribe(
    () => {
      document.documentElement.dataset.theme = preferences.resolvedTheme;
      document.documentElement.dataset.uiLanguage = preferences.locale;
      if (document.documentElement.lang !== preferences.locale) {
        document.documentElement.lang = preferences.locale;
        observer?.takeRecords();
      }
    },
    { signal: controller.signal },
  );
  observer = options.observeHostLanguage
    ? new MutationObserver(() => {
        const locale = document.documentElement.lang;
        if (locale) preferences.updateHost({ locale });
      })
    : null;
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  return {
    preferences,
    dispose: () => {
      controller.abort();
      observer?.disconnect();
    },
  };
}
export function mountPreferences(
  preferences,
  {
    signal,
    appVersion,
    button = document.querySelector(".preferences-toggle"),
  } = {},
) {
  if (!button) return;
  button.innerHTML = preferenceIcon;
  const dialog = document.createElement("dialog");
  dialog.className = "mb-preferences";
  dialog.setAttribute("aria-labelledby", "mb-preferences-title");
  dialog.innerHTML = `<div class="mb-preferences-heading"><h2 id="mb-preferences-title" data-mb-label="preferences"></h2><button type="button" class="mb-preferences-close" data-mb-label-aria-label="closePreferences">×</button></div><label><span data-mb-label="language"></span><select class="mb-language" data-mb-label-aria-label="language"><option value="auto" data-mb-label="automatic"></option><option value="zh-CN">中文</option><option value="en">English</option></select></label><label><span data-mb-label="theme"></span><select class="mb-theme" data-mb-label-aria-label="theme"><option value="auto" data-mb-label="automatic"></option><option value="light" data-mb-label="light"></option><option value="dark" data-mb-label="dark"></option></select></label><p data-mb-label="preferencesNote"></p>`;
  if (appVersion) {
    const version = document.createElement("p");
    version.className = "mb-reader-version";
    version.textContent = `Markdown Book ${appVersion}`;
    dialog.append(version);
  }
  document.body.append(dialog);
  const language = dialog.querySelector(".mb-language"),
    theme = dialog.querySelector(".mb-theme");
  preferences.subscribe(
    () => {
      language.value = preferences.language;
      theme.value = preferences.theme;
      button.title = preferences.t("preferences");
      button.setAttribute("aria-label", preferences.t("preferences"));
      translateDom(preferences);
    },
    { signal },
  );
  language.addEventListener(
    "change",
    () => preferences.setLanguage(language.value),
    { signal },
  );
  theme.addEventListener("change", () => preferences.setTheme(theme.value), {
    signal,
  });
  button.addEventListener(
    "click",
    () => {
      dialog.showModal();
      language.focus();
    },
    { signal },
  );
  dialog
    .querySelector(".mb-preferences-close")
    .addEventListener("click", () => dialog.close(), { signal });
  dialog.addEventListener("close", () => button.focus(), { signal });
  signal?.addEventListener("abort", () => dialog.remove(), { once: true });
}
