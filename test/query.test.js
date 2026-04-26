// @ts-check
import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { Buffer } from 'node:buffer'
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

/**
 * Parameter values are bound directly via `bun:sqlite` without any
 * auto-conversion (unlike `setup()`). bun:sqlite accepts only:
 *   string | number | boolean | bigint | null | TypedArray
 * Anything else throws a TypeError at bind time. These tests pin that
 * contract so future bun upgrades or accidental converter-on-params changes
 * are caught.
 */
describe('query() parameter binding — accepted types', () => {
  beforeEach(() => {
    tool = new SqliteTool(':memory:', SILENT)
    tool.setup({ t: [{ id: 1 }] })
  })

  afterEach(() => {
    tool.close()
  })

  test('string', () => {
    const [row] = tool.query('SELECT $v AS v', { params: { $v: 'hello' } })
    expect(row).toEqual({ v: 'hello' })
  })

  test('empty string', () => {
    const [row] = tool.query('SELECT $v AS v', { params: { $v: '' } })
    expect(row).toEqual({ v: '' })
  })

  test('integer number', () => {
    const [row] = tool.query('SELECT $v AS v', { params: { $v: 42 } })
    expect(row).toEqual({ v: 42 })
  })

  test('floating-point number', () => {
    const [row] = tool.query('SELECT $v AS v', { params: { $v: 3.14 } })
    expect(row).toEqual({ v: 3.14 })
  })

  test('Infinity is preserved as REAL', () => {
    const [row] = tool.query('SELECT $v AS v', { params: { $v: Infinity } })
    expect(row).toEqual({ v: Infinity })
  })

  test('-Infinity is preserved as REAL', () => {
    const [row] = tool.query('SELECT $v AS v', { params: { $v: -Infinity } })
    expect(row).toEqual({ v: -Infinity })
  })

  test('NaN is silently bound as NULL (footgun — documented)', () => {
    // bun:sqlite does NOT throw on NaN, it binds NULL. This is asymmetric
    // with setup(), where NaN is stored as the string 'NaN'. Caller code
    // must filter NaN before passing it as a parameter.
    const [row] = tool.query('SELECT $v AS v', { params: { $v: NaN } })
    expect(row).toEqual({ v: null })
  })

  test('boolean true → 1', () => {
    const [row] = tool.query('SELECT $v AS v', { params: { $v: true } })
    expect(row).toEqual({ v: 1 })
  })

  test('boolean false → 0', () => {
    const [row] = tool.query('SELECT $v AS v', { params: { $v: false } })
    expect(row).toEqual({ v: 0 })
  })

  test('bigint (no safeIntegers needed for binding)', () => {
    // Without safeIntegers reading converts to number — precision is lost on
    // read, but the bind itself succeeded. We only assert the bind path here.
    const rows = /** @type { any[] } */ (
      tool.query('SELECT $v AS v', { params: { $v: 9007199254740993n } })
    )
    expect(typeof rows[0].v).toBe('number')
  })

  test('null → NULL', () => {
    const [row] = tool.query('SELECT $v AS v', { params: { $v: null } })
    expect(row).toEqual({ v: null })
  })

  test('undefined → NULL', () => {
    const [row] = tool.query('SELECT $v AS v', { params: { $v: undefined } })
    expect(row).toEqual({ v: null })
  })

  test('Uint8Array → BLOB', () => {
    const buf = new Uint8Array([1, 2, 3])
    const rows = /** @type { any[] } */ (
      tool.query('SELECT $v AS v', { params: { $v: buf } })
    )
    expect(rows[0].v).toEqual(buf)
  })

  test('Buffer (Node-style) → BLOB', () => {
    const rows = /** @type { any[] } */ (
      tool.query('SELECT $v AS v', { params: { $v: Buffer.from('abc') } })
    )
    expect(rows[0].v).toEqual(new Uint8Array([97, 98, 99]))
  })

  test('Int16Array (other TypedArray) → BLOB', () => {
    const rows = /** @type { any[] } */ (
      tool.query('SELECT $v AS v', { params: { $v: new Int16Array([1, 2]) } })
    )
    expect(rows[0].v).toBeInstanceOf(Uint8Array)
  })
})

describe('query() parameter binding — rejected types throw TypeError', () => {
  beforeEach(() => {
    tool = new SqliteTool(':memory:', SILENT)
    tool.setup({ t: [{ id: 1 }] })
  })

  afterEach(() => {
    tool.close()
  })

  const BIND_ERR = /Binding expected/

  test('plain object throws — pre-serialise via JSON.stringify', () => {
    expect(() =>
      tool.query('SELECT $v AS v', { params: { $v: { a: 1 } } })
    ).toThrow(BIND_ERR)
  })

  test('plain array throws', () => {
    expect(() =>
      tool.query('SELECT $v AS v', { params: { $v: [1, 2] } })
    ).toThrow(BIND_ERR)
  })

  test('Date throws — pre-format via toISOString()', () => {
    expect(() =>
      tool.query('SELECT $v AS v', { params: { $v: new Date() } })
    ).toThrow(BIND_ERR)
  })

  test('Map throws', () => {
    expect(() =>
      tool.query('SELECT $v AS v', { params: { $v: new Map([['a', 1]]) } })
    ).toThrow(BIND_ERR)
  })

  test('Set throws', () => {
    expect(() =>
      tool.query('SELECT $v AS v', { params: { $v: new Set([1, 2]) } })
    ).toThrow(BIND_ERR)
  })

  test('RegExp throws', () => {
    expect(() =>
      tool.query('SELECT $v AS v', { params: { $v: /abc/ } })
    ).toThrow(BIND_ERR)
  })

  test('function throws', () => {
    expect(() =>
      tool.query('SELECT $v AS v', { params: { $v: () => 1 } })
    ).toThrow(BIND_ERR)
  })

  test('Symbol throws', () => {
    expect(() =>
      tool.query('SELECT $v AS v', {
        params: /** @type { any } */ ({ $v: Symbol('s') })
      })
    ).toThrow(BIND_ERR)
  })

  test('ArrayBuffer (without TypedArray view) throws', () => {
    expect(() =>
      tool.query('SELECT $v AS v', { params: { $v: new ArrayBuffer(8) } })
    ).toThrow(BIND_ERR)
  })

  test('class instance throws', () => {
    class Foo {
      constructor() {
        this.x = 1
      }
    }
    expect(() =>
      tool.query('SELECT $v AS v', { params: { $v: new Foo() } })
    ).toThrow(BIND_ERR)
  })

  test('recommended workaround for objects: JSON.stringify', () => {
    // Documents the canonical fix for the rejected-types case above.
    tool.close()
    tool = new SqliteTool(':memory:', SILENT)
    tool.setup({ t: [{ id: 1, data: { a: 1 } }] })
    const rows = tool.query('SELECT id FROM t WHERE data = $d', {
      params: { $d: JSON.stringify({ a: 1 }) }
    })
    expect(rows).toEqual([{ id: 1 }])
  })
})
