# 网站上的阅读器 / Website reading

[中文](#中文) · [English](#english)

## 中文

Markdown Book 0.9.0 的静态构建可指定网站入口。正文、目录、搜索、题解往返、实验状态、静态回退与阅读设置继续使用共用阅读器。

```js
await buildBook(bookRoot, {
  base: "/books/imaging/2026-10/",
  outDir: outputDirectory,
  site: { home: "/books/", favicon: "/favicon.svg" },
  cover: { src: "assets/cover.png", alt: "摄影成像科学封面" },
});
```

```bash
markdown-book build ./book --out ./output --base /books/imaging/2026-10/ \
  --site-home /books/ --site-icon /favicon.svg \
  --cover assets/cover.png --cover-alt "摄影成像科学封面"
```

`site.home` 是返回书架的地址，可用站内绝对路径或 HTTP(S) URL。默认文字随界面语言显示“返回书架”或“Back to bookshelf”；可用 `site.label` / `--site-label` 指定固定文字。`site.favicon` / `--site-icon` 可使用网站图标；省略时不输出工具图标。构建器不读取宿主网站的代码或注入任意脚本。

网站模式保留书名、作者和许可，收起工具标志、格式标签、侧栏提交号及工具页脚。构建记录仍保存在 `build.json`，用于部署核对。省略 `site` 的本地预览和独立网站沿用原来的导航。站点入口属于发布配置，不写进可移植书稿。

封面是可选的本地图片。新书可在 `book.json` 声明 `cover: { "src": "assets/cover.png", "alt": "封面说明" }`；使用该新字段的清单需要 0.9.0 或更新阅读器。现有清单仍需旧版工具读取时，发布方可用上面的构建参数提供封面，原清单保持原样。构建参数优先于清单。

封面路径相对书籍根目录，沿用资源边界检查。构建器复制图片到 `media/`，在目录页展示，并在 `catalog.json` 输出 `cover: { href, alt }`，供书架生成卡片。作者、语言和许可也保留在目录元数据中。封面字节、说明文字、站点入口和图标网址均参与构建摘要；封面更改会更新摘要。自定义入口和图片说明按文本转义，入口只接受上述安全地址类型。

需要在站点工程外准备完整运行库时：

```bash
node scripts/bundle-plugin.js --out /absolute/path/to/new-empty-runtime
```

输出包括构建器、Reader、格式规范、许可和全部生产依赖。指定输出目录须不存在或为空；脚本拒绝替换已有文件的目录、项目根目录及其父目录。此命令不安装插件、不更新 marketplace，也不部署网站。发布方应固定源提交并保存运行库文件摘要，再用这个目录执行构建。

## English

Static builds in Markdown Book 0.9.0 accept `site: { home, label?, favicon? }`. The command-line equivalents are `--site-home`, `--site-label` and `--site-icon`. `home` and `favicon` accept site-absolute paths or HTTP(S) URLs. The default return label follows the reader language; a custom label is fixed text.

Site mode retains the book title, author, license and the shared reader's navigation, search, exercises, experiment persistence, static fallbacks and preferences. It omits tool branding, format labels, sidebar revisions and the tool footer. Build provenance remains in `build.json`. Omit `site` for the standalone reader. Website navigation belongs to deployment configuration rather than the manuscript.

An optional cover is `{ src, alt }`, with a book-relative local image path and a text alternative. New manifests may declare `cover`; that field requires readers 0.9.0 or later. A publisher may instead pass the `cover` build option, or `--cover` together with `--cover-alt`, to keep an existing manifest compatible with older readers. Build options override manifest metadata. The image is validated, copied to `media/`, shown on the contents page, and exported as `catalog.json`'s `cover: { href, alt }`. Cover bytes and presentation options contribute to the build digest.

`node scripts/bundle-plugin.js --out /absolute/path/to/new-empty-runtime` prepares a complete production runtime outside the source checkout. The chosen output must be missing or empty. Preserve the source revision and runtime hashes for reproducible website builds. This operation does not install or publish a plugin.
