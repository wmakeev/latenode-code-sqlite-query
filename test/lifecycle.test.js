// @ts-check
import { expect, test, describe } from 'bun:test'
import { SqliteTool } from '../src/SqliteTool.js'

const SILENT = /** @type {const} */ ({ verbose: 'silent' })

describe('lifecycle', () => {
  test('using-syntax closes the connection', () => {
    let tool
    {
      using t = new SqliteTool(':memory:', SILENT)
      tool = t
      t.setup({ x: [{ id: 1 }] })
      expect(t.query('SELECT id FROM x')).toEqual([{ id: 1 }])
    }
    // tool[Symbol.dispose] has been called — query must throw
    expect(() => tool.query('SELECT 1')).toThrow(/closed/i)
  })

  test('repeated close() — no-op, does not throw', () => {
    const t = new SqliteTool(':memory:', SILENT)
    t.close()
    expect(() => t.close()).not.toThrow()
  })

  test('query() after close() → Error', () => {
    const t = new SqliteTool(':memory:', SILENT)
    t.setup({ x: [{ id: 1 }] })
    t.close()
    expect(() => t.query('SELECT * FROM x')).toThrow(/closed/i)
  })

  test('setup() after close() → Error', () => {
    const t = new SqliteTool(':memory:', SILENT)
    t.close()
    expect(() => t.setup({ x: [{ id: 1 }] })).toThrow(/closed/i)
  })

  test('addTable() after close() → Error', () => {
    const t = new SqliteTool(':memory:', SILENT)
    t.close()
    expect(() => t.addTable('x', [{ id: 1 }])).toThrow(/closed/i)
  })

  test('getSchema() returns a frozen object', () => {
    const t = new SqliteTool(':memory:', SILENT)
    t.setup({ users: [{ id: 1 }] })
    const schema = t.getSchema()
    expect(Object.isFrozen(schema)).toBe(true)
    expect(Object.isFrozen(schema['users'])).toBe(true)
    expect(Object.isFrozen(schema['users']?.['id'])).toBe(true)
    // Mutation attempt — TypeError in strict mode (and a // @ts-check file is always strict)
    expect(() => {
      const u = /** @type { any } */ (schema['users'])
      u.extra = {}
    }).toThrow(TypeError)
    t.close()
  })

  test('getSchema() does not contain converters', () => {
    const t = new SqliteTool(':memory:', SILENT)
    t.setup({ users: [{ id: 1 }] })
    const schema = t.getSchema()
    expect(JSON.stringify(schema)).toBe(
      '{"users":{"id":{"type":"INTEGER","nullable":false}}}'
    )
    t.close()
  })

  test('getSchema() is empty before setup()', () => {
    const t = new SqliteTool(':memory:', SILENT)
    expect(t.getSchema()).toEqual({})
    t.close()
  })
})
