// The translation function type the parts of the listing page share.
import { useT } from '../../shared/language/Language';

export type T = ReturnType<typeof useT>['t'];
