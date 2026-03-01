type SqliteType = 'INTEGER' | 'REAL' | 'TEXT' | 'NULL'

interface SqliteTypeConverter {
  type: SqliteType
  test: (value: unknown) => boolean
  toSqlite: (value: unknown) => unknown
  toJs: (value: unknown) => unknown
  fallbackConverter?: SqliteTypeConverter
}

interface SqliteSchemaField {
  type: SqliteType
  nullable: boolean
  converter: SqliteTypeConverter
}

type SqliteTableSchema = Record<string, SqliteSchemaField>
