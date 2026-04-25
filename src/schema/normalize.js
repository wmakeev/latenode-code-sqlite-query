// @ts-check

import { inferSchema } from './infer.js'
import { sqliteExplicitConverters } from '../sqlite-types.js'

/**
 * @typedef { import('../types.d.ts').SqliteTableInput } SqliteTableInput
 * @typedef { import('../types.d.ts').SqliteRow } SqliteRow
 * @typedef { import('../types.d.ts').SqliteSchemaSpec } SqliteSchemaSpec
 * @typedef { import('../types.d.ts').SqliteSchemaField } SqliteSchemaField
 * @typedef { import('../types.d.ts').SqliteTableSchema } SqliteTableSchema
 * @typedef { import('../types.d.ts').SqliteType } SqliteType
 * @typedef { import('../types.d.ts').SqliteTypeConverter } SqliteTypeConverter
 * @typedef { import('../types.d.ts').NormalizedTableInput } NormalizedTableInput
 */

const KNOWN_TYPES = /** @type { ReadonlySet<string> } */ (
  new Set(['INTEGER', 'REAL', 'TEXT', 'NULL', 'BLOB'])
)

/**
 * Extracts the "short" SQLite type name from an arbitrary declaration string
 * (`'INTEGER PRIMARY KEY AUTOINCREMENT'` → `'INTEGER'`).
 *
 * @param { string } typeStr
 * @returns { SqliteType }
 */
const extractBaseType = typeStr => {
  const upper = typeStr.trim().toUpperCase()
  for (const t of KNOWN_TYPES) {
    if (upper === t || upper.startsWith(t + ' ')) {
      return /** @type { SqliteType } */ (t)
    }
  }
  throw new TypeError(
    `Unknown SQLite type "${typeStr}". Expected one of: INTEGER, REAL, TEXT, NULL, BLOB.`
  )
}

/**
 * Returns the "generic" converter for the base type from an explicit schema.
 *
 * @param { SqliteType } type
 * @returns { SqliteTypeConverter }
 */
const defaultConverterFor = type => sqliteExplicitConverters[type]

/**
 * Turns an explicit schema such as
 * `{ id: 'INTEGER', name: { type: 'TEXT', nullable: true } }` into the public
 * `{ id: { type, nullable }, ... }` form plus a converter map.
 *
 * @param { SqliteSchemaSpec } spec
 * @returns { { schema: Record<string, SqliteSchemaField>, converters: Record<string, SqliteTypeConverter>, rawTypes: Record<string, string> } }
 */
const compileSchemaSpec = spec => {
  /** @type { Record<string, SqliteSchemaField> } */
  const schema = {}
  /** @type { Record<string, SqliteTypeConverter> } */
  const converters = {}
  /** @type { Record<string, string> } */
  const rawTypes = {}

  for (const [colName, colSpec] of Object.entries(spec)) {
    if (typeof colSpec === 'string') {
      const baseType = extractBaseType(colSpec)
      const isComposite = colSpec.trim().toUpperCase() !== baseType
      const upper = colSpec.toUpperCase()
      // If the string contains NOT NULL — the field is NOT NULL; if NULL — nullable;
      // otherwise the default is nullable=false for composites and true otherwise.
      const nullable = isComposite
        ? upper.includes(' NOT NULL') === false
        : false
      schema[colName] = { type: baseType, nullable }
      converters[colName] = defaultConverterFor(baseType)
      if (isComposite) rawTypes[colName] = colSpec
    } else if (colSpec && typeof colSpec === 'object') {
      const typeStr = String(colSpec.type)
      const baseType = extractBaseType(typeStr)
      const nullable = Boolean(colSpec.nullable)
      schema[colName] = { type: baseType, nullable }
      converters[colName] = defaultConverterFor(baseType)
      const isComposite = typeStr.trim().toUpperCase() !== baseType
      if (isComposite) rawTypes[colName] = typeStr
    } else {
      throw new TypeError(
        `Invalid schema spec for column "${colName}": expected string or { type, nullable? }`
      )
    }
  }

  return { schema, converters, rawTypes }
}

/**
 * When both an explicit schema and rows are provided — merge them: the explicit
 * schema sets the type, while rows allow detection of additional keys (those
 * not declared in the schema). If a row has a key that is missing from the
 * schema — that is an error (the user must declare it explicitly).
 *
 * @param { SqliteSchemaSpec } spec
 * @param { SqliteRow[] } rows
 * @param { string } tableName
 * @returns { NormalizedTableInput }
 */
const compileWithRows = (spec, rows, tableName) => {
  const compiled = compileSchemaSpec(spec)
  let hasBigInt = false
  // Verify rows do not contain keys that are missing from the schema.
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!Object.hasOwn(compiled.schema, key)) {
        throw new TypeError(
          `Row for table "${tableName}" contains column "${key}" which is not declared in explicit schema.`
        )
      }
      if (typeof row[key] === 'bigint') hasBigInt = true
    }
  }
  return {
    schema: compiled.schema,
    rows,
    converters: compiled.converters,
    rawTypes: compiled.rawTypes,
    hasBigInt
  }
}

/**
 * Coerces the input for a single table into its canonical form.
 *
 * Supported input forms:
 * 1. `[{...row}, ...]` — short form, schema is inferred from rows.
 * 2. `{ schema: {...}, rows: [...] }` — explicit schema overrides inference.
 * 3. `{ schema: {...} }` — schema only, empty table.
 * 4. `{ rows: [...] }` — equivalent to the short form.
 *
 * @param { string } tableName
 * @param { SqliteTableInput } input
 * @returns { NormalizedTableInput }
 */
export const normalizeTableInput = (tableName, input) => {
  if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new TypeError(
        `Cannot infer schema for empty table "${tableName}". Provide explicit schema via { schema: {...} }.`
      )
    }
    const { schema, converters, hasBigInt } = inferSchema(input)
    return { schema, rows: input, converters, hasBigInt }
  }

  if (input && typeof input === 'object') {
    const long =
      /** @type { { schema?: SqliteSchemaSpec, rows?: SqliteRow[] } } */ (input)
    const rows = long.rows ?? []
    if (long.schema) {
      return compileWithRows(long.schema, rows, tableName)
    }
    if (rows.length === 0) {
      throw new TypeError(
        `Cannot infer schema for empty table "${tableName}". Provide explicit schema via { schema: {...} }.`
      )
    }
    const { schema, converters, hasBigInt } = inferSchema(rows)
    return { schema, rows, converters, hasBigInt }
  }

  throw new TypeError(
    `Invalid input for table "${tableName}": expected array of rows or { schema, rows? }.`
  )
}

/**
 * Coerces the input of `setup()` into a `{ tableName -> NormalizedTableInput }` map.
 *
 * @param { Record<string, SqliteTableInput> } tables
 * @returns { Record<string, NormalizedTableInput> }
 */
export const normalizeTablesInput = tables => {
  /** @type { Record<string, NormalizedTableInput> } */
  const out = {}
  for (const [name, input] of Object.entries(tables)) {
    out[name] = normalizeTableInput(name, input)
  }
  return out
}
