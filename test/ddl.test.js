// @ts-check
import { expect, test, describe } from 'bun:test'
import {
  buildCreateTableSql,
  buildDropTableSql,
  buildInsertSql,
  quoteIdent
} from '../src/schema/ddl.js'

describe('quoteIdent', () => {
  test('regular name', () => {
    expect(quoteIdent('users')).toBe('"users"')
  })

  test('reserved word', () => {
    expect(quoteIdent('select')).toBe('"select"')
  })

  test('name with a quote doubles it', () => {
    expect(quoteIdent('weird"name')).toBe('"weird""name"')
  })

  test('unicode name', () => {
    expect(quoteIdent('таблица')).toBe('"таблица"')
  })

  test('empty name throws', () => {
    expect(() => quoteIdent('')).toThrow(TypeError)
  })

  test('NUL character throws', () => {
    expect(() => quoteIdent('a\0b')).toThrow(TypeError)
  })
})

describe('buildCreateTableSql', () => {
  test('basic schema', () => {
    const sql = buildCreateTableSql('users', {
      id: { type: 'INTEGER', nullable: false },
      name: { type: 'TEXT', nullable: true }
    })
    expect(sql).toBe(
      'CREATE TABLE "users" ("id" INTEGER NOT NULL, "name" TEXT NULL);'
    )
  })

  test('escapes table and column names containing a quote', () => {
    const sql = buildCreateTableSql('we"ird', {
      'col"x': { type: 'INTEGER', nullable: false }
    })
    expect(sql).toBe('CREATE TABLE "we""ird" ("col""x" INTEGER NOT NULL);')
  })

  test('rawTypes are forwarded as is', () => {
    const sql = buildCreateTableSql(
      'orders',
      {
        id: { type: 'INTEGER', nullable: false },
        total: { type: 'REAL', nullable: false }
      },
      { id: 'INTEGER PRIMARY KEY' }
    )
    expect(sql).toBe(
      'CREATE TABLE "orders" ("id" INTEGER PRIMARY KEY, "total" REAL NOT NULL);'
    )
  })

  test('snapshot for a known schema', () => {
    const sql = buildCreateTableSql('items', {
      id: { type: 'INTEGER', nullable: false },
      name: { type: 'TEXT', nullable: false },
      price: { type: 'REAL', nullable: true },
      data: { type: 'BLOB', nullable: true }
    })
    expect(sql).toMatchSnapshot()
  })
})

describe('buildInsertSql', () => {
  test('single column', () => {
    expect(buildInsertSql('t', ['a'])).toBe('INSERT INTO "t" ("a") VALUES (?)')
  })

  test('multiple columns', () => {
    expect(buildInsertSql('t', ['a', 'b', 'c'])).toBe(
      'INSERT INTO "t" ("a", "b", "c") VALUES (?, ?, ?)'
    )
  })

  test('escapes names', () => {
    expect(buildInsertSql('we"ird', ['col"x'])).toBe(
      'INSERT INTO "we""ird" ("col""x") VALUES (?)'
    )
  })

  test('empty column list — error', () => {
    expect(() => buildInsertSql('t', [])).toThrow(TypeError)
  })
})

describe('buildDropTableSql', () => {
  test('emits DROP TABLE IF EXISTS', () => {
    expect(buildDropTableSql('users')).toBe('DROP TABLE IF EXISTS "users";')
  })

  test('escapes the name', () => {
    expect(buildDropTableSql('we"ird')).toBe('DROP TABLE IF EXISTS "we""ird";')
  })
})
