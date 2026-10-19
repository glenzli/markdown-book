# 编写 Markdown Book / Authoring a Markdown Book

[中文](#中文) · [English](#english)

## 中文

先确定书籍目录、稳定 id、书名和许可。已有 Markdown 可以保留目录结构；按阅读顺序在 book.json 登记章节，保持既有链接和锚点。工具本身采用 MIT，不替作者决定教材许可。

以下四个文件组成最小可运行的互动书籍。每个代码块前的路径都相对书籍目录。

### `book.json`

```json
{
  "formatVersion": 1,
  "id": "first-book",
  "title": "第一本书",
  "language": "zh-CN",
  "chapters": [{ "id": "introduction", "file": "introduction.md" }],
  "components": {
    "counter": { "entry": "interactives/counter.js", "props": { "initial": 0 } }
  }
}
```

### `introduction.md`

```markdown
# 第一章

正文可以包含公式，例如 $y = x + 1$。互动显示计数器，每次点击增加 1。

<div data-mb-component="counter">

![计数器初始为零](figures/counter.svg)

</div>
```

### `interactives/counter.js`

```js
export function mount({ element, props, signal }) {
  let count = Number(props.initial ?? 0);
  const button = document.createElement("button");
  const render = () => {
    button.textContent = `Count: ${count}`;
  };
  render();
  button.addEventListener(
    "click",
    () => {
      count += 1;
      render();
    },
    { signal },
  );
  element.append(button);
  return () => element.replaceChildren();
}
```

### `figures/counter.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80"><rect x="1" y="1" width="238" height="78" rx="8" fill="white" stroke="black"/><text x="120" y="48" text-anchor="middle" font-size="20" fill="black">Count: 0</text></svg>
```

组件文字属于书稿，不随 Reader 语言切换。需要双语组件时由作者自己提供切换能力。生产组件应明确模型、单位、假设、参数范围与静态图表达的状态；图片应有说明，不用互动替代必要论证。

先运行 `markdown-book check /path/to/book`，再用原生面板或 `markdown-book serve /path/to/book` 观察实际行为，最后 `markdown-book build /path/to/book --out /tmp/book-preview --base /books/first-book/` 检查网站挂载路径。未全局安装 CLI 时，使用源码中的 `node bin/markdown-book.js` 或插件 `runtime/bin/markdown-book.js`。

check 只验证格式、资源、公式语法、锚点和模块接口，不运行组件，也不证明模型正确。检查滑块/按钮、重复挂载、离开章节后的清理、无 JavaScript/WebGL 时的静态图。计时器、requestAnimationFrame、观察器与 WebGL 对象均需释放；事件监听优先使用 signal。

规范：[格式 v1](format-v1.md)、[组件接口](../src/component.d.ts)、[Three.js](three-components.md)。需要 AI 协助时，使用插件的 `write-markdown-book` skill；它会保留作者已有结构并验证实际文件。

习题与答案可用 `data-mb-exercise`、`data-mb-solution` 和 `data-mb-for` 显式关联，
阅读器与静态网站会生成双向链接。保持 id 稳定，不依赖标题或题号自动配对。
完整示例见[习题与解答](format-v1.md#习题与解答)。

## English

Choose a book directory, stable id, title, and license. Existing manuscripts can keep their directory structure: register chapters in reading order and preserve links and anchors. The MIT tool license does not choose a license for your book.

The four files above form a complete runnable example. Paths are relative to the book directory. Set `title` and `language` to your manuscript's language. Declare components by id and keep a valid local static figure at every placement. Export `mount({ element, props, signal })`, keep UI inside that element, and return cleanup when needed.

Component labels belong to the book and are not translated by Reader preferences. Authors may implement component-specific localization. Explain models, units, assumptions, parameter limits, and the state shown in each static figure. An interactive demonstration does not replace an argument.

Run `markdown-book check /path/to/book`, inspect the actual behavior in a native panel or `markdown-book serve /path/to/book`, then build under the intended website prefix with `markdown-book build /path/to/book --out /tmp/book-preview --base /books/first-book/`. Without a global CLI, use `node bin/markdown-book.js` from the source checkout or the plugin's `runtime/bin/markdown-book.js`.

Check validates format, resources, formula syntax, anchors, and module contracts; it does not execute components or prove the model correct. Exercise controls, repeated mounts, chapter exit, and static fallback without JavaScript/WebGL. Clean up timers, animation frames, observers, and GPU resources. Prefer signal-bound event listeners.

See [format v1](format-v1.en.md), [component types](../src/component.d.ts), and [Three.js](three-components.md). The plugin's `write-markdown-book` skill helps an AI edit actual files, preserve the author's organization, and validate the result.

Use explicit `data-mb-exercise`, `data-mb-solution`, and `data-mb-for` containers for bidirectional question/answer links. Keep ids stable rather than inferring relationships from titles or numbers. See [exercises and solutions](format-v1.en.md#exercises-and-solutions).

## 封面与网站入口

封面和本站导航的构建示例见[网站构建](website-builds.md)。已有清单需保持旧阅读器可读时，使用发布方构建参数传封面；站点入口留在部署配置中。
