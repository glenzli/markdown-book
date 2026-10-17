import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import { brandMark, brandIcons } from "../src/brand.js";

test("the icon master stays neutral and the plugin declares transparent light/dark variants", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL(
        "../plugins/markdown-book/.codex-plugin/plugin.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(manifest.interface.brandColor, undefined);
  assert.equal(manifest.interface.brandColorDark, undefined);
  assert.match(brandMark, /fill="currentColor"/);
  assert.doesNotMatch(brandMark, /#[0-9a-f]{3,8}/i);
  const raster = new Resvg(brandMark, {
    fitTo: { mode: "width", value: 32 },
  }).render();
  assert.equal(raster.pixels[3], 0, "Corner must remain transparent");
  for (let i = 0; i < raster.pixels.length; i += 4) {
    assert.equal(raster.pixels[i], raster.pixels[i + 1]);
    assert.equal(raster.pixels[i], raster.pixels[i + 2]);
  }
  for (const name of ["composerIcon", "composerIconDark", "logo", "logoDark"]) {
    const image = await readFile(
      new URL(
        `../plugins/markdown-book/${manifest.interface[name]}`,
        import.meta.url,
      ),
    );
    assert.equal(image.subarray(1, 4).toString(), "PNG");
    assert.equal(image.readUInt32BE(16), 1024);
  }
  assert.deepEqual(
    brandIcons.map((icon) => icon.theme),
    ["light", "dark"],
  );
});
