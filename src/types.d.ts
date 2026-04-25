// ─── Public types ─────────────────────────────────────────────────────

/** SQLite storage type for a value. */
export type SqliteType = 'INTEGER' | 'REAL' | 'TEXT' | 'NULL' | 'BLOB'

/** Public column information (the internal converter is not exposed). */
export interface SqliteSchemaField {
  readonly type: SqliteType
  readonly nullable: boolean
}

/** Schema of a single table: column → field description. */
export type SqliteTableSchema = Readonly<Record<string, SqliteSchemaField>>

/** Schema of all tables in an instance: table → schema. */
export type SqliteSchema = Readonly<Record<string, SqliteTableSchema>>

/** A single row of input data. */
export type SqliteRow = Record<string, unknown>

/**
 * Specification of a single column in an explicit schema: either a string
 * SQLite type or an object `{ type, nullable? }`. "Composite" declarations
 * such as `INTEGER PRIMARY KEY` are also supported — they are forwarded
 * into the DDL as is.
 */
export type SqliteColumnSpec =
  | SqliteType
  | string
  | { type: SqliteType | string; nullable?: boolean }

/** Explicit schema of a table. */
export type SqliteSchemaSpec = Record<string, SqliteColumnSpec>

/** Extended table description: explicit schema + (optional) rows. */
export interface SqliteTableInputLong {
  schema?: SqliteSchemaSpec
  rows?: SqliteRow[]
}

/** Description of a single table — short (rows array) or extended form. */
export type SqliteTableInput = SqliteRow[] | SqliteTableInputLong

/** Object with table descriptions for `setup()`. */
export type SqliteTablesInput = Record<string, SqliteTableInput>

/** Logger with DI injection (defaults to `console`). */
export interface SqliteLogger {
  log?: (...args: unknown[]) => void
  debug?: (...args: unknown[]) => void
  error?: (...args: unknown[]) => void
}

/** Log verbosity level. */
export type SqliteVerbose = 'silent' | 'info' | 'debug'

export interface SqliteToolOptions {
  /** Open the database in read-only mode. */
  readonly?: boolean
  /** Create the file if it does not exist (file mode). */
  create?: boolean
  /** bun:sqlite strict mode. */
  strict?: boolean
  /**
   * `true`  — INTEGER columns are returned as `bigint`.
   * `'auto'` (default) — enabled automatically if a `bigint` is seen in `setup()`.
   * `false` — disabled.
   */
  safeIntegers?: boolean | 'auto'
  /** Enable WAL for a file-backed database (`:memory:` is ignored). */
  walMode?: boolean
  /** Log interception. */
  logger?: SqliteLogger
  /** Verbosity level (defaults to `'info'`). */
  verbose?: SqliteVerbose
  /** LRU cache size for prepared statements. */
  statementCacheSize?: number
}

export interface SqliteQueryOptions {
  /** Object of named parameters (`$name`/`:name`/`@name`). Keys may include the prefix or omit it. */
  params?: Record<string, unknown>
  /**
   * `'auto'` — try `JSON.parse` for string values starting with `{`, `[`, or `"`.
   * `false` (default) — leave strings as is.
   */
  restoreTypes?: 'auto' | false
}

export interface SqliteQueryMeta<T = Record<string, unknown>> {
  rows: T[]
  columns: string[]
  durationMs: number
}

// ─── Internal types (exported for extensions) ─────────────────────────

export interface SqliteTypeConverter {
  type: SqliteType
  test: (value: unknown) => boolean
  toSqlite: (value: unknown) => unknown
  toJs: (value: unknown) => unknown
  fallbackConverter?: SqliteTypeConverter
}

/** Internal "normalized" form of `setup()`/`addTable()` input. */
export interface NormalizedTableInput {
  schema: Record<string, SqliteSchemaField>
  rows: SqliteRow[]
  /** Map of column → internal converter (when the schema was inferred from rows). */
  converters: Record<string, SqliteTypeConverter>
  /** When an explicit schema is given — original "as is" type declarations for DDL. */
  rawTypes?: Record<string, string>
  /** Whether a `bigint` was seen in the data (used for auto-safeIntegers). */
  hasBigInt: boolean
}

// ─── Public class ─────────────────────────────────────────────────────

export class SqliteTool {
  constructor(dbPath?: string, options?: SqliteToolOptions)

  /** Creates tables and fills them. Atomic (single transaction). */
  setup(tables: SqliteTablesInput): void

  /** Creates a single table (or recreates it if it already exists). */
  addTable(name: string, input: SqliteTableInput): void

  /** Runs a SELECT and returns all rows. */
  query<T = Record<string, unknown>>(
    sql: string,
    opts?: SqliteQueryOptions
  ): T[]

  /** Streams the result row by row (on top of `Statement.iterate()`). */
  queryIterator<T = Record<string, unknown>>(
    sql: string,
    opts?: SqliteQueryOptions
  ): IterableIterator<T>

  /** Runs a SELECT and returns rows + columns + duration. */
  queryWithMeta<T = Record<string, unknown>>(
    sql: string,
    opts?: SqliteQueryOptions
  ): SqliteQueryMeta<T>

  /** Frozen schema of all tables. */
  getSchema(): SqliteSchema

  /** Closes the connection. Idempotent. */
  close(): void

  /** TC39 Explicit Resource Management — enables `using` syntax. */
  [Symbol.dispose](): void
}
