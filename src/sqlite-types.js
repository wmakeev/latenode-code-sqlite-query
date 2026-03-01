// @ts-check

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
  test: val => typeof val === 'number',
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
 * Конвертеры типов
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

  // boolean
  // SQLite не имеет boolean типа, используем INTEGER (0/1)
  {
    type: 'INTEGER',
    test: val => typeof val === 'boolean',
    toSqlite: val => (val === true ? 1 : 0),
    toJs: val => (val === 1 ? true : false)
  },

  // number (integer)
  {
    type: 'INTEGER',
    test: val => typeof val === 'number' && Number.isInteger(val) === true,
    toSqlite: val => val,
    toJs: val => val,
    fallbackConverter: sqliteFloatNumberConverter
  },

  // number (not integer)
  sqliteFloatNumberConverter,

  // bigint
  {
    type: 'INTEGER',
    test: val => typeof val === 'bigint',
    toSqlite: val => val,
    toJs: val => val
  },

  // Date
  {
    type: 'TEXT',
    test: val => val instanceof Date,
    toSqlite: val => {
      return /** @type { Date } */ (val).toJSON()
    },
    toJs: val => new Date(/** @type { string } */ (val))
  },

  // object
  {
    type: 'TEXT',
    test: val => typeof val === 'object',
    toSqlite: val => JSON.stringify(val),
    toJs: val => JSON.parse(/** @type { string } */ (val))
  }
]
