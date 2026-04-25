// @ts-check

import { Database } from 'bun:sqlite'
import {
  buildCreateTableSql,
  buildDropTableSql,
  buildInsertSql
} from './schema/ddl.js'
import {
  normalizeTableInput,
  normalizeTablesInput
} from './schema/normalize.js'

/**
 * @typedef { import('./types.d.ts').SqliteLogger } SqliteLogger
 * @typedef { import('./types.d.ts').SqliteQueryOptions } SqliteQueryOptions
 * @typedef { import('./types.d.ts').SqliteRow } SqliteRow
 * @typedef { import('./types.d.ts').SqliteSchema } SqliteSchema
 * @typedef { import('./types.d.ts').SqliteSchemaField } SqliteSchemaField
 * @typedef { import('./types.d.ts').SqliteTableInput } SqliteTableInput
 * @typedef { import('./types.d.ts').SqliteTablesInput } SqliteTablesInput
 * @typedef { import('./types.d.ts').SqliteToolOptions } SqliteToolOptions
 * @typedef { import('./types.d.ts').SqliteType } SqliteType
 * @typedef { import('./types.d.ts').SqliteTypeConverter } SqliteTypeConverter
 * @typedef { import('./types.d.ts').SqliteVerbose } SqliteVerbose
 * @typedef { import('./types.d.ts').NormalizedTableInput } NormalizedTableInput
 */

const DEFAULT_STMT_CACHE_SIZE = 32

/** @type { Required<Pick<SqliteLogger, 'log' | 'debug' | 'error'>> } */
const CONSOLE_LOGGER = {
  log: (...args) => console.log(...args),
  debug: (...args) => console.debug(...args),
  error: (...args) => console.error(...args)
}

/** @type { Required<Pick<SqliteLogger, 'log' | 'debug' | 'error'>> } */
const SILENT_LOGGER = {
  log: () => {},
  debug: () => {},
  error: () => {}
}

const NOOP = () => {}

/**
 * Named-parameter prefixes accepted by bun:sqlite.
 */
const PREFIX_RE = /^[$@:]/

/**
 * Type-restoration heuristic: tries to JSON.parse strings starting with `{`, `[`, or `"`.
 * Mutates the passed-in row in place.
 *
 * @param { Record<string, unknown> } row
 */
const restoreRowTypes = row => {
  for (const k of Object.keys(row)) {
    const v = row[k]
    if (typeof v !== 'string' || v.length === 0) continue
    const first = v[0]
    if (first !== '{' && first !== '[' && first !== '"') continue
    try {
      row[k] = JSON.parse(v)
    } catch {
      // Leave the string as is.
    }
  }
}

/**
 * Class for running operations against an in-memory SQLite database.
 * Lifecycle: `new SqliteTool(dbPath?, options?)` → `setup(tables)` → `query(sql, opts?)` → `close()`.
 *
 * Supports `using` (TC39 Explicit Resource Management):
 * ```js
 * using tool = new SqliteTool()
 * tool.setup({ users: [{ id: 1 }] })
 * ```
 */
export class SqliteTool {
  /**
   * @param { string } [dbPath] Path to the database file (defaults to `:memory:`).
   * @param { SqliteToolOptions } [options]
   */
  constructor(dbPath = ':memory:', options = {}) {
    /** @private */
    this._dbPath = dbPath

    /**
     * @private
     * @type { SqliteToolOptions }
     */
    this._options = options

    /** @private */
    this._verbose = /** @type { SqliteVerbose } */ (options.verbose ?? 'info')

    /** @private */
    this._logger = this._buildLogger(options.logger)

    /** @private */
    this._safeIntegersOpt = options.safeIntegers ?? 'auto'

    /**
     * Current safeIntegers state of the database (true means bigint mode).
     * @private
     */
    this._safeIntegersActive = this._safeIntegersOpt === true

    /** @private */
    this._stmtCacheLimit = options.statementCacheSize ?? DEFAULT_STMT_CACHE_SIZE

    /** @type { Database } */
    this.db = this._openDb(this._safeIntegersActive)

    /**
     * Map `tableName → schema` (internal — includes converters).
     * @type { Record<string, { fields: Record<string, SqliteSchemaField>, converters: Record<string, SqliteTypeConverter> }> }
     * @private
     */
    this._tables = {}

    /**
     * Cache of prepared query statements keyed by SQL text (LRU).
     * @type { Map<string, ReturnType<Database['prepare']>> }
     * @private
     */
    this._stmtCache = new Map()

    /** @private */
    this._closed = false
  }

  /**
   * @private
   * @param { boolean } safeIntegers
   * @returns { Database }
   */
  _openDb(safeIntegers) {
    const opts = this._options
    /** @type { import('bun:sqlite').DatabaseOptions } */
    const dbOpts = { safeIntegers }
    if (opts.readonly !== undefined) dbOpts.readonly = opts.readonly
    if (opts.create !== undefined) dbOpts.create = opts.create
    if (opts.strict !== undefined) dbOpts.strict = opts.strict
    const db = new Database(this._dbPath, dbOpts)
    if (opts.walMode === true && this._dbPath !== ':memory:') {
      db.run('PRAGMA journal_mode = WAL;')
    }
    return db
  }

  /**
   * Builds a logger honoring `verbose` and the user-supplied `options.logger`.
   *
   * @private
   * @param { SqliteLogger | undefined } userLogger
   * @returns { Required<Pick<SqliteLogger, 'log' | 'debug' | 'error'>> }
   */
  _buildLogger(userLogger) {
    const base = userLogger ?? CONSOLE_LOGGER
    const verbose = this._verbose
    if (verbose === 'silent') return SILENT_LOGGER
    return {
      log: base.log ?? NOOP,
      debug: verbose === 'debug' ? (base.debug ?? NOOP) : NOOP,
      error: base.error ?? NOOP
    }
  }

  /** @private */
  _ensureOpen() {
    if (this._closed) {
      throw new Error('SqliteTool is closed')
    }
  }

  /**
   * Creates tables and fills them with data. Atomic: on error the database is
   * left in its pre-call state (including any tables previously created via `setup()`).
   *
   * @param { SqliteTablesInput } tables
   */
  setup(tables) {
    this._ensureOpen()

    const normalized = normalizeTablesInput(tables)

    // For 'auto' — if the data contains a bigint, reopen the DB with safeIntegers=true.
    // Done BEFORE _applyTables, because bun:sqlite only allows enabling bigint mode
    // via the constructor. All tables are recreated in _applyTables, so no state is
    // lost (and for :memory: there is no state to lose).
    if (
      this._safeIntegersOpt === 'auto' &&
      !this._safeIntegersActive &&
      Object.values(normalized).some(n => n.hasBigInt)
    ) {
      this._reopenWithSafeIntegers()
    }

    this._applyTables(normalized, /* dropPrev */ true)
  }

  /** @private */
  _reopenWithSafeIntegers() {
    this._clearStmtCache()
    this.db.close()
    this.db = this._openDb(true)
    this._safeIntegersActive = true
    // After reopening, previously created tables are gone (they lived in the old DB).
    this._tables = {}
  }

  /**
   * Creates a single table (or recreates it if it already exists).
   *
   * @param { string } name
   * @param { SqliteTableInput } input
   */
  addTable(name, input) {
    this._ensureOpen()
    const normalized = normalizeTableInput(name, input)
    this._applyTables({ [name]: normalized }, /* dropPrev */ false)
  }

  /**
   * Atomically applies a normalized set of tables.
   *
   * @private
   * @param { Record<string, NormalizedTableInput> } normalized
   * @param { boolean } dropPrev — if true, drop all tables previously created via setup().
   */
  _applyTables(normalized, dropPrev) {
    const prevTables = this._tables
    /** @type { Record<string, { fields: Record<string, SqliteSchemaField>, converters: Record<string, SqliteTypeConverter> }> } */
    const nextTables = dropPrev ? {} : { ...prevTables }

    // Release the prepared-statement cache — statements cannot survive DROP.
    this._clearStmtCache()

    const tx = this.db.transaction(() => {
      if (dropPrev) {
        for (const oldName of Object.keys(prevTables)) {
          this.db.run(buildDropTableSql(oldName))
        }
      }

      for (const [name, n] of Object.entries(normalized)) {
        // For addTable() — in case the table already exists in the DB.
        this.db.run(buildDropTableSql(name))

        const createSql = buildCreateTableSql(name, n.schema, n.rawTypes)
        this._logger.log(`[SQL] ${createSql}`)
        this.db.run(createSql)

        nextTables[name] = { fields: n.schema, converters: n.converters }

        if (n.rows.length > 0) {
          this._insertRows(name, n)
        }

        this._logger.log(
          `[INFO] Table "${name}" created and filled with ${n.rows.length} rows.`
        )
      }
    })

    try {
      tx()
    } catch (err) {
      this._tables = prevTables
      throw err
    }
    this._tables = nextTables
  }

  /**
   * @private
   * @param { string } tableName
   * @param { NormalizedTableInput } n
   */
  _insertRows(tableName, n) {
    const columns = Object.keys(n.schema)
    if (columns.length === 0) return
    const insertSql = buildInsertSql(tableName, columns)
    const stmt = this.db.prepare(insertSql)
    this._logger.debug(`[SQL] prepared: ${insertSql}`)

    try {
      for (const row of n.rows) {
        /** @type { unknown[] } */
        const values = []
        for (const col of columns) {
          const conv = n.converters[col]
          if (!conv) {
            throw new Error(
              `Internal: missing converter for column "${col}" of table "${tableName}"`
            )
          }
          const val = row[col]
          values.push(val == null ? null : conv.toSqlite(val))
        }
        stmt.run(.../** @type { any[] } */ (values))
      }
    } finally {
      stmt.finalize()
    }
  }

  /**
   * Runs a SELECT and returns all rows.
   *
   * @template { Record<string, unknown> } [T = Record<string, unknown>]
   * @param { string } sql
   * @param { SqliteQueryOptions } [opts]
   * @returns { T[] }
   */
  query(sql, opts = {}) {
    this._ensureOpen()
    const stmt = this._getOrPrepare(sql)
    this._logger.debug(`[SQL] Query: ${sql}`, opts.params)

    const rows = /** @type { T[] } */ (
      this._runAll(stmt, /** @type { any } */ (opts.params))
    )

    if (opts.restoreTypes === 'auto') {
      for (const row of rows) restoreRowTypes(row)
    }
    return rows
  }

  /**
   * Streams the result row by row (on top of `Statement.iterate()`).
   *
   * @template { Record<string, unknown> } [T = Record<string, unknown>]
   * @param { string } sql
   * @param { SqliteQueryOptions } [opts]
   * @yields { T }
   * @returns { IterableIterator<T> }
   */
  *queryIterator(sql, opts = {}) {
    this._ensureOpen()
    const stmt = this._getOrPrepare(sql)
    this._logger.debug(`[SQL] Iterator: ${sql}`, opts.params)

    const iter = this._runIterate(stmt, /** @type { any } */ (opts.params))
    const restore = opts.restoreTypes === 'auto'
    for (const row of iter) {
      const r = /** @type { T } */ (row)
      if (restore) restoreRowTypes(/** @type { Record<string, unknown> } */ (r))
      yield r
    }
  }

  /**
   * Runs a SELECT and returns rows + column list + duration (ms).
   *
   * @template { Record<string, unknown> } [T = Record<string, unknown>]
   * @param { string } sql
   * @param { SqliteQueryOptions } [opts]
   * @returns { import('./types.d.ts').SqliteQueryMeta<T> }
   */
  queryWithMeta(sql, opts = {}) {
    this._ensureOpen()
    const stmt = this._getOrPrepare(sql)
    this._logger.debug(`[SQL] WithMeta: ${sql}`, opts.params)

    const t0 = performance.now()
    const rows = /** @type { T[] } */ (
      this._runAll(stmt, /** @type { any } */ (opts.params))
    )
    const durationMs = performance.now() - t0

    if (opts.restoreTypes === 'auto') {
      for (const row of rows) restoreRowTypes(row)
    }

    const columns = stmt.columnNames ?? []
    return { rows, columns, durationMs }
  }

  /**
   * @private
   * @param { ReturnType<Database['prepare']> } stmt
   * @param { Record<string, unknown> | undefined } params
   * @returns { unknown[] }
   */
  _runAll(stmt, params) {
    if (params === undefined) return stmt.all()
    return stmt.all(/** @type { any } */ (params))
  }

  /**
   * @private
   * @param { ReturnType<Database['prepare']> } stmt
   * @param { Record<string, unknown> | undefined } params
   * @returns { IterableIterator<unknown> }
   */
  _runIterate(stmt, params) {
    if (params === undefined) return stmt.iterate()
    return stmt.iterate(/** @type { any } */ (params))
  }

  /**
   * @private
   * @param { string } sql
   * @returns { ReturnType<Database['prepare']> }
   */
  _getOrPrepare(sql) {
    const cached = this._stmtCache.get(sql)
    if (cached !== undefined) {
      // LRU touch
      this._stmtCache.delete(sql)
      this._stmtCache.set(sql, cached)
      return cached
    }
    const stmt = this.db.prepare(sql)
    this._stmtCache.set(sql, stmt)
    if (this._stmtCache.size > this._stmtCacheLimit) {
      const oldestKey = this._stmtCache.keys().next().value
      if (oldestKey !== undefined) {
        const evicted = this._stmtCache.get(oldestKey)
        this._stmtCache.delete(oldestKey)
        evicted?.finalize()
      }
    }
    return stmt
  }

  /** @private */
  _clearStmtCache() {
    for (const stmt of this._stmtCache.values()) {
      stmt.finalize()
    }
    this._stmtCache.clear()
  }

  /**
   * Frozen schema of all tables `{ table: { col: { type, nullable } } }`.
   * Internal converters are not exposed.
   *
   * @returns { SqliteSchema }
   */
  getSchema() {
    /** @type { Record<string, Record<string, SqliteSchemaField>> } */
    const out = {}
    for (const [tableName, table] of Object.entries(this._tables)) {
      /** @type { Record<string, SqliteSchemaField> } */
      const cols = {}
      for (const [colName, field] of Object.entries(table.fields)) {
        cols[colName] = Object.freeze({
          type: field.type,
          nullable: field.nullable
        })
      }
      out[tableName] = Object.freeze(cols)
    }
    return /** @type { SqliteSchema } */ (Object.freeze(out))
  }

  /** Closes the connection. Idempotent. */
  close() {
    if (this._closed) {
      this._logger.log('[INFO] Already closed')
      return
    }
    this._clearStmtCache()
    this.db.close()
    this._closed = true
    this._logger.log('[INFO] Database connection closed.')
  }

  /** TC39 Explicit Resource Management — enables `using` syntax. */
  [Symbol.dispose]() {
    this.close()
  }
}

// Suppress «unused» for PREFIX_RE — kept for a stricter future params validation.
void PREFIX_RE
