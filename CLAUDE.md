# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

`@latenode/code-sqlite-query` exposes a single `SqliteTool` class designed to run inside a LateNode "code node" (user-provided JS executed on bun.js). The tool accepts user data as POJO arrays, auto-creates a SQLite database (in-memory by default), runs a parameterised query, and returns both the result rows and the inferred schema so the user can verify how their data was typed.

Runtime is **Bun** (`engines.bun >=1.3.2`) — the SQLite driver is `bun:sqlite`, so the code only runs under Bun, not Node. The package is published to npm as ESM and ships only `src/` (no build step).

## Commands

```bash
bun test                                  # full suite
bun test test/infer.test.js               # single file
bun test test/infer.test.js -t 'string'   # one test by name pattern
bunx tsc --noEmit                         # type-check (JSDoc + .d.ts, strictest config)
bun run lint                              # eslint
bun run format                            # prettier --check (CI runs this)
bun run format:fix                        # prettier --write (auto-fix)
```

Publishing uses a separate npm config: `npx --userconfig ~/.npmrc_latenode np --no-tests` (see `publish.md`).

## Architecture

```
src/
  index.js                   — public re-export (SqliteTool only)
  SqliteTool.js              — facade: lifecycle, transactions, query/queryIterator/queryWithMeta, statement cache
  sqlite-types.js            — converters:
                                  • sqliteTypeConverters (inference, ORDER MATTERS)
                                  • sqliteExplicitConverters (for explicit { schema })
                                  • safeJsonStringify, willConvertToNull
  schema/
    infer.js                 — inferSchema(rows) — pure, no DB
    ddl.js                   — quoteIdent, buildCreateTableSql, buildInsertSql, buildDropTableSql
    normalize.js             — normalizeTableInput / normalizeTablesInput — coerces both input forms
  types.d.ts                 — public types + class declaration (exports.types entry)
```

Lifecycle: `new SqliteTool(dbPath?, options?)` → `setup(tables)` → `query(sql, opts?)` / `getSchema()` → `close()`. Supports `using` via `Symbol.dispose`. `setup()` is **atomic** (one transaction, rolled back on error) and **idempotent across calls** (drops previous tables before recreating). `addTable(name, input)` adds one table without touching others.

`query()` accepts **named parameters only**: `{ params: { $id: 1 } }`. Param keys must include the prefix that matches the SQL (`$id` ↔ `$id`, `:name` ↔ `:name`). Positional `?` is not supported.

Statement cache: `_stmtCache` is an LRU `Map<string, Statement>` (default 32). Invalidated on `setup()` / `addTable()` / `close()` / DB reopen.

`safeIntegers` is `'auto'` by default — if a `bigint` is found in input, the DB is closed and reopened with `safeIntegers: true` BEFORE applying the schema. In bun 1.3.x there's no runtime toggle for this option, only a constructor flag.

## Inference rules (verified in `test/infer.test.js`)

- Column is `nullable` if any row omits the key, has `null`/`undefined`, has `Invalid Date`, or has a non-serializable object (`Map`/`Set`/`RegExp`/class).
- All values null → type `NULL` + nullable.
- Once widened to `sqliteDefaultConverter` (TEXT) the inference stops sharpening further values for that column.
- `Date.toJSON()` for valid dates; `null` for invalid ones (column becomes nullable).
- `Uint8Array` → `BLOB`; plain `{}`/`[]` → `JSON.stringify`. `Map`/`Set`/etc. → `null`.
- Order of `sqliteTypeConverters` is critical: `string` → `boolean` → `BLOB` → `INTEGER` → `REAL` → `bigint` → `Date` → `object`. The boolean converter MUST be before the integer one because `typeof true === 'boolean'`; BLOB must be before object because `Uint8Array` is an object; etc.
- Order of columns in the schema = first-seen across rows in input order. Stable.

The `toJs` field on every converter is **defined but not currently invoked** when reading query results — bun:sqlite already returns native JS values. `restoreTypes: 'auto'` is the available opt-in for JSON deserialization.

## Type system

- Source files are `.js` with `// @ts-check` and JSDoc — no TypeScript transpilation.
- `tsconfig.json` extends `@tsconfig/strictest` + `@tsconfig/bun` with `allowJs`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`.
- `src/types.d.ts` is the single source of truth for public types AND the `SqliteTool` class declaration. Internal JSDoc references types via `import('./types.d.ts').X` (or `import('../types.d.ts').X` from subdirs).
- When adding/changing a public method on `SqliteTool`, update both `src/SqliteTool.js` (JSDoc + impl) AND the class declaration in `src/types.d.ts`.

## Code conventions

- **All project files MUST be written in English.** This includes source code (comments, JSDoc, log messages, identifiers, error messages), tests (descriptions, comments), and documentation (README, CHANGELOG, doc/). Do not write Russian (or any other non-English) text in committed files.
- Prettier config is inline in `package.json`: no semicolons, single quotes, no trailing commas, `arrowParens: avoid`. Before committing run `bun run format:fix` (or at minimum `bun run format`) — CI runs `prettier --check` and will fail on unformatted files.
- ESLint flat config in `eslint.config.js` — `@eslint/js` recommended + `eslint-plugin-jsdoc`.
- Logs go through `this._logger` with `[SQL]` / `[INFO]` / `[ERROR]` prefixes. Never call `console.*` directly inside `SqliteTool.js`. Tests use `verbose: 'silent'`.

## Tests

```
test/
  infer.test.js       — schema inference (24 cases)
  ddl.test.js         — quoteIdent, CREATE/INSERT/DROP, snapshot
  setup.test.js       — atomicity, input forms, double-setup, addTable
  query.test.js       — named params, restoreTypes, JOIN, queryIterator, queryWithMeta
  lifecycle.test.js   — using, idempotent close, getSchema frozen
  e2e.test.js         — original happy-path black-box
```

Snapshots in `test/__snapshots__/`. Update via `bun test --update-snapshots`.

## Internal notes

Deeper architecture / design decisions / refactoring notes live in `doc/`:

- `doc/architecture.md` — module breakdown, transaction flow, statement cache, safeIntegers reopen strategy.
- `doc/type-mapping.md` — full JS↔SQLite mapping table with edge cases.
- `doc/refactoring-notes.md` — what changed in 2.0 and why; deliberate non-decisions.
