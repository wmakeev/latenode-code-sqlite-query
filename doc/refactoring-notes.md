# Refactoring notes for 2.0

> Context for the next authors: what was done in `2.0.0` and why.
> Full plans live in `.refactoring/phase-01/PLAN.md` and `.refactoring/phase-02/PLAN.md`.

## What was intentionally broken (breaking changes)

<!-- prettier-ignore -->
| What | Before | After |
| - | - | - |
| `setup()` | `{ users: [rows] }` | `{ users: [rows] }` or `{ users: { schema?, rows? } }` |
| `query()` params | positional `?` + array | named-only via `{ params: { $name: ... } }` |
| `getSchema()` | `{ type, nullable, converter }` (internal) | `{ type, nullable }`, object is frozen |
| Repeated `setup()` | failed on `CREATE TABLE` | works, drops the old tables |
| `Uint8Array` | serialized via JSON | written as BLOB |
| Version | `1.0.0` | `2.0.0` |

## What was **not** done (deferred)

- **Auto PRIMARY KEY** for `id` columns. Too much implicit behavior.
  The user can always supply it via `{ schema: { id: 'INTEGER PRIMARY KEY' } }`.
- **Sanitizing SQL reserved words** in column/table names.
  Not needed: everything is quoted via `quoteIdent` — `select`, `from`, `__proto__`
  are all valid and work.
- **User-level transactions** (`tool.transaction(fn)`). Users have
  `tool.db` for direct access.
- **Auto-generation of .d.ts via tsc**. There is no build step. `src/types.d.ts`
  is hand-written.

## Decisions that may look strange

### 1. Two sets of converters

`sqliteTypeConverters` (for inference) and `sqliteExplicitConverters`
(for explicit schemas). Duplication?

**No.** Inference converters carry, alongside the `type`, also a `test`
predicate for selection and a `fallbackConverter` for widening, and the
order in the array matters. Generic converters are simply "accept anything
compatible and write" — without selection logic.

If we used inference converters for explicit schemas, `'INTEGER'` would pick
the boolean converter (it is the first INTEGER in the array), and any `42`
in the data would become `1`. This was caught by the
`setup() > mixed input format` test.

### 2. `safeIntegers='auto'` via DB reopen

bun 1.3.2 has no runtime `db.safeIntegers(true)` method — only the
constructor. The alternatives:

- ask the user explicitly (breaks "works out of the box");
- always enable `safeIntegers: true` (penalty for code that does not use bigint).

Reopening is safe: it happens before `setup()`, before any tables are
created. For `:memory:` no data is lost; for a file-backed DB the contents
are read again from disk.

If bun adds a runtime method in the future — replace
`_reopenWithSafeIntegers()` with a one-liner without breaking compatibility.

### 3. Class with a public `db`

`tool.db` is the bun:sqlite `Database` — not a private field. Because:

- the library is a thin wrapper, there is no point in hiding the handle;
- users need access for PRAGMAs, transactions, extensions.

Downside: the user can call `tool.db.close()` directly and bypass our
`_closed` flag. Documented, not enforced by code.

### 4. Logging — DI via `options.logger`

The standard `console` is the default. `verbose: 'silent'` is for tests.
The ability to substitute a logger is needed for integration into the
LateNode environment, where logs may go to a different channel.

### 5. `[Symbol.dispose]()` without `[Symbol.asyncDispose]()`

`close()` is synchronous (bun:sqlite has no async API). `using` is enough.

### 6. What boolean values look like in results

With `safeIntegers: true` — `1n` / `0n`. With `false` — `1` / `0`.
**Boolean values are not restored** — bun does not know about a boolean type.
If you need a JS boolean from the DB, convert it in code: `Boolean(row.flag)`
or `row.flag === 1`.

## What is covered by tests

```txt
test/
  infer.test.js       — 24 schema-inference cases
  ddl.test.js         — 16 escaping + DDL cases + snapshot
  setup.test.js       — 15 cases: atomicity, input forms, double-setup, addTable
  query.test.js       — 15 cases: named params, restoreTypes, JOIN, queryIterator, queryWithMeta
  lifecycle.test.js   — 8 cases: using, close idempotent, getSchema frozen
  e2e.test.js         — original happy-path, as a black box
```

The snapshot at `test/__snapshots__/ddl.test.js.snap` is the locked
`CREATE TABLE` format for a known schema. When the format is intentionally
changed, refresh it via `bun test --update-snapshots`.

## What is missing but worth doing

- A test where `setup()` fails on a file-backed DB and verifies that
  previously created tables are still there. Currently rollback is only
  tested for `:memory:`.
- A test for `addTable()` with `safeIntegers='auto'` — what happens if a
  bigint appears for the first time in `addTable()` after `setup()`. Today
  the auto mode only reopens during `setup()` — `addTable()` silently
  stores the bigint without `safeIntegers`. Either document or change.
- Benchmarks. The README claims "batch insertion via a transaction" — but
  no real numbers have been measured.
