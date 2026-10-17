import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, rm, readFile, stat } from "node:fs/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = path.join(root, "plugins/markdown-book/runtime");
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
