// @ts-check

import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import {
  sqliteDefaultConverter,
  sqliteNullConverter,
  sqliteTypeConverters
} from './sqlite-types.js'

/**
 * Класс для выполнения операций с in-memory базой данных SQLite.
 * Позволяет создавать таблицы из массивов объектов, выполнять параметризованные запросы
 * и получать схему данных.
 */
export class SqliteTool {
  /**
   * @param {string} [dbPath=":memory:"] Путь к файлу БД. По умолчанию используется in-memory.
   */
  constructor(dbPath = ':memory:') {
    this.db = new Database(dbPath)

    /** @type { Record<string, SqliteTableSchema> } */
    this.tablesSchema = {}
  }

  /**
   * Анализирует массив объектов и определяет схему таблицы.
   *
   * @private
   * @param { Array<Object.<string, unknown>> } rows Массив объектов для анализа.
   * @returns { SqliteTableSchema } Объект схемы, где ключи - имена полей, а значения - информация о типе и nullable.
   */
  _inferSchema(rows) {
    if (!rows || rows.length === 0) {
      throw new TypeError(`Empty table row records array`)
    }

    /** @type { Object.<string, SqliteSchemaField> } */
    const schema = {}

    /** @type { Set<string> } */
    const allKeys = new Set()

    // Собираем все уникальные ключи из всех объектов
    rows.forEach(item => Object.keys(item).forEach(key => allKeys.add(key)))

    for (const key of allKeys) {
      let isNullable = false

      /** @type { SqliteTypeConverter | undefined } */
      let converter = undefined

      for (const rowRecord of rows) {
        // Если ключа нет в объекте, значит поле может быть NULL
        if (Object.hasOwn(rowRecord, key) === false) {
          isNullable = true
          continue
        }

        const val = rowRecord[key]

        // Если значение null или undefined, поле тоже nullable
        if (val == null) {
          isNullable = true
          continue
        }

        // Ищем конвертер для типа текущего значения
        if (converter == null) {
          converter = sqliteTypeConverters.find(it => it.test(val))

          if (converter != null) continue

          // Если подходящий конвертер не найден, то берем конвертер по-умолчанию
          converter = sqliteDefaultConverter
          break
        }

        // Соответствует ли текущее значение установленному типу
        else if (converter?.test(val)) {
          continue
        }

        // .. либо если у типа указан fallback тип, то выбираем его
        else if (
          converter?.fallbackConverter &&
          converter.fallbackConverter.test(val)
        ) {
          converter = converter.fallbackConverter
          continue
        }

        // .. либо по умолчанию будет JSON-конвертер
        else {
          converter = sqliteDefaultConverter
          break
        }
      }

      // Если конвертер не определен, то все значения пустые
      converter = converter ?? sqliteNullConverter

      schema[key] = {
        type: converter.type,
        nullable: isNullable,
        converter
      }
    }

    return schema
  }

  /**
   * Генерирует SQL-запрос для создания таблицы на основе схемы.
   *
   * @private
   * @param { string } tableName Имя таблицы.
   * @param { SqliteTableSchema } tableSchema Схема таблицы.
   * @returns { string } SQL-запрос CREATE TABLE.
   */
  _generateCreateTableSql(tableName, tableSchema) {
    const columns = Object.entries(tableSchema).map(
      ([fieldName, { type, nullable }]) => {
        // В SQLite по умолчанию колонки NULLABLE, но для ясности укажем это явно.
        return `"${fieldName}" ${type}${nullable ? ' NULL' : ' NOT NULL'}`
      }
    )

    return `CREATE TABLE "${tableName}" (${columns.join(', ')});`
  }

  /**
   * Заполняет таблицу данными с использованием транзакции для производительности.
   *
   * @param {string} tableName Имя таблицы.
   * @param {Array<Object.<string, unknown>>} data Данные для вставки.
   * @private
   */
  _insertData(tableName, data) {
    if (!data || data.length === 0) {
      return
    }

    const tableSchema = this.tablesSchema[tableName]
    assert.ok(tableSchema, `Table "${tableName}" not found.`)

    const allColumns = Object.keys(tableSchema)

    const placeholders = allColumns.map(() => '?').join(', ')

    const insertSql = `INSERT INTO "${tableName}" (${allColumns
      .map(c => `"${c}"`)
      .join(', ')}) VALUES (${placeholders})`

    const insert = this.db.prepare(insertSql)

    console.debug(`SQL prepared: ${insertSql}`)

    const insertAll = this.db.transaction(() => {
      for (const row of data) {
        /** @type { any[] } */
        const values = []

        for (const col of allColumns) {
          const schema = tableSchema[col]
          assert.ok(schema)
          const val = row[col]
          values.push(val == null ? null : schema.converter.toSqlite(val))
        }

        insert.run(...values)
      }
    })

    insertAll()
  }

  /**
   * Основной метод для настройки базы данных на основе переданных таблиц.
   *
   * @param {Object.<string, Array<Object.<string, unknown>>>} tables Объект, где ключи - имена таблиц, а значения - массивы записей.
   */
  setup(tables) {
    this.tablesSchema = {} // Сбрасываем схему при каждом новом вызове setup

    for (const tableName in tables) {
      if (!Object.prototype.hasOwnProperty.call(tables, tableName)) {
        continue
      }

      const rows = tables[tableName]
      assert.ok(Array.isArray(rows))

      const tableSchema = this._inferSchema(rows)
      assert.ok(tableSchema)

      this.tablesSchema[tableName] = tableSchema

      const createTableSql = this._generateCreateTableSql(
        tableName,
        tableSchema
      )

      console.log(`[SQL] ${createTableSql}`)
      this.db.run(createTableSql)

      this._insertData(tableName, rows)
      console.log(
        `[INFO] Table "${tableName}" created and filled with ${rows.length} rows.`
      )
    }
  }

  // TODO Удобнее работать с именнованными параметрами
  // https://bun.com/docs/runtime/sqlite#parameters

  /**
   * Выполняет параметризованный SQL-запрос.
   *
   * @param { string } sql SQL-запрос с placeholders `?`.
   * @param { Array<any> } [params=[]] Массив параметров для подстановки в запрос.
   * @returns { Array<Object> } Результат запроса в виде массива POJO объектов.
   */
  query(sql, params = []) {
    console.log(`[SQL] Запрос: ${sql} с параметрами:`, params)
    try {
      // .all() выполняет запрос и возвращает все строки как массив объектов
      return this.db.query(sql).all(...params)
    } catch (/** @type { any } */ err) {
      console.error(`[ERROR] Ошибка выполнения запроса: ${err.message}`)
      throw err // Пробрасываем ошибку дальше, чтобы пользователь мог ее обработать
    }
  }

  /**
   * Возвращает схему данных, которая была выведена при последнем вызове setup().
   * @returns Схема всех таблиц.
   */
  getSchema() {
    return this.tablesSchema
  }

  /**
   * Закрывает соединение с базой данных.
   */
  close() {
    this.db.close()
    console.log('[INFO] Соединение с базой данных закрыто.')
  }
}
