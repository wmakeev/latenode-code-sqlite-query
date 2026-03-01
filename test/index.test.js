// @ts-check
import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { SqliteTool } from '../src/SqliteTool.js'
import assert from 'node:assert'

/** @type { SqliteTool } */
let sqliteTool

describe('SqliteTool', () => {
  beforeEach(() => {
    sqliteTool = new SqliteTool()
  })

  afterEach(() => {
    sqliteTool.close()
  })

  test('query', async () => {
    const tables = {
      items: [
        {
          id: 1,
          str: 'str1',
          bigint: 121n,
          float: 1.11,
          int_float: 1,
          int_float_null: 1,
          bool: true,
          date: new Date(2025, 0, 1),
          obj: { a: 1 },
          null_str: '1',
          null_num: undefined,
          multi: 10,
          multi_null: 110
        },
        {
          id: 2,
          str: 'str2',
          bigint: 122n,
          float: 1.22,
          int_float: 1.22,
          int_float_null: 1.22,
          bool: true,
          date: new Date(2025, 0, 2),
          obj: [1, 2, 3],
          null_str: null,
          null_num: 10,
          multi: '20',
          multi_null: null,
          null: null
        },
        {
          id: 3,
          str: 'str3',
          bigint: 123n,
          float: 1.33,
          int_float: 3,
          bool: false,
          date: new Date(2025, 0, 3),
          obj: { a: 3 },
          null_str: '3',
          null_num: 20,
          multi: new Date(2025, 0, 30),
          multi_null: 'text'
        }
      ],
      dict: [
        { id: 1, value: 'id-10' },
        { id: 2, value: 'id-20' },
        { id: 3, value: 'id-30' }
      ]
    }

    sqliteTool.setup(tables)

    const schema = sqliteTool.getSchema()

    const itemsTableSchema = schema['items']
    assert.ok(itemsTableSchema)

    const schemaInfo = Object.entries(itemsTableSchema).map(([k, v]) => {
      return [k, v.type, v.nullable ? 'NULL' : 'NOT NULL']
    })

    // console.log(JSON.stringify(schemaInfo))

    expect(schemaInfo).toStrictEqual(
      /* prettier-ignore */
      [
        ['id'             , 'INTEGER' , 'NOT NULL'],
        ['str'            , 'TEXT'    , 'NOT NULL'],
        ['bigint'         , 'INTEGER' , 'NOT NULL'],
        ['float'          , 'REAL'    , 'NOT NULL'],
        ['int_float'      , 'REAL'    , 'NOT NULL'],
        ['int_float_null' , 'REAL'    , 'NULL'    ],
        ['bool'           , 'INTEGER' , 'NOT NULL'],
        ['date'           , 'TEXT'    , 'NOT NULL'],
        ['obj'            , 'TEXT'    , 'NOT NULL'],
        ['null_str'       , 'TEXT'    , 'NULL'    ],
        ['null_num'       , 'INTEGER' , 'NULL'    ],
        ['multi'          , 'TEXT'    , 'NOT NULL'],
        ['multi_null'     , 'TEXT'    , 'NULL'    ],
        ['null'           , 'NULL'    , 'NULL'    ]
      ]
    )

    // schema['use']

    const userQuery = `
      SELECT
        it.id AS data_id,
        it.str AS data_str,
        it.bigint AS data_bigint,
        it.float AS data_float,
        it.bool AS data_bool,
        it.date AS data_date,
        it.obj AS data_obj,
        it.null_str AS data_null_str,
        it.null_num AS data_null_num,
        it.multi AS data_multi,
        it.multi_null AS data_multi_null,
        d.value AS dict_value

      FROM items AS it

      LEFT JOIN dict AS d ON it.id = d.id

      WHERE it.id = ?
    `

    const queryParams = [2]

    const result = sqliteTool.query(userQuery, queryParams)

    expect(result).toBeArray()

    console.debug(result)
  })
})
