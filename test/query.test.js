// @ts-check
import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { SqliteTool } from '../src/SqliteTool.js'

/** @type { SqliteTool } */
let tool

const SILENT = /** @type {const} */ ({ verbose: 'silent' })

describe('query()', () => {
  beforeEach(() => {
    tool = new SqliteTool(':memory:', SILENT)
  })

  afterEach(() => {
    tool.close()
  })

  test('invalid SQL → throw without a duplicate log', () => {
    tool.setup({ t: [{ id: 1 }] })
    expect(() => tool.query('SELECT * FROM no_such_table')).toThrow()
  })

  test('named parameter $id', () => {
    tool.setup({ t: [{ id: 1 }, { id: 2 }, { id: 3 }] })
    const rows = tool.query('SELECT id FROM t WHERE id = $id', {
      params: { $id: 2 }
    })
    expect(rows).toEqual([{ id: 2 }])
  })

  test('named parameter :name (with prefix in the key)', () => {
    tool.setup({ t: [{ name: 'a' }, { name: 'b' }] })
    const rows = tool.query('SELECT name FROM t WHERE name = :name', {
      params: { ':name': 'b' }
    })
    expect(rows).toEqual([{ name: 'b' }])
  })

  test('two named parameters of different types', () => {
    tool.setup({
      t: [
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
        { id: 3, label: 'c' }
      ]
    })
    const rows = tool.query(
      'SELECT * FROM t WHERE id = $id AND label = $label',
      { params: { $id: 2, $label: 'b' } }
    )
    expect(rows).toEqual([{ id: 2, label: 'b' }])
  })

  test('restoreTypes: auto restores an object from JSON', () => {
    tool.setup({ t: [{ id: 1, data: { a: 1, b: [2, 3] } }] })
    const [row] = tool.query('SELECT data FROM t', {
      restoreTypes: 'auto'
    })
    expect(row).toEqual({ data: { a: 1, b: [2, 3] } })
  })

  test('restoreTypes default (false) — keeps the string', () => {
    tool.setup({ t: [{ data: { a: 1 } }] })
    const [row] = tool.query('SELECT data FROM t')
    expect(row).toEqual({ data: '{"a":1}' })
  })

  test('restoreTypes: auto leaves non-JSON-looking strings untouched', () => {
    tool.setup({ t: [{ s: 'hello' }] })
    const [row] = tool.query('SELECT s FROM t', { restoreTypes: 'auto' })
    expect(row).toEqual({ s: 'hello' })
  })

  test('restoreTypes: auto does not blow up on "pseudo-JSON"', () => {
    tool.setup({ t: [{ s: '{not-json' }] })
    const [row] = tool.query('SELECT s FROM t', { restoreTypes: 'auto' })
    expect(row).toEqual({ s: '{not-json' })
  })

  test('bigint without precision loss when bigint is present (auto)', () => {
    const big = 9007199254740993n // > Number.MAX_SAFE_INTEGER
    tool.setup({ t: [{ x: big }] })
    const rows = /** @type { any[] } */ (tool.query('SELECT x FROM t'))
    expect(rows[0].x).toBe(big)
  })

  test('safeIntegers: false — precision is lost (documented)', () => {
    const t2 = new SqliteTool(':memory:', { ...SILENT, safeIntegers: false })
    const big = 9007199254740993n
    t2.setup({ t: [{ x: big }] })
    const rows = /** @type { any[] } */ (t2.query('SELECT x FROM t'))
    // Without safeIntegers a number is returned — rounding occurs.
    expect(typeof rows[0].x).toBe('number')
    t2.close()
  })

  test('JOIN across two tables', () => {
    tool.setup({
      items: [
        { id: 1, name: 'pen' },
        { id: 2, name: 'pad' }
      ],
      prices: [
        { id: 1, price: 5 },
        { id: 2, price: 10 }
      ]
    })
    const rows = tool.query(
      'SELECT i.name, p.price FROM items i JOIN prices p ON i.id = p.id WHERE i.id = $id',
      { params: { $id: 2 } }
    )
    expect(rows).toEqual([{ name: 'pad', price: 10 }])
  })

  test('prepared statement cache: repeated query works', () => {
    tool.setup({ t: [{ id: 1 }, { id: 2 }] })
    const r1 = tool.query('SELECT id FROM t WHERE id = $id', {
      params: { $id: 1 }
    })
    const r2 = tool.query('SELECT id FROM t WHERE id = $id', {
      params: { $id: 2 }
    })
    expect(r1).toEqual([{ id: 1 }])
    expect(r2).toEqual([{ id: 2 }])
  })

  test('queryWithMeta returns rows + columns + durationMs', () => {
    tool.setup({ t: [{ id: 1, name: 'a' }] })
    const meta = tool.queryWithMeta('SELECT id, name FROM t')
    expect(meta.rows).toEqual([{ id: 1, name: 'a' }])
    expect(meta.columns).toEqual(['id', 'name'])
    expect(typeof meta.durationMs).toBe('number')
    expect(meta.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('queryIterator streams rows', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      val: `v${i + 1}`
    }))
    tool.setup({ t: rows })
    const iter = tool.queryIterator('SELECT id, val FROM t ORDER BY id')
    const collected = []
    for (const row of iter) {
      collected.push(row)
      if (collected.length === 5) break
    }
    expect(collected).toEqual(rows.slice(0, 5))
  })

  test('queryIterator + restoreTypes: auto', () => {
    tool.setup({ t: [{ data: { a: 1 } }, { data: { b: 2 } }] })
    const iter = tool.queryIterator('SELECT data FROM t', {
      restoreTypes: 'auto'
    })
    const arr = Array.from(iter)
    expect(arr).toEqual([{ data: { a: 1 } }, { data: { b: 2 } }])
  })
})
