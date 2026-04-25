// @ts-check

/**
 * @typedef { import('../types.d.ts').SqliteTableSchema } SqliteTableSchema
 */

/**
 * Escapes a SQL identifier (table or column name) — wraps it in double quotes
 * and doubles any embedded quotes. Empty strings and `\0` are rejected.
 *
 * @param { unknown } name
 * @returns { string }
 */
export const quoteIdent = name => {
  const s = String(name)
  if (s.length === 0) {
    throw new TypeError('SQL identifier must be a non-empty string')
  }
  if (s.includes('\0')) {
    throw new TypeError('SQL identifier must not contain NUL character')
  }
  return `"${s.replaceAll('"', '""')}"`
}

/**
 * Builds a `CREATE TABLE` SQL statement.
 *
 * @param { string } tableName
 * @param { SqliteTableSchema } schema
 * @param { Record<string, string> } [rawTypes] Raw type declarations (for explicit schemas).
 *        If a column has a rawType — it is used as is; otherwise `field.type` + nullable suffix.
 * @returns { string }
 */
export const buildCreateTableSql = (tableName, schema, rawTypes) => {
  const columns = Object.entries(schema).map(([fieldName, field]) => {
    const raw = rawTypes?.[fieldName]
    if (raw !== undefined) {
      // The full column declaration is taken as is — the user is responsible
      // for NULL/NOT NULL/PRIMARY KEY etc.
      return `${quoteIdent(fieldName)} ${raw}`
    }
    return `${quoteIdent(fieldName)} ${field.type}${field.nullable ? ' NULL' : ' NOT NULL'}`
  })
  return `CREATE TABLE ${quoteIdent(tableName)} (${columns.join(', ')});`
}

/**
 * Builds a prepared `INSERT INTO ... VALUES (?, ?, ...)`.
 *
 * @param { string } tableName
 * @param { string[] } columns
 * @returns { string }
 */
export const buildInsertSql = (tableName, columns) => {
  if (columns.length === 0) {
    throw new TypeError(
      `Cannot build INSERT for table "${tableName}": no columns`
    )
  }
  const cols = columns.map(quoteIdent).join(', ')
  const placeholders = columns.map(() => '?').join(', ')
  return `INSERT INTO ${quoteIdent(tableName)} (${cols}) VALUES (${placeholders})`
}

/**
 * Builds a `DROP TABLE IF EXISTS` SQL statement.
 *
 * @param { string } tableName
 * @returns { string }
 */
export const buildDropTableSql = tableName =>
  `DROP TABLE IF EXISTS ${quoteIdent(tableName)};`
