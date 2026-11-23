import { draftListing, image, suite } from './setup';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// SEC-DAT-08: metadata (EXIF location included) is removed from every uploaded image before it is stored or shown.
const s = suite();
const withGps = () =>
  sharp({ create: { width: 1200, height: 900, channels: 3, background: '#7a7' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'home', Artist: 'Me' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '23/1 48/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '90/1 24/1 0/1' } })
    .toBuffer();
const metaOf = async (r: Response) => sharp(Buffer.from(await r.arrayBuffer())).metadata();

describe('SEC-DAT-08 image metadata', () => {
  it('SEC-DAT-08 the test image does carry GPS before upload', async () => {
    expect((await sharp(await withGps()).metadata()).exif).toBeDefined();
  });

  it('SEC-DAT-08 a listing photo is served without EXIF', async () => {
    const { b } = await s.signedIn({ kyc: 'verified' });
    const id = await draftListing(s, b);
    const form = new FormData();
    form.set('photo', new Blob([new Uint8Array(await withGps())], { type: 'image/jpeg' }), 'p.jpg');
    const r = await b.upload(`/listings/${id}/photos`, form);
    expect(r.status).toBe(201);
    const p = (await r.json()) as { url: string; thumbUrl: string };
    for (const u of [p.url, p.thumbUrl]) {
      const m = await metaOf(await b.get(u.replace('/api/v1', '')));
      expect(m.exif).toBeUndefined();
      expect(m.xmp).toBeUndefined();
      expect(m.iptc).toBeUndefined();
    }
  });

  it('SEC-DAT-08 a KYC image is stored and shown without EXIF', async () => {
    const owner = await s.signedIn({ kyc: 'unsubmitted' });
    const challenge = (await (await owner.b.get('/kyc/liveness-challenge')).json()) as { challengeId: string };
    const form = new FormData();
    for (const [k, v] of Object.entries({ docType: 'nid', docNumber: String(Date.now()).slice(-10), fullName: 'Exif Person', dateOfBirth: '1995-04-12', challengeId: challenge.challengeId })) form.set(k, v);
    form.set('doc_front', new Blob([new Uint8Array(await withGps())], { type: 'image/jpeg' }), 'f.jpg');
    for (const k of ['doc_back', 'selfie_neutral', 'selfie_action']) form.set(k, new Blob([new Uint8Array(await image())], { type: 'image/jpeg' }), `${k}.jpg`);
    expect((await owner.b.upload('/kyc/submissions', form)).status).toBe(202);
    const { url } = (await (await owner.b.post('/kyc/files/doc_front/view')).json()) as { url: string };
    expect((await metaOf(await owner.b.get(url.replace('/api/v1', '')))).exif).toBeUndefined();
  });
});
