import path from "node:path";
import { checkBook, buildBook, toolVersion } from "./build.js";
import { serveBook } from "./server.js";

const help = `markdown-book ${toolVersion}\n\n  check [book-directory|book.json] [--json]\n  serve [book-directory|book.json] [--port 0] [--base /]\n  build [book-directory|book.json] [--out dist] [--base /]\n        [--site-home /books/] [--site-label label] [--site-icon /favicon.svg]\n        [--cover assets/cover.png --cover-alt description]\n  mcp\n\nThe directory defaults to the current working directory. Preview listens on 127.0.0.1.\n`;

export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command || ["--help", "-h", "help"].includes(command)) {
    process.stdout.write(help);
    return;
  }
  if (command === "--version") {
    process.stdout.write(`${toolVersion}\n`);
    return;
  }
  if (command === "mcp") {
    if (args.length) throw new Error("mcp takes no positional arguments");
    const { startMcp } = await import("./mcp.js");
    await startMcp();
    return;
  }
  if (!["check", "serve", "build"].includes(command))
    throw new Error(`Unknown command: ${command}`);
  let input;
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (
      [
        "--base",
        "--out",
        "--port",
        "--site-home",
        "--site-label",
        "--site-icon",
        "--cover",
        "--cover-alt",
      ].includes(arg)
    ) {
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = args[++i];
      continue;
    }
    if (arg.startsWith("-") || input !== undefined)
      throw new Error(`Unexpected argument: ${arg}`);
    input = arg;
  }
  input ??= ".";
  const websiteOptions = [
    "site-home",
    "site-label",
    "site-icon",
    "cover",
    "cover-alt",
  ];
  if (
    command !== "build" &&
    websiteOptions.some((key) => options[key] !== undefined)
  )
    throw new Error("Website and cover options are available for build only");
  if (
    (options["site-label"] !== undefined ||
      options["site-icon"] !== undefined) &&
    !options["site-home"]
  )
    throw new Error("--site-label and --site-icon require --site-home");
  if ((options.cover !== undefined) !== (options["cover-alt"] !== undefined))
    throw new Error("--cover and --cover-alt must be provided together");
  if (
    options.port !== undefined &&
    (!/^\d+$/.test(options.port) || Number(options.port) > 65535)
  )
    throw new Error("--port must be between 0 and 65535");
  if (command === "check") {
    const book = await checkBook(input, { base: options.base });
    const result = {
      ok: true,
      id: book.manifest.id,
      chapters: book.chapters.length,
      components: Object.keys(book.manifest.components).length,
      digest: book.digest,
    };
    process.stdout.write(
      options.json
        ? `${JSON.stringify(result)}\n`
        : `Checked ${result.id}: ${result.chapters} chapters, ${result.components} components.\n`,
    );
  } else if (command === "build") {
    const result = await buildBook(input, {
      base: options.base,
      outDir: options.out ? path.resolve(options.out) : undefined,
      site: options["site-home"]
        ? {
            home: options["site-home"],
            label: options["site-label"],
            favicon: options["site-icon"],
          }
        : undefined,
      cover: options.cover
        ? { src: options.cover, alt: options["cover-alt"] }
        : undefined,
    });
    process.stdout.write(
      options.json
        ? `${JSON.stringify(result)}\n`
        : `Built ${result.manifest.title}\n${result.outDir}\nMount at ${result.base}\n`,
    );
  } else {
    const preview = await serveBook(input, {
      base: options.base,
      port: Number(options.port ?? 0),
      onError: (error) =>
        process.stderr.write(`Rebuild failed: ${error.message}\n`),
    });
    process.stdout.write(`${preview.url}\n`);
    const stop = async () => {
      await preview.close();
      process.exitCode = 0;
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
}
