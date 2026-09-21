#!/bin/bash
set -e

PLUGIN_VERSION=`jq -r ".version" < manifest.json`
PLUGIN_VERSION="${PLUGIN_VERSION//./-}"
PLUGIN_ZIP_NAME="zip/date2cal-${PLUGIN_VERSION}.zip"

mkdir -p zip

if [ -f "$PLUGIN_ZIP_NAME" ]; then
    rm "$PLUGIN_ZIP_NAME"
fi
zip -r $PLUGIN_ZIP_NAME ./ -x ".*" "*/.*" "venv" "node_modules/*" "scripts/*" "zip/*" "tests/*" \
    "package.json" "package-lock.json" "claude.md" "ARCHITECTURE.md" "BUILD.md"

echo $PLUGIN_ZIP_NAME
cp "$PLUGIN_ZIP_NAME" "zip/date2cal-${PLUGIN_VERSION}.xpi"
cp "$PLUGIN_ZIP_NAME" "zip/date2cal.xpi"