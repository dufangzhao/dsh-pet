import { KernelFault } from '@pet/host-kernel';

const invalid = (): never => {
  throw new KernelFault('invalid-input');
};
const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Structural byte validation and detected MIME; user names and declared suffixes are irrelevant. */
export function imageMediaType(bytes: Buffer): string {
  if (bytes.subarray(0, 8).equals(pngHeader)) {
    let at = 8,
      image = false,
      first = true;
    while (at < bytes.length) {
      if (at + 12 > bytes.length) return invalid();
      const length = bytes.readUInt32BE(at),
        end = at + 12 + length;
      if (end > bytes.length) return invalid();
      const kind = bytes.toString('ascii', at + 4, at + 8);
      if (crc32(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return invalid();
      if (
        first &&
        (kind !== 'IHDR' ||
          length !== 13 ||
          !bytes.readUInt32BE(at + 8) ||
          !bytes.readUInt32BE(at + 12))
      )
        return invalid();
      first = false;
      if (kind === 'IDAT' && length) image = true;
      if (kind === 'IEND') {
        if (length || !image || end !== bytes.length) return invalid();
        return 'image/png';
      }
      at = end;
    }
    return invalid();
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  ) {
    let at = 2,
      frame = false;
    while (at + 4 < bytes.length) {
      if (bytes[at++] !== 0xff) return invalid();
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === undefined) return invalid();
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (at + 2 > bytes.length) return invalid();
      const length = bytes.readUInt16BE(at);
      if (length < 2 || at + length > bytes.length) return invalid();
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (length < 8 || !bytes.readUInt16BE(at + 3) || !bytes.readUInt16BE(at + 5))
          return invalid();
        frame = true;
      }
      if (marker === 0xda)
        return frame && at + length < bytes.length - 2 ? 'image/jpeg' : invalid();
      at += length;
    }
    return invalid();
  }
  if (bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
    if (!bytes.readUInt16LE(6) || !bytes.readUInt16LE(8)) return invalid();
    const packed = bytes[10] ?? 0;
    let at = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0),
      image = false;
    const blocks = (): void => {
      for (;;) {
        const length = bytes[at++];
        if (length === undefined || at + length > bytes.length) invalid();
        if (!length) return;
        at += length;
      }
    };
    while (at < bytes.length) {
      const kind = bytes[at++];
      if (kind === 0x3b) return image && at === bytes.length ? 'image/gif' : invalid();
      if (kind === 0x21) {
        at++;
        blocks();
      } else if (kind === 0x2c) {
        if (at + 9 > bytes.length || !bytes.readUInt16LE(at + 4) || !bytes.readUInt16LE(at + 6))
          return invalid();
        const descriptor = bytes[at + 8] ?? 0;
        at += 9 + (descriptor & 0x80 ? 3 * 2 ** ((descriptor & 7) + 1) : 0);
        const minimum = bytes[at++];
        if (minimum === undefined || minimum < 2 || minimum > 8) return invalid();
        blocks();
        image = true;
      } else return invalid();
    }
    return invalid();
  }
  if (
    bytes.length >= 20 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) return invalid();
    let at = 12,
      image = false;
    while (at + 8 <= bytes.length) {
      const kind = bytes.toString('ascii', at, at + 4),
        length = bytes.readUInt32LE(at + 4);
      if (at + 8 + length > bytes.length) return invalid();
      if ((kind === 'VP8 ' && length >= 10) || (kind === 'VP8L' && length >= 5)) image = true;
      at += 8 + length + (length % 2);
    }
    return image && at === bytes.length ? 'image/webp' : invalid();
  }
  return invalid();
}
