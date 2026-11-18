# Keyword Highlighter

A Visual Studio Code extension that highlights predefined and custom keywords across source code editors, Git diffs, and Markdown previews.

## Features

- **Automatic Scanning**: Detects and highlights keywords on file open, typing, and undo/redo.
- **Git Diff Support**: Highlights occurrences in both side-by-side and inline Git diff editors.
- **Markdown Preview**: Extends the built-in preview via `markdown-it` to highlight keywords in rendered headings, lists, tables, and paragraphs.
- **Adaptive Contrast**: Automatically adjusts text contrast for light, dark, and high-contrast themes.
- **Configurable Rules**: Add, modify, or disable keyword rules with custom colors and priorities.

## Default Keywords

- `@TODO:` - Red highlight (`#DC2626`), highlights the keyword only (`wholeLine: false`).
- `@CORE:` - Blue highlight (`#2563EB`), highlights the full containing line (`wholeLine: true`).

## Commands

- `Keyword Highlighter: Enable`
- `Keyword Highlighter: Disable`
- `Keyword Highlighter: Toggle`
- `Keyword Highlighter: Refresh Highlights`
- `Keyword Highlighter: Open Settings`
