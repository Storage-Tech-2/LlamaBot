# Litematic-reader
Example:
```ts
import { readFile } from "fs/promises";
import { Litematic } from '@kleppe/litematic-reader'

async function example(filepath: string) {
    const ArrayBuffer = readFile(filepath)

    const litematic = new Litematic(ArrayBuffer) // It only takes inn a ArrayBuffer
    
    /* 
        Gets all block in  litematic file and return with block id and position
    */
    console.log(await litematic.getAllBlocks()) 
    /* 
        logs: [
            {pos {x: 0, y: 0, z:0} block: 'minecraft:air'},
            {pos {x: 0, y: 0, z:1} block: 'minecraft:stone'}
            etc...
        ]
    */

    /* 
        Get a specific block in litematic file
    */
    console.log(await litematic.getBlock(0, 0, 0))
    /*
        logs: 'minecraft:air'
    */

    /* Get a palette of all the diffrent blocks with counts them */
    console.log(await litematic.getBlockPaletteWithCount())
    /*
        logs: {
            'minecraft:stone': { block: 'minecraft:smooth_quartz', count: 355 },
            'minecraft:air': { block: 'minecraft:air', count: 1551 },
            etc...
        }
    */

    /* Get a palette of all the diffrent blocks */
    console.log(await litematic.getBlockPalette())
    /* 
        logs: [
            'minecraft:air',
            'minecraft:stone',
            etc...
        ]
    */

    /* The functions above all read individually */
    await litematic.read() // Only needed for the operations beneath


    /* Can also access other file data */
    console.log(litematic.litematic?.totalBlocks) // 2
    console.log(litematic.litematic?.palette) /* 
    PaletteManager {
        palette: [],
        paletteList: []
    }
    */
    console.log(litematic.litematic?.version) // 14
    console.log(litematic.litematic?.author) // Minecraft Name
    console.log(litematic.litematic?.name) // Litematic Name
    console.log(litematic.litematic?.description) // Litematic Description
}

example('file.litematic')
```

---
### Web use || Vite fix

When Vite is used the `fs/promises` module will create problems. When you use a `Node.js` module in the browser, Vite will output the following warning.

> Module "fs" has been externalized for browser compatibility. Cannot access "fs.readFile" in client code.

This is because Vite does not automatically polyfill Node.js modules.

##### **Vite own documentation says:**
> We recommend avoiding Node.js modules for browser code to reduce the bundle size, although you can add polyfills manually. If the module is imported from a third-party library (that's meant to be used in the browser), it's advised to report the issue to the respective library.

[Vite FS Troubleshooting](https://vitejs.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility).


Example:

Html:
```html
<input id="input" type="file">
```

TS / JS:
```ts
import { Litematic } from '@kleppe/litematic-reader'
const input = getElementById('input')

input.addEventListener('change', (event:any) => {
    const file = event.target.files[0]
    let reader = new FileReader()

    reader.addEventListener('loadend', async (e) => {
        const arrayBuffer = e.target?.result
        let litematic = new Litematic(arrayBuffer as ArrayBuffer)

        /* Add function and logistics here */
    })

    reader.readAsArrayBuffer(file)

    /* Can also call another function to to the logistics */
    someFunction(file)
})
```