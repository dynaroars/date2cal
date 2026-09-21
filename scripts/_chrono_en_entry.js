// Bundle entry point for scripts/bundle_dependencies.sh.
// Re-exports only the English chrono-node build (chrono-node/en), not the
// full multi-locale package -- this add-on is English-only by design (see
// ARCHITECTURE.md), and it cuts the bundle from ~403KB (14 locales) to
// ~95KB.
export {casual, strict, GB, parse, parseDate, Chrono} from 'chrono-node/en'
