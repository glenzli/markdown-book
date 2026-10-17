import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const [result] = JSON.parse(
  execFileSync(
    "npm",
    [
      "pack",
      "--dry-run",
      "--ignore-scripts",
      "--json",
      "--cache",
      "/tmp/markdown-book-npm-cache",
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  ),
);
assert.ok(
  result.files.every(
    ({ path }) =>
      !path.includes("/runtime/") && !path.includes("node_modules/"),
  ),
  "Package must not include a locally generated plugin runtime or dependencies",
);
for (const required of [
  "bin/markdown-book.js",
  "src/build.js",
  "reader/reader.js",
  "reader/style.css",
  "reader/three.js",
  "assets/brand/markdown-book.svg",
  "plugins/markdown-book/assets/icon.png",
  "plugins/markdown-book/assets/icon-dark.png",
  "schema/book.schema.json",
  "plugins/markdown-book/.codex-plugin/plugin.json",
])
  assert.ok(
    result.files.some(({ path }) => path === required),
    `Missing package file: ${required}`,
  );
process.stdout.write(
  `Package boundary checked: ${result.entryCount} files, ${result.size} bytes.\n`,
);
