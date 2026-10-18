# Markdown Book format v1

[中文](format-v1.md) · English

This is a project convention for books made of ordinary Markdown and optional browser interactives, not a claim of universal reader compatibility. `formatVersion` is `1`; the tool has a separate semantic version.

## Manifest and resource boundary

Each book has a `book.json`. Its directory is the resource boundary. Chapter and component paths are relative to that directory; absolute paths, `..`, and symlinks escaping it are rejected. Multiple books may live in one repository without relocating existing chapters.

```json
{
  "formatVersion": 1,
  "id": "imaging",
  "title": "Imaging science",
  "language": "en",
  "chapters": [{ "id": "noise", "file": "04_noise.md" }],
  "components": {
    "noise": {
      "entry": "interactives/noise/index.js",
      "props": { "seed": 20261017 }
    }
  }
}
```

The [JSON Schema](../schema/book.schema.json) is the full machine contract. Unknown manifest fields are rejected.

| Field           | Contract                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `formatVersion` | Required literal `1`                                                                                                     |
| `id`            | Required lowercase letters/digits separated by hyphens                                                                   |
| `title`         | Required nonempty book title                                                                                             |
| `description`   | Optional text; defaults to empty                                                                                         |
| `author`        | Optional text                                                                                                            |
| `language`      | Book language, defaults to `zh-CN`; independent of interface language                                                    |
| `license`       | Optional `{ "name": "…", "url": "https://…" }`; retained on every page                                                   |
| `chapters`      | Nonempty ordered array of `{ "id", "file", "title"? }`; ids and files each unique; files end in `.md`                    |
| `components`    | Optional map from component id to `{ "entry", "props"? }`; entry ends in `.js`, `.mjs`, or `.ts`; props is a JSON object |
| `source`        | Optional `{ "repository": "https://…", "path": "…" }` for source links                                                   |
| `$schema`       | Optional schema URL for editing support                                                                                  |

Chapter URLs use stable ids, not titles or positions. Chapter order follows the manifest. Repository and license URLs accept HTTP(S). Choose each book's license separately from the MIT tool license.

## Markdown

- CommonMark with GFM tables, task lists, strikethrough, and footnotes.
- `$...$` inline and `$$...$$` display math using the KaTeX LaTeX subset, including explicit `\tag{...}`.
- Headings receive unique anchors; duplicates get suffixes. Cross-chapter links use relative source `.md` paths and are rewritten to chapter URLs.
- Images and downloads resolve relative to their Markdown file and are copied into output. Keep assets local, without GitHub raw or CDN dependencies.
- External links accept HTTP(S), mailto, and tel. Do not put a deployment prefix into manuscript links.
- Embedded HTML is sanitized. Source scripts, event handlers, and dangerous URLs do not execute. Interactive modules are trusted programs with ordinary page-script capabilities.
- `check` validates manifests, files, formulas, same/cross-chapter anchors, and component bundling. It neither proves subject correctness nor checks remote URL availability.

## Interactive placement and lifecycle

Declare every component in the manifest. Retain blank lines around the HTML container and its Markdown figure:

```markdown
<div data-mb-component="noise">

![Noise at different signal levels](figures/noise.svg)

</div>
```

Each placement must include a valid local image. GitHub and readers without JavaScript display that image. The web reader loads components near the viewport. The fallback is hidden only after successful mounting; errors retain it and show a diagnostic. Different placements get independent props and lifecycle.

A component must have a named `mount` export:

```js
export function mount({ element, props, signal }) {
  const button = document.createElement("button");
  button.textContent = props.label ?? "Click";
  element.append(button);
  button.addEventListener(
    "click",
    () => {
      button.textContent = "Clicked";
    },
    { signal },
  );
  return () => element.replaceChildren();
}
```

`element` is the component's own host, `props` is an independent JSON copy, and `signal` aborts when leaving the page. Mount may return a Promise and resolve to nothing or a cleanup function. Dispose timers, observers, animation frames, and GPU resources in cleanup. Keep UI inside the host; Shadow DOM can isolate styles. See [component.d.ts](../src/component.d.ts).

The same component runs in local previews, native panels, and static builds. Format v1 has no kernel, local command execution, file-writing API, network proxy, or shared component-state protocol. The optional [Three.js helper](three-components.md) provides the tool-owned engine and viewport lifecycle. Book-owned labels are not translated by the reader's interface preference.

## Build and preview

`build --base /books/imaging/` creates a book landing page, per-chapter `index.html`, content-hashed JS/CSS/fonts, local assets, `catalog.json`, `search.json`, `reader-map.json`, and `build.json`. Mount the output at the specified base. The default output is the book's `dist`; the tool only replaces output previously generated for the same book id and rejects the book root or unknown directories.

`build.json` records tool/format versions, input digest, observed Git revision, and dirty state. Source manuscripts and component code remain authoritative; web output is reproducible. Build does not commit or deploy.

`serve` uses the same builder and reader, writes to a temporary directory, and listens only on loopback. Source changes rebuild serially. Errors retain the last successful output; recovery refreshes it. Preview does not change source or project build output.

## Native reading and preferences

The standard MCP App resource is `ui://markdown-book/reader.html`. Hosts present the `open_workspace` global sidebar entry and `open_reader` thread entry; the book format itself has no Codex dependency. The native gateway reuses generated pages, fonts, media, and component modules, keeps each panel independent, and transfers content through app-only MCP tools without loopback HTTP.

Books need no Codex-specific files. The plugin discovers declared books, reads and builds them, and supports live source updates. UI language and theme can be automatic or manually selected; book language, component labels, and manuscript text remain unchanged. Authoring skills use normal authorized file edits, while preview MCP tools remain read-only.

## Optional experiment sessions

Components may accept an optional `session` with `load()`, `save(value)` and `describe(capture)`.
Existing mount functions remain valid; formatVersion stays 1. Sessions isolate book, chapter,
component ID and occurrence. The component validates version/ranges and restores playback paused.
See [Experiment sessions](experiment-sessions.md) for limits, native persistence and reviewed AI drafts.
