import { translate } from "./i18n.js";
export function referenceContent(
  state,
  context,
  question = "",
  root = "",
  language = "zh-CN",
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
