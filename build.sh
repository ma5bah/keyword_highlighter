#!/usr/bin/env bash
set -e

echo "=== Building Keyword Highlighter ==="

# 1. Install dependencies with pnpm
echo "Installing dependencies..."
pnpm install

# 2. Compile TypeScript
echo "Compiling TypeScript..."
pnpm run compile

echo "=== Build complete ==="
echo "Output files generated in ./out"
