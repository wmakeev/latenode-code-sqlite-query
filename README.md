# @latenode/code-sqlite-query

The `SqliteTool` class for fast ad-hoc queries over data given as arrays of
plain objects. Feed it POJO tables — the library infers the schema, creates
an in-memory SQLite, runs your SELECT, and returns the result together with
the schema description.

Used in LateNode "code node"; works only on **bun**
(`engines.bun >=1.3.2`), because it relies on the built-in `bun:sqlite`.

## Installation

```bash
bun add @latenode/code-sqlite-query
```

## Quickstart

```js
import { SqliteTool } from '@latenode/code-sqlite-query'

using tool = new SqliteTool() // :memory: + Symbol.dispose

tool.setup({
  users: [
    { id: 1, name: 'Anna', city_id: 10 },
    { id: 2, name: 'Boris' } // city_id is missing → column becomes nullable
  ],
  cities: [{ id: 10, name: 'Moscow' }]
})

const rows = tool.query(
  `SELECT u.name, c.name AS city
   FROM users u LEFT JOIN cities c ON u.city_id = c.id
   WHERE u.id = $id`,
  { params: { $id: 1 } }
)
// → [{ name: 'Anna', city: 'Moscow' }]

console.log(tool.getSchema())
// {
//   users:  { id: { type:'INTEGER', nullable:false }, name: ..., city_id: { ..., nullable:true } },
//   cities: { id: ..., name: ... }
// }
```

## JS → SQLite type mapping (short)

| JS | SQLite |
| ----------------------------- | ------------------------------ |
| `string` | `TEXT` |
| `boolean` | `INTEGER` (0/1) |
| `Uint8Array` | `BLOB` |
| `number` (integer, finite) | `INTEGER` |
| `number` (fractional, finite) | `REAL` |
| `bigint` | `INTEGER` (see `safeIntegers`) |
| `Date` | `TEXT` (ISO 8601) |
| plain `{}`/`[]` | `TEXT` (JSON) |
| `Map`/`Set`/`RegExp`/class | `TEXT NULL` (stored as `null`) |
| `null`/`undefined` | column → nullable |
| `NaN`/`Infinity` | `TEXT` |

The full table with edge cases lives in [`doc/type-mapping.md`](./doc/type-mapping.md).

## Edge cases

- **Empty table without an explicit schema** → error. Pass `{ schema: {...} }`.
- **`Map` / `Set` / `RegExp`** → column `TEXT NULL`, value in DB is `NULL`.
- **Invalid `Date`** → column `TEXT NULL`, value is `NULL`.
- **`NaN` / `Infinity`** → column `TEXT`, value is `'NaN'` / `'Infinity'`.
- **`bigint`** — `safeIntegers='auto'` (default) automatically enables
  bigint mode; ALL INTEGER values are then returned as `bigint`.
- **Identifiers** — every table/column name is quoted (`select`, `from`,
  embedded quotes, unicode — all allowed).

## API

### `new SqliteTool(dbPath?, options?)`

```ts
new SqliteTool(
  dbPath: string = ':memory:',
  options?: {
    readonly?: boolean
    create?: boolean
    strict?: boolean
    safeIntegers?: boolean | 'auto'   // default 'auto'
    walMode?: boolean                 // file-backed DB only
    logger?: { log?, debug?, error? } // default — console
    verbose?: 'silent' | 'info' | 'debug'  // default 'info'
    statementCacheSize?: number       // default 32
  }
)
```

### `setup(tables)`

Atomically (single transaction) creates all tables and fills them with data.

```js
tool.setup({
  // short form
  users: [{ id: 1 }, { id: 2 }],

  // explicit schema + data
  orders: { schema: { id: 'INTEGER', total: 'REAL' }, rows: [...] },

  // schema only (empty table)
  audit:  { schema: { id: 'INTEGER', kind: { type: 'TEXT', nullable: true } } }
})
```

A second call to `setup()` recreates everything from scratch (the previous
tables are dropped).

### `addTable(name, input)`

Adds a single table next to the existing ones. If a table with that name
already exists, it is recreated.

### `query(sql, opts?)`

```js
tool.query('SELECT * FROM users WHERE id = $id', {
  params: { $id: 1 }, // named parameters with the prefix
  restoreTypes: 'auto' // (optional) JSON.parse strings starting with {[ "
})
```

Parameters are **named only** (`$name`, `:name`, `@name`). The key in
`params` must include the same prefix that is used in the SQL (`$id` ↔ `$id`,
`:name` ↔ `:name`).

#### Allowed parameter value types

`opts.params` values are bound directly by `bun:sqlite` — there is **no
auto-conversion** (this is asymmetric with `setup()`, which serializes POJOs
into SQLite types via converters).

| JS value | Result |
| --------------------------------------------- | -------------------------------------- |
| `string` | `TEXT` |
| `number` (finite or `±Infinity`) | `INTEGER` / `REAL` |
| `boolean` | `INTEGER` (`true → 1`, `false → 0`) |
| `bigint` | `INTEGER` |
| `null` / `undefined` | `NULL` |
| `Uint8Array`, `Buffer`, any `TypedArray` | `BLOB` |
| `NaN` | **silently bound as `NULL`** |
| plain `{}` / `[]` | **`TypeError` thrown** by `bun:sqlite` |
| `Date` (valid or invalid) | **`TypeError` thrown** |
| `Map`, `Set`, `RegExp`, class instances | **`TypeError` thrown** |
| `ArrayBuffer` (no view), `function`, `Symbol` | **`TypeError` thrown** |

The `TypeError` reads `Binding expected string, TypedArray, boolean, number, bigint or null`.

For unsupported types pre-serialize on the call site:

```js
tool.query('SELECT * FROM t WHERE data = $d', {
  params: { $d: JSON.stringify({ a: 1 }) }
})
tool.query('SELECT * FROM t WHERE created_at >= $t', {
  params: { $t: new Date().toISOString() }
})
```

Note the `NaN` corner: `setup()` stores `NaN` as the string `'NaN'`, but a
`NaN` parameter binds as `NULL` without any error. Filter `Number.isNaN`
before calling `query()` if that distinction matters.

### `queryIterator(sql, opts?)`

Streams row by row via `Statement.iterate()`. For large SELECTs.

### `queryWithMeta(sql, opts?)`

```js
const { rows, columns, durationMs } = tool.queryWithMeta('SELECT id FROM users')
```

### `getSchema()`

A frozen object `{ table: { col: { type, nullable } } }`. The internal
converters do not appear in the result.

### `close()`

Closes the connection. Idempotent — calling it again is safe.
After `close()` every method (`setup`, `query`, …) throws `Error('SqliteTool is closed')`.

### `[Symbol.dispose]()` / `using`

```js
{
  using tool = new SqliteTool()
  tool.setup(...)
  tool.query(...)
} // close() is called automatically
```

## Running tests

```bash
bun test                        # all tests
bun test test/infer.test.js     # one file
bun test --coverage             # coverage
bunx tsc --noEmit               # type-check
```

## Publishing

See [`publish.md`](./publish.md).

## What's inside

Architecture details, design rationale, and contributor notes —
in the [`doc/`](./doc/) folder.

## Links

- [SQLite docs](https://sqlite.org/docs.html)
- [bun:sqlite](https://bun.com/docs/runtime/sqlite)
