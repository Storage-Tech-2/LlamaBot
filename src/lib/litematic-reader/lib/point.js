/**
 * A string representation of a 3D point, which can be used
 * as a readonly point struct with structural equality,
 * or as an object key.
 */
export function p (x, y, z) {
  return `${x}:${y}:${z}`
}
export function parseP (point) {
  return point.split(':').map(c => +c)
}
// # sourceMappingURL=point.js.map
