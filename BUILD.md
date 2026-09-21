# Build instructions

The submitted `.xpi`/zip contains two generated artifacts that are not
human-authored source:

- `dependencies/chrono-en.js` — the English build of
  [chrono-node](https://github.com/wanasit/chrono) (MIT), bundled by esbuild.
  English-only by design (~95KB vs. ~403KB for the full multi-locale
  package) -- see `ARCHITECTURE.md`.
- `src/content/highlight/bundle/highlight.bundle.js` — the inline-highlight
  content script bundle, produced by esbuild from
  `src/content/highlight/highlight.js` and its imports (including
  `src/detect/`).

To reproduce both from source:

```
npm install     # also runs `npm run setup` via the prepare hook
```

This runs, in order:

```
npm run bundle-dependencies    # scripts/bundle_dependencies.sh -> dependencies/chrono-en.js
npm run bundle-content-script  # scripts/bundle_content_script.sh -> src/content/highlight/bundle/highlight.bundle.js
```

Both scripts invoke `esbuild` (pinned in `package.json`) with no custom flags
beyond bundling and (for the content script) inlining CSS as text; see the
scripts themselves for the exact invocation. Bundles are shipped
human-readable/non-minified: the Thunderbird add-on review (webext-linter)
rejects minified/machine-generated code as unreviewable.

To produce the same packaged zip submitted for review:

```
npm run bundle-plugin   # setup, then scripts/zip_to_publish.sh -> zip/date2cal-<version>.zip
```

Other useful scripts:

```
npm run check   # scripts/check_imports.mjs -- verifies every relative import
                # and manifest.json reference resolves to a real file
npm test        # mocha over tests/*.test.js, including the golden-corpus
                # precision/recall gate (tests/corpus.test.js)
npm run lint    # builds the publish zip, then runs the Thunderbird
                # webext-linter against it -- the same automated review
                # Thunderbird runs on ATN submission
npm run dev     # scripts/bundle_plugin_watch.sh -- rebuilds on file change
```

Node.js version used: see `package.json` (no `engines` pin currently; tested
with a current LTS Node).

## Loading the add-on for manual testing

1. `npm install`
2. In Thunderbird: Tools → Developer Tools → Debug Add-ons → "Load Temporary
   Add-on…" → select `manifest.json` in the repo root.
3. Open a message and check the message-toolbar button, inline highlighted
   dates, and the "Create event from selection" context menu item.

Reloading after a change to any file under `src/content/highlight/` requires
re-running `npm run bundle-content-script` (or `npm run dev` for a watch
loop) before reloading the add-on -- everything else is loaded as plain ES
modules and just needs an add-on reload.
