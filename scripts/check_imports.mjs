#!/usr/bin/env node
// Guards the failure mode that made upstream silently dead: a module imports
// something under dependencies/ or bundle/ that was never built, so the
// background script fails to load and NO dates are ever detected -- with no
// user-visible error. Walk every JS file and assert each relative import and
// each manifest-referenced file actually exists on disk.
import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs'
import {join, dirname, resolve, relative} from 'node:path'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')
const SKIP = new Set(['node_modules', '.git', 'zip', 'tests'])

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (SKIP.has(entry) || entry.startsWith('.')) continue
        const p = join(dir, entry)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(p)
    }
    return out
}

const problems = []

// 1. Relative imports in source files must resolve.
const IMPORT_RE = /(?:^|\s)(?:import|export)[\s\S]*?from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g
for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(IMPORT_RE)) {
        const spec = m[1] || m[2]
        if (!spec) continue
        const target = resolve(dirname(file), spec)
        if (!existsSync(target)) {
            problems.push(`${relative(ROOT, file)} -> missing import '${spec}'`)
        }
    }
}

// 2. Files referenced from manifest.json must exist.
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'))
const refs = []
const collect = (v) => {
    if (typeof v === 'string' && /\.(js|mjs|html|css|json|png|svg)$/.test(v)) refs.push(v)
    else if (Array.isArray(v)) v.forEach(collect)
    else if (v && typeof v === 'object') Object.values(v).forEach(collect)
}
collect(manifest)
for (const ref of [...new Set(refs)]) {
    if (!existsSync(join(ROOT, ref))) problems.push(`manifest.json -> missing file '${ref}'`)
}

if (problems.length) {
    console.error('✗ unresolved references (did you run `npm run setup`?):\n')
    for (const p of problems) console.error('   ' + p)
    console.error(`\n${problems.length} problem(s)`)
    process.exit(1)
}
console.log(`✓ all relative imports and manifest references resolve (${walk(ROOT).length} files checked)`)
