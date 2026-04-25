// @ts-check

/**
 * @typedef { import('./types.d.ts').SqliteTypeConverter } SqliteTypeConverter
 */

/**
 * Safe JSON serialization: only plain objects and arrays.
 * Map/Set/RegExp/Promise/class instances → `null` (non-serializable).
 *
 * @param { unknown } val
 * @returns { string | null }
 */
export const safeJsonStringify = val => {
  if (val == null) return null
  if (Array.isArray(val)) return JSON.stringify(val)
  if (typeof val === 'object' && val.constructor === Object) {
    return JSON.stringify(val)
  }
  return null
}

/** @type { SqliteTypeConverter } */
export const sqliteNullConverter = {
  type: 'NULL',
  test: val => val == null,
  toSqlite: () => null,
  toJs: () => null
}

/** @type { SqliteTypeConverter } */
export const sqliteFloatNumberConverter = {
  type: 'REAL',
  test: val => typeof val === 'number' && Number.isFinite(val),
  toSqlite: val => val,
  toJs: val => val
}

/** @type { SqliteTypeConverter } */
export const sqliteDefaultConverter = {
  type: 'TEXT',
  test: () => true,
  toSqlite: val => String(val),
  toJs: val => val
}

/**
 * Type converters. Order matters — `_inferSchema` picks the first one whose
 * `test()` returns `true`. If a later value does not match, we either try the
 * `fallbackConverter` or fall back to `sqliteDefaultConverter` (TEXT).
 *
 * @type { Array<SqliteTypeConverter> }
 */
export const sqliteTypeConverters = [
  // string
  {
    type: 'TEXT',
    test: val => typeof val === 'string',
    toSqlite: val => String(val),
    toJs: val => val
  },

  // boolean (before integer — typeof true === 'boolean', but stored as 0/1 in SQLite)
  {
    type: 'INTEGER',
    test: val => typeof val === 'boolean',
    toSqlite: val => (val ? 1 : 0),
    toJs: val => val === 1
  },

  // BLOB (before object — Uint8Array is an object)
  {
    type: 'BLOB',
    test: val => val instanceof Uint8Array,
    toSqlite: val => val,
    toJs: val => val
  },

  // number (finite integer)
  {
    type: 'INTEGER',
    test: val =>
      typeof val === 'number' && Number.isFinite(val) && Number.isInteger(val),
    toSqlite: val => val,
    toJs: val => val,
    fallbackConverter: sqliteFloatNumberConverter
  },

  // number (finite, not necessarily integer)
  sqliteFloatNumberConverter,

  // bigint
  {
    type: 'INTEGER',
    test: val => typeof val === 'bigint',
    toSqlite: val => val,
    toJs: val => val
  },

  // Date — invalid Date is stored as null
  {
    type: 'TEXT',
    test: val => val instanceof Date,
    toSqlite: val => {
      const d = /** @type { Date } */ (val)
      if (Number.isNaN(d.getTime())) return null
      return d.toJSON()
    },
    toJs: val => new Date(/** @type { string } */ (val))
  },

  // object/array — only plain objects and arrays; everything else → null
  {
    type: 'TEXT',
    test: val => typeof val === 'object' && val !== null,
    toSqlite: val => safeJsonStringify(val),
    toJs: val => JSON.parse(/** @type { string } */ (val))
  }
]

/**
 * "Generic" converters used when the user supplies an explicit type via
 * `setup({ t: { schema: { id: 'INTEGER' } } })`. Unlike inference converters,
 * they accept any compatible JS type without a `test()` check and do not
 * depend on the order of `sqliteTypeConverters`.
 *
 * @type { Record<'INTEGER' | 'REAL' | 'TEXT' | 'BLOB' | 'NULL', SqliteTypeConverter> }
 */
export const sqliteExplicitConverters = {
  INTEGER: {
    type: 'INTEGER',
    test: val =>
      typeof val === 'number' ||
      typeof val === 'bigint' ||
      typeof val === 'boolean',
    toSqlite: val => {
      if (typeof val === 'boolean') return val ? 1 : 0
      return val
    },
    toJs: val => val
  },
  REAL: {
    type: 'REAL',
    test: val => typeof val === 'number' || typeof val === 'bigint',
    toSqlite: val => (typeof val === 'bigint' ? Number(val) : val),
    toJs: val => val
  },
  TEXT: {
    type: 'TEXT',
    test: () => true,
    toSqlite: val => {
      if (typeof val === 'string') return val
      if (val instanceof Date) {
        return Number.isNaN(val.getTime()) ? null : val.toJSON()
      }
      if (typeof val === 'object' && val !== null) {
        return safeJsonStringify(val)
      }
      return String(val)
    },
    toJs: val => val
  },
  BLOB: {
    type: 'BLOB',
    test: val => val instanceof Uint8Array,
    toSqlite: val => val,
    toJs: val => val
  },
  NULL: sqliteNullConverter
}

/**
 * Returns true if the value can be written through `converter` only as `null`:
 * for `Date`/`object`/`number` there are cases where `toSqlite` returns `null`
 * — that is the signal that the column must become `nullable`.
 *
 * @param { SqliteTypeConverter } converter
 * @param { unknown } val
 * @returns { boolean }
 */
export const willConvertToNull = (converter, val) => {
  if (val == null) return true
  if (
    converter.type === 'TEXT' &&
    val instanceof Date &&
    Number.isNaN(val.getTime())
  ) {
    return true
  }
  if (
    converter.type === 'TEXT' &&
    typeof val === 'object' &&
    !(val instanceof Date) &&
    !(val instanceof Uint8Array) &&
    safeJsonStringify(val) === null
  ) {
    return true
  }
  return false
}
