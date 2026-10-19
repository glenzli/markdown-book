import { translate } from "../reader/i18n.js";
import { brandMark, brandDataUrl } from "./brand.js";
export const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const json = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");

export function renderPage(book, chapter, state, liveReload = false) {
  const { manifest, chapters, base } = book;
  const t = (key, values) => translate(manifest.language, key, values);
  const label = (key, tag = "span", values = {}) =>
    `<${tag} data-mb-label="${key}" data-mb-values="${escapeHtml(JSON.stringify(values))}">${escapeHtml(t(key, values))}</${tag}>`;
  const current = chapter
    ? chapters.findIndex((entry) => entry.id === chapter.id)
    : -1;
  const previous = chapters[current - 1];
  const next = chapters[current + 1];
  const href = (id) => `${base}${id}/`;
  const navigation = chapters
    .map(
      (entry, index) =>
        `<a href="${href(entry.id)}" ${entry.id === chapter?.id ? 'aria-current="page"' : ""}><span class="chapter-number">${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(entry.title)}</span></a>`,
    )
    .join("");
  const toc =
    chapter?.headings
      .filter(({ level }) => level === 2)
      .map(
        ({ id, text }) =>
          `<a href="#${escapeHtml(id)}">${escapeHtml(text)}</a>`,
      )
      .join("") ?? "";
  const revision = state.commit ? state.commit.slice(0, 8) : "local";
  const source =
    manifest.source && chapter
      ? `${manifest.source.repository.replace(/\.git$/, "")}/blob/${state.dirty ? "main" : (state.commit ?? "main")}/${[manifest.source.path, chapter.file].filter(Boolean).join("/")}`
      : (manifest.source?.repository ?? null);
  const license = manifest.license
    ? `<a href="${escapeHtml(manifest.license.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(manifest.license.name)}</a>`
    : "";
  const site = book.site;
  const brand = site
    ? `<a class="brand site-return" href="${escapeHtml(site.home)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h13"/></svg>${site.label ? `<span>${escapeHtml(site.label)}</span>` : label("backToBookshelf")}</a>`
    : `<a class="brand" href="${base}"><span class="brand-symbol" aria-hidden="true">${brandMark}</span><span>Markdown Book</span></a>`;
  const favicon = site
    ? site.favicon
      ? `<link rel="icon" href="${escapeHtml(site.favicon)}">`
      : ""
    : `<link rel="icon" type="image/svg+xml" href="${brandDataUrl}">`;
  const sidebarFooter = site
    ? ""
    : `<div class="sidebar-footer"><span>${label(liveReload ? "livePreview" : "webReading")}</span><code>${revision}${state.dirty ? " · working tree" : ""}</code></div>`;
  const footer = `<footer class="reader-footer"><span>${site ? escapeHtml(manifest.author ?? "") : `Markdown Book · ${escapeHtml(manifest.author ?? "")}`}</span>${license}${source && !site ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">${label("viewSource")}</a>` : ""}</footer>`;
  const cover = book.cover
    ? `<img class="book-cover" src="${escapeHtml(book.cover.href)}" alt="${escapeHtml(book.cover.alt)}" decoding="async">`
    : "";
  const content =
    chapter?.html ??
    `<div class="book-intro"><div class="book-frontmatter${cover ? " has-cover" : ""}"><div><p class="eyebrow">${label(site ? "readingPageCount" : "pageCount", "span", { count: chapters.length })}</p><h1>${escapeHtml(manifest.title)}</h1><p class="book-description">${escapeHtml(manifest.description)}</p>${manifest.author ? `<p class="book-author">${escapeHtml(manifest.author)}</p>` : ""}<a class="start-reading" href="${href(chapters[0].id)}">${label("startReading")} <span aria-hidden="true">↗</span></a></div>${cover}</div><div class="book-contents">${chapters.map((entry, index) => `<a href="${href(entry.id)}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(entry.title)}</strong><span aria-hidden="true">→</span></a>`).join("")}</div></div>`;
  return `<!doctype html>
<html lang="${escapeHtml(manifest.language)}"><head><meta charset="utf-8">${favicon}<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escapeHtml(manifest.description)}"><meta name="color-scheme" content="light dark"><title>${escapeHtml(chapter ? `${chapter.title} · ${manifest.title}` : manifest.title)}</title><link rel="stylesheet" href="${base}assets/${book.stylesheet}"><script type="module" src="${base}assets/${book.javascript}"></script></head>
<body${site ? " data-mb-site" : ""}><a class="skip-link" href="#main">${label("skipContent")}</a><header class="topbar"><button class="reader-action navigation-toggle" type="button" aria-label="${escapeHtml(t("collapseChapters"))}" data-mb-label-aria-label="collapseChapters" title="${escapeHtml(t("collapseChapters"))}" data-mb-label-title="collapseChapters" aria-expanded="true" aria-controls="book-sidebar"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg></button>${brand}<span class="topbar-title">${escapeHtml(manifest.title)}</span><button class="reader-action search-toggle" type="button" aria-label="${escapeHtml(t("searchTitle"))}" data-mb-label-aria-label="searchTitle" title="${escapeHtml(t("searchTooltip"))}" data-mb-label-title="searchTooltip"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button><button class="reader-action discussion-toggle" type="button" aria-label="${escapeHtml(t("discuss"))}" data-mb-label-aria-label="discuss" title="${escapeHtml(t("discuss"))}" data-mb-label-title="discuss"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h6"/></svg></button><button class="reader-action preferences-toggle" type="button" aria-label="${escapeHtml(t("preferences"))}"></button></header><div class="reader-layout"><aside id="book-sidebar" class="sidebar"><a class="book-name" href="${base}">${escapeHtml(manifest.title)}</a><p class="sidebar-label">${label("contents")}</p><nav id="book-chapters" aria-label="${escapeHtml(t("chapters"))}" data-mb-label-aria-label="chapters">${navigation}</nav>${sidebarFooter}</aside><main id="main" class="main-column"><div id="reader-notice" role="status" hidden></div>${chapter ? `<div class="chapter-meta"><a href="${base}">${label("allChapters")}</a><span>${current + 1} / ${chapters.length}</span></div>` : ""}<article class="prose" lang="${escapeHtml(manifest.language)}">${content}</article>${chapter ? `<nav class="chapter-pagination" aria-label="${escapeHtml(t("chapterNavigation"))}" data-mb-label-aria-label="chapterNavigation">${previous ? `<a href="${href(previous.id)}"><small>${label("previousChapter")}</small>${escapeHtml(previous.title)}</a>` : `<a href="${base}"><small>${label("back")}</small>${label("bookContents")}</a>`}${next ? `<a href="${href(next.id)}"><small>${label("nextChapter")}</small>${escapeHtml(next.title)}</a>` : "<span></span>"}</nav>` : ""}${footer}</main><details class="on-this-page" open><summary>${label("onThisPage")}</summary><nav aria-label="${escapeHtml(t("onThisPage"))}" data-mb-label-aria-label="onThisPage">${toc}</nav></details></div><script id="mb-state" type="application/json">${json({ bookId: manifest.id, bookTitle: manifest.title, chapterId: chapter?.id ?? null, chapter: chapter ? { title: chapter.title, file: chapter.file, source: chapter.source } : null, base, liveReload: Boolean(liveReload), components: chapter?.components ?? [] })}</script></body></html>`;
}
