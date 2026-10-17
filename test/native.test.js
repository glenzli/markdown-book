import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ReaderGateway, discoverBooks } from "../src/reader-gateway.js";
import { fixture, waitFor } from "./fixtures.js";

test("native entrypoints share one self-contained MCP App resource and isolate book views", async (t) => {
  const first = await fixture(),
    second = await fixture();
  second.manifest.title = "另一本书";
  await second.manifestWrite();
  const client = new Client({ name: "native-reader-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(new URL("../bin/markdown-book.js", import.meta.url)),
        "mcp",
      ],
      stderr: "pipe",
      env: { ...process.env, MARKDOWN_BOOK_STATE: `${first.root}.recent.json` },
    }),
  );
  t.after(async () => {
    await client.close();
    await rm(`${first.root}.recent.json`, { force: true });
    await Promise.all(
      [first, second].map((book) =>
        rm(book.root, { recursive: true, force: true }),
      ),
    );
  });
  const { tools } = await client.listTools();
  for (const [name, type] of [
    ["open_workspace", "global"],
    ["open_reader", "thread"],
  ]) {
    const tool = tools.find((tool) => tool.name === name);
    assert.equal(tool._meta.ui.resourceUri, "ui://markdown-book/reader.html");
    assert.deepEqual(tool._meta["openai/ui"].entrypoints, [{ type }]);
  }
  for (const name of [
    "reader_index",
    "reader_library",
    "choose_book_directory",
    "forget_recent_book",
    "reader_view",
    "reader_page",
    "reader_updates",
    "close_reader_view",
  ])
    assert.deepEqual(
      tools.find((tool) => tool.name === name)._meta.ui.visibility,
      ["app"],
    );
  const resource = await client.readResource({
    uri: "ui://markdown-book/reader.html",
  });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(resource.contents[0].text, /data-mb-app/);
  assert.match(resource.contents[0].text, /ui\/initialize/);
  assert.doesNotMatch(resource.contents[0].text, /https?:\/\/127/);
  assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, []);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result.content));
    return result.structuredContent;
  };
  const a = "a".repeat(32),
    b = "b".repeat(32);
  await call("reader_view", { viewKey: a, root: first.root });
  await call("reader_view", { viewKey: b, root: second.root });
  const page = await call("reader_page", { viewKey: a, chapterId: "first" });
  assert.match(page.body, /data:image\/svg\+xml;base64,/);
  assert.match(page.body, /katex-mathml/);
  assert.match(page.body, /href="\/second\/#/);
  assert.doesNotMatch(
    page.body.split('<script id="mb-state"')[0],
    /alert\(1\)|onerror=/,
  );
  const indexA = await call("reader_index", { viewKey: a });
  assert.equal(
    indexA.entries.filter((entry) => entry.kind === "interactive").length,
    1,
  );
  assert.ok(indexA.entries.every((entry) => !entry.text.includes("alert(1)")));
  assert.equal(
    (await call("reader_index", { viewKey: b })).bookId,
    second.manifest.id,
  );
  assert.match(page.stylesheet, /data:font\/woff2;base64,/);
  assert.ok(
    [...page.stylesheet.matchAll(/url\(([^)]+)\)/g)].every((match) =>
      match[1].replace(/^["']|["']$/g, "").startsWith("data:"),
    ),
  );
  assert.doesNotMatch(page.javascript, /import\(["']\.\//);
  assert.match(page.javascript, /mount/);
  assert.equal((await call("reader_page", { viewKey: b })).title, "另一本书");
  assert.equal(
    (
      await client.callTool({
        name: "reader_page",
        arguments: { viewKey: a, chapterId: "../book.json" },
      })
    ).isError,
    true,
  );
  const watching = call("reader_updates", {
    viewKey: a,
    cursor: 0,
    waitMs: 15000,
  });
  await call("close_reader_view", { viewKey: a });
  assert.equal((await watching).closed, true);
  assert.equal(
    (await client.callTool({ name: "reader_page", arguments: { viewKey: a } }))
      .isError,
    true,
  );
  assert.equal((await call("reader_page", { viewKey: b })).title, "另一本书");
  assert.equal(
    (await client.callTool({ name: "reader_index", arguments: { viewKey: a } }))
      .isError,
    true,
  );
});

test("native view watches source, retains a good build on error, recovers, and discovers bounded books", async (t) => {
  const book = await fixture();
  const gateway = new ReaderGateway({
    stateFilePath: `${book.root}.recent.json`,
  });
  t.after(async () => {
    await gateway.close();
    await rm(`${book.root}.recent.json`, { force: true });
    await rm(book.root, { recursive: true, force: true });
  });
  const viewKey = "c".repeat(32);
  await gateway.view(viewKey, book.root);
  const state = gateway.requireView(viewKey).state;
  const original = await gateway.page(viewKey, "second");
  // Wait until chokidar has taken its initial snapshot before editing.
  await new Promise((resolve) => setTimeout(resolve, 200));
  await writeFile(
    path.join(book.root, "second.md"),
    "# 第二章\n\n## 第二节\n\n更新后的内容。\n",
  );
  await waitFor(() => state.cursor > 0);
  const revised = await gateway.page(viewKey, "second");
  assert.match(revised.body, /更新后的内容/);
  assert.notEqual(revised.digest, original.digest);
  await writeFile(
    path.join(book.root, "second.md"),
    "# 第二章\n\n$\\notARealCommand$\n",
  );
  await waitFor(() => state.error);
  assert.equal((await gateway.page(viewKey, "second")).digest, revised.digest);
  await writeFile(
    path.join(book.root, "second.md"),
    "# 第二章\n\n## 第二节\n\n已恢复。\n",
  );
  await waitFor(() => !state.error);
  assert.match((await gateway.page(viewKey, "second")).body, /已恢复/);
  const workspace = path.join(book.root, "workspace");
  await mkdir(workspace);
  await symlink(book.root, path.join(workspace, "outside"), "dir");
  assert.deepEqual(await discoverBooks(workspace), []);
  await assert.rejects(discoverBooks("relative"), /absolute/);
});
