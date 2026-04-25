# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

`@latenode/code-sqlite-query` exposes a single `SqliteTool` class designed to run inside a LateNode "code node" (user-provided JS executed on bun.js). The tool accepts user data as POJO arrays, auto-creates an in-memory SQLite database, runs a parameterised query, and returns both the result rows and the inferred schema so the user can verify how their data was typed.

Runtime is **Bun** (`engines.bun >=1.3.2`) — the SQLite driver is `bun:sqlite`, so the code only runs under Bun, not Node. The package is published to npm as ESM and ships only `src/` (no build step).

## Commands

```bash
bun test                 # run the suite (test/index.test.js uses bun:test)
bun test test/index.test.js -t 'query'   # single test by name
bunx tsc --noEmit        # type-check (JSDoc + .d.ts, strictest config)
```

The `npm test` / `coverage` / `posttest` scripts in `package.json` invoke `c8` + `node --test` and are leftovers from the `@latenode/js-node-bootstrap` template — they will not work because both source and tests depend on `bun:sqlite` / `bun:test`. Use `bun test`.

Publishing uses a separate npm config: `npx --userconfig ~/.npmrc_latenode npm publish --access public` (see `publish.md`).

## Architecture

Three files in `src/`, plus an `index.js` re-export.

**`SqliteTool.js`** — the public class. Lifecycle: `new SqliteTool(dbPath?)` → `setup(tables)` → `query(sql, params)` / `getSchema()` → `close()`. `setup()` resets `tablesSchema` and rebuilds everything; calling it twice on the same instance is supported but starts fresh. Inserts use a prepared statement wrapped in `db.transaction(...)` for throughput. Errors from `query()` are logged and re-thrown so the calling user code can handle them.

**`sqlite-types.js`** — ordered list of `SqliteTypeConverter` records that drive type inference. Each converter has `{ type, test, toSqlite, toJs, fallbackConverter? }`. The order in `sqliteTypeConverters` matters: `_inferSchema` walks the array and picks the first `test()` that matches the first non-null value of a column. If a later row's value doesn't match the picked converter, the algorithm tries `fallbackConverter` (e.g. integer → real) and otherwise widens to `sqliteDefaultConverter` (TEXT, `String(val)`). The boolean converter must come before the integer one because `typeof true === 'boolean'` but booleans must map to INTEGER 0/1, not be treated as text.

**Schema inference rules** (encoded in `_inferSchema`, verified by `test/index.test.js`):

- A column is `NULLABLE` if any row omits the key, or has `null`/`undefined` for it.
- A column with only null/undefined across all rows gets type `NULL` (via `sqliteNullConverter`).
- Once widened to `sqliteDefaultConverter` (TEXT), the inference stops scanning further rows for that column.
- `Date` instances serialise via `toJSON()` (TEXT); plain objects/arrays serialise via `JSON.stringify` (TEXT). The `toJs` direction is defined on the converters but is **not currently invoked** when reading query results — `query()` returns whatever `bun:sqlite` gives back. Keep this in mind when adding features that round-trip values.

**`types.d.ts`** — declares `SqliteType`, `SqliteTypeConverter`, `SqliteSchemaField`, `SqliteTableSchema` as **ambient global types** (no `export`). All `.js` files use `// @ts-check` and JSDoc to consume them. Don't convert types to `export`s without updating every JSDoc reference.

## Code conventions

- Source files are `.js` with `// @ts-check` and JSDoc — no TypeScript transpilation. `tsconfig.json` extends `@tsconfig/strictest` + `@tsconfig/bun` with `allowJs` and `noEmit`.
- Prettier config is inline in `package.json`: no semicolons, single quotes, no trailing commas, `arrowParens: avoid`.
- Comments and `console.*` log messages are in Russian — match the existing style when extending the file.
- Logs use `[SQL]` / `[INFO]` / `[ERROR]` prefixes; the library is meant to be observable from the user's code node, so don't silence them without reason.
