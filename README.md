# Markdown Book

普通 Markdown 书稿、可复用的浏览器互动组件，以及本地与网站共用的阅读器。

当前为 0.3.0 开发版。包含格式 v1、`check / serve / build`、公式与资源转换、静态回退、源文件更新预览，以及 Codex 插件。尚未发布 npm 包，也未部署网站。

## 本地开发

需要 Node.js 22 或更新版本。

```bash
npm ci
node bin/markdown-book.js check /path/to/book
node bin/markdown-book.js serve /path/to/book
node bin/markdown-book.js build /path/to/book --out /tmp/book-site --base /books/example/
```

参数可以是包含 book.json 的目录，也可以是清单路径。`serve` 输出本地地址，默认动态选择空闲端口。静态构建输出的内容挂载到 `--base` 指定的路径即可，不要求主站重新解析正文。除本地预览的文件更新通知外，阅读与互动均不需要服务器 API。

本轮真实使用端位于相邻 Curio 仓库的 `books/photographic-imaging-science/book.json`，包含完整摄影教材的 25 个阅读页面、第四章噪声互动和第十六章 Three.js 对焦动画。书稿、图版与学科模型维护在 Curio，工具仓库不复制教材正文。

## 规范与源码

- [格式 v1](docs/format-v1.md)：清单、Markdown、互动声明与产物约定。
- [JSON Schema](schema/book.schema.json)：格式的机器约束。
- [组件接口](src/component.d.ts)：挂载、中止与清理。
- `src/manifest.js` 与 `src/markdown.js` 负责输入约束、正文和资源解析；`src/build.js` 与 `src/template.js` 负责静态产物。
- `reader/reader.js` 负责共用页面与组件生命周期；`src/server.js` 负责本地监听与重建。`src/mcp.js` 注册 Codex 工具和原生入口，`src/reader-gateway.js` 管理独立视图，`reader/app.js` 负责 MCP App 宿主通信。

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

面板使用同一份构建产物和组件代码，图片、KaTeX 字体与互动模块经 MCP 传入，运行时无需连接 localhost 或 CDN。只读的 `reader_view / reader_page / reader_updates / close_reader_view` 管理视图和更新；它们仅向 App 暴露。构建缓存可由同一本书的多个面板共用，源文件监听随 MCP 进程关闭。

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
