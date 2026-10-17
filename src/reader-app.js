import { readFile } from "node:fs/promises";
import { build as bundle } from "esbuild";
import { fileURLToPath } from "node:url";

export const readerResourceUri = "ui://markdown-book/reader.html";
let resource;

/** A self-contained MCP App shell. Book bytes travel through app-only tools. */
export function readerAppHtml() {
  return (resource ??= (async () => {
    const compiled = await bundle({
      entryPoints: [
        fileURLToPath(new URL("../reader/app.js", import.meta.url)),
      ],
      write: false,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      minify: true,
      logLevel: "silent",
    });
    const css = await readFile(
      new URL("../reader/app.css", import.meta.url),
      "utf8",
    );
    return `<!doctype html><html lang="zh-CN" data-mb-app><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="mb-launcher"><h1>Markdown Book</h1><p role="status">正在连接阅读器…</p></main><script type="module">${compiled.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  })());
}
