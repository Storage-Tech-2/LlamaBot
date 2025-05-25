import { SchematicReader } from './lib/litematic.js'
import { decompress } from './lib/compression.js'
class Litematic {
  constructor (file) {
    this.file = file
  }

  async read () {
    const uint8View = new Uint8Array(this.file)
    const decompressed = await decompress(uint8View)
    const litematic = new SchematicReader(decompressed)
    this.litematic = litematic
    return litematic
  }

  async fileCheck () {
    if (!this.litematic) { await this.read() }
  }

  async getAllBlocks () {
    await this.fileCheck()
    const litematic = this.litematic
    const blocks = []
    for (let h = 0; h < litematic.blocks.height; h++) {
      for (let w = 0; w < litematic.blocks.width; w++) {
        for (let l = 0; l < litematic.blocks.length; l++) {
          const block = litematic.getBlock(w, h, l)
          blocks.push({
            pos: {
              x: w,
              y: h,
              z: l
            },
            block
          })
        }
      }
    }
    return blocks
  }

  async getBlock (x, y, z) {
    await this.fileCheck()
    const litematic = this.litematic
    return litematic.getBlock(x, y, z)
  }

  async getBlockPalette () {
    await this.fileCheck()
    const litematic = this.litematic
    const paletteList = litematic.palette.paletteList
    const fullPaletteList = []
    for (let i = 0; i < paletteList.length; i++) {
      const blockSplit = paletteList[i].split('[')
      if (fullPaletteList.includes(blockSplit[0])) { continue }
      fullPaletteList.push(blockSplit[0])
    }
    return fullPaletteList
  }

  async getBlockPaletteWithCount () {
    const allBlocks = await this.getAllBlocks()
    const paletteWithCount = {}
    for (let i = 0; i < allBlocks.length; i++) {
      const blockName = allBlocks[i].block.split('[')[0]
      const blockCount = paletteWithCount[blockName]?.count || 0
      paletteWithCount[blockName] = {
        block: blockName,
        count: blockCount + 1
      }
    }
    return paletteWithCount
  }
}
export { Litematic }
// # sourceMappingURL=main.js.map
