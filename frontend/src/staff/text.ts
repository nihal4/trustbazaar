// The console's catalogue (staff.json), with the shell's keys.
import { useT } from '../shared/language/Language';
import en from '../messages/en/staff.json';
import bn from '../messages/bn/staff.json';

const CATALOGUES = { en, bn };
export const useStaffT = () => useT(CATALOGUES);
