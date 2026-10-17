import path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { loadBook } from "./manifest.js";

const limit = 12;

function chooseWith(command, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
      timeout: 300000,
    });
    let output = "",
      error = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      error += chunk;
    });
    child.once("error", () =>
      reject(new Error("系统文件夹选择器不可用；可展开“输入路径”继续。")),
    );
    child.once("close", (code) => {
      if (code === 0) resolve(output.trim() || undefined);
      else if ([1, 130].includes(code) && !error.trim()) resolve(undefined);
      else reject(new Error(error.trim() || "系统文件夹选择器未能打开。"));
    });
  });
}

/** Invoked only by the app's explicit Choose Folder action. */
export function chooseBookDirectory(signal) {
  if (process.platform === "darwin")
    return chooseWith(
      "osascript",
      [
        "-e",
        'try\nPOSIX path of (choose folder with prompt "选择 Markdown Book 书籍或项目文件夹")\non error number -128\nreturn ""\nend try',
      ],
      signal,
    );
  if (process.platform === "win32")
    return chooseWith(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        'Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = "Choose a Markdown Book folder"; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }',
      ],
      signal,
    );
  return chooseWith(
    "zenity",
    [
      "--file-selection",
      "--directory",
      "--title=Choose a Markdown Book folder",
    ],
    signal,
  );
}

/** Local reader preferences; this owner never writes into a book. */
export class ReaderLibrary {
  constructor({ stateFilePath, chooseDirectory = chooseBookDirectory } = {}) {
    this.filename =
      stateFilePath ??
      process.env.MARKDOWN_BOOK_STATE ??
      path.join(homedir(), ".markdown-book", "recent-books.json");
    this.chooseDirectory = chooseDirectory;
    this.queue = Promise.resolve();
  }

  async stored() {
    try {
      const value = JSON.parse(await readFile(this.filename, "utf8"));
      return Array.isArray(value.books)
        ? value.books
            .filter(
              (item) =>
                typeof item?.root === "string" &&
                path.isAbsolute(item.root) &&
                typeof item.openedAt === "string",
            )
            .slice(0, limit)
        : [];
    } catch {
      return [];
    }
  }

  async list() {
    await this.queue;
    const books = await Promise.all(
      (await this.stored()).map(async (item) => {
        try {
          const book = await loadBook(item.root);
          const chapter = book.manifest.chapters.find(
            (chapter) => chapter.id === item.chapterId,
          );
          return {
            root: book.root,
            title: book.manifest.title,
            openedAt: item.openedAt,
            chapterId: chapter?.id ?? null,
            chapterTitle: chapter?.title ?? chapter?.id ?? null,
          };
        } catch {
          return null;
        }
      }),
    );
    return [
      ...new Map(
        books.filter(Boolean).map((book) => [book.root, book]),
      ).values(),
    ];
  }

  async update(transform) {
    const work = this.queue.then(async () => {
      await mkdir(path.dirname(this.filename), {
        recursive: true,
        mode: 0o700,
      });
      const lock = `${this.filename}.lock`;
      let acquired = false;
      // Separate Codex MCP processes merge against the latest file under one short lock.
      for (let attempt = 0; attempt < 80; attempt++) {
        try {
          await mkdir(lock, { mode: 0o700 });
          acquired = true;
          break;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      if (!acquired)
        throw new Error("最近阅读记录正被另一个进程使用，请稍后重试。");
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      try {
        const books = transform(await this.stored()).slice(0, limit);
        await writeFile(
          temporary,
          `${JSON.stringify({ version: 1, books }, null, 2)}\n`,
          { mode: 0o600 },
        );
        await rename(temporary, this.filename);
      } finally {
        await rm(temporary, { force: true });
        await rm(lock, { recursive: true, force: true });
      }
    });
    this.queue = work.catch(() => {});
    return work;
  }

  async remember(root, title, chapterId) {
    const canonical = await realpath(root);
    try {
      await this.update((books) => {
        const previous = books.find((book) => book.root === canonical);
        return [
          {
            root: canonical,
            title,
            openedAt: new Date().toISOString(),
            chapterId:
              chapterId === undefined
                ? (previous?.chapterId ?? null)
                : chapterId,
          },
          ...books.filter((book) => book.root !== canonical),
        ];
      });
    } catch (error) {
      // History is optional. An unwritable state file must not prevent reading a book.
      process.stderr.write(`[markdown-book] ${error.message}\n`);
    }
  }

  async forget(root) {
    await this.update((books) => books.filter((book) => book.root !== root));
  }

  async choose() {
    if (this.picker)
      throw new Error("已有文件夹选择器打开，请先完成或取消该选择。");
    const picker = (this.picker = new AbortController());
    try {
      return await this.chooseDirectory(picker.signal);
    } finally {
      if (this.picker === picker) this.picker = null;
    }
  }

  async close() {
    this.picker?.abort();
    await this.queue;
  }
}
