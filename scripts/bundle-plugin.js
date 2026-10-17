import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, rm } from "node:fs/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = path.join(root, "plugins/markdown-book/runtime");
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
for (const name of [
  "bin",
  "src",
  "reader",
  "package.json",
  "package-lock.json",
  "node_modules",
])
  await cp(path.join(root, name), path.join(runtime, name), {
    recursive: true,
    dereference: true,
  });
process.stdout.write(`Bundled local plugin runtime: ${runtime}\n`);
