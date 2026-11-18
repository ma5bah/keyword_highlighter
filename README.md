# Keyword Highlighter

Keyword Highlighter automatically marks configured keywords in VS Code editors, Git diffs, workspace matches, and Markdown previews.

## Features

- Scan documents while opening, editing, and undoing/redoing changes.
- Highlight matches in side-by-side and inline Git diffs, with an option to limit diff highlighting to changed lines.
- Highlight Markdown preview content using the built-in Markdown extension plugin API.
- Configure literal or regular-expression rules, case sensitivity, whole-word matching, priorities, keyword or whole-line styles, colors, borders, font weight/style, and adaptive contrast.
- Add include/exclude file globs, language filters, maximum file size, comment-only filtering, overview ruler marks, and enable/disable rules.
- Navigate next/previous matches, add the editor selection as a keyword, refresh highlights or workspace matches, and inspect matches in the Keyword Matches activity-bar view.
- Enable, disable, toggle, refresh, and open settings using the provided commands. Click **Keywords On/Off** in the status bar to toggle highlighting.

Default rules highlight `@TODO:` in red and `@CORE:` in blue across its whole line. Defaults and all options are configurable through Settings under **Keyword Highlighter**.

## Requirements

VS Code 1.146.0 or newer. Build prerequisites: Node.js 22 or newer and pnpm. The build resolves pinned esbuild and VSCE through `pnpm dlx`.

## Behavior and limits

- Comment-only filtering uses lightweight lexing for common supported languages. An unsupported language ID yields no comment matches.
- Workspace scanning covers up to 500 files and 5,000 matches, honors VS Code default file exclusions for discovered files, and reads dirty working copies.
- Git changed-lines-only mode applies to the modified pane of visible Git diffs. Results may be omitted when diff data is unavailable or exceeds the computation bound.
- Markdown preview highlighting renders inline text tokens and follows editor keyword, case-sensitivity, and enable preferences.

## Build and install

Run `./build.sh` to install locked dependencies and package an installable `.vsix`. VSCE runs the prepublish bundle once, compiling the desktop entry with TypeScript and producing the browser bundle alongside it. Install it with `code --install-extension keyword-highlighter-1.0.0.vsix`, then reload the VS Code window. Alternatively, use **Extensions: Install from VSIX...** and select the generated package.

## Commands

- Keyword Highlighter: Enable / Disable / Toggle
- Keyword Highlighter: Refresh Highlights
- Keyword Highlighter: Open Settings
- Keyword Highlighter: Next Match / Previous Match (`Ctrl+K`, then `Alt+N` / `Alt+P` on Windows/Linux; `Cmd+K`, then `Alt+N` / `Alt+P` on macOS)
- Keyword Highlighter: Add Selection as Keyword (editor selection context menu)
- Keyword Highlighter: Refresh Workspace Matches
