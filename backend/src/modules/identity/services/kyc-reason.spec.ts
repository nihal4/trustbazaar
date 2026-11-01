import { userFacing } from './kyc.service';

describe('KYC rejection reasons for the user', () => {
  it('FR-KYC-06 every reason and note is shown, except a blacklist match (FR-TNS-06)', () => {
    expect(userFacing('duplicate_identity', 'Linked to another account')).toEqual({ reason: 'duplicate_identity', note: 'Linked to another account' });
    expect(userFacing('underage', null)).toEqual({ reason: 'underage', note: null });
    expect(userFacing('blacklisted', 'Banned after order 42')).toEqual({ reason: 'other', note: null });
  });
});
