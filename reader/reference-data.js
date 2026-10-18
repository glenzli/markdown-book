import { translate } from "./i18n.js";
import { experimentValue } from "./experiments.js";
export function experimentSummary(experiments, language = "zh-CN") {
  const t = (key, values) => translate(language, key, values);
  function rows(value) {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value))
      return value.flatMap((item) =>
        item && typeof item === "object" && "label" in item
          ? [
              String(item.label) +
                ": " +
                String(item.value ?? "") +
                (item.detail ? " · " + item.detail : ""),
            ]
          : rows(item),
      );
    if (typeof value === "object")
      return Object.entries(value).flatMap(([key, item]) =>
        item && typeof item === "object"
          ? [key + ":", ...rows(item).map((row) => "  " + row)]
          : [key + ": " + String(item)],
      );
    return [String(value)];
  }
  return experimentValue(experiments, 32768)
    .map((item) => {
      const readings =
        item.readings &&
        !Array.isArray(item.readings) &&
        typeof item.readings === "object" &&
        "stats" in item.readings
          ? [...rows(item.readings.stats), ...rows(item.readings.notes)]
          : rows(item.readings);
      return [
        item.title ?? item.component,
        item.preset ? t("experimentPreset") + ": " + item.preset : "",
        t("experimentParameters") + ":",
        ...rows(item.parameters),
        ...rows(item.options),
        ...(readings.length
          ? [t("experimentReadings") + ":", ...readings]
          : []),
        ...(item.assumptions
          ? [t("experimentConditions") + ": " + item.assumptions]
          : []),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export function referenceContent(
  state,
  context,
  question = "",
  root = "",
  language = "zh-CN",
  experiments = [],
) {
  const t = (key, values) => translate(language, key, values);
  if (!state.chapter) throw new Error(t("openChapterFirst"));
  const lines = state.chapter.source.split("\n");
  const start = context.lineStart;
  const end = context.lineEnd;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end > lines.length
  )
    throw new Error(t("referenceChanged"));
  const source = lines.slice(start - 1, end).join("\n");
  if (source.length > 12000) throw new Error(t("referenceTooLong"));
  const file = root
    ? `${root.replace(/[/\\]$/, "")}/${state.chapter.file}`
    : state.chapter.file;
  const fence = "`".repeat(
    Math.max(
      3,
      ...[...source.matchAll(/`+/g)].map((match) => match[0].length + 1),
    ),
  );
  const title = t("referenceTitle", { title: state.chapter.title, start, end });
  const text = `${t("referenceBook")}${state.bookTitle}\n${t("referenceChapter")}${state.chapter.title}\n${t("referenceSource")}${file}:${start}-${end}${context.excerpt ? `\n${t("referenceExcerpt")}` : ""}\n\n${t("referenceIntro")}\n${fence}markdown\n${source}\n${fence}`;
  return {
    source,
    title,
    location: `${file}:${start}-${end}`,
    content: [
      {
        type: "text",
        text: question.trim() || t("defaultQuestion"),
      },
      { type: "text", text, _meta: { "openai/title": title } },
      ...(experiments.length
        ? [
            {
              type: "text",
              text:
                t("experimentReference") +
                "\n" +
                experimentSummary(experiments, language),
            },
          ]
        : []),
    ],
  };
}

export function discussionRequest(content) {
  return {
    role: "user",
    content,
    _meta: { "openai/message": { target: "new", send: false } },
  };
}

export function canDraftDiscussion(capabilities) {
  const extension = capabilities?.experimental?.["openai/message"];
  return Boolean(
    capabilities?.message && extension && extension.draft !== false,
  );
}
