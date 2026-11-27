import { RequestMethod } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { DiscoveryService } from '@nestjs/core';
import { getMetadataStorage } from 'class-validator';
import { randomUUID } from 'crypto';
import { problem, suite } from './setup';

// SEC-INP-01: every input is validated on the server against an explicit schema (type, length, range, format);
// requests with unknown or invalid fields are rejected.
const s = suite();

describe('SEC-INP-01 schema validation', () => {
  it('SEC-INP-01 every request body of every route is a declared class with validation rules', () => {
    const storage = getMetadataStorage();
    const loose: string[] = [];
    for (const c of s.t.app.get(DiscoveryService).getControllers()) {
      const proto = Object.getPrototypeOf(c.instance ?? {});
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor' || typeof proto[name] !== 'function') continue;
        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, proto.constructor, name) ?? {}) as Record<string, { index: number; data?: unknown }>;
        const types = (Reflect.getMetadata('design:paramtypes', proto, name) ?? []) as unknown[];
        for (const [key, a] of Object.entries(args)) {
          if (Number(key.split(':')[0]) !== RouteParamtypes.BODY || a.data !== undefined) continue;
          const type = types[a.index] as (new () => unknown) | undefined;
          const ruled = typeof type === 'function' && ![Object, String, Number, Boolean, Array].includes(type as never) && storage.getTargetValidationMetadatas(type, '', true, false).length > 0;
          if (!ruled) loose.push(`${c.metatype?.name}.${name}`);
        }
      }
    }
    expect(loose).toEqual([]);
    void RequestMethod;
  });

  it('SEC-INP-01 an unknown field is rejected, and nothing is created', async () => {
    const email = `u-${randomUUID()}@tb.test`;
    const r = await s.browser().post('/auth/register', { email, displayName: 'Tania Akter', password: 'kites over the green river', isAdmin: true });
    const p = await problem(r);
    expect(p).toMatchObject({ status: 400, type: '/problems/validation-failed' });
    expect(p.errors).toEqual(['property isAdmin should not exist']); // names the field, never the value
    expect(await s.fx.query(`SELECT 1 FROM identity.users WHERE email = $1`, [email])).toHaveLength(0);
  });

  it.each([
    ['a wrong type', { quantity: 'many' }, 'quantity'],
    ['a value out of range', { quantity: 0 }, 'quantity'],
    ['a malformed identifier', { listingId: 'not-a-uuid' }, 'listingId'],
    ['a value outside its list', { fulfilment: 'teleport' }, 'fulfilment'],
  ])('SEC-INP-01 an order with %s is rejected naming the field', async (_case, change, field) => {
    const { b } = await s.signedIn({ kyc: 'verified' });
    const p = await problem(await b.post('/orders', { listingId: randomUUID(), quantity: 1, fulfilment: 'self_pickup', ...change }));
    expect(p.status).toBe(400);
    expect((p.errors as unknown as string[]).some((m) => m.startsWith(`${field} `))).toBe(true);
  });

  it('SEC-INP-01 a text past its length limit is rejected', async () => {
    const { b } = await s.signedIn({ kyc: 'verified' });
    const p = await problem(await b.post('/listings', { itemKind: 'physical', saleFormat: 'fixed_price', title: 'x'.repeat(5000) }));
    expect(p.status).toBe(400);
    expect((p.errors as unknown as string[]).some((m) => m.startsWith('title '))).toBe(true);
  });
});
