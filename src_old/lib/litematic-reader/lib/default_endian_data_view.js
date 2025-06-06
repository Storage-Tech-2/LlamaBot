/**
 * A DataView which has a default endianness.
 */
export class DefaultEndianDataView extends DataView {
  constructor (littleEndian, buffer, byteOffset, byteLength) {
    super(buffer, byteOffset, byteLength)
    this.littleEndian = littleEndian
  }

  getFloat32 (byteOffset, littleEndian = this.littleEndian) {
    return super.getFloat32(byteOffset, littleEndian)
  }

  getFloat64 (byteOffset, littleEndian = this.littleEndian) {
    return super.getFloat64(byteOffset, littleEndian)
  }

  getInt16 (byteOffset, littleEndian = this.littleEndian) {
    return super.getInt16(byteOffset, littleEndian)
  }

  getInt32 (byteOffset, littleEndian = this.littleEndian) {
    return super.getInt32(byteOffset, littleEndian)
  }

  getUint16 (byteOffset, littleEndian = this.littleEndian) {
    return super.getUint16(byteOffset, littleEndian)
  }

  getUint32 (byteOffset, littleEndian = this.littleEndian) {
    return super.getUint32(byteOffset, littleEndian)
  }

  setFloat32 (byteOffset, value, littleEndian = this.littleEndian) {
    super.setFloat32(byteOffset, value, littleEndian)
  }

  setFloat64 (byteOffset, value, littleEndian = this.littleEndian) {
    super.setFloat64(byteOffset, value, littleEndian)
  }

  setInt16 (byteOffset, value, littleEndian = this.littleEndian) {
    super.setInt16(byteOffset, value, littleEndian)
  }

  setInt32 (byteOffset, value, littleEndian = this.littleEndian) {
    super.setInt32(byteOffset, value, littleEndian)
  }

  setUint16 (byteOffset, value, littleEndian = this.littleEndian) {
    super.setUint16(byteOffset, value, littleEndian)
  }

  setUint32 (byteOffset, value, littleEndian = this.littleEndian) {
    super.setUint32(byteOffset, value, littleEndian)
  }

  getBigInt64 (byteOffset, littleEndian = this.littleEndian) {
    return super.getBigInt64(byteOffset, littleEndian)
  }

  getBigUint64 (byteOffset, littleEndian = this.littleEndian) {
    return super.getBigInt64(byteOffset, littleEndian)
  }

  setBigInt64 (byteOffset, value, littleEndian = this.littleEndian) {
    super.setBigInt64(byteOffset, value, littleEndian)
  }

  setBigUint64 (byteOffset, value, littleEndian = this.littleEndian) {
    super.setBigUint64(byteOffset, value, littleEndian)
  }

  subview (byteOffset, length) {
    return new DefaultEndianDataView(this.littleEndian, this.buffer, this.byteOffset + byteOffset, length)
  }
}
// # sourceMappingURL=default_endian_data_view.js.map
