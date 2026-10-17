# Markdown Book 格式 v1

本规范定义以普通 Markdown 和可选浏览器互动组件组成的书籍源码。它是 Markdown 的书籍配置约定，不声称是所有阅读器共同支持的标准。格式版本为 `1`，工具包有独立的语义版本。

## 书籍清单

每本书有一个 `book.json`，文件所在目录是资源边界。所有章节与组件入口使用相对此目录的路径；不能通过 `..`、绝对路径或符号链接越过书籍目录。一仓多书时，每本书分别提供清单，不强制移动现有章节。

```json
{
  "formatVersion": 1,
  "id": "imaging",
  "title": "成像科学",
  "language": "zh-CN",
  "chapters": [{ "id": "noise", "file": "04_noise.md" }],
  "components": {
    "noise": {
      "entry": "interactives/noise/index.js",
      "props": { "seed": 20261017 }
    }
  }
}
```

完整机器约束见 [JSON Schema](../schema/book.schema.json)。书与章节标识采用小写字母、数字和短横线，章节 id 与 file 各自唯一。章节顺序以清单为准；网址使用稳定 id，不从标题或顺序生成。可选的 description、author、source 供阅读器展示与溯源。`license` 可填写 `{ "name": "CC BY-NC-ND 4.0", "url": "https://creativecommons.org/licenses/by-nc-nd/4.0/" }`，阅读器在每页保留许可链接；仓库与许可网址仅接受 HTTP(S)。

## 正文

- CommonMark 加 GFM 表格、任务列表、删除线和脚注。
- `$...$` 表示行内数学，`$$...$$` 表示独立数学；使用 KaTeX 支持的 LaTeX 子集，保留显式 `\tag{...}`。
- 标题生成唯一锚点，重复标题附加编号。跨章节链接仍写源文件的相对 `.md` 路径，构建时转为章节网址。
- 图片和下载文件相对当前 Markdown 文件定位，构建时复制到输出；资源不依赖 GitHub raw 或在线 CDN。
- 外部链接支持 HTTP(S)、mailto 和 tel。书内使用相对路径，不在源稿硬编码部署前缀。
- HTML 经清洗后渲染；原稿中的 script、事件处理属性和危险 URL 不执行。互动来自清单声明的受信任程序模块，模块拥有普通页面脚本能力。
- `check` 检查清单、文件、同页与跨章节锚点、公式及组件打包。它不证明公式正确、组件行为正确，也不检查远程链接可达性。

## 互动声明

在正文中用带静态替代图片的 HTML 容器标记位置，容器前后及内部 Markdown 保留空行：

```markdown
<div data-mb-component="noise">

![不同信号水平下的噪声预算](figures/noise.svg)

</div>
```

`noise` 必须存在于清单的 components 中。该容器至少有一幅有效本地图。GitHub 按普通图文阅读；网页在组件接近视口时加载其模块。静态内容在组件成功挂载后隐藏，失败时保留并显示错误。关闭 JavaScript 时仍可阅读正文与静态图。

组件可以使用 JavaScript、ES module 或 TypeScript 入口，必须命名导出 `mount`：

```js
export function mount({ element, props, signal }) {
  const button = document.createElement("button");
  button.textContent = props.label ?? "点击";
  element.append(button);
  button.addEventListener(
    "click",
    () => {
      button.textContent = "已点击";
    },
    { signal },
  );
  return () => element.replaceChildren();
}
```

`element` 是专属宿主元素，`props` 是清单 JSON 的独立副本，`signal` 在离开页面时中止。挂载可以返回 Promise；返回值为空或清理函数。定时器、观察器和其他资源由组件在清理时释放。组件把界面保持在宿主中，可用 Shadow DOM 隔离样式。签名见 [component.d.ts](../src/component.d.ts)。

浏览器组件在本地 Reader 和静态网页运行相同代码。v1 不提供本地命令执行、文件写入、Python kernel、网络代理或组件间共享状态协议。

## 输出与本地预览

`build --base /books/imaging/` 生成书目首页、每章 index.html、带内容指纹的 JS/CSS/字体、本地资源、catalog.json、原生面板组件映射 reader-map.json 与 build.json。输出目录内容挂载到指定 base。默认输出为书籍目录的 dist；仅覆盖此前由本工具为同一 book id 生成的输出，拒绝覆盖书籍根或未知目录。

build.json 记录工具与格式版本、输入摘要、观测到的 Git 提交和工作树状态。网页终态可重新生成，书稿与组件源码是维护入口。构建不会提交 Git 或部署网站。

`serve` 使用同一个构建器和阅读器，在临时目录生成结果，只监听 loopback；源文件变化后串行重建并通知页面刷新。构建失败时继续保留上次成功版本，显示错误，恢复后再刷新。预览不修改源稿或项目输出目录。

## Codex 原生阅读

工具注册标准 MCP App 资源 `ui://markdown-book/reader.html`。`open_workspace` 的 global 入口出现在全局侧栏，`open_reader` 的 thread 入口出现在会话面板；这两种入口由宿主呈现，书籍格式不依赖 Codex。

原生面板复用静态构建的正文、样式、公式和组件模块。MCP 网关为每个面板维护独立 viewKey，将本地图片与字体内联，并将同一组生成的模块打包为面板可加载的代码。面板通过 App 专用工具取页、接收更新和释放视图，不直接访问 loopback HTTP。CLI 与网站保留普通的章节网页、独立资源和按需组件加载。

书籍不需要添加 Codex 专用文件。插件的书籍发现只扫描显式项目目录内的三层子目录，不跟随目录符号链接；项目包含多本书时由读者选择。插件不提供写书、命令执行或部署工具。

## 可选的三维运行时

v1 的 `mount` 接口可以加载 Three.js 场景。工具提供 `@glenzli/markdown-book/three` 模块，在构建时解析到工具持有的固定版本引擎，不要求书籍额外安装依赖；这是运行时能力，不改变书籍格式版本。仍需同一个静态回退容器。生命周期、加载边界和模型要求见 [三维组件](three-components.md)。
