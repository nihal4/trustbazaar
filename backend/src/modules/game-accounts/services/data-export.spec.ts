import { GameAccountsDataExport } from './data-export';

// Unit 5's export source (U7-11) with the database faked; on PostgreSQL in test/api/data-export.spec.ts.
describe('GameAccountsDataExport', () => {
  it('FR-PRV-03 never a credential: sealed credentials and buyer keys are not read, nor proof screenshots', async () => {
    const sql: string[] = [];
    const out = await new GameAccountsDataExport({ query: jest.fn(async (q: string) => (sql.push(q), [])) } as never).exportFor('U');
    expect(Object.keys(out)).toEqual(['listings', 'ownershipProofs', 'handovers', 'credentialViews']);
    const all = sql.join('\n');
    expect(all).not.toMatch(/sealed_credentials|buyer_keys/);
    expect(all).toContain('screenshot_key,screenshot_dek');
  });
});
