/**
 * An NBT parser/serializer which gives results as plain JS objects
 * and avoids copying large arrays, instead giving DataViews of the
 * original data.
 *
 * In order to provide type safety and distinguish types that have the
 * same JS representation, you can provide a shape object describing
 * the NBT data.
 */
import { DataViewReader, DataViewWriter } from './data_view_stream.js'
import { DefaultEndianDataView } from './default_endian_data_view.js'
import { checkExhaustive } from './util.js'
/** The possible Nbt tags. */
let Tags;
(function (Tags) {
  Tags[Tags.End = 0] = 'End'
  Tags[Tags.Byte = 1] = 'Byte'
  Tags[Tags.Short = 2] = 'Short'
  Tags[Tags.Int = 3] = 'Int'
  Tags[Tags.Long = 4] = 'Long'
  Tags[Tags.Float = 5] = 'Float'
  Tags[Tags.Double = 6] = 'Double'
  Tags[Tags.ByteArray = 7] = 'ByteArray'
  Tags[Tags.String = 8] = 'String'
  Tags[Tags.List = 9] = 'List'
  Tags[Tags.Compound = 10] = 'Compound'
  Tags[Tags.IntArray = 11] = 'IntArray'
  Tags[Tags.LongArray = 12] = 'LongArray'
})(Tags || (Tags = {}))
/**
 * Given an object or array shape and a prop, gives the shape of the prop.
 */
function shapeGet (shape, prop) {
  if (shape === '*') {
    return '*'
  } else if (Array.isArray(shape)) {
    return shape[0]
  } else if (shape['*']) {
    return shape['*']
  } else {
    return shape[prop] ?? '*'
  }
}
function assert (a, message, path) {
  if (!a) {
    throw new Error(`${message}\n${path}`)
  }
}
/**
 * A Nbt parser and serializer for a given shape.
 * Keeping the shape separate from the data allows
 * the parse result to be a plain JS object without
 * extra metadata on the object types.
 * For example, byte and short are both numbers when read,
 * but must be written differently.
 */
export class Nbt {
  constructor (shape) {
    this.shape = shape
  }

  /**
     * Parses the data in the Uint8Array into the JS object
     * given by the shape of this Nbt parser.
     */
  parse (data, littleEndian = false) {
    const asView = new DefaultEndianDataView(littleEndian, data.buffer, data.byteOffset, data.byteLength)
    const reader = new DataViewReader(asView)
    return this.parseRoot(reader)
  }

  /**
     * Serializes the JS object into a Uint8Array given
     * by the shape of this Nbt serializer.
     */
  serialize (value) {
    const dataView = this.serializeRoot(value, this.shape)
    return new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength)
  }

  parseRoot (data) {
    assert(data.byte() === Tags.Compound, 'Expected a compound at root')
    data.string()
    return this.parsePayload(data, Tags.Compound, this.shape, 'root')
  }

  /**
     * Parses the payload value at the current position of the DataViewReader.
     *
     * @param data The data view reader
     * @param tagType The tag of the payload to parse
     * @param shape The shape of the data
     * @param path The path so far, used for error messages
     * @returns The payload value, based
     */
  parsePayload (data, tagType, shape, path) {
    switch (tagType) {
      case Tags.End:
        return undefined
      case Tags.Byte:
        this.assertSimpleShape(shape, 'byte', path)
        return data.byte()
      case Tags.Short:
        this.assertSimpleShape(shape, 'short', path)
        return data.short()
      case Tags.Int:
        this.assertSimpleShape(shape, 'int', path)
        return data.int()
      case Tags.Long:
        this.assertSimpleShape(shape, 'long', path)
        return data.long()
      case Tags.Float:
        this.assertSimpleShape(shape, 'float', path)
        return data.float()
      case Tags.Double:
        this.assertSimpleShape(shape, 'double', path)
        return data.double()
      case Tags.String:
        this.assertSimpleShape(shape, 'string', path)
        return data.string()
      case Tags.ByteArray:
        this.assertSimpleShape(shape, 'byteArray', path)
        return data.array(1)
      case Tags.IntArray:
        this.assertSimpleShape(shape, 'intArray', path)
        return data.array(4)
      case Tags.LongArray:
        this.assertSimpleShape(shape, 'longArray', path)
        return data.array(8)
      case Tags.Compound: {
        this.assertCompoundShape(shape, path)
        const result = {}
        let tagType
        while ((tagType = data.byte()) !== Tags.End) {
          const name = data.string()
          if (shape === '*' || shape['*'] || name in shape) {
            result[name] = this.parsePayload(data, tagType, shapeGet(shape, name), `${path}.${name}`)
          } else {
            this.skipPayload(data, tagType)
          }
        }
        return result
      }
      case Tags.List: {
        this.assertListShape(shape, path)
        const itemType = data.byte()
        const nItems = data.int()
        const result = []
        for (let i = 0; i < nItems; i++) {
          result.push(this.parsePayload(data, itemType, shapeGet(shape, 0), `${path}[${i}]`))
        }
        return result
      }
      default:
        checkExhaustive(tagType)
    }
  }

  /**
     * Skips the payload of the given type at the current position of the
     * DataViewReader. Simply advances with minimal processing of the data,
     * so that we can quickly skip over parts that we don't understand.
     * @param data The data view reader
     * @param tagType The tag of the payload to skip
     */
  skipPayload (data, tagType) {
    switch (tagType) {
      case Tags.End:
        return undefined
      case Tags.Byte:
        data.skip(1)
        return
      case Tags.Short:
        data.skip(2)
        return
      case Tags.Int:
        data.skip(4)
        return
      case Tags.Long:
        data.skip(8)
        return
      case Tags.Float:
        data.skip(4)
        return
      case Tags.Double:
        data.skip(8)
        return
      case Tags.String:
        data.skipString()
        return
      case Tags.ByteArray:
        data.skipArray(1)
        return
      case Tags.IntArray:
        data.skipArray(4)
        return
      case Tags.LongArray:
        data.skipArray(8)
        return
      case Tags.Compound: {
        let tagType
        while ((tagType = data.byte()) !== Tags.End) {
          data.skipString()
          this.skipPayload(data, tagType)
        }
        return
      }
      case Tags.List: {
        const itemType = data.byte()
        const nItems = data.int()
        for (let i = 0; i < nItems; i++) {
          this.skipPayload(data, itemType)
        }
        return
      }
      default:
        checkExhaustive(tagType)
    }
  }

  assertSimpleShape (shape, t, path) {
    assert(shape === '*' || shape === t, `Found a ${t}, but expected ${shape}`, path)
  }

  assertCompoundShape (shape, path) {
    assert(shape === '*' || (!Array.isArray(shape) && typeof shape === 'object'), `Found ${shape}, but expected a compound.`, path)
  }

  assertListShape (shape, path) {
    assert(shape === '*' || Array.isArray(shape), `Found ${shape}, but expected a list`, path)
  }

  serializeRoot (value, shape) {
    const writer = new DataViewWriter()
    this.assertObject(value, 'root')
    writer.byte(Tags.Compound)
    writer.string('')
    this.serializePayload(writer, value, shape, 'root')
    return writer.final()
  }

  serializePayload (writer, value, shape, path) {
    switch (shape) {
      case 'byte':
        return writer.byte(this.assertNumber(value, path))
      case 'short':
        return writer.short(this.assertNumber(value, path))
      case 'int':
        return writer.int(this.assertNumber(value, path))
      case 'long':
        return writer.long(this.assertBigInt(value, path))
      case 'float':
        return writer.float(this.assertNumber(value, path))
      case 'double':
        return writer.double(this.assertNumber(value, path))
      case 'byteArray':
        return writer.array(this.assertDataView(value, path), 1)
      case 'intArray':
        return writer.array(this.assertDataView(value, path), 4)
      case 'longArray':
        return writer.array(this.assertDataView(value, path), 8)
      case 'string':
        return writer.string(this.assertString(value, path))
      case 'end':
        // nothing to write
        return
      case '*':
        assert(false, `Can't write value of unknown type: ${value}`, path)
        return
      default:
        if (Array.isArray(shape)) {
          const [itemShape] = shape
          const array = this.assertArray(value, path)
          writer.byte(this.getTagTypeForShape(itemShape))
          writer.int(array.length)
          let i = 0
          for (const item of array) {
            this.serializePayload(writer, item, itemShape, `${path}[${i++}]`)
          }
          return
        } else if (typeof shape === 'object') {
          this.assertCompoundShape(shape, path)
          const obj = this.assertObject(value, path)
          const keys = Object.keys(obj).sort()
          for (const key of keys) {
            const itemShape = shapeGet(shape, key)
            writer.byte(this.getTagTypeForShape(itemShape))
            writer.string(key)
            this.serializePayload(writer, obj[key], itemShape, `${path}.${key}`)
          }
          writer.byte(Tags.End)
          return
        }
        checkExhaustive(shape)
    }
  }

  assertNumber (n, path) {
    assert(typeof n === 'number', `Expected a number, got ${n}`, path)
    return n
  }

  assertBigInt (n, path) {
    assert(typeof n === 'bigint', `Expected a bigint, got ${n}`, path)
    return n
  }

  assertDataView (n, path) {
    assert(n instanceof DataView, `Expected a DataView, got ${n}`, path)
    return n
  }

  assertString (n, path) {
    assert(typeof n === 'string', `Expected a string, got ${n}`, path)
    return n
  }

  assertArray (n, path) {
    assert(Array.isArray(n), `Expected an array, got ${n}`, path)
    return n
  }

  assertObject (n, path) {
    assert(typeof n === 'object', `Expected an object, got ${n}`, path)
    return n
  }

  getTagTypeForShape (shape) {
    switch (shape) {
      case 'byte': return Tags.Byte
      case 'short': return Tags.Short
      case 'int': return Tags.Int
      case 'long': return Tags.Long
      case 'float': return Tags.Float
      case 'double': return Tags.Double
      case 'byteArray': return Tags.ByteArray
      case 'intArray': return Tags.IntArray
      case 'longArray': return Tags.LongArray
      case 'string': return Tags.String
      case 'end': return Tags.End
      case '*': return Tags.End // don't know what to write here.
      default:
        if (Array.isArray(shape)) {
          return Tags.List
        } else if (typeof shape === 'object') {
          return Tags.Compound
        }
        checkExhaustive(shape)
    }
  }
}
// # sourceMappingURL=nbt.js.map
