#!/bin/bash
set -e

PLUGIN_VERSION=`jq -r ".version" < manifest.json`
PLUGIN_VERSION="${PLUGIN_VERSION//./-}"
SOURCE_ZIP_NAME="zip/date2cal-source-${PLUGIN_VERSION}.zip"

if [ -f "$SOURCE_ZIP_NAME" ]; then
    rm "$SOURCE_ZIP_NAME"
fi

git archive --format=zip -o "$SOURCE_ZIP_NAME" HEAD
zip "$SOURCE_ZIP_NAME" BUILD.md

echo "$SOURCE_ZIP_NAME"
