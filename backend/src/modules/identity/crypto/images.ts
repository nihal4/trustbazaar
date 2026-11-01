// sharp's package types resolve to its ES module typings under this project's CommonJS setup, while
// require() returns the function itself; the cast joins the two.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// Uploaded images (Unit 1 section 6.6; SEC-INP-04, SEC-DAT-08, DV-9). The type is identified from the
// first bytes, never from the name or the declared type: JPEG, PNG or WebP only, at most CP-33's 10 MB.
// Then the image is decoded, turned upright from its EXIF orientation, stripped of all metadata (EXIF
// location included: sharp writes none unless asked), resized to at most 2000 px on the long side and
// re-encoded as JPEG. Re-encoding also destroys most payloads hidden in image files.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // CP-33
export const MAX_LONG_SIDE = 2000; // DV-9
const MAX_INPUT_PIXELS = 50_000_000; // a decompression bomb is refused before it is decoded

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function sniffImage(bytes: Buffer): ImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export class ImageRejected extends Error {
  constructor(readonly reason: 'too-large' | 'not-an-image' | 'unreadable') {
    super(reason);
  }
}

/** The re-encoded JPEG, or ImageRejected. */
export async function reencodeImage(bytes: Buffer): Promise<{ jpeg: Buffer; width: number; height: number }> {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new ImageRejected('too-large');
  if (!sniffImage(bytes)) throw new ImageRejected('not-an-image');
  try {
    const { data, info } = await sharp(bytes, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_LONG_SIDE, height: MAX_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return { jpeg: data, width: info.width, height: info.height };
  } catch {
    throw new ImageRejected('unreadable');
  }
}
