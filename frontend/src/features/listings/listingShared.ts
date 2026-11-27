import { useT } from '../../shared/language/Language';

export type T = ReturnType<typeof useT>['t'];
