# Plugin release / 插件发布

The source repository owns code, specs, and skills. The public `glenzli/marketplace` repository owns validated install snapshots. Maintainers use the shared `glenzli-local` development catalog; public installs use `markdown-book@glenzli-marketplace` from `glenzli/marketplace`. The MIT license covers the tool and docs, not the books it opens.

源码仓库维护实现、规范和 skill；`glenzli/marketplace` 维护经过验证的安装快照。维护者本地开发统一使用 `glenzli-local`，公开安装统一使用 `glenzli/marketplace`。

1. Align package.json, package-lock.json, toolVersion, appInfo, plugin manifest, and README versions. Keep formatVersion independent.
2. Run `npm run release:check`. Validate language/theme changes in a live reader and a real book at the intended static base.
3. Run `npm run plugin:dist` and `npm run plugin:verify`. Smoke-test the packaged CLI and MCP resource from an isolated folder, including `MARKDOWN_BOOK_BUNDLER=wasm` for the portable backend. Inspect `release.json` and package licenses.
4. Commit authorized source changes through the repository's normal coordination workflow. Build the package from that clean revision so `sourceRevision` and `sourceDirty: false` identify its source. Reuse source validation when inputs are unchanged.
5. In the marketplace repository, preserve unrelated work and claim `plugins/markdown-book`, `.agents/plugins/marketplace.json`, and relevant README edits. Run `npm run plugin:sync -- /absolute/path/to/marketplace` from the source repository, then `npm run plugin:verify -- /absolute/path/to/marketplace/plugins/markdown-book`.
6. Commit and push each authorized repository separately. Read every remote branch back; local installation, Git push, and a running host are separate states. No website deployment or npm publication is implied.

`release.json` covers files and executable bits, not timestamps. The source revision can be locally committed before it is pushed. The package contains production dependencies, their licenses, the tool's LICENSE, authoring specifications, and both skills. Native esbuild is an acceleration; a matching WASM backend keeps copied packages usable without a matching native binary. Node.js 22+ is still required. Platform-specific folder pickers depend on OS facilities; Linux uses zenity.

Install from the public source:

```bash
codex plugin marketplace add glenzli/marketplace --ref main
codex plugin add markdown-book@glenzli-marketplace --json
```

Maintainer local development:

The shared local catalog is named `glenzli-local`. Register a `markdown-book` entry
with the relative source `./plugins/markdown-book`; that path points to this source
repository's generated `plugins/markdown-book` directory, usually through a symlink.
Keep this machine-local catalog outside the public release repository.

```bash
npm run plugin:bundle
codex plugin marketplace add /absolute/path/to/glenzli-local
codex plugin add markdown-book@glenzli-local --json
```

本地目录项指向源码仓库打包后的插件目录；公开 marketplace 保存可核验的发行快照。
修改源码后仍需重新打包、安装，已有面板的运行版本另行核对。

For an existing `markdown-book-local` installation, install and verify
`markdown-book@glenzli-local` first, then remove the old plugin registration and
standalone source:

```bash
codex plugin remove markdown-book@markdown-book-local --json
codex plugin marketplace remove markdown-book-local --json
```

The source repository's standalone catalog remains available for older development
setups; it is no longer the default maintainer installation route. Install one
Markdown Book source per host to keep a single sidebar entry.

Before replacing an installed version, preserve any cache still used by a live host process if the installer prunes it. Do not overwrite a running old version with new bytes. After installation, compare distributed files and modes with the package. Reload the plugin or restart the host to use new native code; an installed version number alone does not prove the existing panel updated.

The current manifest uses the supported [Codex compatibility layout](https://developers.openai.com/plugins/build/plugins). Language/appearance use host context when available, with [document locale](https://developers.openai.com/plugins/build/chatgpt-ui#widget-localization) and browser preferences as fallbacks. A repository marketplace is a distribution source, not a submission to the universal public plugin directory.

## Native reconnect acceptance

For changes to the MCP App lifecycle, exercise the packaged resource through a real stdio
server restart. Reopen the same view, navigate while recovery is pending, and check that late
responses cannot restore an older book or chapter. Verify saved and unconfirmed experiment
parameters, including a cold panel, and confirm animation restoration stays paused. Tool-result
launch context must work with or without private `_meta` delivery. Only reader requests and
idempotent local experiment assignments participate in recovery; discussion messages do not.

Run the app lifecycle regressions, then the release gate once. After installing, separately check
the actual sidebar opens, navigates and restores an experiment; a fresh backend-only consumer is
not a substitute for that UI check. Retain the working old cache until live hosts have reloaded.

## Navigation acceptance

With a native panel kept open, add a chapter to a temporary book manifest and wait for the live rebuild. Enter the new chapter through the refreshed directory, including an anchored link. The opening-time chapter list must not block it. Repeat after removing an earlier chapter, and confirm the rendered directory and backend agree.

Scroll the directory to a late chapter, switch chapters, collapse and expand it, and reopen the same book. The selected entry should remain visible without scrolling the main text. On narrow screens, reopening the directory should keep its position. Check a second book for position isolation and a long chapter outline for bounded, independent scrolling.

Delay the chapter module in a local acceptance host and record the visible directory offset on each animation frame between body replacement and module startup. A late-chapter selection must remain at its saved offset throughout that gap, with no frame at zero. Also check a collapsed directory stays hidden before the module starts. Keep this delay in the test host only.

Native entrypoints use `ui://markdown-book/reader-VERSION.html` so a new release does not reuse a prior shell resource. `ui://markdown-book/reader.html` remains a compatible read alias. After reloading the plugin, open Reading settings and verify the displayed panel version; an updated backend process alone does not establish the shell version. During chapter changes, verify the directory element and unchanged links retain their identity, while live catalog additions still update.
