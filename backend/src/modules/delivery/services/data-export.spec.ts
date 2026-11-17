import { DeliveryDataExport } from './data-export';

// Unit 4's export source (U7-11) with the database faked; on PostgreSQL in test/api/data-export.spec.ts.
describe('DeliveryDataExport', () => {
  it('FR-PRV-03 saved addresses as the user sees them; shipments without their sealed addresses', async () => {
    const sql: string[] = [];
    const out = await new DeliveryDataExport({ query: jest.fn(async (q: string) => (sql.push(q), [])) } as never, { list: async () => ({ items: [{ id: 'a' }] }) } as never).exportFor('U');
    expect(out.savedAddresses).toEqual([{ id: 'a' }]);
    expect(Object.keys(out)).toEqual(['savedAddresses', 'quotes', 'shipments', 'handovers', 'meetupProposals']);
    expect(sql.join('\n')).toContain('pickup_address_enc,dropoff_address_enc');
  });
});
