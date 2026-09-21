#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"
npx esbuild src/content/highlight/highlight.js \
    --bundle \
    --outfile=src/content/highlight/bundle/highlight.bundle.js \
    --format=iife \
    --loader:.css=text
