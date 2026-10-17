const blocks = new Set(["p", "li", "pre", "blockquote", "table"]);
function textOf(node) {
  if (node.type === "text") return node.value;
  if (node.tagName === "img") return node.properties.alt ?? "";
  return (node.children ?? []).map(textOf).join(" ");
}

/** Index sanitized content before KaTeX expands each formula into duplicate trees. */
export function collectReadingEntries(tree, chapter) {
  const entries = [];
  const usedIds = new Set();
  function rememberIds(node) {
    if (node.properties?.id) usedIds.add(node.properties.id);
    for (const child of node.children ?? []) rememberIds(child);
  }
  rememberIds(tree);
  let section = chapter.title ?? chapter.id,
    sequence = 0;
  function walk(node, insideBlock = false) {
    const heading = /^h[1-6]$/.test(node.tagName ?? "");
    const component = node.properties?.dataMbComponent;
    const block = blocks.has(node.tagName) || Boolean(component);
    if (heading) section = textOf(node).replace(/\s+/g, " ").trim();
    if (heading || (block && !insideBlock)) {
      const text = textOf(node).replace(/\s+/g, " ").trim();
      if (text) {
        node.properties ??= {};
        if (!node.properties.id) {
          let id;
          do {
            id = `mb-block-${++sequence}`;
          } while (usedIds.has(id));
          node.properties.id = id;
          usedIds.add(id);
        }
        const lineStart = node.position?.start.line ?? 1;
        const lineEnd = node.position?.end.line ?? lineStart;
        node.properties.dataMbLineStart = lineStart;
        node.properties.dataMbLineEnd = lineEnd;
        entries.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title ?? chapter.id,
          file: chapter.file,
          anchor: node.properties.id,
          heading: section,
          text,
          kind: component ? "interactive" : heading ? "heading" : "text",
          ...(heading ? { level: Number(node.tagName[1]) } : {}),
          ...(component ? { component } : {}),
          lineStart,
          lineEnd,
        });
      }
    }
    for (const child of node.children ?? [])
      walk(child, insideBlock || block || heading);
  }
  walk(tree);
  return entries;
}
