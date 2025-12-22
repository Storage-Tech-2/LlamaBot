import { decompress } from "./compression.js"
import { SchematicReader } from "./litematic.js"

export class Litematic {
  public litematic?: SchematicReader 

  constructor(private file: ArrayBuffer) {}
  
  async read() {
    const uint8View = new Uint8Array(this.file)
    let decompressed = await decompress(uint8View)
    const litematic = new SchematicReader(decompressed)
    this.litematic = litematic
    return litematic
  }

  async fileCheck() {
    if (!this.litematic) await this.read()
    if (!this.litematic) return 
  }

  async getAllBlocks() : Promise<{pos: {x: number, y: number, z: number}, block: string}[]> {
    await this.fileCheck()
    const litematic = this.litematic!
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

  async getBlock(x: number, y: number, z: number) : Promise<string> {
    await this.fileCheck()
    const litematic = this.litematic!

    return litematic.getBlock(x, y, z)
  }

  async getBlockPalette() : Promise<string[]>  {
    await this.fileCheck()
    const litematic = this.litematic!
    const paletteList = litematic.palette['paletteList']
    const fullPaletteList:string[] = []

    for (let i = 0; i < paletteList.length; i++) {
      const blockSplit = paletteList[i].split('[')
      if(fullPaletteList.includes(blockSplit[0])) continue
      fullPaletteList.push(blockSplit[0])
    }

    return fullPaletteList
  }

  async getBlockPaletteWithCount(): Promise<{[key: string]: {block: string, count: number}}> {
    const allBlocks = await this.getAllBlocks()


    let paletteWithCount:{
      [key: string]: {
        block: string,
        count: number
      }} = {}

    for (let i = 0; i < allBlocks.length; i++) {
      const blockName = allBlocks[i].block.split('[')[0]
      let blockCount = paletteWithCount[blockName]?.count || 0

      paletteWithCount[blockName] = {
        block: blockName,
        count: blockCount + 1
      }
    }

    return paletteWithCount

  }
}