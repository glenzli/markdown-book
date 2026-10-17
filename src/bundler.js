import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let engine;
export function bundlerKind() {
  if (process.env.MARKDOWN_BOOK_BUNDLER === "wasm") return "esbuild-wasm";
  try {
    const nativeRequire = createRequire(
      require.resolve("esbuild/package.json"),
    );
    nativeRequire.resolve(
      `@esbuild/${process.platform}-${process.arch}/package.json`,
    );
    return "esbuild";
  } catch {
    return "esbuild-wasm";
  }
}
/** Keep native speed locally; copied plugin packages can use portable WASM. */
export async function build(options) {
  engine ??= import(bundlerKind());
  return (await engine).build(options);
}
