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
  const content =
    chapter?.html ??
    `<div class="book-intro"><p class="eyebrow">MARKDOWN BOOK · ${chapters.length} 页</p><h1>${escapeHtml(manifest.title)}</h1><p class="book-description">${escapeHtml(manifest.description)}</p>${manifest.author ? `<p class="book-author">${escapeHtml(manifest.author)}</p>` : ""}<a class="start-reading" href="${href(chapters[0].id)}">开始阅读 <span aria-hidden="true">↗</span></a><div class="book-contents">${chapters.map((entry, index) => `<a href="${href(entry.id)}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(entry.title)}</strong><span aria-hidden="true">→</span></a>`).join("")}</div></div>`;
  return `<!doctype html>
<html lang="${escapeHtml(manifest.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escapeHtml(manifest.description)}"><meta name="color-scheme" content="light dark"><title>${escapeHtml(chapter ? `${chapter.title} · ${manifest.title}` : manifest.title)}</title><link rel="stylesheet" href="${base}assets/${book.stylesheet}"><script type="module" src="${base}assets/${book.javascript}"></script></head>
<body><a class="skip-link" href="#main">跳到正文</a><header class="topbar"><a class="brand" href="${base}"><span class="brand-symbol" aria-hidden="true">▥</span><span>Markdown Book</span></a><span class="topbar-title">${escapeHtml(manifest.title)}</span><button class="theme-toggle" type="button" aria-label="切换明暗主题" title="切换明暗主题">◐</button></header><div class="reader-layout"><aside class="sidebar"><a class="book-name" href="${base}">${escapeHtml(manifest.title)}</a><p class="sidebar-label">目录</p><button class="chapter-list-toggle" type="button" aria-expanded="false" aria-controls="book-chapters">章节目录 · ${chapters.length} 页 <span aria-hidden="true">⌄</span></button><nav id="book-chapters" aria-label="章节">${navigation}</nav><div class="sidebar-footer"><span>${liveReload ? "本地预览 · 自动更新" : "网页阅读"}</span><code>${revision}${state.dirty ? " · working tree" : ""}</code></div></aside><main id="main" class="main-column"><div id="reader-notice" role="status" hidden></div>${chapter ? `<div class="chapter-meta"><a href="${base}">全部章节</a><span>${current + 1} / ${chapters.length}</span></div>` : ""}<article class="prose">${content}</article>${chapter ? `<nav class="chapter-pagination" aria-label="前后章节">${previous ? `<a href="${href(previous.id)}"><small>上一章</small>${escapeHtml(previous.title)}</a>` : `<a href="${base}"><small>返回</small>本书目录</a>`}${next ? `<a href="${href(next.id)}"><small>下一章</small>${escapeHtml(next.title)}</a>` : "<span></span>"}</nav>` : ""}<footer class="reader-footer"><span>Markdown Book · ${escapeHtml(manifest.author ?? "")}</span>${license}${source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">查看源码 ↗</a>` : ""}</footer></main><aside class="on-this-page"><span class="sidebar-label">本章内容</span><nav aria-label="本章内容">${toc}</nav></aside></div><script id="mb-state" type="application/json">${json({ bookId: manifest.id, chapterId: chapter?.id ?? null, base, liveReload: Boolean(liveReload), components: chapter?.components ?? [] })}</script></body></html>`;
}
