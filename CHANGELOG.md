# Changelog

Format — [Keep a Changelog](https://keepachangelog.com/),
versioning — [SemVer](https://semver.org/).

## [2.0.0] — 2026-04-25

### Breaking

- **`setup()` accepts an extended input format.** Each table now supports
  `[rows]`, `{ schema, rows }`, and `{ schema }` forms. An empty table
  without an explicit schema now throws (previously the entire `setup()`
  failed).
- **`query()` — named parameters only.** Signature:
  `query(sql, { params?, restoreTypes? })`. Positional `?` + array is no
  longer supported (passing it now fails inside bun:sqlite).
- **`getSchema()` returns a frozen object without internal converters.**
  Now of the form `{ [table]: { [col]: { type, nullable } } }`.
  `JSON.stringify` produces a clean output without empty `{}` for
  functions.
- **Package version — 2.0.0.**

### Added

- `addTable(name, input)` — adds a single table without recreating the
  existing ones.
- `queryIterator(sql, opts)` — streams the result via `Statement.iterate()`.
- `queryWithMeta(sql, opts)` — returns `{ rows, columns, durationMs }`.
- `restoreTypes: 'auto'` — heuristic JSON restoration for results from
  `query()`/`queryIterator()`/`queryWithMeta()`.
- `Symbol.dispose` — TC39 Explicit Resource Management support (`using`).
- Constructor options: `readonly`, `create`, `strict`, `safeIntegers`,
  `walMode`, `logger`, `verbose`, `statementCacheSize`.
- `safeIntegers: 'auto'` (default) — automatically enables bigint mode
  when `bigint` is present in the data.
- BLOB converter: `Uint8Array` is written as `BLOB`.
- LRU cache for prepared statements in `query()` (default 32 entries).

### Fixed

- **Repeated `setup()` now works.** Previously it failed on
  `CREATE TABLE` because tables were not dropped.
- **SQL injection through table/column names.** Every identifier is
  quoted via `quoteIdent()` (double quotes are doubled).
- **`Map` / `Set` / `RegExp` / class instance** no longer silently turn
  into `{}` — the column becomes `TEXT NULL` and the value is written as
  `NULL`.
- **Invalid `Date`** no longer breaks `NOT NULL` — the column is
  automatically made `TEXT NULL` and the value becomes `NULL`.
- **`bigint` without precision loss** with `safeIntegers='auto'` (default).
- **`NaN` / `Infinity`** are no longer caught by the `REAL` converter —
  they widen to `TEXT`.
- **Prepared-statement leak** — `_insertData` finalises `insert` in
  `finally`; the `query()` cache is cleared on `close()` and `setup()`.
- **Duplicate log in `query()`** — `console.error` removed, the error
  is just rethrown.
- **Boolean converter**: `val === true ? 1 : 0` → `val ? 1 : 0`.

### Internal

- Decomposition of `SqliteTool` into pure modules:
  - `src/schema/infer.js` — `inferSchema(rows)`;
  - `src/schema/ddl.js` — `quoteIdent`, `buildCreateTableSql`,
    `buildInsertSql`, `buildDropTableSql`;
  - `src/schema/normalize.js` — `normalizeTablesInput`.
- `src/types.d.ts` — public types extracted into named exports + class
  declaration.
- `package.json` — added `exports`, `types`, `sideEffects: false`.
- Removed: `package-lock.json`, `scripts/coverage-badge.js`, `badges/`,
  `images/`, `under-construction.png`, `__temp/`, dev-dependency
  `@latenode/js-node-bootstrap`.
- TypeScript bumped to `^6.0.3`.
- Tests: 6 files, ~80 cases (`infer`, `ddl`, `setup`, `query`,
  `lifecycle`, `e2e`).

## [1.0.0] — 2025-11-08

- First public release.
