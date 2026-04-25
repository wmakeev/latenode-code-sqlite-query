// @ts-check
import { expect, test, describe, beforeEach, afterEach, spyOn } from 'bun:test'
import { SqliteTool } from '../src/SqliteTool.js'

/** @type { SqliteTool } */
let tool

const SILENT = /** @type {const} */ ({ verbose: 'silent' })

describe('setup()', () => {
  beforeEach(() => {
    tool = new SqliteTool(':memory:', SILENT)
  })

  afterEach(() => {
    tool.close()
  })

  test('double setup() with different sets — both versions are alive', () => {
    tool.setup({ a: [{ id: 1 }] })
    tool.setup({ a: [{ id: 1, name: 'x' }] })
    const schema = tool.getSchema()
    expect(Object.keys(schema['a'] ?? {})).toEqual(['id', 'name'])
    const rows = tool.query('SELECT id, name FROM a')
    expect(rows).toEqual([{ id: 1, name: 'x' }])
  })

  test('setup() drops tables from the previous call that are absent in the new one', () => {
    tool.setup({ old: [{ id: 1 }] })
    tool.setup({ neu: [{ id: 2 }] })
    expect(() => tool.query('SELECT * FROM old')).toThrow()
    const rows = tool.query('SELECT * FROM neu')
    expect(rows).toEqual([{ id: 2 }])
  })

  test('setup() is atomic: rolls back fully on error', () => {
    expect(() =>
      tool.setup({
        a: [{ id: 1 }],
        b: /** @type { any } */ (null) // will fail in normalize
      })
    ).toThrow()
    // No tables should have been created
    expect(tool.getSchema()).toEqual({})
    expect(() => tool.query('SELECT * FROM a')).toThrow()
  })

  test('empty table with explicit schema — created without rows', () => {
    tool.setup({
      audit: {
        schema: { id: 'INTEGER', kind: { type: 'TEXT', nullable: true } }
      }
    })
    const schema = tool.getSchema()
    expect(schema['audit']).toEqual({
      id: { type: 'INTEGER', nullable: false },
      kind: { type: 'TEXT', nullable: true }
    })
    const rows = tool.query('SELECT COUNT(*) AS c FROM audit')
    expect(rows[0]).toEqual({ c: 0 })
  })

  test('empty table without schema — error', () => {
    expect(() => tool.setup({ x: [] })).toThrow(/empty table/i)
    expect(() => tool.setup({ x: { rows: [] } })).toThrow(/empty table/i)
  })

  test('mixed input format: array + { schema, rows }', () => {
    tool.setup({
      users: [{ id: 1, name: 'a' }],
      orders: {
        schema: { id: 'INTEGER', total: 'REAL' },
        rows: [{ id: 10, total: 99.5 }]
      }
    })
    const schema = tool.getSchema()
    expect(schema['users']?.['name']).toEqual({ type: 'TEXT', nullable: false })
    expect(schema['orders']?.['total']).toEqual({
      type: 'REAL',
      nullable: false
    })
    expect(
      tool.query('SELECT total FROM orders WHERE id = $id', {
        params: { $id: 10 }
      })
    ).toEqual([{ total: 99.5 }])
  })

  test('explicit schema + rows: row key not in schema → error', () => {
    expect(() =>
      tool.setup({
        t: { schema: { id: 'INTEGER' }, rows: [{ id: 1, extra: 'no' }] }
      })
    ).toThrow(/not declared in explicit schema/)
  })

  test('identifiers containing a quote', () => {
    tool.setup({ 'we"ird': [{ 'col"x': 1 }] })
    const rows = tool.query('SELECT "col""x" FROM "we""ird"')
    expect(rows).toEqual([{ 'col"x': 1 }])
  })

  test('Map in data → column nullable, NULL in DB', () => {
    tool.setup({ t: [{ x: new Map() }] })
    const schema = tool.getSchema()
    expect(schema['t']?.['x']).toEqual({ type: 'TEXT', nullable: true })
    const rows = tool.query('SELECT x FROM t')
    expect(rows[0]).toEqual({ x: null })
  })

  test('invalid Date → column nullable, NULL in DB', () => {
    tool.setup({ t: [{ d: new Date('xxx') }] })
    const schema = tool.getSchema()
    expect(schema['t']?.['d']).toEqual({ type: 'TEXT', nullable: true })
    const rows = tool.query('SELECT d FROM t')
    expect(rows[0]).toEqual({ d: null })
  })

  test('Uint8Array → BLOB', () => {
    const blob = new Uint8Array([1, 2, 3])
    tool.setup({ t: [{ b: blob }] })
    const schema = tool.getSchema()
    expect(schema['t']?.['b']).toEqual({ type: 'BLOB', nullable: false })
    const rows = /** @type { any[] } */ (tool.query('SELECT b FROM t'))
    expect(rows[0].b).toBeInstanceOf(Uint8Array)
    expect(Array.from(rows[0].b)).toEqual([1, 2, 3])
  })

  test('verbose: silent — logs are suppressed', () => {
    const silentTool = new SqliteTool(':memory:', { verbose: 'silent' })
    const spy = spyOn(console, 'log')
    silentTool.setup({ x: [{ a: 1 }] })
    silentTool.close()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('addTable()', () => {
  beforeEach(() => {
    tool = new SqliteTool(':memory:', SILENT)
  })

  afterEach(() => {
    tool.close()
  })

  test('adds a table next to the existing ones', () => {
    tool.setup({ a: [{ id: 1 }] })
    tool.addTable('b', [{ name: 'x' }])
    expect(Object.keys(tool.getSchema())).toEqual(['a', 'b'])
    expect(tool.query('SELECT * FROM a')).toEqual([{ id: 1 }])
    expect(tool.query('SELECT * FROM b')).toEqual([{ name: 'x' }])
  })

  test('recreates an already existing table', () => {
    tool.setup({ a: [{ id: 1 }] })
    tool.addTable('a', [{ id: 2, name: 'new' }])
    const rows = tool.query('SELECT * FROM a')
    expect(rows).toEqual([{ id: 2, name: 'new' }])
  })

  test('addTable with explicit schema and empty rows', () => {
    tool.addTable('events', { schema: { id: 'INTEGER', ts: 'TEXT' } })
    expect(tool.getSchema()['events']).toBeDefined()
    expect(tool.query('SELECT COUNT(*) AS c FROM events')[0]).toEqual({ c: 0 })
  })
})
