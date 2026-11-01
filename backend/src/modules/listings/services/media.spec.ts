import { mkdtempSync, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { TbConfig } from '../../../kernel/config/config';
import { MediaPipeline, PhotoRejected, sniffImage } from './media';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

const image = (fmt: 'jpeg' | 'png' | 'webp', w = 2000, h = 1000) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#468' } })[fmt]().toBuffer();

describe('MediaPipeline (listing photos, section 6.2)', () => {
  const root = mkdtempSync(join(tmpdir(), 'tb-media-'));
  const media = new MediaPipeline({ filesRoot: root } as TbConfig);

  it('SEC-INP-04 the type comes from the first bytes: JPEG, PNG and WebP only', async () => {
    expect(sniffImage(await image('jpeg', 10, 10))).toBe('image/jpeg');
    expect(sniffImage(await image('png', 10, 10))).toBe('image/png');
    expect(sniffImage(await image('webp', 10, 10))).toBe('image/webp');
    expect(sniffImage(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffImage(Buffer.alloc(2))).toBeNull();
  });

  it('SEC-INP-04 too large, not an image and unreadable are refused with their reason', async () => {
    await expect(media.reencode(await image('png', 50, 50), 10)).rejects.toEqual(new PhotoRejected('too-large'));
    await expect(media.reencode(Buffer.from('<svg/>'), 1e7)).rejects.toMatchObject({ reason: 'not-an-image' });
    await expect(media.reencode((await image('jpeg')).subarray(0, 300), 1e7)).rejects.toMatchObject({ reason: 'unreadable' });
  });

  it('DV-20 a stored photo is a 1600 px JPEG with a 400 px thumbnail under a random name; removing it deletes both', async () => {
    const p = await media.store(await image('webp', 3000, 1500), 1e7);
    expect(p).toMatchObject({ width: 1600, height: 800 });
    expect(p.key).toMatch(/^[0-9a-f]{32}$/);
    const full = await sharp(await fs.readFile(media.path(p.key, 'full'))).metadata();
    const thumb = await sharp(await fs.readFile(media.path(p.key, 'thumb'))).metadata();
    expect([full.format, full.width, thumb.width]).toEqual(['jpeg', 1600, 400]);
    expect(full.exif).toBeUndefined();
    await media.remove(p.key);
    await expect(fs.stat(media.path(p.key, 'full'))).rejects.toThrow();
    await media.remove(p.key); // already gone: no error
  });

  it('SEC-INP-04 a small image is not enlarged', async () => {
    const p = await media.reencode(await image('png', 300, 200), 1e7);
    expect([p.width, p.height]).toEqual([300, 200]);
  });

  it('SEC-INP-04 files are named only by their random storage key, never by a path from the request', () => {
    expect(() => media.path('../../etc/passwd', 'full')).toThrow('not a storage key');
  });
});
