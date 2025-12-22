/**
 * A DataView which has a default endianness.
 */
export class DefaultEndianDataView {
  private view: DataView;

  constructor(public readonly littleEndian: boolean, buffer: ArrayBufferLike, byteOffset?: number, byteLength?: number) {
    this.view = new DataView(buffer, byteOffset, byteLength);
  }

  public getView(): DataView {
    return this.view;
  }
  
  public getInt8(byteOffset: number): number {
    return this.view.getInt8(byteOffset);
  }
  public getUint8(byteOffset: number): number {
    return this.view.getUint8(byteOffset);
  }
  public getFloat32(byteOffset: number, littleEndian = this.littleEndian): number {
    return this.view.getFloat32(byteOffset, littleEndian);
  }
  public getFloat64(byteOffset: number, littleEndian = this.littleEndian): number {
    return this.view.getFloat64(byteOffset, littleEndian);
  }
  public getInt16(byteOffset: number, littleEndian = this.littleEndian): number {
    return this.view.getInt16(byteOffset, littleEndian);
  }
  public getInt32(byteOffset: number, littleEndian = this.littleEndian): number {
    return this.view.getInt32(byteOffset, littleEndian);
  }
  public getUint16(byteOffset: number, littleEndian = this.littleEndian): number {
    return this.view.getUint16(byteOffset, littleEndian);
  }
  public getUint32(byteOffset: number, littleEndian = this.littleEndian): number {
    return this.view.getUint32(byteOffset, littleEndian);
  }
  public setInt8(byteOffset: number, value: number): void {
    this.view.setInt8(byteOffset, value);
  }
  public setUint8(byteOffset: number, value: number): void {
    this.view.setUint8(byteOffset, value);
  }
  public setFloat32(byteOffset: number, value: number, littleEndian = this.littleEndian): void {
    this.view.setFloat32(byteOffset, value, littleEndian);
  }
  public setFloat64(byteOffset: number, value: number, littleEndian = this.littleEndian): void {
    this.view.setFloat64(byteOffset, value, littleEndian);
  }
  public setInt16(byteOffset: number, value: number, littleEndian = this.littleEndian): void {
    this.view.setInt16(byteOffset, value, littleEndian);
  }
  public setInt32(byteOffset: number, value: number, littleEndian = this.littleEndian): void {
    this.view.setInt32(byteOffset, value, littleEndian);
  }
  public setUint16(byteOffset: number, value: number, littleEndian = this.littleEndian): void {
    this.view.setUint16(byteOffset, value, littleEndian);
  }
  public setUint32(byteOffset: number, value: number, littleEndian = this.littleEndian): void {
    this.view.setUint32(byteOffset, value, littleEndian);
  }
  public getBigInt64(byteOffset: number, littleEndian = this.littleEndian): bigint {
    return this.view.getBigInt64(byteOffset, littleEndian);
  }
  public getBigUint64(byteOffset: number, littleEndian = this.littleEndian): bigint {
    return this.view.getBigInt64(byteOffset, littleEndian);
  }
  public setBigInt64(byteOffset: number, value: bigint, littleEndian = this.littleEndian): void {
    this.view.setBigInt64(byteOffset, value, littleEndian);
  }
  public setBigUint64(byteOffset: number, value: bigint, littleEndian = this.littleEndian): void {
    this.view.setBigUint64(byteOffset, value, littleEndian);
  }

  public subview(byteOffset: number, length: number): DefaultEndianDataView {
    return new DefaultEndianDataView(
      this.littleEndian,
      this.view.buffer,
      this.view.byteOffset + byteOffset,
      length
    );
  }
}