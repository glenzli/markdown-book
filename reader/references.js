import { translateDom } from "./i18n.js";
import { referenceContent } from "./reference-data.js";

export function startReferences({ state, signal, host, preferences }) {
  const t = (key, values) => preferences.t(key, values);
  const trigger = document.querySelector(".discussion-toggle");
  if (!state.chapter) {
    trigger.hidden = true;
    return;
  }
  const prose = document.querySelector(".prose");
  const dialog = document.createElement("dialog");
  dialog.className = "reader-dialog reference-dialog";
  dialog.setAttribute("aria-labelledby", "discussion-title");
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="discussion-title" data-mb-label="discuss">与 AI 讨论</h2><button type="button" class="dialog-close" aria-label="关闭讨论" data-mb-label-aria-label="closeDiscussion">×</button></div><p class="reference-location"></p><pre class="reference-preview"></pre><label class="question-label"><span data-mb-label="questionLabel">想讨论的问题（可选）</span><textarea rows="3" placeholder="例如：这一步为什么成立？" data-mb-label-placeholder="questionPlaceholder"></textarea></label><p class="reference-status" role="status"></p><div class="reference-actions"><button type="button" class="reference-submit"></button></div>`;
  const quote = document.createElement("button");
  quote.type = "button";
  quote.className = "selection-reference";
  quote.dataset.mbLabel = "discussSelection";
  quote.textContent = t("discussSelection");
  quote.hidden = true;
  document.body.append(dialog, quote);
  const preview = dialog.querySelector(".reference-preview");
  const location = dialog.querySelector(".reference-location");
  const status = dialog.querySelector(".reference-status");
  const question = dialog.querySelector("textarea");
  const submit = dialog.querySelector(".reference-submit");
  const native = Boolean(host?.draftDiscussion);
  submit.dataset.mbLabel = native ? "newDiscussion" : "copyDiscussion";
  let selection, context;
  function showStatus(key) {
    status.dataset.mbLabel = key;
    status.textContent = t(key);
  }
  preferences.subscribe(
    () => {
      translateDom(preferences);
      if (context)
        location.textContent = `${state.bookTitle} · ${host?.root ? host.root + "/" : ""}${state.chapter.file}:${context.lineStart}-${context.lineEnd}${context.excerpt ? t("excerpt") : ""}`;
    },
    { signal },
  );
  const lineNode = (node) =>
    (node.nodeType === 1 ? node : node.parentElement)?.closest(
      "[data-mb-line-start]",
    );
  function capture() {
    if (dialog.open) return;
    const value = window.getSelection();
    quote.hidden = true;
    selection = undefined;
    if (!value?.rangeCount || value.isCollapsed) return;
    const range = value.getRangeAt(0);
    if (
      !prose.contains(range.startContainer) ||
      !prose.contains(range.endContainer)
    )
      return;
    const first = lineNode(range.startContainer),
      last = lineNode(range.endContainer);
    if (!first || !last) return;
    selection = {
      lineStart: Number(first.dataset.mbLineStart),
      lineEnd: Number(last.dataset.mbLineEnd),
    };
    const rect = range.getBoundingClientRect();
    quote.hidden = false;
    quote.style.left = `${Math.max(12, Math.min(window.innerWidth - 150, rect.left))}px`;
    quote.style.top = `${Math.max(12, Math.min(window.innerHeight - 48, rect.bottom + 8))}px`;
  }
  function currentSection() {
    const headings = [...prose.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(
      (node) => node.dataset.mbLineStart,
    );
    const current =
      headings
        .filter(
          (node) =>
            node.getBoundingClientRect().top <= window.innerHeight * 0.35,
        )
        .at(-1) ?? headings[0];
    const lines = state.chapter.source.split("\n");
    const start = Number(current?.dataset.mbLineStart ?? 1);
    const next = headings.find(
      (node) => Number(node.dataset.mbLineStart) > start,
    );
    const end = next ? Number(next.dataset.mbLineStart) - 1 : lines.length;
    let selectedEnd = start,
      length = lines[start - 1].length;
    while (selectedEnd < end && length + lines[selectedEnd].length < 6000) {
      length += lines[selectedEnd].length + 1;
      selectedEnd++;
    }
    return {
      lineStart: start,
      lineEnd: selectedEnd,
      excerpt: selectedEnd < end,
    };
  }
  function open() {
    context = selection ?? currentSection();
    quote.hidden = true;
    showStatus(native ? "draftHint" : "copyHint");
    try {
      const reference = referenceContent(
        state,
        context,
        "",
        host?.root,
        preferences.locale,
      );
      preview.textContent = reference.source;
      location.textContent = `${state.bookTitle} · ${reference.location}${context.excerpt ? t("excerpt") : ""}`;
      submit.disabled = false;
    } catch (error) {
      preview.textContent = "";
      location.textContent = state.chapter.title;
      delete status.dataset.mbLabel;
      status.textContent = error.message;
      submit.disabled = true;
    }
    dialog.showModal();
    question.focus();
  }
  trigger.addEventListener("click", open, { signal });
  quote.addEventListener("pointerdown", (event) => event.preventDefault(), {
    signal,
  });
  quote.addEventListener("click", open, { signal });
  document.addEventListener("pointerup", capture, { signal });
  document.addEventListener(
    "keyup",
    (event) => {
      if (event.key !== "Escape") capture();
    },
    { signal },
  );
  window.addEventListener(
    "scroll",
    () => {
      quote.hidden = true;
    },
    { signal, passive: true },
  );
  dialog
    .querySelector(".dialog-close")
    .addEventListener("click", () => dialog.close(), { signal });
  dialog.addEventListener("close", () => trigger.focus(), { signal });
  submit.addEventListener(
    "click",
    async () => {
      submit.disabled = true;
      try {
        const reference = referenceContent(
          state,
          context,
          question.value,
          host?.root,
          preferences.locale,
        );
        if (native) {
          await host.draftDiscussion(reference.content);
          if (!signal.aborted) {
            showStatus("draftOpened");
            dialog.close();
          }
        } else {
          await navigator.clipboard.writeText(
            reference.content.map((item) => item.text).join("\n\n"),
          );
          if (!signal.aborted) showStatus("discussionCopied");
        }
      } catch (error) {
        if (!signal.aborted) {
          delete status.dataset.mbLabel;
          status.textContent = error.message;
        }
      } finally {
        if (!signal.aborted) submit.disabled = false;
      }
    },
    { signal },
  );
  signal.addEventListener(
    "abort",
    () => {
      dialog.remove();
      quote.remove();
    },
    { once: true },
  );
}
