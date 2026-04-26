# Internal architecture

> Notes for library developers. Not user documentation — that lives in the README.

## Modules

```txt
src/
  index.js                  — public re-export (only SqliteTool)
  SqliteTool.js             — facade: lifecycle, transactions, query/queryIterator/queryWithMeta, statement cache
  sqlite-types.js           — converters:
                               - sqliteTypeConverters (for inference, order matters)
                               - sqliteExplicitConverters (for explicit schemas)
                               - safeJsonStringify, willConvertToNull (helpers)
  schema/
    infer.js                — inferSchema(rows) — pure function, infers a schema from rows
    ddl.js                  — quoteIdent, buildCreateTableSql, buildInsertSql, buildDropTableSql
    normalize.js            — normalizeTableInput / normalizeTablesInput — coerces input variants into a single shape
  types.d.ts                — public types + class declaration (entry point for npm consumers)
```

## Execution flow of `setup(tables)`

```txt
tables (user input)
  → normalizeTablesInput()           — Record<string, NormalizedTableInput>
                                       (the short [rows] and the long {schema, rows} forms are unified)
  → check hasBigInt → reopen DB with safeIntegers=true (when 'auto')
  → db.transaction(() => {
       DROP all tables previously created via setup()
       for each new one:
         DROP TABLE IF EXISTS
         CREATE TABLE
         INSERT (via prepared statement, finalize in finally)
    })()
  → if the transaction throws — _tables is rolled back to prevTables
```

## Atomicity of `setup()`

`setup()` runs inside `db.transaction()`. When an exception is raised inside
the transaction, bun:sqlite issues a ROLLBACK automatically — tables do not
remain in a half-created state. After rollback we restore `_tables` to its
pre-call value.

Note: when a file path is used and `safeIntegers='auto'` triggers, the DB is
reopened OUTSIDE the transaction first, then `setup()` is run. This means that
if `setup()` fails after the reopen, the DB will be either "freshly empty"
(for `:memory:`) or "what was on disk" (for a file, after reading from disk).
This is documented under `safeIntegers`.

## Prepared-statement cache

`_stmtCache: Map<string, Statement>` — an LRU map with a `statementCacheSize`
limit (default 32). It stores prepared statements for `query()` /
`queryIterator()` / `queryWithMeta()`.

Invalidation:

- on `setup()` / `addTable()` (DROP TABLE invalidates the statements)
- on `_reopenWithSafeIntegers()` (statements are bound to the old DB handle)
- on `close()`
- on LRU eviction (when cache.size > limit)

Every evicted statement must be `.finalize()`d to avoid leaking native bun
resources.

## Inference vs explicit schema

Two paths for building a schema — two different sets of converters.

**Inference** (`src/schema/infer.js`): the user passes rows, we walk over the
values and pick a converter from the `sqliteTypeConverters` array. The order
in the array is **critical**:

- string must come before object (otherwise strings end up in the JSON converter)
- boolean must come before integer (typeof true === 'boolean', but it is stored as 0/1 in SQLite)
- BLOB must come before object (Uint8Array is an object)
- bigint and Date — do not overlap with any other tests

During inference each column keeps EXACTLY the converter that won — so that
boolean.toSqlite returns `0/1` while integer.toSqlite returns the number itself.

**Explicit** (`src/schema/normalize.js` + `sqliteExplicitConverters`): the
user states the type. Here we cannot use the first matching converter from
the array, because for `'INTEGER'` that would be the boolean one. Instead we
use the generic converters from `sqliteExplicitConverters`, which handle any
compatible JS type correctly:

- INTEGER accepts number, bigint, boolean
- REAL accepts number, bigint
- TEXT accepts anything (Date → toJSON, plain object → JSON.stringify, otherwise String())
- BLOB accepts only Uint8Array
- NULL — just `null`

## `safeIntegers` and DB reopening

In bun 1.3.x `safeIntegers` is a **constructor option of Database**, there is
no runtime `db.safeIntegers(true)` method. So the `'auto'` mode works like
this:

1. During normalization we compute `hasBigInt` per table.
2. On entry into `setup()` — if `safeIntegersOpt === 'auto'`, the current
   mode is not active yet, and at least one table contains a bigint, we
   close `this.db` and reopen with `safeIntegers: true`.
3. Then the regular `_applyTables` runs and recreates all tables.

For `:memory:` this is safe — there is no data in the DB yet. For a
file-backed DB, the file's contents are read again on reopen.

After the reopen `_safeIntegersActive = true`, so we won't reopen again.

## Why `toJs` is unused

`SqliteTypeConverter.toJs` is defined for every converter but is **not
called** in the current `query()`. The reasons:

1. bun:sqlite already returns data in JS form (number/bigint/string/null/Uint8Array).
2. Using `toJs` requires knowing the **result schema**, not the table schema
   (a SELECT can return arbitrary expressions).
3. Users have `restoreTypes: 'auto'` for the popular case — JSON.

`toJs` is kept for the future (e.g. `queryWithSchema(sql, schemaHint)`).

## Why a `SqliteTool` class instead of a function bag

The class holds mutable state: `db` (handle), `_tables`, `_stmtCache`,
`_closed`. The lifecycle (`new` → `setup` → `query` → `close`) maps onto a
class naturally. A bonus: `Symbol.dispose` and the `using` syntax.

## Known limitations

- **Bun only**: uses `bun:sqlite`, will not run on Node.
- **User-level transactions** are not supported — `query()` does not open its
  own transaction, everything runs in auto-commit. To make several queries
  atomic the user has to issue `BEGIN/COMMIT` manually via `db.exec()`
  (through `tool.db`).
- **The schema is not editable** — after `setup()` you cannot add a column.
  Use `addTable()` to recreate a single table.
- **Parameters are named only** in `query()`. Positional `?` will fail with
  an error from bun:sqlite (when used without params/with an array).
