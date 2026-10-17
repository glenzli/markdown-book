import { execFileSync } from "node:child_process";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { bookSchema } from "../src/manifest.js";

await mkdir("schema", { recursive: true });
const schema = JSON.stringify(z.toJSONSchema(bookSchema), null, 2) + "\n";
let current;
try {
  current = await readFile("schema/book.schema.json", "utf8");
} catch {
  /* First generation. */
}
if (process.argv.includes("--write-schema"))
  await writeFile("schema/book.schema.json", schema);
else if (current !== schema)
  throw new Error(
    "schema/book.schema.json is stale; run node scripts/check-project.js --write-schema",
  );
for (const folder of ["src", "bin", "reader", "scripts", "test"]) {
  for (const file of await readdir(folder))
    if (file.endsWith(".js"))
      execFileSync(process.execPath, ["--check", path.join(folder, file)], {
        stdio: "inherit",
      });
}
for (const file of [
  "plugins/markdown-book/.codex-plugin/plugin.json",
  "plugins/markdown-book/.mcp.json",
  ".agents/plugins/marketplace.json",
])
  JSON.parse(await readFile(file, "utf8"));
process.stdout.write(
  "Schema, JavaScript syntax and plugin manifests checked.\n",
);
