#!/bin/bash
# Runs the Thunderbird webext-linter (https://github.com/thunderbird/webext-linter)
# against the packaged add-on, i.e. the exact zip that gets published to ATN.
# This is the same automated review Mozilla/Thunderbird runs on submission.
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# Build the publish zip and capture its path (last line printed by the script).
PLUGIN_ZIP_NAME="$(bash scripts/zip_to_publish.sh | tail -n 1)"

echo "Linting ${PLUGIN_ZIP_NAME}"
exec ./node_modules/.bin/webext-linter "$PLUGIN_ZIP_NAME" "$@"
