#!/usr/bin/env bash
# Returns durable job JSON immediately; worker continues independently.
# Single: launch.sh [--wait|--detach] <package.md> <title> <model> <fallback> [ses_id]
# Batch: launch.sh [--wait|--detach] --parallel [--jobs N] <model-a> <model-b> <package.md>...
# --wait opts into waiting for completion; all submitted packages start by default.
exec python3 "$(dirname "$0")/opencode_tools.py" launch "$@"
