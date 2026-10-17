import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

export async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "markdown-book-test-"));
  await mkdir(path.join(root, "figures"));
  await mkdir(path.join(root, "components"));
  const manifest = {
    formatVersion: 1,
    id: "test-book",
    title: "测试书籍",
    chapters: [
      { id: "first", file: "first.md" },
      { id: "second", file: "second.md" },
    ],
    components: {
      sample: { entry: "components/sample.js", props: { label: "实验按钮" } },
    },
  };
  await writeFile(path.join(root, "book.json"), JSON.stringify(manifest));
  await writeFile(
    path.join(root, "first.md"),
    '# 第一章\n\n## 噪声\n\n$\\mu_s / \\sqrt{\\mu_s+4}$\n\n[下一章](second.md#第二节)\n\n<div data-mb-component="sample">\n\n![静态图](figures/noise.svg)\n\n</div>\n\n<script>alert(1)</script>\n<img src="figures/noise.svg" onerror="alert(1)">\n',
  );
  await writeFile(
    path.join(root, "second.md"),
    "# 第二章\n\n## 第二节\n\n正文。\n",
  );
  await writeFile(
    path.join(root, "figures/noise.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>',
  );
  await writeFile(
    path.join(root, "components/sample.js"),
    'export function mount({element,props,signal}) { const button=document.createElement("button"); button.textContent=props.label; element.append(button); button.addEventListener("click",()=>button.textContent="已点击",{signal}); return ()=>element.replaceChildren(); }',
  );
  return {
    root,
    manifest,
    async manifestWrite(value = manifest) {
      await writeFile(path.join(root, "book.json"), JSON.stringify(value));
    },
  };
}

export async function waitFor(predicate, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for observable state");
}
