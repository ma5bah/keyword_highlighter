#!/usr/bin/env bash
set -euo pipefail
# @CORE: Package the type-checked desktop and web bundle using cached tools.
# @TODO: Test and verify cold and warm packaging, failed type checks, and retry recovery.
pnpm install --frozen-lockfile --prefer-offline
pnpm run package
