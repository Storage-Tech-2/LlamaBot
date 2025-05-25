import { p, parseP } from './point.js'
const SEGMENT_SIZE = 16
function isPowerOfTwo (x) {
  return ((x !== 0) && !(x & (x - 1)))
}
/**
 * A sparse representation of an infinite 3d array of ints. Uses
 * 16^3 subchunks as the smallest unit of storage. Supports values
 * up to 16 bits.
 */
export class Virtual3DCanvas {
  constructor (xSize = SEGMENT_SIZE, ySize = SEGMENT_SIZE, zSize = SEGMENT_SIZE) {
    this.xSize = xSize
    this.ySize = ySize
    this.zSize = zSize
    this.segments = {}
    // if true, then some value in the canvas required more than 8 bits.
    this.requires16bits = false
    this.empty = true
    this.minx = 0
    this.maxx = 0
    this.miny = 0
    this.maxy = 0
    this.minz = 0
    this.maxz = 0
    this.lastSegmentX = 0
    this.lastSegmentY = 0
    this.lastSegmentZ = 0
    this.lastSegment = undefined
    if (!isPowerOfTwo(xSize)) {
      throw new Error('xSize must be a power of two.')
    }
    if (!isPowerOfTwo(ySize)) {
      throw new Error('ySize must be a power of two.')
    }
    if (!isPowerOfTwo(zSize)) {
      throw new Error('zSize must be a power of two.')
    }
  }

  get width () {
    return this.maxx - this.minx + 1
  }

  get height () {
    return this.maxy - this.miny + 1
  }

  get length () {
    return this.maxz - this.minz + 1
  }

  get (x, y, z) {
    const sx = Math.floor(x / this.xSize)
    const sy = Math.floor(y / this.ySize)
    const sz = Math.floor(z / this.zSize)
    const segment = this.getSegment(sx, sy, sz, false, false)
    if (!segment) {
      return 0
    }
    x = x & (this.xSize - 1)
    y = y & (this.ySize - 1)
    z = z & (this.zSize - 1)
    return segment[x + this.xSize * (z + this.zSize * y)]
  }

  /** @noline */
  recalculateExtents (x, y, z) {
    // Recalculate the extents
    if (this.empty) {
      this.maxx = this.minx = x
      this.maxy = this.miny = y
      this.maxz = this.minz = z
      this.empty = false
    } else {
      this.maxx = Math.max(this.maxx, x)
      this.maxy = Math.max(this.maxy, y)
      this.maxz = Math.max(this.maxz, z)
      this.minx = Math.min(this.minx, x)
      this.miny = Math.min(this.miny, y)
      this.minz = Math.min(this.minz, z)
    }
  }

  getSegment (x, y, z, create, require16) {
    // cache the last segment
    if (this.lastSegment &&
            this.lastSegmentX === x &&
            this.lastSegmentY === y &&
            this.lastSegmentZ === z) {
      return this.lastSegment
    } else {
      const segmentPoint = p(x, y, z)
      const segment = this.segments[segmentPoint]
      if (segment) {
        this.lastSegment = segment
        this.lastSegmentX = x
        this.lastSegmentY = y
        this.lastSegmentZ = z
        return segment
      } else if (create) {
        const segment = require16
          ? new Uint16Array(this.xSize * this.ySize * this.zSize)
          : new Uint8Array(this.xSize * this.ySize * this.zSize)
        // create a new segment if needed
        this.segments[segmentPoint] = this.lastSegment = segment
        this.lastSegmentX = x
        this.lastSegmentY = y
        this.lastSegmentZ = z
        return segment
      }
    }
  }

  set (x, y, z, value) {
    if (value > 0xFF) {
      this.requires16bits = true
    }
    this.recalculateExtents(x, y, z)
    const sx = Math.floor(x / this.xSize)
    const sy = Math.floor(y / this.ySize)
    const sz = Math.floor(z / this.zSize)
    let segment = this.getSegment(sx, sy, sz, true, value > 0xFF)
    x = x & (this.xSize - 1)
    y = y & (this.ySize - 1)
    z = z & (this.zSize - 1)
    if (value > 0xFF && segment instanceof Uint8Array) {
      const segmentPoint = p(sx, sy, sz)
      // move the data to a 16bit segment if needed
      segment = this.segments[segmentPoint] = Uint16Array.from(segment)
    }
    segment[x + this.xSize * (z + this.zSize * y)] = value
  }

  getAllBlocks () {
    const width = this.width
    const height = this.height
    const length = this.length
    const result = this.requires16bits
      ? new Uint16Array(width * height * length)
      : new Uint8Array(width * height * length)
    // If we haven't written any blocks, return a single empty block.
    if (this.empty) {
      return [result, 0]
    }
    // TODO: this could be more efficient if we only process
    // chunks that exist.
    let nonZero = 0
    for (let y = 0, index = 0; y < height; y++) {
      for (let z = 0; z < length; z++) {
        for (let x = 0; x < width; x++, index++) {
          const block = this.get(this.minx + x, this.miny + y, this.minz + z)
          if (block !== 0) {
            nonZero++
          }
          result[index] = block
        }
      }
    }
    return [result, nonZero]
  }

  [Symbol.iterator] () {
    const entries = Object.entries(this.segments)
    return entries.map(([p, data]) => {
      const [x, y, z] = parseP(p)
      return [x * this.xSize, y * this.ySize, z * this.zSize, data]
    })[Symbol.iterator]()
  }
}
/**
 * A 3D set.
 */
export class Virtual3DSet {
  constructor (xSize = SEGMENT_SIZE, ySize = SEGMENT_SIZE, zSize = SEGMENT_SIZE) {
    this.xSize = xSize
    this.ySize = ySize
    this.zSize = zSize
    this.canvas = new Virtual3DCanvas(xSize, ySize, zSize)
  }

  add (x, y, z) {
    const yByte = Math.floor(y / 8)
    let current = this.canvas.get(x, yByte, z)
    current |= (1 << (y & 7))
    this.canvas.set(x, yByte, z, current)
  }

  has (x, y, z) {
    const yByte = Math.floor(y / 8)
    const current = this.canvas.get(x, yByte, z)
    return ((current >>> (y & 7)) & 1) === 1
  }

  getColumn (x, y, z) {
    return this.canvas.get(x, Math.floor(y / 8), z)
  }

  readData (data, x, y, z) {
    return data[x + this.xSize * (z + this.zSize * y)]
  }

  [Symbol.iterator] () {
    return this.canvas[Symbol.iterator]()
  }
}
const CHUNK_SIZE = 16
const REGION_SIZE = 32
const BYTES_PER_CHUNK = CHUNK_SIZE ** 2 / 8
export class Virtual2DSet {
  constructor () {
    this.regions = {}
    this.lastRegionX = 0
    this.lastRegionZ = 0
  }

  getRegion (regionX, regionZ, create) {
    if (this.lastRegion &&
            this.lastRegionX === regionX &&
            this.lastRegionZ === regionZ) {
      return this.lastRegion
    } else {
      const regionP = p(regionX, 0, regionZ)
      let region = this.regions[regionP]
      if (!region) {
        if (create) {
          region = this.regions[regionP] = new Uint8Array(REGION_SIZE ** 2 * BYTES_PER_CHUNK)
        } else {
          return undefined
        }
      }
      this.lastRegion = region
      this.lastRegionX = regionX
      this.lastRegionZ = regionZ
      return region
    }
  }

  add (x, z) {
    const chunkX = Math.floor(x / CHUNK_SIZE)
    const chunkZ = Math.floor(z / CHUNK_SIZE)
    const regionX = Math.floor(chunkX / REGION_SIZE)
    const regionZ = Math.floor(chunkZ / REGION_SIZE)
    const region = this.getRegion(regionX, regionZ, true)
    const chunkNumberX = chunkX & (REGION_SIZE - 1)
    const chunkNumberZ = chunkZ & (REGION_SIZE - 1)
    const chunkNumber = chunkNumberX + REGION_SIZE * chunkNumberZ
    const chunkOffset = chunkNumber * BYTES_PER_CHUNK
    this.writeInArea(region, chunkOffset, x, z, true)
  }

  has (x, z) {
    const chunkX = Math.floor(x / CHUNK_SIZE)
    const chunkZ = Math.floor(z / CHUNK_SIZE)
    const regionX = Math.floor(chunkX / REGION_SIZE)
    const regionZ = Math.floor(chunkZ / REGION_SIZE)
    const region = this.getRegion(regionX, regionZ, false)
    if (!region) {
      return false
    }
    const chunkNumberX = chunkX & (REGION_SIZE - 1)
    const chunkNumberZ = chunkZ & (REGION_SIZE - 1)
    const chunkNumber = chunkNumberX + REGION_SIZE * chunkNumberZ
    const chunkOffset = chunkNumber * BYTES_PER_CHUNK
    return this.readInArea(region, chunkOffset, x, z)
  }

  areas () {
    const result = []
    for (const [regionP, array] of Object.entries(this.regions)) {
      const [regionX, , regionZ] = parseP(regionP)
      for (let z = 0; z < REGION_SIZE; z++) {
        for (let x = 0; x < REGION_SIZE; x++) {
          const offset = (x + z * REGION_SIZE) * BYTES_PER_CHUNK
          // only output chunks that have some data.
          let someSet = false
          for (let i = 0; i < BYTES_PER_CHUNK; i++) {
            if (array[offset + i] !== 0) {
              someSet = true
              break
            }
          }
          if (someSet) {
            result.push({
              array,
              offset,
              areaX: regionX * REGION_SIZE + x,
              areaZ: regionZ * REGION_SIZE + z
            })
          }
        }
      }
    }
    return result
  }

  // Returns the areas that are less than the radius away from
  // the specified area coordinates.
  radius (r, x, z) {
    const result = []
    for (let zOffset = -r; zOffset <= r; zOffset++) {
      for (let xOffset = -r; xOffset <= r; xOffset++) {
        if (xOffset ** 2 + zOffset ** 2 < r ** 2) {
          const areaX = x + xOffset
          const areaZ = z + zOffset
          const regionX = Math.floor(areaX / REGION_SIZE)
          const regionZ = Math.floor(areaZ / REGION_SIZE)
          const array = this.getRegion(regionX, regionZ, false)
          if (array) {
            const chunkNumberX = areaX & (REGION_SIZE - 1)
            const chunkNumberZ = areaZ & (REGION_SIZE - 1)
            const chunkNumber = chunkNumberX + REGION_SIZE * chunkNumberZ
            const offset = chunkNumber * BYTES_PER_CHUNK
            let someSet = false
            for (let i = 0; i < BYTES_PER_CHUNK; i++) {
              if (array[offset + i] !== 0) {
                someSet = true
                break
              }
            }
            if (someSet) {
              result.push({
                array,
                offset,
                areaX: x + xOffset,
                areaZ: z + zOffset
              })
            }
          }
        }
      }
    }
    return result
  }

  readInArea (array, offset, x, z) {
    const blockNumberX = x & (CHUNK_SIZE - 1)
    const blockNumberZ = z & (CHUNK_SIZE - 1)
    const blockNumber = blockNumberX + CHUNK_SIZE * blockNumberZ
    const blockByte = Math.floor(blockNumber / 8)
    return ((array[offset + blockByte] >>> (x & 7)) & 1) === 1
  }

  writeInArea (array, offset, x, z, value) {
    const blockNumberX = x & (CHUNK_SIZE - 1)
    const blockNumberZ = z & (CHUNK_SIZE - 1)
    const blockNumber = blockNumberX + CHUNK_SIZE * blockNumberZ
    const blockByte = Math.floor(blockNumber / 8)
    const current = array[offset + blockByte]
    const shift = 1 << (blockNumber & 7)
    array[offset + blockByte] = (current & ~(shift)) | (value ? shift : 0)
  }
}
// # sourceMappingURL=virtual_canvas.js.map
