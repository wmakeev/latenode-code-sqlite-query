// @ts-check

import {
  sqliteDefaultConverter,
  sqliteNullConverter,
  sqliteTypeConverters,
  willConvertToNull
} from '../sqlite-types.js'

/**
 * @typedef { import('../types.d.ts').SqliteRow } SqliteRow
 * @typedef { import('../types.d.ts').SqliteSchemaField } SqliteSchemaField
 * @typedef { import('../types.d.ts').SqliteTableSchema } SqliteTableSchema
 * @typedef { import('../types.d.ts').SqliteTypeConverter } SqliteTypeConverter
 */

/**
 * @typedef { object } InferredSchemaResult
 * @property { Record<string, SqliteSchemaField> } schema  Public description (without converter).
 * @property { Record<string, SqliteTypeConverter> } converters  Map of column → converter.
 * @property { boolean } hasBigInt  `bigint` was seen in at least one row of the input.
 * @property { string[] } nullifiedNonSerializable Names of columns where non-serializable objects (Map/Set/RegExp/...) were seen — they become nullable.
 */

/**
 * Analyses an array of objects and infers the table schema (pure function).
 *
 * Rules:
 * - A column is `nullable: true` if at least one row omits the key, or the value is `null`/`undefined`,
 *   or the `Date` is invalid, or a non-serializable object is seen (Map/Set/RegExp/...).
 * - If all values in a column are `null`/`undefined` → type `NULL`, nullable.
 * - If the first value is captured by `sqliteDefaultConverter` (TEXT) — the column does not narrow further.
 * - Column order: keys of the first row in order of appearance, then "newcomers" from later rows.
 *
 * @param { SqliteRow[] } rows
 * @returns { InferredSchemaResult }
 * @throws { TypeError } if `rows` is empty.
 */
export const inferSchema = rows => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TypeError('Cannot infer schema from empty rows array')
  }

  /** @type { Record<string, SqliteSchemaField> } */
  const schema = {}
  /** @type { Record<string, SqliteTypeConverter> } */
  const converters = {}

  // Column order: first row → then new keys in order of appearance.
  const orderedKeys = /** @type { string[] } */ ([])
  const seenKeys = /** @type { Set<string> } */ (new Set())
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seenKeys.has(k)) {
        seenKeys.add(k)
        orderedKeys.push(k)
      }
    }
  }

  let hasBigInt = false
  /** @type { string[] } */
  const nullifiedNonSerializable = []

  for (const key of orderedKeys) {
    let isNullable = false
    let nonSerializableSeen = false
    /** @type { SqliteTypeConverter | undefined } */
    let converter = undefined

    for (const row of rows) {
      if (!Object.hasOwn(row, key)) {
        isNullable = true
        continue
      }
      const val = row[key]

      if (val == null) {
        isNullable = true
        continue
      }

      if (typeof val === 'bigint') hasBigInt = true

      if (converter == null) {
        const found = sqliteTypeConverters.find(c => c.test(val))
        if (found) {
          converter = found
        } else {
          converter = sqliteDefaultConverter
          // sqliteDefaultConverter catches everything — we no longer narrow,
          // but nullable still has to be checked across all rows.
        }
      } else if (converter.test(val)) {
        // OK
      } else if (
        converter.fallbackConverter &&
        converter.fallbackConverter.test(val)
      ) {
        converter = converter.fallbackConverter
      } else {
        // Widen to TEXT — but still check whether the value will be stored as null
        // (e.g. Map/Set are still non-serializable even after a fallback to TEXT).
        converter = sqliteDefaultConverter
      }

      // Check whether this value will be stored as NULL (Invalid Date,
      // Map/Set/RegExp). If so — the column is nullable.
      if (willConvertToNull(converter, val)) {
        isNullable = true
        if (
          converter.type === 'TEXT' &&
          typeof val === 'object' &&
          !(val instanceof Date) &&
          !(val instanceof Uint8Array)
        ) {
          nonSerializableSeen = true
        }
      }
    }

    if (nonSerializableSeen) {
      nullifiedNonSerializable.push(key)
    }

    converter = converter ?? sqliteNullConverter

    schema[key] = { type: converter.type, nullable: isNullable }
    converters[key] = converter
  }

  return {
    schema,
    converters,
    hasBigInt,
    nullifiedNonSerializable
  }
}
