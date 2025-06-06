import * as pako from 'pako'
export async function decompress (data) {
  return pako.ungzip(data)
}
export async function compress (data) {
  return pako.gzip(data)
}
// # sourceMappingURL=compression.js.map
