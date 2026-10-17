import { searchEntries, searchExcerpt } from "./search-data.js";

export function startSearch({ state, signal, host }) {
  const trigger = document.querySelector(".search-toggle");
  const dialog = document.createElement("dialog");
  dialog.className = "reader-dialog search-dialog";
  dialog.setAttribute("aria-labelledby", "search-title");
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="search-title">查找书中内容</h2><button type="button" class="dialog-close" aria-label="关闭查找">×</button></div><div class="search-fields"><label><span class="visually-hidden">关键词</span><input type="search" placeholder="章节、正文或演示关键词" aria-label="查找关键词" autocomplete="off"></label><label><span class="visually-hidden">查找范围</span><select aria-label="查找范围"><option value="all">全部内容</option><option value="text">章节与正文</option><option value="interactive">互动演示</option></select></label></div><p class="search-status" role="status"></p><ol class="search-results"></ol>`;
  document.body.append(dialog);
  const input = dialog.querySelector("input");
  const filter = dialog.querySelector("select");
  const status = dialog.querySelector(".search-status");
  const results = dialog.querySelector(".search-results");
  let loading,
    generation = 0;
  async function index() {
    loading ??= (
      host?.loadIndex
        ? host.loadIndex()
        : fetch(`${state.base}search.json`, { signal }).then((response) => {
            if (!response.ok) throw new Error("查找内容暂未加载，请稍后重试。");
            return response.json();
          })
    ).catch((error) => {
      loading = undefined;
      throw error;
    });
    return loading;
  }
  async function render() {
    const current = ++generation;
    status.textContent = "正在加载…";
    try {
      const data = await index();
      if (signal.aborted || current !== generation || !dialog.open) return;
      const found = searchEntries(data.entries, input.value, filter.value);
      results.replaceChildren();
      for (const entry of found.entries) {
        const row = document.createElement("li");
        const link = document.createElement("a");
        link.href = `${state.base}${entry.chapterId}/#${encodeURIComponent(entry.anchor)}`;
        const title = document.createElement("strong");
        title.textContent =
          entry.kind === "interactive"
            ? `${entry.heading} · 互动演示`
            : entry.heading;
        const location = document.createElement("span");
        location.className = "search-location";
        location.textContent = entry.chapterTitle;
        const excerpt = document.createElement("small");
        excerpt.textContent = searchExcerpt(entry.text, input.value);
        link.append(title, location, excerpt);
        row.append(link);
        results.append(row);
      }
      status.textContent = found.total
        ? `${found.total} 条结果${found.total > found.entries.length ? `，显示前 ${found.entries.length} 条` : ""}`
        : "没有找到相关内容，可换个关键词。";
    } catch (error) {
      if (!signal.aborted && current === generation)
        status.textContent = error.message;
    }
  }
  function open() {
    if (!dialog.open) dialog.showModal();
    input.focus();
    void render();
  }
  trigger.addEventListener("click", open, { signal });
  input.addEventListener("input", render, { signal });
  filter.addEventListener("change", render, { signal });
  dialog
    .querySelector(".dialog-close")
    .addEventListener("click", () => dialog.close(), { signal });
  results.addEventListener(
    "click",
    (event) => {
      if (event.target.closest("a")) dialog.close();
    },
    { signal },
  );
  dialog.addEventListener("close", () => trigger.focus(), { signal });
  document.addEventListener(
    "keydown",
    (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    },
    { signal },
  );
  signal.addEventListener(
    "abort",
    () => {
      ++generation;
      dialog.remove();
    },
    { once: true },
  );
}
