import { inflateRawSync } from 'zlib';
import { DeliveryDataExport } from '../../modules/delivery/services/data-export';
import { GameAccountsDataExport } from '../../modules/game-accounts/services/data-export';
import { OrdersDataExport } from '../../modules/orders/services/data-export';
import { collectRows } from './data-export';
import { zip } from './zip';

// U7-11: the export helpers, and the unit sources' queries (with the database faked; on PostgreSQL in
// test/api/data-export.spec.ts).
describe('data export helpers (FR-PRV-03)', () => {
  it('FR-PRV-03 collectRows runs each named query for the user and keeps the r column', async () => {
    const db = { query: jest.fn(async (sql: string) => (sql === 'A' ? [{ r: { a: 1 } }, { r: { a: 2 } }] : [])) };
    expect(await collectRows(db as never, { first: 'A', second: 'B' }, 'U')).toEqual({ first: [{ a: 1 }, { a: 2 }], second: [] });
    expect(db.query).toHaveBeenCalledWith('A', ['U']);
  });

  it('FR-PRV-03 the ZIP holds each file deflated with its name, sizes and CRC', () => {
    const data = Buffer.from('{"hello":"বাংলা"}'.repeat(50), 'utf8');
    const z = zip([{ name: 'trustbazaar-data.json', data, date: new Date('2026-11-17T10:20:30Z') }]);
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    const size = z.readUInt32LE(18);
    expect(z.readUInt32LE(22)).toBe(data.length);
    const nameLen = z.readUInt16LE(26);
    expect(z.subarray(30, 30 + nameLen).toString()).toBe('trustbazaar-data.json');
    expect(inflateRawSync(z.subarray(30 + nameLen, 30 + nameLen + size)).equals(data)).toBe(true);
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
    expect(z.readUInt16LE(z.length - 12)).toBe(1);
  });

  it('FR-PRV-03 the Orders, Delivery and Game-account sources never select secrets', async () => {
    const sql: string[] = [];
    const db = { query: jest.fn(async (q: string) => (sql.push(q), [])) };
    const orders = await new OrdersDataExport(db as never).exportFor('U');
    expect(Object.keys(orders)).toEqual(['orders', 'cancellationRequests', 'payments', 'refunds', 'settlements', 'payouts', 'payoutAccounts', 'subscriptions', 'featuredPurchases']);
    const delivery = await new DeliveryDataExport(db as never, { list: async () => ({ items: [{ id: 'a' }] }) } as never).exportFor('U');
    expect(delivery.savedAddresses).toEqual([{ id: 'a' }]);
    const game = await new GameAccountsDataExport(db as never).exportFor('U');
    expect(Object.keys(game)).toEqual(['listings', 'ownershipProofs', 'handovers', 'credentialViews']);
    const all = sql.join('\n');
    expect(all).not.toMatch(/sealed_credentials|buyer_keys/);
    expect(all).toContain("'{account_number_enc,reviewed_by,user_id}'");
    expect(all).toContain('pickup_address_enc,dropoff_address_enc');
  });
});
