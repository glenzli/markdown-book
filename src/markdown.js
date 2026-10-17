import path from "node:path";
import { readFile } from "node:fs/promises";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import GithubSlugger from "github-slugger";
import { VFile } from "vfile";
import { projectFile } from "./manifest.js";
import { collectReadingEntries } from "./reading-index.js";

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes.div ?? []), "dataMbComponent"],
    code: [
      ...(defaultSchema.attributes.code ?? []),
      ["className", /^language-./, "math-inline", "math-display"],
    ],
  },
};
const textOf = (node) =>
  node.type === "text"
    ? node.value
    : (node.children ?? []).map(textOf).join("");
const external = (url) => /^(?:https?:|mailto:|tel:|#)/i.test(url);

export async function renderChapter(book, chapter, base = "/") {
  const source = await readFile(
    await projectFile(book.root, chapter.file),
    "utf8",
  );
  const assets = new Map();
  const links = [];
  const headings = [];
  const components = new Set();
  const references = [];
  const issues = [];
  const slugger = new GithubSlugger();
  let title = chapter.title;
  let readingEntries;
  function collect() {
    return (tree) => {
      visit(tree, "element", (node) => {
        if (/^h[1-6]$/.test(node.tagName)) {
          const text = textOf(node);
          const id = slugger.slug(text);
          node.properties.id = id;
          if (node.tagName === "h1" && !title) title = text;
          headings.push({ id, text, level: Number(node.tagName[1]) });
        }
        const component = node.properties?.dataMbComponent;
        if (component !== undefined) {
          if (
            node.tagName !== "div" ||
            typeof component !== "string" ||
            !book.manifest.components[component]
          )
            issues.push(`Unknown or invalid component: ${component}`);
          else {
            components.add(component);
            let fallback = false;
            visit(node, "element", (child) => {
              if (child.tagName === "img") fallback = true;
            });
            if (!fallback)
              issues.push(`Component ${component} requires a fallback image`);
            node.properties.className = ["mb-component"];
            node.properties.tabIndex = -1;
          }
        }
        for (const property of ["src", "href"]) {
          const value = node.properties?.[property];
          if (typeof value === "string") links.push({ node, property, value });
        }
      });
      readingEntries = collectReadingEntries(tree, { ...chapter, title });
    };
  }
  // Sanitize before math rendering so generated KaTeX MathML is retained.
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, schema)
    .use(collect)
    .use(rehypeKatex, { throwOnError: true, strict: "error", trust: false });
  const file = new VFile({ path: chapter.file, value: source });
  const tree = await processor.run(processor.parse(file), file);
  for (const message of file.messages)
    issues.push(`Invalid formula: ${message.reason}`);
  const anchors = new Set();
  visit(tree, "element", (node) => {
    if (node.properties?.id) anchors.add(node.properties.id);
  });
  for (const link of links) {
    const { value, property, node } = link;
    if (external(value)) {
      if (value.startsWith("#") && value.length > 1) {
        const target = decodeURIComponent(value.slice(1));
        if (anchors.has(target)) continue;
        if (anchors.has(`user-content-${target}`)) {
          node.properties.href = `#user-content-${target}`;
          continue;
        }
        issues.push(`Missing heading anchor: ${value}`);
      }
      continue;
    }
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(value) ||
      value.startsWith("/") ||
      value.startsWith("//")
    ) {
      issues.push(`Use a relative book resource or HTTPS URL: ${value}`);
      continue;
    }
    const separator = value.search(/[?#]/);
    const rawPath = separator === -1 ? value : value.slice(0, separator);
    const suffix = separator === -1 ? "" : value.slice(separator);
    let relative;
    try {
      relative = path.posix.normalize(
        path.posix.join(
          path.posix.dirname(chapter.file),
          decodeURIComponent(rawPath),
        ),
      );
    } catch {
      issues.push(`Invalid URL: ${value}`);
      continue;
    }
    if (property === "href" && relative.endsWith(".md")) {
      const target = book.manifest.chapters.find(
        (entry) => entry.file === relative,
      );
      if (!target) {
        issues.push(`Linked chapter is absent from book.json: ${value}`);
        continue;
      }
      node.properties.href = `${base}${target.id}/${suffix}`;
      if (suffix.includes("#"))
        references.push({
          chapterId: target.id,
          anchor: decodeURIComponent(suffix.slice(suffix.indexOf("#") + 1)),
        });
    } else {
      try {
        const absolute = await projectFile(book.root, relative);
        const output = `media/${relative.split("/").map(encodeURIComponent).join("/")}`;
        assets.set(relative, { absolute, output });
        node.properties[property] = `${base}${output}${suffix}`;
      } catch (error) {
        issues.push(`Missing or invalid resource ${value}: ${error.message}`);
      }
    }
  }
  // KaTeX records render failures as messages rather than always throwing.
  visit(tree, "element", (node) => {
    if (node.properties?.className?.includes("katex-error"))
      issues.push(`Invalid formula: ${node.properties.title ?? textOf(node)}`);
  });
  if (issues.length)
    throw new Error(
      `${chapter.file}:\n${issues.map((issue) => `  ${issue}`).join("\n")}`,
    );
  const html = unified().use(rehypeStringify).stringify(tree);
  return {
    ...chapter,
    title: title ?? chapter.id,
    html,
    headings,
    anchors: [...anchors],
    references,
    components: [...components],
    assets: [...assets.values()],
    source,
    readingEntries,
  };
}
