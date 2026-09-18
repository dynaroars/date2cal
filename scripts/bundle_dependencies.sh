# !/bin/bash
set -ex

mkdir -p dependencies

# Ship human-readable (non-minified) bundles: the Thunderbird add-on review
# (webext-linter) rejects minified/machine-generated code as unreviewable.
# See https://webextension-api.thunderbird.net/en/mv3/guides/vendoring.html
npx esbuild node_modules/franc/index.js --bundle --outfile=dependencies/franc.js --format=esm
npx esbuild node_modules/@louis.jln/extract-date/index.js --bundle --outfile=dependencies/extract-date.js --format=esm --alias:@=./node_modules/@louis.jln/extract-date
npx esbuild node_modules/@louis.jln/extract-time/index.js --bundle --outfile=dependencies/extract-time.js --format=esm
