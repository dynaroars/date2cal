# !/bin/bash
set -ex

mkdir -p dependencies

# Ship human-readable (non-minified) bundles: the Thunderbird add-on review
# (webext-linter) rejects minified/machine-generated code as unreviewable.
# See https://webextension-api.thunderbird.net/en/mv3/guides/vendoring.html
#
# English only, by design (see PLAN.md section 2): chrono-node/en instead of
# the full multi-locale package. ~95KB vs ~403KB / ~4.7MB for the libraries
# this replaces.
npx esbuild scripts/_chrono_en_entry.js --bundle --outfile=dependencies/chrono-en.js --format=esm
