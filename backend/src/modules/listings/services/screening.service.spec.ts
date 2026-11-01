import { normaliseForScreening, ScreeningService } from './screening.service';

describe('ScreeningService (FR-LST-11)', () => {
  it('FR-LST-11 title and description are matched in one normalised, lower-case text', async () => {
    const query = jest.fn().mockResolvedValue([{ term: 'password', severity: 'high_risk' }]);
    const found = await new ScreeningService().matches({ query } as never, 'PUBG  Account', 'With\nPASSWORD পাসওয়ার্ড');
    expect(found).toEqual([{ term: 'password', severity: 'high_risk' }]);
    expect(query.mock.calls[0][1]).toEqual(['pubg account with password পাসওয়ার্ড']);
    expect(normaliseForScreening('Aé  B')).toBe('aé b');
  });
});
