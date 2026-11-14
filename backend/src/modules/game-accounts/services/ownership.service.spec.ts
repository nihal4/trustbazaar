import { ownershipCode } from './ownership.service';

// U5-02: the ownership code's form (docs/design/05_game_accounts.pdf section 5.2; FR-GAM-03).
describe('ownershipCode', () => {
  it('FR-GAM-03 TB-XXXX-XXXX: 40 bits in Crockford base32, without I, L, O and U', () => {
    expect(ownershipCode(Buffer.from([0, 0, 0, 0, 0]))).toBe('TB-0000-0000');
    expect(ownershipCode(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]))).toBe('TB-ZZZZ-ZZZZ');
    expect(ownershipCode(Buffer.from([0x00, 0x00, 0x00, 0x00, 0x21]))).toBe('TB-0000-0011');
    for (let i = 0; i < 200; i++) expect(ownershipCode()).toMatch(/^TB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });
});
