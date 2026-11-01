// The KYC wizard's catalogue.
import { useT } from '../../shared/language/Language';
import en from '../../messages/en/kyc.json';
import bn from '../../messages/bn/kyc.json';

const CATALOGUES = { en, bn };

export const useKycT = () => useT(CATALOGUES);
