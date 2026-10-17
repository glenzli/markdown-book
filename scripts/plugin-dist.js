import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  rename,
  rm,
} from "node:fs/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const command = process.argv[2] ?? "verify";
const args = process.argv.slice(3);
const packageRoot = path.resolve(root, "dist/markdown-book");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function inventory(folder, prefix = "") {
  const files = {};
  for (const name of (await readdir(path.join(folder, prefix))).sort()) {
    const relative = path.posix.join(prefix, name),
      filename = path.join(folder, relative),
      info = await lstat(filename);
    if (info.isSymbolicLink())
      throw new Error(`Release package must not contain symlinks: ${relative}`);
    if (info.isDirectory())
      Object.assign(files, await inventory(folder, relative));
    else if (relative !== "release.json")
      files[relative] = {
        sha256: hash(await readFile(filename)),
        executable: Boolean(info.mode & 0o111),
      };
  }
  return files;
}
export async function verify(folder) {
  const metadata = JSON.parse(
    await readFile(path.join(folder, "release.json"), "utf8"),
  );
  const files = await inventory(folder);
  if (
    hash(JSON.stringify(files)) !== metadata.treeSha256 ||
    JSON.stringify(files) !== JSON.stringify(metadata.files)
  )
    throw new Error(
      "Release inventory, file bytes or executable modes changed",
    );
  const manifest = JSON.parse(
    await readFile(path.join(folder, ".codex-plugin/plugin.json"), "utf8"),
  );
  const runtime = JSON.parse(
    await readFile(path.join(folder, "runtime/package.json"), "utf8"),
  );
  if (
    metadata.version !== manifest.version ||
    manifest.version !== runtime.version ||
    runtime.license !== "MIT"
  )
    throw new Error("Release identity mismatch");
  for (const file of [
    "LICENSE",
    "skills/write-markdown-book/SKILL.md",
    "runtime/docs/format-v1.md",
    "runtime/docs/format-v1.en.md",
    "runtime/node_modules/esbuild-wasm/esbuild.wasm",
  ])
    if (!files[file]) throw new Error(`Missing release file: ${file}`);
  return metadata;
}
if (command === "build") {
  execFileSync(
    process.execPath,
    [path.join(root, "scripts/bundle-plugin.js")],
    { stdio: "inherit" },
  );
  const temporary = `${packageRoot}.building`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(path.dirname(temporary), { recursive: true });
  await cp(path.join(root, "plugins/markdown-book"), temporary, {
    recursive: true,
    dereference: true,
  });
  for (const name of ["LICENSE", "README.md"])
    await cp(path.join(root, name), path.join(temporary, name));
  const version = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  ).version;
  const files = await inventory(temporary);
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const sourceDirty = Boolean(
    execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
  );
  await writeFile(
    path.join(temporary, "release.json"),
    JSON.stringify(
      {
        version,
        sourceRevision,
        sourceDirty,
        treeSha256: hash(JSON.stringify(files)),
        files,
      },
      null,
      2,
    ) + "\n",
  );
  await verify(temporary);
  await rm(packageRoot, { recursive: true, force: true });
  await rename(temporary, packageRoot);
  process.stdout.write(`Verified plugin package ${version}: ${packageRoot}\n`);
} else if (command === "verify") {
  const folder = args[0] ? path.resolve(args[0]) : packageRoot;
  const metadata = await verify(folder);
  process.stdout.write(
    `Verified ${metadata.version}: ${Object.keys(metadata.files).length} files\n`,
  );
} else if (command === "sync") {
  if (args.length !== 1)
    throw new Error(
      "Usage: npm run plugin:sync -- /absolute/path/to/marketplace",
    );
  const marketplace = path.resolve(args[0]);
  if (marketplace === root)
    throw new Error("Use the separate marketplace repository");
  const catalogFile = path.join(
    marketplace,
    ".agents/plugins/marketplace.json",
  );
  const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
  const metadata = await verify(packageRoot);
  const target = path.join(marketplace, "plugins/markdown-book");
  try {
    const existing = JSON.parse(
      await readFile(path.join(target, ".codex-plugin/plugin.json"), "utf8"),
    );
    if (existing.name !== "markdown-book")
      throw new Error("Refusing to replace an unrelated plugin");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = `${target}.syncing`;
  await rm(temporary, { recursive: true, force: true });
  await cp(packageRoot, temporary, { recursive: true, dereference: true });
  await verify(temporary);
  const entry = {
    name: "markdown-book",
    source: { source: "local", path: "./plugins/markdown-book" },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Productivity",
  };
  const index = catalog.plugins.findIndex(
    (plugin) => plugin.name === entry.name,
  );
  if (index < 0) catalog.plugins.push(entry);
  else catalog.plugins[index] = entry;
  await rm(target, { recursive: true, force: true });
  await rename(temporary, target);
  await writeFile(catalogFile, JSON.stringify(catalog, null, 2) + "\n");
  process.stdout.write(`Synced verified ${metadata.version} to ${target}\n`);
} else throw new Error(`Unknown plugin distribution command: ${command}`);
