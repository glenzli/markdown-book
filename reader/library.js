import { translateDom } from "./i18n.js";
import { mountPreferences } from "./preferences.js";
/** Book selection UI. All paths and titles are rendered as text, never HTML. */
export function renderLibrary({
  data,
  preferences,
  mark,
  onOpen,
  onChoose,
  onForget,
  onRefresh,
  onError,
  onBack,
}) {
  const controller = new AbortController();
  const t = (key, values) => preferences.t(key, values);
  document.body.innerHTML = `<main class="mb-launcher">
    <header class="mb-library-heading"><h1>Markdown Book</h1><div class="mb-library-header-actions"><button class="mb-library-back" hidden data-mb-label="backReading">返回阅读</button><button class="preferences-toggle" type="button"></button></div></header>
    <p data-mb-label="chooseIntro">选择一本书，继续阅读。</p>
    <div class="mb-library-actions"><button class="mb-choose-directory" type="button" data-mb-label="chooseDirectory">选择文件夹…</button><button class="mb-refresh-library" type="button" data-mb-label="refresh">刷新</button></div>
    <label class="mb-search-label" for="mb-book-search" data-mb-label="findBooks">查找书籍</label><input type="search" id="mb-book-search" placeholder="书名或位置" data-mb-label-placeholder="bookQuery" autocomplete="off">
    <p role="alert" hidden></p><div class="mb-library-groups"></div>
    <details class="mb-path-details"><summary data-mb-label="enterPath">输入路径</summary><form><label for="mb-root" data-mb-label="bookFolder">书籍或项目文件夹</label><input id="mb-root" required placeholder="/absolute/path/to/book"><button type="submit" data-mb-label="open">打开</button></form></details>
    <p class="mb-library-note" data-mb-label="libraryNote">最近阅读仅保存在本机。选择项目文件夹时，会查找其中的 book.json。</p>
  </main>`;
  document.querySelector("h1").insertAdjacentHTML("afterbegin", mark);
  const guarded =
    (fn) =>
    (...args) =>
      Promise.resolve()
        .then(() => fn(...args))
        .catch(onError);
  if (onBack) {
    const back = document.querySelector(".mb-library-back");
    back.hidden = false;
    back.addEventListener("click", guarded(onBack));
  }
  document
    .querySelector(".mb-refresh-library")
    .addEventListener("click", guarded(onRefresh));
  document
    .querySelector(".mb-choose-directory")
    .addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.dataset.mbLabel = "choosing";
      button.textContent = t("choosing");
      try {
        await onChoose();
      } catch (error) {
        onError(error);
      } finally {
        button.disabled = false;
        button.dataset.mbLabel = "chooseDirectory";
        button.textContent = t("chooseDirectory");
      }
    });
  const form = document.querySelector("form");
  const openPath = (event) => {
    event.preventDefault();
    const root = document.getElementById("mb-root").value.trim();
    if (root) void guarded(onOpen)(root);
  };
  form.addEventListener("submit", openPath);
  // Opaque MCP App sandboxes may disallow native form submission.
  form.querySelector('[type="submit"]').addEventListener("click", openPath);
  function section(title, choices, recent, empty) {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = title;
    section.append(heading);
    const list = document.createElement("div");
    list.className = "mb-books";
    for (const choice of choices) {
      const row = document.createElement("div"),
        button = document.createElement("button");
      row.className = "mb-book-row";
      button.className = "mb-book-open";
      button.setAttribute("aria-label", t("openBook", { title: choice.title }));
      const name = document.createElement("strong"),
        location = document.createElement("small");
      name.textContent = choice.title;
      location.textContent = choice.root;
      location.title = choice.root;
      button.append(name);
      if (recent && choice.chapterTitle) {
        const resume = document.createElement("span");
        resume.className = "mb-resume";
        resume.textContent = t("resume", { title: choice.chapterTitle });
        button.append(resume);
      }
      button.append(location);
      button.addEventListener(
        "click",
        guarded(() => onOpen(choice.root, choice.chapterId)),
      );
      row.append(button);
      if (recent) {
        const forget = document.createElement("button");
        forget.className = "mb-forget-book";
        forget.textContent = "×";
        forget.title = t("forget");
        forget.setAttribute(
          "aria-label",
          t("forgetBook", { title: choice.title }),
        );
        forget.addEventListener(
          "click",
          guarded(() => onForget(choice.root)),
        );
        row.append(forget);
      }
      list.append(row);
    }
    if (!choices.length) {
      const message = document.createElement("p");
      message.className = "mb-empty";
      message.textContent = empty;
      list.append(message);
    }
    section.append(list);
    return section;
  }
  const query = document.getElementById("mb-book-search");
  function display() {
    const term = query.value.trim().toLocaleLowerCase();
    const filter = (choices = []) =>
      choices.filter((book) =>
        `${book.title} ${book.root}`.toLocaleLowerCase().includes(term),
      );
    const groups = document.querySelector(".mb-library-groups");
    groups.replaceChildren(
      section(
        t("recentBooks"),
        filter(data.recentBooks),
        true,
        term ? t("noRecentMatch") : t("recentEmpty"),
      ),
      section(
        t("workspaceBooks"),
        filter(data.workspaceBooks),
        false,
        term ? t("noWorkspaceMatch") : t("workspaceEmpty"),
      ),
    );
  }
  query.addEventListener("input", display);
  preferences.subscribe(
    () => {
      document.title = t("chooseBook");
      translateDom(preferences);
      display();
    },
    { signal: controller.signal },
  );
  mountPreferences(preferences, { signal: controller.signal });
  if (data.warning) onError(new Error(data.warning));
  return () => controller.abort();
}
