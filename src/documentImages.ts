export interface JpegImage { bytes: Uint8Array; width: number; height: number; channels: number }
/** Read JPEG frame metadata without decoding pixels or trusting file extensions. */
export function inspectJpeg(bytes: Uint8Array | undefined): JpegImage | null {
  if (!bytes || bytes.length < 12 || bytes.length > 1_500_000 || bytes[0] !== 255 || bytes[1] !== 216) return null;
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p++] !== 255) return null;
    while (bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = (bytes[p] << 8) | bytes[p + 1];
    if (length < 2 || p + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
      const height = (bytes[p + 3] << 8) | bytes[p + 4], width = (bytes[p + 5] << 8) | bytes[p + 6];
      const channels = bytes[p + 7];
      return bytes[p + 2] === 8 && width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16_000_000 && [1, 3].includes(channels)
        ? { bytes, width, height, channels } : null;
    }
    p += length;
  }
  return null;
}
