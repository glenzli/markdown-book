/** Book selection UI. All paths and titles are rendered as text, never HTML. */
export function renderLibrary({
  data,
  mark,
  onOpen,
  onChoose,
  onForget,
  onRefresh,
  onError,
  onBack,
}) {
  document.title = "选择书籍 · Markdown Book";
  document.body.innerHTML = `<main class="mb-launcher">
    <header class="mb-library-heading"><h1>Markdown Book</h1><button class="mb-library-back" hidden>返回阅读</button></header>
    <p>选择一本书，继续阅读。</p>
    <div class="mb-library-actions"><button class="mb-choose-directory" type="button">选择文件夹…</button><button class="mb-refresh-library" type="button">刷新</button></div>
    <label class="mb-search-label" for="mb-book-search">查找书籍</label><input type="search" id="mb-book-search" placeholder="书名或位置" autocomplete="off">
    <p role="alert" hidden></p><div class="mb-library-groups"></div>
    <details class="mb-path-details"><summary>输入路径</summary><form><label for="mb-root">书籍或项目文件夹</label><input id="mb-root" required placeholder="/absolute/path/to/book"><button type="submit">打开</button></form></details>
    <p class="mb-library-note">最近阅读仅保存在本机。选择项目文件夹时，会查找其中的 book.json。</p>
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
      button.textContent = "正在选择…";
      try {
        await onChoose();
      } catch (error) {
        onError(error);
      } finally {
        button.disabled = false;
        button.textContent = "选择文件夹…";
      }
    });
  document.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    void guarded(onOpen)(document.getElementById("mb-root").value.trim());
  });
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
      button.setAttribute("aria-label", `打开《${choice.title}》`);
      const name = document.createElement("strong"),
        location = document.createElement("small");
      name.textContent = choice.title;
      location.textContent = choice.root;
      location.title = choice.root;
      button.append(name);
      if (recent && choice.chapterTitle) {
        const resume = document.createElement("span");
        resume.className = "mb-resume";
        resume.textContent = `继续 · ${choice.chapterTitle}`;
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
        forget.title = "移出最近阅读";
        forget.setAttribute("aria-label", `从最近阅读移除《${choice.title}》`);
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
        "最近阅读",
        filter(data.recentBooks),
        true,
        term ? "没有匹配的最近书籍。" : "打开的书会出现在这里。",
      ),
      section(
        "当前工作区",
        filter(data.workspaceBooks),
        false,
        term
          ? "当前工作区没有匹配的书籍。"
          : "未发现书籍，可选择书籍或项目文件夹。",
      ),
    );
  }
  query.addEventListener("input", display);
  display();
  if (data.warning) onError(new Error(data.warning));
}
