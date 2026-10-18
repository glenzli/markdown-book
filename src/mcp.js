import { brandIcons } from "./brand.js";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkBook, toolVersion } from "./build.js";
import { ReaderGateway, discoverBooks } from "./reader-gateway.js";
import {
  readerAppHtml,
  readerResourceUri,
  legacyReaderResourceUri,
} from "./reader-app.js";

export function createBookMcp(options = {}) {
  const server = new McpServer({
    name: "markdown-book",
    version: toolVersion,
    icons: brandIcons,
  });
  const gateway = new ReaderGateway(options);
  const result = (value) => ({ content: [], structuredContent: value });
  const attempt = (fn) => async (args) => {
    try {
      return result(await fn(args));
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error.message }],
      };
    }
  };
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  const root = z
    .string()
    .optional()
    .describe(
      "Absolute book directory/book.json, or workspace containing books. Without a path, use the host's current workspace or the book chooser.",
    );
  const chapterId = z.string().optional();
  const viewKey = z.string().regex(/^[a-f0-9]{32}$/);
  const appOnly = { ui: { visibility: ["app"] } };
  async function currentRoots() {
    if (server.server.getClientCapabilities()?.roots) {
      try {
        const { roots } = await server.server.listRoots(undefined, {
          timeout: 3000,
        });
        return roots
          .filter((root) => root.uri.startsWith("file:"))
          .map((root) => fileURLToPath(root.uri));
      } catch {
        return [];
      }
    }
    if (options.defaultRoot) return [options.defaultRoot];
    const cwd = process.cwd();
    return cwd === homedir() || cwd === path.parse(cwd).root ? [] : [cwd];
  }
  async function currentRoot() {
    const roots = await currentRoots();
    return roots.length === 1 ? roots[0] : undefined;
  }
  for (const [name, uri] of [
    ["markdown-book-reader", readerResourceUri],
    ["markdown-book-reader-legacy", legacyReaderResourceUri],
  ])
    server.registerResource(
      name,
      uri,
      {
        title: "Markdown Book",
        mimeType: "text/html;profile=mcp-app",
        description:
          "Shared Markdown Book reader for the global sidebar and conversation panel.",
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: "text/html;profile=mcp-app",
            text: await readerAppHtml(),
            _meta: {
              ui: {
                csp: {
                  connectDomains: [],
                  resourceDomains: ["data:", "blob:"],
                },
                prefersBorder: false,
              },
              "openai/ui": {
                availableDisplayModes: ["inline", "fullscreen"],
                preferredDisplayMode: "fullscreen",
              },
            },
          },
        ],
      }),
    );
  for (const entrypoint of ["global", "thread"]) {
    server.registerTool(
      entrypoint === "global" ? "open_workspace" : "open_reader",
      {
        title: "Markdown Book",
        description:
          entrypoint === "global"
            ? "Open Markdown Book from the native sidebar; discover books in the current workspace or choose a local directory."
            : "Open a Markdown Book beside this conversation, with independent chapter navigation and interactive components.",
        inputSchema: { root, chapterId },
        annotations,
        _meta: {
          ui: { resourceUri: readerResourceUri },
          "openai/ui": { entrypoints: [{ type: entrypoint }] },
        },
      },
      async (input) => {
        try {
          const requested = input.root ?? (await currentRoot());
          if (requested && !path.isAbsolute(requested))
            throw new Error("root must be absolute");
          // Explicit books retain a browser URL for hosts without MCP Apps.
          let opened;
          if (input.root) {
            const { discoverBooks } = await import("./reader-gateway.js");
            const choices = await discoverBooks(requested);
            if (choices.length === 1)
              opened = await gateway.open(choices[0].root, input.chapterId);
          }
          const reader = {
            ...(requested ? { root: opened?.root ?? requested } : {}),
            ...(entrypoint === "global" && !input.root ? { choose: true } : {}),
            ...(input.chapterId ? { chapterId: input.chapterId } : {}),
          };
          return {
            content: [{ type: "text", text: "Markdown Book reader is ready." }],
            structuredContent: { ready: true, ...(opened ?? {}), reader },
            _meta: { reader },
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text", text: error.message }],
          };
        }
      },
    );
  }
  server.registerTool(
    "reader_library",
    {
      title: "List books",
      description:
        "List local recent books and discover books in the host workspaces or one selected folder.",
      inputSchema: { root },
      annotations,
      _meta: appOnly,
    },
    attempt(async (input) =>
      gateway.listBooks(input.root ? [input.root] : await currentRoots()),
    ),
  );
  server.registerTool(
    "choose_book_directory",
    {
      title: "Choose a book folder",
      description:
        "Show the system folder chooser after the user clicks Choose Folder. Cancellation leaves the current reader unchanged.",
      inputSchema: {},
      annotations: { ...annotations, readOnlyHint: false },
      _meta: appOnly,
    },
    attempt(async () => {
      const selected = await gateway.library.choose();
      if (!selected) return { cancelled: true };
      return { root: selected, choices: await discoverBooks(selected) };
    }),
  );
  server.registerTool(
    "forget_recent_book",
    {
      title: "Remove a recent book",
      description:
        "Remove a local recent-book record. Never modifies or deletes book source.",
      inputSchema: { root: z.string() },
      annotations: { ...annotations, readOnlyHint: false },
      _meta: appOnly,
    },
    attempt(async ({ root }) => {
      await gateway.library.forget(root);
      return { removed: true };
    }),
  );
  server.registerTool(
    "reader_view",
    {
      title: "Open a book view",
      description:
        "Select this app instance's book, or list books inside an explicit workspace.",
      inputSchema: { viewKey, root },
      annotations,
      _meta: appOnly,
    },
    attempt(async (input) =>
      gateway.view(input.viewKey, input.root ?? (await currentRoot())),
    ),
  );
  server.registerTool(
    "reader_page",
    {
      title: "Read a book page",
      description:
        "Read one rendered page and its local reader, formula fonts and interactive code for this app view.",
      inputSchema: {
        viewKey,
        chapterId,
        assets: z
          .object({
            stylesheetId: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            javascriptIds: z
              .array(z.string().regex(/^[a-f0-9]{64}$/))
              .max(32)
              .optional(),
          })
          .optional(),
      },
      annotations,
      _meta: appOnly,
    },
    attempt((input) =>
      gateway.page(input.viewKey, input.chapterId, input.assets),
    ),
  );
  server.registerTool(
    "save_reader_experiments",
    {
      title: "Save local experiment state",
      description:
        "Save finite JSON parameters for this view's book; never modify manuscript files.",
      inputSchema: {
        viewKey,
        root: z.string(),
        bookId: z.string(),
        values: z.record(z.string(), z.unknown()),
      },
      annotations: { ...annotations, readOnlyHint: false },
      _meta: appOnly,
    },
    attempt((input) =>
      gateway.saveExperiments(
        input.viewKey,
        input.root,
        input.values,
        input.bookId,
      ),
    ),
  );
  server.registerTool(
    "reader_index",
    {
      title: "Read the book search index",
      description:
        "Read sanitized chapter, text and interactive-component search entries for this app view.",
      inputSchema: { viewKey },
      annotations,
      _meta: appOnly,
    },
    attempt((input) => gateway.index(input.viewKey)),
  );
  server.registerTool(
    "reader_updates",
    {
      title: "Watch a book view",
      description:
        "Wait for source changes or build diagnostics in this app view.",
      inputSchema: {
        viewKey,
        cursor: z.number().int().nonnegative(),
        waitMs: z.number().int().min(0).max(15000).default(15000),
      },
      annotations,
      _meta: appOnly,
    },
    attempt((input) =>
      gateway.updates(input.viewKey, input.cursor, input.waitMs),
    ),
  );
  server.registerTool(
    "close_reader_view",
    {
      title: "Close a book view",
      description: "Release this app instance's view and pending watches.",
      inputSchema: { viewKey },
      annotations,
      _meta: appOnly,
    },
    attempt((input) => {
      gateway.closeView(input.viewKey);
      return { closed: true };
    }),
  );
  server.registerTool(
    "check_book",
    {
      description:
        "Validate a Markdown Book manifest, chapters, formulas, local resources and component modules without executing components or modifying source.",
      inputSchema: { root: z.string() },
      annotations,
    },
    attempt(async ({ root }) => {
      if (!path.isAbsolute(root)) throw new Error("root must be absolute");
      const book = await checkBook(root);
      return {
        ok: true,
        title: book.manifest.title,
        chapters: book.chapters.length,
        components: Object.keys(book.manifest.components).length,
        digest: book.digest,
      };
    }),
  );
  return {
    server,
    gateway,
    async close() {
      await gateway.close();
      await server.close();
    },
  };
}

export async function startMcp() {
  const app = createBookMcp();
  await app.server.connect(new StdioServerTransport());
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await app.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdin.once("end", stop);
}
