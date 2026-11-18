#!/usr/bin/env bash
set -e

echo "=== Building Keyword Highlighter ==="

# 1. Install dependencies
echo "Installing dependencies..."
pnpm install

# 2. Compile TypeScript
echo "Compiling TypeScript..."
pnpm run compile

# 3. Package extension into .vsix
echo "Packaging .vsix..."
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license

echo "=== Build and packaging complete ==="
echo "Package generated: keyword-highlighter-1.0.0.vsix"
