import { Nbt } from './nbt.js'
import { Virtual3DCanvas } from './virtual_canvas.js'
import { expandLongPackedArray } from './long_packed_array.js'
import { compress } from './compression.js'
export const SCHEMATIC_SHAPE = {
  Version: 'int',
  MinecraftDataVersion: 'int',
  Metadata: {
    Name: 'string',
    Author: 'string',
    Description: 'string',
    EnclosingSize: { x: 'int', y: 'int', z: 'int' },
    TimeCreated: 'long',
    TimeModified: 'long',
    TotalBlocks: 'int',
    TotalVolume: 'int',
    RegionCount: 'int'
  },
  Regions: {
    '*': {
      BlockStatePalette: [{
        Name: 'string',
        Properties: { '*': 'string' }
      }],
      BlockStates: 'longArray',
      Position: { x: 'int', y: 'int', z: 'int' },
      Size: { x: 'int', y: 'int', z: 'int' },
      Entities: [{ '*': '*' }],
      TileEntities: [{ '*': '*' }],
      PendingBlockTicks: [{ '*': '*' }]
    }
  }
}
/**
 * Converts the Nbt form of a block state palette entry into
 * a string like "minecraft:observer[facing=east]".
 */
export function blockState (state) {
  if (state.Properties != null && Object.keys(state.Properties).length) {
    return `${state.Name}[${Object.keys(state.Properties)
            .sort()
            .map(prop => `${prop}=${state.Properties[prop]}`)
            .join(',')}]`
  }
  return `${state.Name}`
}
/**
 * Parses a string like "minecraft:observer[facing=east]" to
 * {Name: "minecraft:observer", Properties: {facing: "east"}}.
 */
export function parseBlockState (state) {
  const [name, props] = state.split('[')
  const properties = {}
  if (props) {
    for (const kv of props.slice(0, -1).split(',')) {
      const [key, value] = kv.split('=')
      properties[key] = value
    }
  }
  return {
    Name: name,
    Properties: properties
  }
}
/**
 * Returns the number of bits needed to represent all of the block states
 * in nPaletteEntries. There is always a minimum of 2 bits.
 */
function bitsForBlockStates (nPaletteEntries) {
  return Math.max(Math.ceil(Math.log2(nPaletteEntries)), 2)
}
/**
 * Keeps track of the palette assignments.
 */
export class PaletteManager {
  constructor (empty = 'minecraft:air') {
    this.palette = { [empty]: 0 }
    this.paletteList = [empty]
  }

  getOrCreatePaletteIndex (blockState) {
    if (this.palette[blockState] !== undefined) {
      return this.palette[blockState]
    }
    this.paletteList.push(blockState)
    this.palette[blockState] = this.paletteList.length - 1
    return this.palette[blockState]
  }

  getBlockState (n) {
    return this.paletteList[n] ?? 'minecraft:air'
  }

  bits () {
    return bitsForBlockStates(this.paletteList.length)
  }

  toNbt () {
    return this.paletteList.map(parseBlockState)
  }
}
/**
 * Reads a schematic.
 */
export class SchematicReader {
  constructor (fileContents) {
    this.nbt = new Nbt(SCHEMATIC_SHAPE)
    this.palette = new PaletteManager()
    this.blocks = new Virtual3DCanvas()
    this.nbtData = this.nbt.parse(fileContents)
    const regions = Object.keys(this.nbtData.Regions)
    for (const regionName of regions) {
      const region = this.nbtData.Regions[regionName]
      const palette = region.BlockStatePalette.map(blockState)
      const bits = bitsForBlockStates(palette.length)
      // A region is defined in the UI as two corner points,
      // but is saved as point 1 (position) and a size. If
      // the size is negative in an axis, then it indicates
      // that point 2 is less in that axis, so we adjust to
      // get the starting point of the blockstates array, which
      // is always to lower of the two points.
      const width = region.Size.x
      const height = region.Size.y
      const length = region.Size.z
      const rx = region.Position.x + (width < 0 ? width + 1 : 0)
      const ry = region.Position.y + (height < 0 ? height + 1 : 0)
      const rz = region.Position.z + (length < 0 ? length + 1 : 0)
      const blocks = expandLongPackedArray(region.BlockStates, bits, Math.abs(width * height * length), true)
      // Copy the data onto the 3d canvas with the combined palette.
      for (let y = 0, i = 0; y < Math.abs(height); y++) {
        for (let z = 0; z < Math.abs(length); z++) {
          for (let x = 0; x < Math.abs(width); x++, i++) {
            const block = blocks[i]
            const paletteIndex = this.palette.getOrCreatePaletteIndex(palette[block])
            this.blocks.set(rx + x, ry + y, rz + z, paletteIndex)
          }
        }
      }
    }
  }

  getBlock (x, y, z) {
    if (x < 0 || x >= this.width ||
            y < 0 || y >= this.height ||
            z < 0 || z >= this.length) {
      return 'minecraft:air'
    }
    return this.palette.getBlockState(this.blocks.get(this.blocks.minx + x, this.blocks.miny + y, this.blocks.minz + z))
  }

  get version () {
    return this.nbtData.Version
  }

  get minecraftDataVersion () {
    return this.nbtData.MinecraftDataVersion
  }

  get name () {
    return this.nbtData.Metadata.Name
  }

  get author () {
    return this.nbtData.Metadata.Author
  }

  get description () {
    return this.nbtData.Metadata.Description
  }

  get totalBlocks () {
    return this.nbtData.Metadata.TotalBlocks
  }

  get totalVolume () {
    return this.nbtData.Metadata.TotalVolume
  }

  get enclosingSize () {
    return this.nbtData.Metadata.EnclosingSize
  }

  get width () {
    return this.blocks.width
  }

  get height () {
    return this.blocks.height
  }

  get length () {
    return this.blocks.length
  }

  get timeCreated () {
    return this.nbtData.Metadata.TimeCreated
  }

  get timeModified () {
    return this.nbtData.Metadata.TimeModified
  }
}
/**
 * Simple interface for writing schematics with a
 * single region. Uses a virtual infinite space for
 * setting blocks, and then uses the smallest bounding box
 * when saving.
 */
export class SchematicWriter {
  constructor (name, author) {
    this.name = name
    this.author = author
    this.nbt = new Nbt(SCHEMATIC_SHAPE)
    this.description = ''
    this.paletteManager = new PaletteManager()
    this.canvas = new Virtual3DCanvas()
    this.version = 5
    this.minecraftDataVersion = 2730
  }

  /**
     * Gets the index of the given block state in the palette,
     * adding it to the palette if necessary.
     */
  getOrCreatePaletteIndex (blockState) {
    return this.paletteManager.getOrCreatePaletteIndex(blockState)
  }

  /**
     * Sets the block (x, y, z) to the given block state.
     */
  setBlock (x, y, z, blockState) {
    this.canvas.set(x, y, z, this.getOrCreatePaletteIndex(blockState))
  }

  /**
     * Gets the block state at (x, y, z)
     */
  getBlock (x, y, z) {
    return this.paletteManager.getBlockState(this.canvas.get(x, y, z))
  }

  asNbtData () {
    const [blocks, nonAirBlocks] = this.canvas.getAllBlocks()
    const bits = this.paletteManager.bits()
    const uint64sRequired = Math.ceil(blocks.length * bits / 64)
    const blockStates = new DataView(new ArrayBuffer(uint64sRequired * 8))
    // Pack the blocks into the blockStates array using
    // only the number of bits required for each entry.
    let current = 0n
    let next = 0n
    let bitOffset = 0
    let blockStatesIndex = 0
    for (const block of blocks) {
      const shifted = BigInt(block) << BigInt(bitOffset)
      current |= shifted
      next |= shifted >> 64n
      bitOffset += bits
      if (bitOffset >= 64) {
        bitOffset -= 64
        blockStates.setBigUint64(blockStatesIndex, current)
        blockStatesIndex += 8
        current = next
        next = 0n
      }
    }
    const now = BigInt(Date.now())
    return {
      Version: this.version,
      MinecraftDataVersion: this.minecraftDataVersion,
      Metadata: {
        Name: this.name,
        Author: this.author,
        Description: this.description,
        TimeCreated: now,
        TimeModified: now,
        TotalBlocks: nonAirBlocks,
        TotalVolume: this.canvas.width * this.canvas.height * this.canvas.length,
        RegionCount: 1,
        EnclosingSize: {
          x: this.canvas.width,
          y: this.canvas.height,
          z: this.canvas.length
        }
      },
      Regions: {
        [this.name]: {
          BlockStatePalette: this.paletteManager.toNbt(),
          BlockStates: blockStates,
          Position: {
            x: this.canvas.minx,
            y: this.canvas.miny,
            z: this.canvas.minz
          },
          Size: {
            x: this.canvas.width,
            y: this.canvas.height,
            z: this.canvas.length
          },
          Entities: [],
          PendingBlockTicks: [],
          TileEntities: []
        }
      }
    }
  }

  async save () {
    const uncompressed = this.nbt.serialize(this.asNbtData())
    return compress(uncompressed)
  }
}
// # sourceMappingURL=litematic.js.map
