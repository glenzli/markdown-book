import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { build as bundle } from "./bundler.js";
import { loadBook, inside, normalizeBase } from "./manifest.js";
import { renderChapter } from "./markdown.js";
import { renderPage } from "./template.js";

const toolRoot = fileURLToPath(new URL("../", import.meta.url));
const resolveDependency = createRequire(import.meta.url).resolve;
export const toolVersion = "0.7.0";
const sha = (value) => createHash("sha256").update(value).digest("hex");

export async function checkBook(input = ".", options = {}) {
  const book = await loadBook(input);
  const base = normalizeBase(options.base ?? "/");
  const chapters = [];
  for (const chapter of book.manifest.chapters)
    chapters.push(await renderChapter(book, chapter, base));
  for (const chapter of chapters)
    for (const reference of chapter.references) {
      if (
        !chapters
          .find((entry) => entry.id === reference.chapterId)
          .anchors.includes(reference.anchor)
      )
        throw new Error(
          `${chapter.file}: Missing chapter anchor: ${reference.chapterId}#${reference.anchor}`,
        );
    }
  const registry = Object.fromEntries(
    Object.entries(book.manifest.components).map(([id, component]) => [
      id,
      {
        entry: path.resolve(book.root, component.entry),
        props: component.props,
      },
    ]),
  );
  const moduleSource = `import ${JSON.stringify(path.join(toolRoot, "reader/style.css"))};\nimport ${JSON.stringify(path.join(toolRoot, "reader/preferences.css"))};\nimport ${JSON.stringify(resolveDependency("katex/dist/katex.min.css"))};\nimport { startReader } from ${JSON.stringify(path.join(toolRoot, "reader/reader.js"))};\nconst registry = {${Object.entries(
    registry,
  )
    .map(
      ([id, component]) =>
        `${JSON.stringify(id)}: {load: () => import(${JSON.stringify(component.entry)}), props: ${JSON.stringify(component.props)}}`,
    )
    .join(",")}};\nstartReader(registry);`;
  const bundling = await bundle({
    absWorkingDir: toolRoot,
    entryPoints: {
      reader: "markdown-book:entry",
      "reader-host": "markdown-book:host",
    },
    plugins: [
      {
        name: "markdown-book-reader",
        setup(api) {
          api.onResolve({ filter: /^@glenzli\/markdown-book\/three$/ }, () => ({
            path: path.join(toolRoot, "reader/three.js"),
          }));
          api.onResolve({ filter: /^markdown-book:(entry|host)$/ }, (args) => ({
            path: args.path.endsWith(":host") ? "host" : "entry",
            namespace: "markdown-book",
          }));
          api.onLoad({ filter: /.*/, namespace: "markdown-book" }, (args) => ({
            contents:
              args.path === "host"
                ? `export { startReader } from ${JSON.stringify(path.join(toolRoot, "reader/reader.js"))};`
                : moduleSource,
            resolveDir: book.root,
            loader: "js",
          }));
        },
      },
    ],
    outdir: path.join(toolRoot, ".virtual-output"),
    write: false,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    metafile: true,
    entryNames: "[name]-[hash]",
    chunkNames: "component-[name]-[hash]",
    assetNames: "[name]-[hash]",
    loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
    logLevel: "silent",
  });
  const componentModules = {};
  for (const [id, component] of Object.entries(registry)) {
    const output = Object.entries(bundling.metafile.outputs).find(
      ([, entry]) =>
        entry.entryPoint &&
        path.resolve(toolRoot, entry.entryPoint) === component.entry,
    );
    if (!output?.[1].exports.includes("mount"))
      throw new Error(`Component ${id} must export mount(context)`);
    componentModules[id] = {
      file: path.basename(output[0]),
      props: component.props,
    };
  }
  const nativeEntry = Object.entries(bundling.metafile.outputs).find(
    ([, value]) => value.entryPoint === "markdown-book:host",
  );
  if (!nativeEntry) throw new Error("Native reader entry was not generated");
  const entry = Object.entries(bundling.metafile.outputs).find(
    ([, value]) => value.entryPoint === "markdown-book:entry",
  );
  if (!entry) throw new Error("Reader entry was not generated");
  const javascript = path.basename(entry[0]);
  const stylesheet = path.basename(entry[1].cssBundle);
  const inputDigests = [];
  for (const filename of Object.keys(bundling.metafile.inputs)) {
    if (filename.startsWith("markdown-book:")) continue;
    const absolute = await realpath(path.resolve(toolRoot, filename));
    const toolRelative = path.relative(toolRoot, absolute);
    const bookRelative = path.relative(book.root, absolute);
    let label;
    if (
      inside(toolRoot, absolute) &&
      !toolRelative.split(path.sep).includes("node_modules")
    )
      label = `tool:${toolRelative}`;
    else if (
      inside(book.root, absolute) &&
      !bookRelative.split(path.sep).includes("node_modules")
    )
      label = `book:${bookRelative}`;
    else {
      const marker = `${path.sep}node_modules${path.sep}`;
      const index = absolute.lastIndexOf(marker);
      if (index === -1)
        throw new Error(
          `Component import leaves the book directory: ${filename}`,
        );
      label = `dependency:${absolute.slice(index + marker.length)}`;
    }
    inputDigests.push([
      label.replaceAll(path.sep, "/"),
      sha(await readFile(absolute)),
    ]);
  }
  const notices = [];
  if (inputDigests.some(([name]) => name.startsWith("dependency:three/"))) {
    const license = await readFile(
      path.resolve(path.dirname(resolveDependency("three")), "../LICENSE"),
      "utf8",
    );
    notices.push(`Three.js\n\n${license}`);
    inputDigests.push(["dependency:three/LICENSE", sha(license)]);
  }
  inputDigests.sort((a, b) => a[0].localeCompare(b[0]));
  const assetDigests = [];
  for (const chapter of chapters)
    for (const asset of chapter.assets)
      assetDigests.push([asset.output, sha(await readFile(asset.absolute))]);
  const rendererDigests = await Promise.all(
    [
      "src/build.js",
      "src/manifest.js",
      "src/markdown.js",
      "src/reading-index.js",
      "src/template.js",
      "src/brand.js",
      "assets/brand/markdown-book.svg",
      "package.json",
    ].map(async (file) => [
      file,
      sha(await readFile(path.join(toolRoot, file))),
    ]),
  );
  const digest = sha(
    JSON.stringify({
      manifest: book.manifest,
      base,
      chapters: chapters.map(({ id, source, html }) => ({ id, source, html })),
      inputDigests,
      assetDigests,
      rendererDigests,
    }),
  );
  return {
    ...book,
    chapters,
    base,
    javascript,
    nativeJavascript: path.basename(nativeEntry[0]),
    componentModules,
    stylesheet,
    notices,
    outputFiles: bundling.outputFiles,
    digest,
  };
}

function gitState(root) {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const dirty =
      execFileSync("git", ["status", "--porcelain", "--", "."], {
        cwd: root,
        encoding: "utf8",
      }).trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: true };
  }
}

async function canonicalOutput(filename) {
  const suffix = [];
  let current = filename;
  for (;;) {
    try {
      return path.join(await realpath(current), ...suffix);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      suffix.unshift(path.basename(current));
      current = path.dirname(current);
    }
  }
}

export async function buildBook(input = ".", options = {}) {
  const prepared = await checkBook(input, options);
  const outDir = await canonicalOutput(
    path.resolve(options.outDir ?? path.join(prepared.root, "dist")),
  );
  if (inside(outDir, prepared.root))
    throw new Error(
      "Output directory must not replace the book or one of its ancestors",
    );
  let existing = [];
  try {
    existing = await readdir(outDir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing.length) {
    let previous;
    try {
      previous = JSON.parse(
        await readFile(path.join(outDir, "build.json"), "utf8"),
      );
    } catch {
      /* Refuse unowned output. */
    }
    if (
      previous?.generator !== "markdown-book" ||
      previous?.bookId !== prepared.manifest.id
    )
      throw new Error(`Refusing to replace non-owned output: ${outDir}`);
  }
  await mkdir(path.dirname(outDir), { recursive: true });
  const staging = await mkdtemp(
    path.join(path.dirname(outDir), ".markdown-book-build-"),
  );
  const state = {
    generator: "markdown-book",
    toolVersion,
    formatVersion: 1,
    bookId: prepared.manifest.id,
    digest: prepared.digest,
    ...gitState(prepared.root),
  };
  try {
    await mkdir(path.join(staging, "assets"));
    if (prepared.notices.length)
      await writeFile(
        path.join(staging, "THIRD_PARTY_LICENSES.txt"),
        prepared.notices.join("\n\n"),
      );
    for (const file of prepared.outputFiles)
      await writeFile(
        path.join(staging, "assets", path.basename(file.path)),
        file.contents,
      );
    await writeFile(
      path.join(staging, "search.json"),
      JSON.stringify({
        bookId: prepared.manifest.id,
        digest: prepared.digest,
        entries: prepared.chapters.flatMap((chapter) => chapter.readingEntries),
      }) + "\n",
    );
    await writeFile(
      path.join(staging, "reader-map.json"),
      JSON.stringify({
        reader: prepared.nativeJavascript,
        stylesheet: prepared.stylesheet,
        components: prepared.componentModules,
      }) + "\n",
    );
    for (const chapter of prepared.chapters) {
      for (const asset of chapter.assets) {
        const target = path.join(
          staging,
          ...asset.output.split("/").map(decodeURIComponent),
        );
        await mkdir(path.dirname(target), { recursive: true });
        await cp(asset.absolute, target);
      }
      await mkdir(path.join(staging, chapter.id));
      await writeFile(
        path.join(staging, chapter.id, "index.html"),
        renderPage(prepared, chapter, state, options.liveReload),
      );
    }
    await writeFile(
      path.join(staging, "index.html"),
      renderPage(prepared, null, state, options.liveReload),
    );
    await writeFile(
      path.join(staging, "build.json"),
      JSON.stringify(state, null, 2) + "\n",
    );
    await writeFile(
      path.join(staging, "catalog.json"),
      JSON.stringify(
        {
          id: prepared.manifest.id,
          title: prepared.manifest.title,
          description: prepared.manifest.description,
          base: prepared.base,
          chapters: prepared.chapters.map(({ id, title }) => ({
            id,
            title,
            href: `${prepared.base}${id}/`,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    const backup = `${staging}-old`;
    try {
      await rename(outDir, backup);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, outDir);
    } catch (error) {
      try {
        await rename(backup, outDir);
      } catch {
        /* No previous output. */
      }
      throw error;
    }
    await rm(backup, { recursive: true, force: true });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return {
    outDir,
    base: prepared.base,
    manifest: prepared.manifest,
    chapters: prepared.chapters.map(({ id, title }) => ({ id, title })),
    ...state,
  };
}
