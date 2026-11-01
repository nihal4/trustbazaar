import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Problem } from '../../../kernel/http/problems';
import type { ListingService } from '../services/listing.service';
import { CategoriesController, ListingPhotosController, ListingsController, MyListingsController } from './listings.controller';

// The controllers only pass the caller and the request on; the rules are ListingService's (its spec) and
// the policies are checked over HTTP (test/api/listings.spec.ts).
const user = { type: 'user', userId: 'u1', sessionId: 's1', accountStatus: 'active', kycStatus: 'verified', emailVerified: true } as const;
const staff = { type: 'staff', staffId: 'st', sessionId: 's2', role: 'operator' } as const;

function service() {
  const fn = () => jest.fn(async (...args: unknown[]) => ({ args }));
  return {
    categories: fn(), create: jest.fn(async () => ({ listing: { id: 'l1' }, repeated: true })), update: fn(), addPhoto: fn(), removePhoto: fn(),
    publish: fn(), clarify: fn(), cancel: fn(), view: fn(), mine: fn(), photoFile: jest.fn(),
  };
}

describe('listings controllers', () => {
  it('IF-UI-03 each route hands its caller and input to ListingService', async () => {
    const s = service();
    const c = new ListingsController(s as unknown as ListingService);
    const res = { status: jest.fn() };
    expect(await c.create({} as never, 'key-12345678', user, res as never)).toEqual({ id: 'l1' });
    expect(res.status).toHaveBeenCalledWith(200);
    await c.update('l1', { title: 'x' } as never, user);
    await c.addPhoto('l1', { showsDefects: 'true' }, { buffer: Buffer.from('b') }, user);
    await c.addPhoto('l1', {}, undefined, user);
    await c.removePhoto('l1', 'p1', user);
    await c.publish('l1', {}, user);
    await c.clarify('l1', { body: 'note' }, user);
    await c.cancel('l1', user);
    await c.view('l1', undefined);
    expect(s.update).toHaveBeenCalledWith('u1', 'l1', { title: 'x' });
    expect(s.addPhoto.mock.calls).toEqual([['u1', 'l1', Buffer.from('b'), true], ['u1', 'l1', undefined, false]]);
    expect(s.clarify).toHaveBeenCalledWith('u1', 'l1', 'note');
    expect(s.view).toHaveBeenCalledWith('l1', undefined);
    await new CategoriesController(s as unknown as ListingService).categories();
    await new MyListingsController(s as unknown as ListingService).mine({ status: 'draft' }, user);
    expect(s.mine).toHaveBeenCalledWith('u1', 'draft', undefined);
  });

  it('SEC-ACC-01 a staff session is not a seller', async () => {
    const c = new ListingsController(service() as unknown as ListingService);
    expect(() => c.update('l1', {} as never, staff)).toThrow(Problem);
  });

  it('SEC-INP-04 photos are served as JPEG with nosniff; a missing file is not found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-photo-'));
    const file = join(dir, 'p.jpg');
    writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff]));
    const s = service();
    s.photoFile.mockResolvedValueOnce(file).mockResolvedValueOnce(join(dir, 'missing.jpg'));
    const c = new ListingPhotosController(s as unknown as ListingService);
    const res = { status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), send: jest.fn() };
    const key = 'c'.repeat(32);
    await c.photo(key, { size: 'thumb' }, res as never);
    expect(s.photoFile).toHaveBeenCalledWith(key, 'thumb');
    expect(res.set.mock.calls[0][0]).toMatchObject({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' });
    await expect(c.photo(key, {}, res as never)).rejects.toMatchObject({ problem: 'not-found' });
    await expect(c.photo('../../etc/passwd', {}, res as never)).rejects.toMatchObject({ problem: 'not-found' });
    expect(s.photoFile).toHaveBeenCalledTimes(2);
  });
});
