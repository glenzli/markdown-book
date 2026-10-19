import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const identifier = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const relativeFile = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !path.isAbsolute(value) &&
      !value.includes("\\") &&
      !value.split("/").includes(".."),
    "Use a project-relative path without ..",
  );
const webUrl = z
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "Use an HTTP(S) URL");
export const coverSchema = z.strictObject({
  src: relativeFile.refine(
    (value) =>
      /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(value) && !/[?:#]/.test(value),
    "Cover must be a local image path without a query or fragment",
  ),
  alt: z.string().trim().min(1),
});
const siteUrl = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !/[\u0000-\u0020\\]/.test(value) &&
      ((value.startsWith("/") && !value.startsWith("//")) ||
        webUrl.safeParse(value).success),
    "Use a site-absolute path or an HTTP(S) URL",
  );
const siteSchema = z.strictObject({
  home: siteUrl,
  label: z.string().trim().min(1).optional(),
  favicon: siteUrl.optional(),
});
export function normalizeSite(value) {
  return value == null ? null : siteSchema.parse(value);
}

export const bookSchema = z.strictObject({
  $schema: z.url().optional(),
  formatVersion: z.literal(1),
  id: identifier,
  title: z.string().min(1),
  description: z.string().default(""),
  author: z.string().optional(),
  cover: coverSchema.optional(),
  language: z.string().default("zh-CN"),
  license: z.strictObject({ name: z.string().min(1), url: webUrl }).optional(),
  chapters: z
    .array(
      z.strictObject({
        id: identifier,
        title: z.string().min(1).optional(),
        file: relativeFile,
      }),
    )
    .min(1),
  components: z
    .record(
      identifier,
      z.strictObject({
        entry: relativeFile,
        props: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .default({}),
  source: z
    .strictObject({ repository: webUrl, path: z.string().default("") })
    .optional(),
});

export function inside(root, filename) {
  const relative = path.relative(root, filename);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export async function projectFile(root, relative) {
  const absolute = path.resolve(root, relative);
  if (!inside(root, absolute))
    throw new Error(`Path leaves book directory: ${relative}`);
  const actual = await realpath(absolute);
  if (!inside(root, actual))
    throw new Error(`Symlink leaves book directory: ${relative}`);
  if (!(await stat(actual)).isFile())
    throw new Error(`Expected a file: ${relative}`);
  return actual;
}

export function normalizeBase(value = "/") {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(value))
    throw new Error(
      "--base must be an absolute URL path ending in /, for example /books/imaging/",
    );
  return value;
}

export async function loadBook(input = ".") {
  const candidate = path.resolve(input);
  const filename = (await stat(candidate)).isDirectory()
    ? path.join(candidate, "book.json")
    : candidate;
  const root = await realpath(path.dirname(filename));
  const manifest = bookSchema.parse(
    JSON.parse(await readFile(filename, "utf8")),
  );
  const ids = new Set();
  const files = new Set();
  for (const chapter of manifest.chapters) {
    if (ids.has(chapter.id))
      throw new Error(`Duplicate chapter id: ${chapter.id}`);
    if (files.has(chapter.file))
      throw new Error(`Duplicate chapter file: ${chapter.file}`);
    if (!chapter.file.endsWith(".md"))
      throw new Error(`Chapter must be Markdown: ${chapter.file}`);
    ids.add(chapter.id);
    files.add(chapter.file);
    await projectFile(root, chapter.file);
  }
  for (const [id, component] of Object.entries(manifest.components)) {
    if (!/\.(m?js|ts)$/.test(component.entry))
      throw new Error(`Component ${id} needs a .js, .mjs or .ts entry`);
    await projectFile(root, component.entry);
  }
  if (manifest.cover) await projectFile(root, manifest.cover.src);
  return { root, filename, manifest };
}
