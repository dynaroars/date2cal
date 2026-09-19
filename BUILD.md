# Build instructions for reviewers

The submitted `.xpi`/zip contains two generated artifacts that are not
human-authored source:

- `dependencies/chrono-en.js` — the English build of
  [chrono-node](https://github.com/wanasit/chrono) (MIT), bundled by esbuild.
- `content_scripts/highlight_dates/bundle/highlight_dates.bundle.js` — the
  content script bundle, produced by esbuild from
  `content_scripts/highlight_dates/highlight_dates.js` and its imports.

To reproduce both from source:

```
npm install     # also runs `npm run setup` via the prepare hook
```

This runs, in order:

```
npm run bundle-dependencies    # scripts/bundle_dependencies.sh -> dependencies/chrono-en.js
npm run bundle-content-script  # scripts/bundle_content_script.sh -> content_scripts/highlight_dates/bundle/highlight_dates.bundle.js
```

Both scripts invoke `esbuild` (pinned in `package.json`, version 0.28.1) with
no custom flags beyond bundling and minification; see the scripts themselves
for the exact esbuild invocation.

To produce the same packaged zip submitted for review:

```
npm run bundle-plugin   # setup, then scripts/zip_to_publish.sh -> zip/date2cal-<version>.zip
```

Node.js version used: see `package.json` (no `engines` pin currently; tested
with a current LTS Node).
