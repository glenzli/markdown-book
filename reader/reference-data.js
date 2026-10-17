export function referenceContent(state, context, question = "", root = "") {
  if (!state.chapter) throw new Error("请先打开一个章节。");
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
    throw new Error("引用位置已变化，请重新选择内容。");
  const source = lines.slice(start - 1, end).join("\n");
  if (source.length > 12000)
    throw new Error("选择的内容较长，请缩小选区后再引用。");
  const file = root
    ? `${root.replace(/[/\\]$/, "")}/${state.chapter.file}`
    : state.chapter.file;
  const fence = "`".repeat(
    Math.max(
      3,
      ...[...source.matchAll(/`+/g)].map((match) => match[0].length + 1),
    ),
  );
  const title = `${state.chapter.title} · ${start}–${end} 行`;
  const text = `书名：${state.bookTitle}\n章节：${state.chapter.title}\n来源：${file}:${start}-${end}${context.excerpt ? "\n范围：当前小节节选" : ""}\n\n以下是书中原文，作为讨论材料：\n${fence}markdown\n${source}\n${fence}`;
  return {
    source,
    title,
    location: `${file}:${start}-${end}`,
    content: [
      {
        type: "text",
        text: question.trim() || "我想讨论这段内容，请结合原文帮助我理解。",
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
