# Markdown Book

[中文](#中文) · [English](#english)

<a id="中文"></a>

## 中文

普通 Markdown 书稿、浏览器互动组件，以及本地、Codex 和网站共用的阅读器。代码与配套文档采用 [MIT](LICENSE) 协议；书稿和素材的许可由各自作者决定。

阅读界面采用黑白灰底色，亮暗模式支持自动跟随或手动选择。

当前源码工具版本 **0.9.0**，书籍格式版本 **1**。适合在 GitHub 持续维护、在个人网站发布的网络书籍。尚未发布 npm 包。原生面板打开书籍时显示加载状态，合并重复点击；超时后可重试，复用面板会响应新的打开请求。切章时复用已载入的样式、公式字体和演示代码，避免重复传输；代码缓存有容量上限，并随面板关闭释放。书稿新增章节后可直接从更新的目录进入；切章保留目录滚动位置，并让当前章节保持可见。切章时保留现有目录节点，只更新正文和当前章节标记；“阅读设置”显示实际面板版本。每个发行版使用独立的原生界面资源地址，旧资源地址仍可读取。

侧栏重连会重建当前书籍的失效会话，并保留章节、滚动位置与实验参数；后台刷新不会
覆盖正在进行的章节切换。保存未获确认的实验设置会保留，重试后继续写入本地状态。
打开信息也随标准工具结果传递；信息迟到后可继续打开，无需重复初始化宿主连接。

## 安装 Codex 插件

需要 Node.js 22+。通过统一 marketplace 安装：

```bash
codex plugin marketplace add glenzli/marketplace --ref main
codex plugin add markdown-book@glenzli-marketplace --json
```

也可以在 Codex 的插件目录选择 **Glenzli Marketplace → Markdown Book**。更新前刷新来源，再安装新版本：

```bash
codex plugin marketplace upgrade glenzli-marketplace
codex plugin add markdown-book@glenzli-marketplace --json
```

安装包包含 Reader、构建器、生产依赖、规范和写作 skill，无需全局安装 CLI，也不需要在书稿目录运行 npm install。Node.js 需可由宿主找到。现有面板可能保留旧运行时；更新后重新加载插件或重启宿主，再打开阅读器。

在新对话中说“预览这个项目的 Markdown 书籍”。`open_workspace` 提供全局侧栏入口，`open_reader` 提供会话旁的阅读面板。未选择书籍时，面板显示最近阅读和当前工作区书籍，支持筛选、系统文件夹选择与折叠的路径入口。单仓库可以有多本书。

### 阅读与外观

阅读设置提供 **自动 / 中文 / English** 和 **自动 / 亮色 / 暗色**。自动语言优先使用宿主传入的 locale，未提供时使用浏览器/系统语言；中文使用简体界面，其他未支持的语言回退到英文。自动主题优先跟随宿主的明暗主题，未提供时使用系统偏好。宿主或系统变化时自动更新，手动选择优先，并且随时可以切回自动。

偏好保存在浏览器本地；存储受限的原生面板使用宿主视图状态。界面翻译覆盖选书、导航、查找、讨论及阅读设置，**不翻译书稿、章节标题或作者编写的互动组件**。诊断信息保留原始错误内容。

章节目录和“本章内容”均可收起。`⌘K` / `Ctrl+K` 查找章节、正文和互动演示，点击结果定位到原位置。正文选区或当前小节可附上 Markdown、文件和行号，在单独的 Codex 对话中创建可编辑的讨论草稿；由用户发送。普通网页支持复制讨论内容。

习题与答案支持显式关联，阅读器和静态网页自动生成“查看解答 / 返回习题”链接。题解可分布在不同章节，同题可有多份解答；题号仍由作者决定。[编写方法](docs/format-v1.md#习题与解答)。

实验参数可跨切章、关闭和重启恢复；原生模式保存在本机独立状态文件，网页模式使用浏览器本地存储。参与此接口的演示提供“讨论这个实验”，讨论草稿可附上打开时的参数、读数和模型条件，并可取消勾选。[组件会话规范](docs/experiment-sessions.md)。

最近阅读保存在 `~/.markdown-book/recent-books.json`，可用 `MARKDOWN_BOOK_STATE` 改用其他本机文件。移出最近阅读不删除书稿。系统目录选择器在 Linux 上需要 zenity；不可用时仍可使用工作区列表和路径入口。

### 编写一本书

- [格式 v1](docs/format-v1.md)：清单字段、正文、组件、资源边界和构建产物。
- [写作指南与可运行示例](docs/authoring.md)：新建、迁移已有书稿以及互动组件的最小实现。
- [JSON Schema](schema/book.schema.json) 与 [组件类型](src/component.d.ts)：机器约束和挂载/清理接口。
- [Three.js 组件](docs/three-components.md)：内置引擎、按需渲染、暂停和 GPU 资源释放。

插件同时提供 `open-markdown-book` 和 **`write-markdown-book`** 两个 skill。可以说“用 Markdown Book 新建一本书”或“把现有 Markdown 整理成 Markdown Book”。写作 skill 通过正常文件编辑创建书稿，并调用 check 验证；预览工具自身保持只读。

每本书由 `book.json`、普通 `.md`、本地图片和可选浏览器组件组成。互动位置必须保留静态图，GitHub 和无 JavaScript 环境也能读。书稿与学科模型留在书稿仓库，工具与 Reader 由本仓库维护；不复制教材正文到插件。

### 本地使用与网站构建

```bash
git clone https://github.com/glenzli/markdown-book.git
cd markdown-book
npm ci
node bin/markdown-book.js check /path/to/book
node bin/markdown-book.js serve /path/to/book
node bin/markdown-book.js build /path/to/book --out /tmp/book-site --base /books/example/
```

参数可以是书籍目录或 book.json。`serve` 只监听本机并在源文件变化后重建；失败时保留上次成功版本。静态输出挂载到指定 `--base` 即可，网站无需重新解析 Markdown。图片、KaTeX 字体、查找索引和组件均随产物提供，无需 CDN 或阅读服务 API。原生面板经 MCP 接收相同内容，不需要连接 localhost。

Three.js 通过 `@glenzli/markdown-book/three` 提供，仅在对应组件需要时加载。无 WebGL 2 时保留静态图。图标采用透明底单色书页，随界面文字颜色变化，不预设品牌主题色。

0.9.0 新增可选封面和网站导航：发布时可显示“返回书架”并收起工具信息，互动、题解和状态恢复继续共用。见[网站构建](docs/website-builds.md)。本轮新增能力先用于源码网站构建；公开插件目录仍为 0.8.0。

### 开发与发布

```bash
npm run release:check
npm run plugin:dist
npm run plugin:verify
npm run plugin:sync -- /absolute/path/to/marketplace
```

`plugin:dist` 在 `dist/markdown-book` 生成完整安装包和 `release.json`，记录源提交、源工作树是否有修改，以及每个文件的 SHA-256 和可执行权限。构建时优先使用本机原生 esbuild；不具备匹配二进制的平台自动使用同版本 WASM，避免复制 node_modules 后的平台冲突。WASM 构建更慢。

`plugin:sync` 校验包后只替换目标仓库的 `plugins/markdown-book` 并登记目录项，不提交 Git、不 push、不部署。完整流程见 [插件发布](docs/releasing.md)。维护者的本地开发统一使用 `glenzli-local`，其中的 `markdown-book` 条目指向本仓库生成的 `plugins/markdown-book`；运行 `npm run plugin:bundle` 后安装 `markdown-book@glenzli-local`。公开安装与更新使用上方的 `glenzli/marketplace`。

架构入口：`src/manifest.js` / `src/markdown.js` 管理书稿约束与解析；`src/build.js` / `src/template.js` 管理产物；`reader/preferences-data.js` / `reader/preferences.js` 管理语言、主题与偏好生命周期；`reader/reader.js` 管理页面和组件；`src/mcp.js` / `src/reader-gateway.js` / `reader/app.js` 管理原生面板。学科模型由书稿仓库验证，check 不证明数学或科学结论正确。

[English ↓](#english)

---

<a id="english"></a>

## English

Markdown manuscripts, browser interactives, and one reader for local previews, Codex panels, and static websites. The code and accompanying documentation are licensed under [MIT](LICENSE). Books and media retain their authors' own licenses.

The reader uses neutral grayscale surfaces, with automatic or manual light and dark appearance.

Source tool version **0.9.0**, book format **1**. Designed for books maintained on GitHub and published on the web. An npm package has not been published yet. Native panels show opening progress, coalesce repeated clicks, offer retry after timeouts, and accept fresh open requests when reused. Chapters reuse loaded styles, formula fonts, and interactive source bytes. The code cache has a size limit and is released when the panel closes. Newly added chapters open from the updated directory without reopening the book. Chapter changes preserve the directory scroll position and keep the current entry visible. Chapter changes retain the live directory node while updating the text and current entry. Reading settings show the loaded panel version. Each release has its own native UI resource address; the legacy address remains readable.

Sidebar recovery recreates a missing view for the current book while preserving its chapter,
scroll position, and experiment parameters. Background updates cannot supersede newer navigation.
Unconfirmed experiment assignments remain available for retry. Launch context also travels in
standard tool results, and late context can resume startup without reinitializing the host bridge.

Exercises and answers can be linked explicitly across chapters. Reader and static output generate “View solution / Back to exercise” links, including multiple answers per exercise. Authors keep control of numbering. See the [format](docs/format-v1.en.md#exercises-and-solutions).

## Install the Codex plugin

Requires Node.js 22+. Install from the shared marketplace:

```bash
codex plugin marketplace add glenzli/marketplace --ref main
codex plugin add markdown-book@glenzli-marketplace --json
```

Or choose **Glenzli Marketplace → Markdown Book** in the Codex plugin directory. To update:

```bash
codex plugin marketplace upgrade glenzli-marketplace
codex plugin add markdown-book@glenzli-marketplace --json
```

The package includes the reader, builder, production dependencies, specifications, and authoring skill. No global CLI or npm installation in the book project is needed. The host must be able to find Node.js. Existing panels may retain an older runtime; reload the plugin or restart the host, then reopen the reader after updating.

Ask “Preview the Markdown book in this project.” `open_workspace` provides a global sidebar entry, and `open_reader` opens beside a conversation. The library offers recent books, workspace discovery, filtering, a system folder picker, and a folded path input. A repository may contain multiple books.

### Reading and appearance

Reading settings offer **Automatic / 中文 / English** and **Automatic / Light / Dark**. Automatic language follows the host locale when supplied, otherwise the browser/system language. Chinese uses the Simplified Chinese interface; unsupported languages fall back to English. Automatic appearance follows the host theme when supplied, otherwise the system preference. Changes are applied live. Manual choices take priority and can be reset to Automatic.

Preferences use browser storage, with host view state for native panels where storage is unavailable. The library, navigation, search, discussion, and settings are translated. **Book text, chapter titles, and author-owned interactive UI remain unchanged.** Diagnostics retain their original error details.

Collapse the chapter sidebar or the on-page outline. Press `⌘K` / `Ctrl+K` to search chapters, text, and interactive demos. Results jump to their source location. Reference selected text or the current section, including its Markdown, file, and line numbers, in a separate editable Codex discussion draft. The user sends the draft. Static websites can copy the same discussion context.

Recent books live at `~/.markdown-book/recent-books.json`; override this with `MARKDOWN_BOOK_STATE`. Removing a recent entry never deletes a book. The Linux folder picker requires zenity; workspace discovery and path entry remain available without it.

Experiment sessions restore parameters across navigation and restarts. Native panels use a separate local state file; websites use browser storage. Opted-in components offer **Discuss this experiment** with a frozen, reviewable parameter/readout snapshot. [Session contract](docs/experiment-sessions.md).

### Author a book

- [Format v1](docs/format-v1.en.md): manifest fields, Markdown, components, resource boundaries, and build output.
- [Authoring guide and runnable example](docs/authoring.md#english): create a book or adapt an existing manuscript.
- [JSON Schema](schema/book.schema.json) and [component types](src/component.d.ts): machine constraints and the mount/cleanup interface.
- [Three.js components](docs/three-components.md): bundled engine, rendering, pause, and resource disposal.

The plugin includes `open-markdown-book` and **`write-markdown-book`** skills. Ask “Create a Markdown Book” or “Organize this existing manuscript as a Markdown Book.” The authoring skill uses normal file edits and validates with check; preview MCP tools remain read-only.

A book contains `book.json`, ordinary `.md` files, local media, and optional browser components. Every interactive placement retains a static figure for GitHub and readers without JavaScript. Books and subject models stay in their manuscript repositories. This repository owns the tool and shared reader.

### Local use and static builds

```bash
git clone https://github.com/glenzli/markdown-book.git
cd markdown-book
npm ci
node bin/markdown-book.js check /path/to/book
node bin/markdown-book.js serve /path/to/book
node bin/markdown-book.js build /path/to/book --out /tmp/book-site --base /books/example/
```

Pass a book directory or book.json. `serve` listens on loopback and rebuilds on source changes, retaining the last successful build after errors. Mount static output at the configured `--base`; the website does not reparse Markdown. Images, KaTeX fonts, search data, and components are local assets. No CDN or reading-service API is required. Native panels receive the same content through MCP without connecting to localhost.

Three.js is available through `@glenzli/markdown-book/three` and loads only where needed. Static figures remain available without WebGL 2. The transparent monochrome book icon inherits the interface text color and imposes no brand color.

0.9.0 adds optional covers and website navigation, with a return-to-bookshelf link and minimal tool chrome. Reading, exercises and experiment state still use the shared reader. See [website builds](docs/website-builds.md#english). These additions are currently available in source builds; the public plugin catalog remains at 0.8.0.

### Development and release

```bash
npm run release:check
npm run plugin:dist
npm run plugin:verify
npm run plugin:sync -- /absolute/path/to/marketplace
```

`plugin:dist` creates a complete package at `dist/markdown-book`. Its `release.json` records the source revision, dirty-source flag, and every file's SHA-256 and executable mode. Builds prefer native esbuild; platforms without a matching binary use the same-version WASM backend. WASM is slower, but avoids platform conflicts when distributing dependencies.

`plugin:sync` verifies the package, replaces only `plugins/markdown-book` in the target marketplace, and registers its catalog entry. It does not commit, push, or deploy. See [plugin releases](docs/releasing.md). Maintainer development uses the shared `glenzli-local` catalog, whose `markdown-book` entry points to this repository’s generated `plugins/markdown-book` directory. Run `npm run plugin:bundle`, then install `markdown-book@glenzli-local`. Public installs and updates use `glenzli/marketplace` as shown above.

Source ownership: `src/manifest.js` / `src/markdown.js` validate and parse books; `src/build.js` / `src/template.js` build output; `reader/preferences-data.js` / `reader/preferences.js` own language, theme, and preference lifecycle; `reader/reader.js` owns pages and components; `src/mcp.js` / `src/reader-gateway.js` / `reader/app.js` own native panels. Book repositories validate subject models; check does not establish mathematical or scientific correctness.

[返回中文 ↑](#中文)
