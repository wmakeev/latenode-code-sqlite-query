// @ts-check
import { expect, test, describe } from 'bun:test'
import { inferSchema } from '../src/schema/infer.js'

describe('inferSchema', () => {
  test('integer-only column → INTEGER NOT NULL', () => {
    const { schema } = inferSchema([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(schema['id']).toEqual({ type: 'INTEGER', nullable: false })
  })

  test('integer + float in same column → REAL NOT NULL (fallback)', () => {
    const { schema } = inferSchema([{ x: 1 }, { x: 1.5 }])
    expect(schema['x']).toEqual({ type: 'REAL', nullable: false })
  })

  test('string → TEXT NOT NULL', () => {
    const { schema } = inferSchema([{ s: 'a' }, { s: 'b' }])
    expect(schema['s']).toEqual({ type: 'TEXT', nullable: false })
  })

  test('boolean → INTEGER NOT NULL', () => {
    const { schema } = inferSchema([{ b: true }, { b: false }])
    expect(schema['b']).toEqual({ type: 'INTEGER', nullable: false })
  })

  test('bigint → INTEGER NOT NULL + hasBigInt', () => {
    const { schema, hasBigInt } = inferSchema([{ n: 1n }, { n: 2n }])
    expect(schema['n']).toEqual({ type: 'INTEGER', nullable: false })
    expect(hasBigInt).toBe(true)
  })

  test('Date → TEXT NOT NULL', () => {
    const { schema } = inferSchema([
      { d: new Date(2025, 0, 1) },
      { d: new Date(2025, 0, 2) }
    ])
    expect(schema['d']).toEqual({ type: 'TEXT', nullable: false })
  })

  test('Invalid Date → TEXT NULL', () => {
    const { schema } = inferSchema([{ d: new Date('xxx') }])
    expect(schema['d']).toEqual({ type: 'TEXT', nullable: true })
  })

  test('object → TEXT NOT NULL', () => {
    const { schema } = inferSchema([{ o: { a: 1 } }, { o: { b: 2 } }])
    expect(schema['o']).toEqual({ type: 'TEXT', nullable: false })
  })

  test('array → TEXT NOT NULL', () => {
    const { schema } = inferSchema([{ a: [1, 2] }, { a: [3] }])
    expect(schema['a']).toEqual({ type: 'TEXT', nullable: false })
  })

  test('Map → TEXT NULL (non-serializable object)', () => {
    const { schema, nullifiedNonSerializable } = inferSchema([{ x: new Map() }])
    expect(schema['x']).toEqual({ type: 'TEXT', nullable: true })
    expect(nullifiedNonSerializable).toContain('x')
  })

  test('Set → TEXT NULL', () => {
    const { schema } = inferSchema([{ x: new Set() }])
    expect(schema['x']).toEqual({ type: 'TEXT', nullable: true })
  })

  test('RegExp → TEXT NULL', () => {
    const { schema } = inferSchema([{ x: /abc/ }])
    expect(schema['x']).toEqual({ type: 'TEXT', nullable: true })
  })

  test('mixed string + number → TEXT NOT NULL (widening to default)', () => {
    const { schema } = inferSchema([{ x: 1 }, { x: 'two' }])
    expect(schema['x']).toEqual({ type: 'TEXT', nullable: false })
  })

  test('all null/undefined → NULL nullable', () => {
    const { schema } = inferSchema([{ x: null }, { x: undefined }])
    expect(schema['x']).toEqual({ type: 'NULL', nullable: true })
  })

  test('missing key in some rows → nullable', () => {
    const { schema } = inferSchema([{ a: 1 }, {}])
    expect(schema['a']).toEqual({ type: 'INTEGER', nullable: true })
  })

  test('explicit null in some rows → nullable', () => {
    const { schema } = inferSchema([{ a: 1 }, { a: null }])
    expect(schema['a']).toEqual({ type: 'INTEGER', nullable: true })
  })

  test('key appears only in second row → nullable', () => {
    const { schema } = inferSchema([{ a: 1 }, { a: 2, b: 'x' }])
    expect(schema['b']).toEqual({ type: 'TEXT', nullable: true })
  })

  test('NaN → TEXT (not a finite number)', () => {
    const { schema } = inferSchema([{ x: NaN }])
    expect(schema['x']).toEqual({ type: 'TEXT', nullable: false })
  })

  test('Infinity → TEXT', () => {
    const { schema } = inferSchema([{ x: Infinity }])
    expect(schema['x']).toEqual({ type: 'TEXT', nullable: false })
  })

  test('integer + NaN → TEXT (NaN does not fall back to REAL)', () => {
    const { schema } = inferSchema([{ x: 1 }, { x: NaN }])
    expect(schema['x']).toEqual({ type: 'TEXT', nullable: false })
  })

  test('Uint8Array → BLOB NOT NULL', () => {
    const { schema } = inferSchema([{ b: new Uint8Array([1, 2, 3]) }])
    expect(schema['b']).toEqual({ type: 'BLOB', nullable: false })
  })

  test('empty array → error', () => {
    expect(() => inferSchema([])).toThrow(TypeError)
  })

  test('column order: first row → then "newcomers"', () => {
    const { schema } = inferSchema([
      { a: 1, b: 2 },
      { c: 3, a: 4 }
    ])
    expect(Object.keys(schema)).toEqual(['a', 'b', 'c'])
  })

  test('hasBigInt = false when no bigint is present', () => {
    const { hasBigInt } = inferSchema([{ a: 1 }, { a: 'x' }])
    expect(hasBigInt).toBe(false)
  })
})
