import { identifier } from "./manifest.js";
import { translate } from "../reader/i18n.js";

function marker(node) {
  const props = node.properties ?? {};
  const {
    dataMbExercise: exercise,
    dataMbSolution: solution,
    dataMbFor: target,
  } = props;
  if (exercise === undefined && solution === undefined && target === undefined)
    return;
  const kind = exercise !== undefined ? "exercise" : "solution";
  const id = exercise ?? solution;
  return {
    kind,
    id,
    target,
    valid:
      node.tagName === "div" &&
      props.dataMbComponent === undefined &&
      !(exercise !== undefined && solution !== undefined) &&
      identifier.safeParse(id).success &&
      (kind === "solution"
        ? identifier.safeParse(target).success
        : target === undefined),
  };
}
function walkMarkers(tree, callback, enclosing = false) {
  const entry = marker(tree);
  if (entry) callback(tree, entry, enclosing);
  for (const child of tree.children ?? [])
    walkMarkers(child, callback, enclosing || Boolean(entry));
}

/** Inspect raw HTML before sanitizing, so unsupported containers cannot silently lose their markers. */
export function validateExerciseMarkup(tree, issues) {
  walkMarkers(tree, (node, entry, enclosing) => {
    if (!entry.valid)
      issues.push(
        "Invalid exercise/solution: use a div with a stable lowercase id; solutions need data-mb-for",
      );
    else if (enclosing)
      issues.push("Exercises and solutions must not be nested");
  });
}
function readable(node) {
  return (
    (node.type === "text" && Boolean(node.value.trim())) ||
    node.tagName === "img" ||
    (node.children ?? []).some(readable)
  );
}

/** Explicit book-wide identities; exercise numbers and wording remain author-owned. */
export function collectExercises(tree, chapter, issues) {
  const entries = [];
  const ids = new Set(),
    entryIds = new Set();
  function remember(node) {
    if (node.properties?.id) ids.add(node.properties.id);
    for (const child of node.children ?? []) remember(child);
  }
  remember(tree);
  walkMarkers(tree, (node, entry, enclosing) => {
    if (!entry.valid || enclosing) return;
    const { kind, id, target } = entry;
    const anchor = `mb-${kind}-${id}`;
    if (entryIds.has(id)) issues.push(`Duplicate exercise/solution id: ${id}`);
    else if (ids.has(anchor))
      issues.push(`Exercise/solution anchor collision: ${anchor}`);
    if (!readable(node)) issues.push(`Empty exercise/solution: ${id}`);
    entryIds.add(id);
    ids.add(anchor);
    node.properties.id = anchor;
    node.properties.tabIndex = -1;
    node.properties.className = [
      ...(node.properties.className ?? []),
      `mb-${kind}`,
    ];
    entries.push({
      id,
      kind,
      target,
      anchor,
      chapterId: chapter.id,
      file: chapter.file,
      line: node.position?.start.line ?? 1,
      node,
    });
  });
  return entries;
}

export function connectExercises(chapters, base, language) {
  const entries = chapters.flatMap((chapter) => chapter.exerciseBlocks);
  const byId = new Map();
  const answers = new Map();
  const fail = (entry, message) => {
    throw new Error(`${entry.file}:${entry.line}: ${message}`);
  };
  for (const entry of entries) {
    if (byId.has(entry.id))
      fail(entry, `Duplicate exercise/solution id: ${entry.id}`);
    byId.set(entry.id, entry);
  }
  for (const entry of entries) {
    if (entry.kind !== "solution") continue;
    const target = byId.get(entry.target);
    if (target?.kind !== "exercise")
      fail(entry, `Solution target must be an exercise: ${entry.target}`);
    const group = answers.get(entry.target) ?? [];
    group.push(entry);
    answers.set(entry.target, group);
  }
  function link(from, target, key, values = {}) {
    return {
      type: "element",
      tagName: "a",
      properties: {
        href: `${from.chapterId === target.chapterId ? "" : `${base}${target.chapterId}/`}#${target.anchor}`,
        dataMbLabel: key,
        dataMbValues: JSON.stringify(values),
      },
      children: [{ type: "text", value: translate(language, key, values) }],
    };
  }
  for (const entry of entries) {
    const targets =
      entry.kind === "exercise"
        ? (answers.get(entry.id) ?? [])
        : [byId.get(entry.target)];
    if (!targets.length) continue;
    const children = [];
    targets.forEach((target, index) => {
      if (index) children.push({ type: "text", value: " · " });
      children.push(
        link(
          entry,
          target,
          entry.kind === "solution"
            ? "backToExercise"
            : targets.length === 1
              ? "viewSolution"
              : "viewNumberedSolution",
          { number: index + 1 },
        ),
      );
    });
    entry.node.children.push({
      type: "element",
      tagName: "p",
      properties: {
        className: ["mb-exercise-links"],
        dataMbGeneratedLinks: "",
      },
      children,
    });
  }
}
