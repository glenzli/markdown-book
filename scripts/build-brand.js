import { Resvg } from "@resvg/resvg-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const source = await readFile(
  new URL("../assets/brand/markdown-book.svg", import.meta.url),
  "utf8",
);
for (const [filename, color] of [
  ["icon.png", "#252525"],
  ["icon-dark.png", "#F2F2F2"],
]) {
  const png = new Resvg(
    source.replace('fill="currentColor"', `fill="${color}"`),
    { fitTo: { mode: "width", value: 1024 } },
  )
    .render()
    .asPng();
  const output = new URL(
    `../plugins/markdown-book/assets/${filename}`,
    import.meta.url,
  );
  if (process.argv.includes("--check"))
    assert.deepEqual(
      await readFile(output),
      png,
      "Regenerate the plugin icons with npm run brand:build",
    );
  else {
    await mkdir(fileURLToPath(new URL("./", output)), { recursive: true });
    await writeFile(output, png);
  }
}
process.stdout.write(
  `Monochrome artwork ${process.argv.includes("--check") ? "verified" : "rendered"}: SVG source to transparent light/dark PNGs.\n`,
);
