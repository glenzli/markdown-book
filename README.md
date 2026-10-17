# Markdown Book

普通 Markdown 书稿、可复用的浏览器互动组件，以及本地与网站共用的阅读器。

当前为 0.5.1 开发版。包含格式 v1、`check / serve / build`、公式与资源转换、静态回退、源文件更新预览，以及 Codex 插件。尚未发布 npm 包，也未部署网站。

## 本地开发

需要 Node.js 22 或更新版本。

```bash
npm ci
node bin/markdown-book.js check /path/to/book
node bin/markdown-book.js serve /path/to/book
node bin/markdown-book.js build /path/to/book --out /tmp/book-site --base /books/example/
```

参数可以是包含 book.json 的目录，也可以是清单路径。`serve` 输出本地地址，默认动态选择空闲端口。静态构建输出的内容挂载到 `--base` 指定的路径即可，不要求主站重新解析正文。除本地预览的文件更新通知外，阅读与互动均不需要服务器 API。

本轮真实使用端位于相邻 Curio 仓库的 `books/photographic-imaging-science/book.json`，包含完整摄影教材的 25 个阅读页面、噪声、采样混叠、MTF、像场重对焦和 Three.js 对焦动画。书稿、图版与学科模型维护在 Curio，工具仓库不复制教材正文。

## 规范与源码

- [格式 v1](docs/format-v1.md)：清单、Markdown、互动声明与产物约定。
- [JSON Schema](schema/book.schema.json)：格式的机器约束。
- [组件接口](src/component.d.ts)：挂载、中止与清理。
- `src/manifest.js` 与 `src/markdown.js` 负责输入约束、正文和资源解析；`src/build.js` 与 `src/template.js` 负责静态产物。
- `src/reading-index.js` 为清理后的正文建立查找条目与源码位置。`reader/navigation.js`、`reader/search.js` 与 `reader/references.js` 分别管理目录、查找和阅读引用；`reader/reader.js` 负责共用页面与组件生命周期；`src/server.js` 负责本地监听与重建。`src/mcp.js` 注册 Codex 工具和原生入口，`src/reader-gateway.js` 管理独立视图，`reader/app.js` 负责 MCP App 宿主通信。

## Codex 本地插件

```bash
npm run plugin:bundle
codex plugin marketplace add /absolute/path/to/markdown-book
```

然后在 Codex 插件目录中选择 **Markdown Book** 来源并安装 **Markdown Book**，也可运行：

```bash
codex plugin add markdown-book@markdown-book-local --json
```

插件通过标准 MCP App 扩展提供两个原生入口：侧栏的 `open_workspace`，以及会话旁的 `open_reader`。两者加载同一个 `ui://markdown-book/reader.html`，每个面板独立选择书籍、章节和阅读位置。宿主提供当前项目时，会在项目内寻找 book.json；一仓多书显示选择页，也可以输入书籍的绝对路径。

在新聊天中可以说“预览这个项目的 Markdown 书籍”。支持 MCP Apps 的宿主直接打开阅读面板；插件不再要求把 localhost 网页当作原生侧栏。普通浏览器仍可通过 `serve` 或工具返回的备用 URL 阅读。`check_book` 提供格式与资源诊断。

面板使用同一份构建产物和组件代码，图片、KaTeX 字体与互动模块经 MCP 传入，运行时无需连接 localhost 或 CDN。`reader_view / reader_page / reader_updates / close_reader_view` 管理视图和更新；它们仅向 App 暴露，不修改书稿。最近阅读记录由本机用户数据目录保存。构建缓存可由同一本书的多个面板共用，源文件监听随 MCP 进程关闭。

插件源位于 `plugins/markdown-book/`，仓库市场清单位于 `.agents/plugins/marketplace.json`。`plugin:bundle` 在忽略的 runtime 目录准备自包含本地运行时，安装前运行；源码检出也可以直接使用仓库内 CLI。插件更新后，已启动的会话可能仍使用旧工具列表；在新会话或重新加载插件后使用新入口。插件不包含写书、部署或执行书稿命令的工具。

插件结构依据 [OpenAI 官方插件文档](https://developers.openai.com/plugins/build/plugins)，采用仍受支持的 Codex compatibility manifest；侧栏和会话入口依据 [官方扩展协议](https://developers.openai.com/plugins/build/extensions#sidebar-apps)。

## 三维组件与图标

组件可以从 `@glenzli/markdown-book/three` 导入内置的 Three.js、OrbitControls 和 `createThreeViewport`。书籍不需要单独安装 Three.js，也不需要 CDN。网页仅在对应组件接近视口时加载三维代码；原生面板仅打包当前页面用到的组件，普通章节不加载三维引擎。

视口助手统一处理尺寸、按需渲染、播放暂停、不可见时停帧和关闭时释放 GPU 资源。没有 WebGL 2 时，Reader 保留原静态图。使用约定与示例见 [三维组件](docs/three-components.md)。

图标采用透明底单色书页，右页的播放形表示动态内容。矢量原稿保存在 [assets/brand/markdown-book.svg](assets/brand/markdown-book.svg)；`npm run brand:build` 可重建插件的黑白 PNG。浅色与深色图标分别配置 `composerIcon / composerIconDark` 与 `logo / logoDark`，不设置品牌主题色；Reader 中的矢量图继承界面文字颜色。

## 验证

```bash
npm test
npm run check
npm run format:check
npm run brand:check
npm run package:check
```

修改清单 schema 后，运行 `node scripts/check-project.js --write-schema` 生成机器规范。测试覆盖真实输入边界、打包与输出、预览重建及 MCP 会话。组件的学科模型与行为测试由各书稿仓库承担。

代码采用 MIT；使用端教材及素材各自遵循其许可。

### 选择与继续阅读

未提供宿主工作区时，使用 MCP 启动目录发现书籍；不会自动扫描主目录或文件系统根目录。从侧边栏打开后，优先显示最近阅读和当前工作区中的书籍，可按书名或位置筛选。最近记录包含最后打开的章节；点击即可继续，切换书籍后也可返回原阅读位置。选择文件夹使用 macOS、Windows 或 Linux 的系统目录选择器；路径输入位于折叠的备用入口。移出最近阅读仅移除本地记录。

记录默认位于 `~/.markdown-book/recent-books.json`，可用 `MARKDOWN_BOOK_STATE` 指向其他本地状态文件。损坏或失效记录不会阻止打开新书，记录无法写入时仍可阅读。Linux 目录选择需要系统已安装 `zenity`；不可用时可使用工作区发现、最近记录或备用路径入口。

### 目录、查找与讨论

顶部的目录按钮可收起或展开章节栏，桌面端会记住选择；窄屏默认收起，选择章节后再次收起。右侧“本章内容”也可折叠。浏览器存储受限时，原生面板通过宿主视图状态保存目录偏好，阅读仍可继续。

点击查找按钮，或按 `⌘K` / `Ctrl+K`，可在章节、正文与互动演示中查找。结果可筛选为“章节与正文”或“互动演示”，点击后定位到对应段落或演示。网页按需加载本地 `search.json`；原生面板通过仅 App 可见的 `reader_index` 读取同一份索引，不依赖外部搜索服务。

在正文中选中文字后点击“讨论所选内容”，或使用顶部“与 AI 讨论”按钮，可预览将要引用的 Markdown、文件位置与行号，并补充问题。“新建 Codex 讨论”打开单独的可编辑对话草稿，由用户发送。没有选区时引用当前阅读小节；较长小节会明确标记节选。普通网页提供复制讨论内容，宿主不支持草稿接口时也使用这一入口。

新对话入口采用 [OpenAI 官方会话扩展](https://developers.openai.com/plugins/build/extensions) 的 `ui/message`，设置 `target: "new"` 与 `send: false`，按宿主广告的能力启用。选书、翻页和选区变化不会自行发送正文。
