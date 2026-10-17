const normalize = (text) => text.normalize("NFKC").toLocaleLowerCase();

export function searchEntries(entries, query, kind = "all", limit = 60) {
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
  const matches = [];
  for (const [order, entry] of entries.entries()) {
    if (kind === "interactive" && entry.kind !== "interactive") continue;
    if (kind === "text" && entry.kind === "interactive") continue;
    if (!terms.length && entry.kind !== "interactive" && entry.level !== 1)
      continue;
    const text = normalize(`${entry.text} ${entry.component ?? ""}`);
    if (!terms.every((term) => text.includes(term))) continue;
    const score =
      (entry.kind === "heading" ? 30 : entry.kind === "interactive" ? 15 : 0) +
      terms.filter((term) => normalize(entry.heading).includes(term)).length;
    matches.push({ entry, order, score });
  }
  matches.sort((a, b) => b.score - a.score || a.order - b.order);
  return {
    total: matches.length,
    entries: matches.slice(0, limit).map(({ entry }) => entry),
  };
}

export function searchExcerpt(text, query, length = 150) {
  const first = normalize(query.trim()).split(/\s+/).find(Boolean);
  const position = first ? normalize(text).indexOf(first) : 0;
  const start = Math.max(0, position - 40);
  return `${start ? "…" : ""}${text.slice(start, start + length)}${start + length < text.length ? "…" : ""}`;
}
