import path from "node:path";
import { createHash } from "node:crypto";
import { ReaderLibrary } from "./reader-library.js";
import { experimentValue } from "../reader/experiment-data.js";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { build as bundle } from "./bundler.js";
import { loadBook, projectFile } from "./manifest.js";
import { serveBook } from "./server.js";

const assetId = (source) => createHash("sha256").update(source).digest("hex");

const ignored = new Set([
  ".git",
  ".dev-mesh",
  ".agents",
  ".codex",
  "node_modules",
  "dist",
]);
const mime = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};
const exists = async (filename) =>
  stat(filename).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

/** Discover only inside an explicit workspace; never follow directory symlinks. */
export async function discoverBooks(input) {
  if (!path.isAbsolute(input)) throw new Error("root must be absolute");
  const root = await realpath(input);
  if (
    path.basename(root) === "book.json" ||
    (await exists(path.join(root, "book.json")))
  ) {
    const book = await loadBook(root);
    return [{ root: book.root, title: book.manifest.title }];
  }
  const books = [];
  let visited = 0;
  async function visit(directory, depth) {
    if (++visited > 500)
      throw new Error(
        "Workspace is too large to scan; choose the book directory containing book.json.",
      );
    if (await exists(path.join(directory, "book.json"))) {
      const book = await loadBook(directory);
      books.push({ root: book.root, title: book.manifest.title });
      return;
    }
    if (depth === 0) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)))
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !ignored.has(entry.name)
      )
        await visit(path.join(directory, entry.name), depth - 1);
  }
  await visit(root, 3);
  return books;
}

/** Share immutable builds per book; each app view owns its root and navigation. */
export class ReaderGateway {
  previews = new Map();
  opening = new Map();
  views = new Map();
  selections = new Map();
  closing = false;

  constructor(options = {}) {
    this.library = options.library ?? new ReaderLibrary(options);
  }

  async listBooks(workspaces = []) {
    const workspaceBooks = new Map(),
      warnings = [];
    for (const workspace of [...new Set(workspaces)]) {
      try {
        for (const book of await discoverBooks(workspace))
          workspaceBooks.set(book.root, book);
      } catch (error) {
        warnings.push(error.message);
      }
    }
    return {
      recentBooks: await this.library.list(),
      workspaceBooks: [...workspaceBooks.values()],
      workspaces,
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
    };
  }

  async preview(root) {
    if (this.closing) throw new Error("MCP server is closing");
    const book = await loadBook(root);
    if (!this.previews.has(book.root)) {
      if (!this.opening.has(book.root)) {
        const state = {
          cursor: 0,
          error: null,
          listeners: new Set(),
          native: null,
        };
        const notify = (error) => {
          state.cursor++;
          state.error = error?.message ?? null;
          state.native = null;
          for (const listener of [...state.listeners]) listener();
        };
        this.opening.set(
          book.root,
          serveBook(book.root, {
            onUpdate: () => notify(null),
            onError: (error) => notify(error),
          })
            .then(async (preview) => {
              if (this.closing) {
                await preview.close();
                throw new Error("MCP server is closing");
              }
              state.preview = preview;
              this.previews.set(book.root, state);
              return state;
            })
            .finally(() => this.opening.delete(book.root)),
        );
      }
      await this.opening.get(book.root);
    }
    return this.previews.get(book.root);
  }

  async open(root, chapterId) {
    const state = await this.preview(root);
    const { preview } = state;
    if (
      chapterId &&
      !preview.result.chapters.some((chapter) => chapter.id === chapterId)
    )
      throw new Error(`Unknown chapter: ${chapterId}`);
    const canonical = (await loadBook(root)).root;
    await this.library.remember(
      canonical,
      preview.result.manifest.title,
      chapterId,
    );
    return {
      root: canonical,
      bookId: preview.result.manifest.id,
      title: preview.result.manifest.title,
      chapters: preview.result.chapters,
      url: `${preview.url}${chapterId ? `${chapterId}/` : ""}`,
    };
  }

  async view(viewKey, root) {
    if (this.closing) throw new Error("MCP server is closing");
    if (root) {
      const selection = {};
      this.selections.set(viewKey, selection);
      const books = await discoverBooks(root);
      if (this.selections.get(viewKey) !== selection || this.closing)
        throw new Error("Book selection changed.");
      if (books.length !== 1) {
        this.closeView(viewKey, false);
        return { choices: books, workspace: root };
      }
      const opened = await this.open(books[0].root);
      if (this.selections.get(viewKey) !== selection || this.closing)
        throw new Error("Book selection changed.");
      this.closeView(viewKey, false);
      this.views.set(viewKey, {
        root: opened.root,
        state: await this.preview(opened.root),
        waiters: new Set(),
      });
      return opened;
    }
    const view = this.views.get(viewKey);
    if (!view) return { choices: [] };
    return this.open(view.root);
  }

  requireView(viewKey) {
    const view = this.views.get(viewKey);
    if (!view) throw new Error("Reader view not found.");
    return view;
  }

  async nativeAssets(state, componentNames = []) {
    if (!state.native)
      state.native = (async () => {
        const out = state.preview.result.outDir;
        const index = await readFile(path.join(out, "index.html"), "utf8");
        const stylesheet = index.match(
          /<link rel="stylesheet" href="([^"]+)">/,
        )?.[1];
        if (!stylesheet) throw new Error("Reader assets are missing");
        const cssFile = await projectFile(out, stylesheet.slice(1));
        let css = await readFile(cssFile, "utf8");
        css = css.replace(/src:([^;}]+);/g, (declaration, sources) => {
          const modern = sources.match(
            /url\([^)]*\.woff2\)\s*format\(["']?woff2["']?\)/,
          );
          return modern ? `src:${modern[0]};` : declaration;
        });
        const urls = [
          ...new Set(
            [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]),
          ),
        ];
        for (const url of urls) {
          const relative = url.replace(/^["']|["']$/g, "");
          if (relative.startsWith("data:")) continue;
          const filename = await projectFile(
            out,
            path.relative(out, path.resolve(path.dirname(cssFile), relative)),
          );
          const data = `data:${mime[path.extname(filename)] ?? "application/octet-stream"};base64,${(await readFile(filename)).toString("base64")}`;
          css = css.split(`url(${url})`).join(`url("${data}")`);
        }
        const map = JSON.parse(
          await readFile(path.join(out, "reader-map.json"), "utf8"),
        );
        return {
          stylesheet: css,
          stylesheetId: assetId(css),
          map,
          out,
          scripts: new Map(),
        };
      })().catch((error) => {
        state.native = null;
        throw error;
      });
    const assets = await state.native;
    const names = [...new Set(componentNames)].sort();
    const key = JSON.stringify(names);
    if (!assets.scripts.has(key))
      assets.scripts.set(
        key,
        (async () => {
          const core = await projectFile(
            assets.out,
            `assets/${assets.map.reader}`,
          );
          const entries = [];
          for (const name of names) {
            const component = assets.map.components[name];
            if (!component)
              throw new Error(`Unknown native component: ${name}`);
            const filename = await projectFile(
              assets.out,
              `assets/${component.file}`,
            );
            entries.push(
              `${JSON.stringify(name)}: { load: () => import(${JSON.stringify(filename)}), props: ${JSON.stringify(component.props)} }`,
            );
          }
          // Rebundle only this page's generated components; plain pages never load Three.js.
          const compiled = await bundle({
            stdin: {
              contents: `import { startReader } from ${JSON.stringify(core)}; startReader({${entries.join(",")}}, globalThis.__markdownBookHost);`,
              resolveDir: path.join(assets.out, "assets"),
              sourcefile: "native-reader.js",
              loader: "js",
            },
            bundle: true,
            write: false,
            format: "esm",
            platform: "browser",
            target: "es2022",
            minify: true,
            logLevel: "silent",
          });
          const javascript = compiled.outputFiles[0].text;
          return { javascript, javascriptId: assetId(javascript) };
        })().catch((error) => {
          assets.scripts.delete(key);
          throw error;
        }),
      );
    return {
      stylesheet: assets.stylesheet,
      stylesheetId: assets.stylesheetId,
      ...(await assets.scripts.get(key)),
    };
  }

  async page(viewKey, chapterId, knownAssets = {}) {
    const view = this.requireView(viewKey);
    const { state } = view;
    if (
      chapterId &&
      !state.preview.result.chapters.some((chapter) => chapter.id === chapterId)
    )
      throw new Error(`Unknown chapter: ${chapterId}`);
    const out = state.preview.result.outDir;
    let html = await readFile(
      await projectFile(
        out,
        chapterId ? `${chapterId}/index.html` : "index.html",
      ),
      "utf8",
    );
    const images = [
      ...new Set(
        [...html.matchAll(/<img\b[^>]*\bsrc="(\/media\/[^"?#]+)"/g)].map(
          (match) => match[1],
        ),
      ),
    ];
    for (const src of images) {
      const filename = await projectFile(out, decodeURIComponent(src.slice(1)));
      const data = `data:${mime[path.extname(filename)] ?? "application/octet-stream"};base64,${(await readFile(filename)).toString("base64")}`;
      html = html.split(`src="${src}"`).join(`src="${data}"`);
    }
    const body = html.match(/<body>([\s\S]*)<\/body>/)?.[1];
    if (!body) throw new Error("Reader page is missing");
    const pageState = JSON.parse(
      html.match(
        /<script id="mb-state" type="application\/json">([\s\S]*?)<\/script>/,
      )[1],
    );
    const assets = await this.nativeAssets(state, pageState.components);
    if (this.views.get(viewKey) !== view)
      throw new Error("Book selection changed.");
    await this.library.remember(
      view.root,
      state.preview.result.manifest.title,
      chapterId ?? null,
    );
    return {
      body,
      bookId: state.preview.result.manifest.id,
      experiments: await this.library.experiments(
        view.root,
        state.preview.result.manifest.id,
      ),
      stylesheetId: assets.stylesheetId,
      javascriptId: assets.javascriptId,
      ...(knownAssets.stylesheetId === assets.stylesheetId
        ? {}
        : { stylesheet: assets.stylesheet }),
      ...(knownAssets.javascriptIds?.includes(assets.javascriptId)
        ? {}
        : { javascript: assets.javascript }),
      title: state.preview.result.manifest.title,
      chapterId: chapterId ?? null,
      cursor: state.cursor,
      digest: state.preview.result.digest,
      error: state.error,
    };
  }

  async saveExperiments(viewKey, root, values, bookId) {
    const view = this.requireView(viewKey);
    if (view.root !== root || bookId !== view.state.preview.result.manifest.id)
      throw new Error("Book selection changed.");
    experimentValue(values, 131000);
    for (const [key, value] of Object.entries(values)) {
      experimentValue(value);
      const identity = JSON.parse(key);
      if (
        !Array.isArray(identity) ||
        identity.length !== 3 ||
        JSON.stringify(identity) !== key
      )
        throw new Error("Invalid experiment identity.");
      const [chapter, component, occurrence] = identity;
      if (
        !view.state.preview.result.chapters.some(
          (item) => item.id === chapter,
        ) ||
        !Object.hasOwn(
          view.state.preview.result.manifest.components,
          component,
        ) ||
        !Number.isSafeInteger(occurrence) ||
        occurrence < 0 ||
        occurrence > 127
      )
        throw new Error("Invalid experiment identity.");
    }
    await this.library.saveExperiments(root, values, bookId);
    return { saved: true };
  }

  async index(viewKey) {
    const view = this.requireView(viewKey);
    const result = JSON.parse(
      await readFile(
        path.join(view.state.preview.result.outDir, "search.json"),
        "utf8",
      ),
    );
    if (this.views.get(viewKey) !== view)
      throw new Error("Book selection changed.");
    return result;
  }

  async updates(viewKey, cursor, waitMs) {
    const view = this.requireView(viewKey);
    const { state } = view;
    if (state.cursor <= cursor && waitMs)
      await new Promise((resolve) => {
        let timer;
        const done = () => {
          clearTimeout(timer);
          state.listeners.delete(done);
          view.waiters.delete(done);
          resolve();
        };
        state.listeners.add(done);
        view.waiters.add(done);
        timer = setTimeout(done, waitMs);
      });
    return {
      cursor: state.cursor,
      error: state.error,
      closed: !this.views.has(viewKey),
      digest: state.preview.result.digest,
    };
  }

  closeView(viewKey, cancelSelection = true) {
    if (cancelSelection) this.selections.delete(viewKey);
    const view = this.views.get(viewKey);
    this.views.delete(viewKey);
    for (const done of [...(view?.waiters ?? [])]) done();
  }

  async close() {
    this.closing = true;
    await this.library.close();
    this.selections.clear();
    for (const key of [...this.views.keys()]) this.closeView(key);
    await Promise.allSettled([...this.opening.values()]);
    await Promise.all(
      [...this.previews.values()].map((state) => state.preview.close()),
    );
    this.previews.clear();
  }
}
