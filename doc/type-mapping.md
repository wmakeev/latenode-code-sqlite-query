# JS ↔ SQLite type mapping

> A detailed table with edge cases. The short version is in the README.

## Inference (schema is derived from rows)

| JS value                                   | SQLite                                                  | Nullable  | Write                                              | Read                                                           |
| ------------------------------------------ | ------------------------------------------------------- | --------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `string`                                   | `TEXT`                                                  | per rules | `String(val)`                                      | `string`                                                       |
| `true` / `false`                           | `INTEGER`                                               | per rules | `1` / `0`                                          | `1` / `0` (bun returns a number; for bool compare against `1`) |
| `Uint8Array`                               | `BLOB`                                                  | per rules | `val`                                              | `Uint8Array`                                                   |
| `42` (finite integer)                      | `INTEGER`                                               | per rules | `val`                                              | `number` or `bigint` (see `safeIntegers`)                      |
| `1.5` (finite)                             | `REAL`                                                  | per rules | `val`                                              | `number`                                                       |
| `1n` (`bigint`)                            | `INTEGER`                                               | per rules | `val`                                              | `bigint` (when `safeIntegers` is active)                       |
| valid `Date`                               | `TEXT`                                                  | per rules | `val.toJSON()` (ISO 8601)                          | `string`                                                       |
| invalid `Date`                             | `TEXT`                                                  | **NULL**  | `null`                                             | `null`                                                         |
| `{}`, `[...]` (plain)                      | `TEXT`                                                  | per rules | `JSON.stringify(val)`                              | `string` (see `restoreTypes`)                                  |
| `Map`, `Set`, `RegExp`, `Promise`, classes | `TEXT`                                                  | **NULL**  | `null`                                             | `null`                                                         |
| `NaN`, `Infinity`, `-Infinity`             | `TEXT`                                                  | per rules | `'NaN'` / `'Infinity'` (via the default converter) | `string`                                                       |
| `null`, `undefined`                        | — (does not change the type, makes the column nullable) | yes       | `null`                                             | `null`                                                         |
| key absent in the row                      | — (makes the column nullable)                           | yes       | `null`                                             | `null`                                                         |

### Nullable rules

A column → `nullable: true` if any of the following holds in at least one row:

- the key is missing (`Object.hasOwn(row, key) === false`);
- the value is `null` or `undefined`;
- the `Date` is invalid (`Number.isNaN(val.getTime())`);
- the object is "non-serializable" (`Map`/`Set`/`RegExp`/class with private fields…).

### Type selection and widening rules

1. The first non-null value of a column sets `converter` (the first one in `sqliteTypeConverters` whose `test()` returns `true`).
2. For subsequent values:
   - if `converter.test(val)` is true — keep it;
   - otherwise try `converter.fallbackConverter` (only INTEGER → REAL has one);
   - otherwise widen to `sqliteDefaultConverter` (TEXT via `String(val)`).
3. Once widened to TEXT, the column never narrows again (even if a later integer comes in).

### Column order

Stable, in order of first appearance:

1. Keys of the first row in `Object.keys` order.
2. Then "newcomers" from later rows in order of appearance.

## Explicit schema (via `setup({ t: { schema: {...} } })`)

Here the converters are generic (see `sqliteExplicitConverters`):

| Declared type | Accepts                       | Write                                                                                                                   |
| ------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `'INTEGER'`   | `number`, `bigint`, `boolean` | `boolean → 0/1`, otherwise `val`                                                                                        |
| `'REAL'`      | `number`, `bigint`            | `bigint → Number(val)`, otherwise `val`                                                                                 |
| `'TEXT'`      | any                           | `string → val`, `Date → val.toJSON()` (or `null` for invalid), `plain object → JSON.stringify`, otherwise `String(val)` |
| `'BLOB'`      | `Uint8Array`                  | `val`                                                                                                                   |
| `'NULL'`      | `null` / `undefined`          | `null`                                                                                                                  |

### Composite declarations

Strings such as `'INTEGER PRIMARY KEY'`, `'TEXT NOT NULL DEFAULT \'foo\''`
are supported — they are forwarded into `CREATE TABLE` as is, via
`rawTypes`. The base type is determined by the first word; nullability is
computed from the presence of the `NOT NULL` substring (case-insensitive).

```js
setup({
  users: {
    schema: {
      id: 'INTEGER PRIMARY KEY',
      created_at: 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP'
    },
    rows: []
  }
})
```

### Object form

Alternative to the string form — `{ type, nullable? }`:

```js
{ schema: { id: { type: 'INTEGER', nullable: false } } }
```

`nullable` defaults to `false`.

## Reading results (`query()`)

`bun:sqlite` itself converts SQLite → JS:

- `INTEGER` → `number` or `bigint` (depending on `safeIntegers`);
- `REAL` → `number`;
- `TEXT` → `string`;
- `BLOB` → `Uint8Array`;
- `NULL` → `null`.

The converter `toJs` method is **not called** when reading (see
`doc/architecture.md` — section "Why `toJs` is unused").

### `restoreTypes: 'auto'`

A heuristic applied on top of `query()` results: for every string value
starting with `{`, `[`, or `"` it tries `JSON.parse`. If parsing succeeds —
the value is replaced; if it fails — the original string is kept.

Documented limitations:

- works **only** on the `{[`"`prefix — regular strings (`'hello'`,
`'NaN'`, ISO dates) are left alone;
- for deep structures `JSON.parse` returns a plain object — `Date`/`Map`/etc.
  are not reconstructed;
- in `queryIterator()` it is applied per row.

## Query parameters (`query({ params })`)

`opts.params` values bypass the converter pipeline entirely — they are
forwarded straight into `Statement.all()` / `Statement.iterate()`. The
accepted set is whatever `bun:sqlite` accepts at bind time:

| JS value | Bound as |
| - | - |
| `string` | `TEXT` |
| `number` (finite) | `INTEGER` (no fraction) / `REAL` |
| `Infinity`, `-Infinity` | `REAL` (preserved on read) |
| `NaN` | `NULL` — **silent**, no error |
| `boolean` | `INTEGER` (`true → 1`, `false → 0`) |
| `bigint` | `INTEGER` (regardless of `safeIntegers`) |
| `null`, `undefined` | `NULL` |
| `Uint8Array`, `Buffer`, any `TypedArray` | `BLOB` |
| anything else | `TypeError: Binding expected string, TypedArray, boolean, number, bigint or null` |

"Anything else" covers — among others — plain `{}`/`[]`, `Date` (valid and
invalid), `Map`, `Set`, `RegExp`, class instances, `ArrayBuffer` without a
typed view, `Symbol`, and functions.

### Asymmetry with `setup()`

| Value | `setup()` (POJO data) | `query()` parameter |
| - | - | - |
| plain `{}`/`[]` | `TEXT` (`JSON.stringify`) | **TypeError** |
| `Date` (valid) | `TEXT` (`val.toJSON()`) | **TypeError** |
| `Date` (invalid) | `NULL` | **TypeError** |
| `Map` / `Set` | `NULL` | **TypeError** |
| `NaN` | `'NaN'` (TEXT via `String()`) | `NULL` (silent) |

Pre-serialize on the caller side before binding:

```js
tool.query('SELECT * FROM t WHERE data = $d', {
  params: { $d: JSON.stringify({ a: 1 }) }
})
tool.query('SELECT * FROM t WHERE created_at >= $t', {
  params: { $t: new Date().toISOString() }
})
```

The contract is exercised in `test/query.test.js` (`describe(...
parameter binding ...)`).

### Why no symmetric converter for params

Wrapping params with the same converters as `setup()` was considered and
deliberately not done:

- key-order in `JSON.stringify({})` is not specified — using it inside
  `WHERE col = $v` would be an unstable equality check;
- `Date → toJSON()` would mask invalid dates as `NULL`, surprising filters
  like `WHERE created_at = $d`;
- the explicit `String(val)` / `JSON.stringify(val)` at the call site is
  one line and makes the wire format obvious.

## `safeIntegers`

| Mode               | Behavior                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `false`            | INTEGER is always returned as `number`. Large values (`> 2^53 − 1`) lose precision.                                             |
| `true`             | INTEGER is always returned as `bigint`. ALL INTEGER values, including booleans (1n/0n) and auto-increment.                      |
| `'auto'` (default) | If at least one `bigint` is seen in `setup()`/`addTable()`, the DB is reopened with `safeIntegers: true` and the mode is fixed. |

In bun 1.3.x `safeIntegers` is a constructor option of `Database`, no runtime toggle exists.
That is why `'auto'` physically closes and reopens the DB (see
`doc/architecture.md`).
