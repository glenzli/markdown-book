import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fixture } from "./fixtures.js";

test("packaged stdio tools check, open, reuse and close a real local reader", async (t) => {
  const book = await fixture();
  const client = new Client({ name: "markdown-book-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      fileURLToPath(new URL("../bin/markdown-book.js", import.meta.url)),
      "mcp",
    ],
    stderr: "pipe",
    cwd: book.root,
    env: { ...process.env, MARKDOWN_BOOK_STATE: `${book.root}.recent.json` },
  });
  t.after(async () => {
    await client.close();
    await rm(`${book.root}.recent.json`, { force: true });
    await rm(book.root, { recursive: true, force: true });
  });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name).sort(), [
    "check_book",
    "choose_book_directory",
    "close_reader_view",
    "forget_recent_book",
    "open_reader",
    "open_workspace",
    "reader_index",
    "reader_library",
    "reader_page",
    "reader_updates",
    "reader_view",
    "save_reader_experiments",
  ]);
  const library = await client.callTool({
    name: "reader_library",
    arguments: {},
  });
  assert.equal(library.structuredContent.workspaceBooks.length, 1);
  const sidebar = await client.callTool({
    name: "open_workspace",
    arguments: {},
  });
  assert.equal(sidebar._meta.reader.choose, true);
  const checked = await client.callTool({
    name: "check_book",
    arguments: { root: book.root },
  });
  assert.equal(checked.structuredContent.ok, true);
  const opened = await client.callTool({
    name: "open_reader",
    arguments: { root: book.root, chapterId: "first" },
  });
  assert.equal(opened.isError, undefined);
  assert.equal((await fetch(opened.structuredContent.url)).status, 200);
  const reused = await client.callTool({
    name: "open_reader",
    arguments: { root: book.root, chapterId: "first" },
  });
  assert.equal(reused.structuredContent.url, opened.structuredContent.url);
  const invalid = await client.callTool({
    name: "open_reader",
    arguments: { root: book.root, chapterId: "missing" },
  });
  assert.equal(invalid.isError, true);
  await client.close();
  await assert.rejects(fetch(opened.structuredContent.url));
});
