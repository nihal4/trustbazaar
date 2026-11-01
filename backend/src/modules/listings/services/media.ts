import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';

// sharp's package types resolve to its ES module typings under this project's CommonJS setup, while
// require() returns the function itself; the cast joins the two.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// MediaPipeline (docs/design/03_listings_auctions.pdf section 6.2; SEC-INP-04, SEC-DAT-08, DV-20). Listing
// photos are public, so unlike KYC images they are not encrypted, but they get the same treatment: the type
// is identified from the first bytes (JPEG, PNG or WebP only) and the size limit CP-33 applied; the image is
// decoded, turned upright and re-encoded without any metadata (EXIF location included: sharp writes none
// unless asked), at most 1600 px on the long side, with a 400 px thumbnail. The files get a random name on
// the listing_media volume (FILES_ROOT/listings) and are served with a fixed type by ListingPhotosController.
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // the multipart cap; CP-33 image_bytes is applied too
export const FULL_SIZE = 1600; // DV-20
export const THUMB_SIZE = 400; // DV-20
const MAX_INPUT_PIXELS = 50_000_000; // a decompression bomb is refused before it is decoded
export const STORAGE_KEY = /^[0-9a-f]{32}$/;

export type PhotoSize = 'full' | 'thumb';

export function sniffImage(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export class PhotoRejected extends Error {
  constructor(readonly reason: 'too-large' | 'not-an-image' | 'unreadable') {
    super(reason);
  }
}

export interface StoredPhoto {
  key: string;
  width: number;
  height: number;
}

@Injectable()
export class MediaPipeline {
  private readonly log = new Logger('MediaPipeline');
  private readonly dir: string;

  constructor(@Inject(TB_CONFIG) config: TbConfig) {
    this.dir = join(config.filesRoot, 'listings');
  }

  /** The re-encoded full-size JPEG and thumbnail, or PhotoRejected. */
  async reencode(bytes: Buffer, maxBytes: number): Promise<{ full: Buffer; thumb: Buffer; width: number; height: number }> {
    if (bytes.length > Math.min(maxBytes, MAX_PHOTO_BYTES)) throw new PhotoRejected('too-large');
    if (!sniffImage(bytes)) throw new PhotoRejected('not-an-image');
    try {
      const upright = await sharp(bytes, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS }).rotate().toBuffer();
      const { data: full, info } = await sharp(upright)
        .resize({ width: FULL_SIZE, height: FULL_SIZE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      const thumb = await sharp(upright)
        .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      return { full, thumb, width: info.width, height: info.height };
    } catch {
      throw new PhotoRejected('unreadable');
    }
  }

  /** Checks, re-encodes and writes a photo; the caller records the key in its transaction. */
  async store(bytes: Buffer, maxBytes: number): Promise<StoredPhoto> {
    const { full, thumb, width, height } = await this.reencode(bytes, maxBytes);
    const key = randomBytes(16).toString('hex');
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await this.write(this.path(key, 'full'), full);
    await this.write(this.path(key, 'thumb'), thumb);
    return { key, width, height };
  }

  /** Best effort: a file left behind is unreachable, since only listed keys are served. */
  async remove(key: string): Promise<void> {
    for (const size of ['full', 'thumb'] as const) {
      await fs.unlink(this.path(key, size)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') this.log.warn(`could not remove listing photo ${key}: ${err.message}`);
      });
    }
  }

  path(key: string, size: PhotoSize): string {
    if (!STORAGE_KEY.test(key)) throw new Error('not a storage key');
    return join(this.dir, size === 'full' ? `${key}.jpg` : `${key}-${THUMB_SIZE}.jpg`);
  }

  private async write(path: string, data: Buffer): Promise<void> {
    const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, path);
  }
}
