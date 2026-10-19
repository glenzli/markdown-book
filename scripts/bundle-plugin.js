import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, rm, readFile, readdir, stat } from "node:fs/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--out"))
  throw new Error("Usage: bundle-plugin.js [--out empty-runtime-directory]");
const runtime = args.length
  ? path.resolve(args[1])
  : path.join(root, "plugins/markdown-book/runtime");
if (args.length) {
  if (
    runtime === root ||
    root.startsWith(`${runtime}${path.sep}`) ||
    runtime === path.parse(runtime).root
  )
    throw new Error(
      "Runtime output must not replace the project or its ancestors",
    );
  try {
    if ((await readdir(runtime)).length)
      throw new Error(`Runtime output must be empty: ${runtime}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
for (const name of [
  "bin",
  "src",
  "reader",
  "assets",
  "docs",
  "schema",
  "LICENSE",
  "package.json",
  "package-lock.json",
])
  await cp(path.join(root, name), path.join(runtime, name), {
    recursive: true,
    dereference: true,
  });
const lock = JSON.parse(
  await readFile(path.join(root, "package-lock.json"), "utf8"),
);
for (const [relative, dependency] of Object.entries(lock.packages)) {
  if (!relative.startsWith("node_modules/") || dependency.dev) continue;
  const source = path.join(root, relative);
  try {
    await stat(source);
  } catch (error) {
    if (error.code === "ENOENT" && dependency.optional) continue;
    throw error;
  }
  await cp(source, path.join(runtime, relative), {
    recursive: true,
    dereference: true,
    filter: (filename) => !filename.split(path.sep).includes(".bin"),
  });
}
process.stdout.write(`Bundled production plugin runtime: ${runtime}\n`);
