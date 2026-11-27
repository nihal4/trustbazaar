// The mark of a way to be paid (U10-25): the wallet's brand or a bank. These files in public/brand/payments are simple stand-ins in each brand's colours;
// the providers' official marks go in the same files (same names) without any change to the code.
import type { PayoutAccount } from './model';

const FILE: Record<PayoutAccount['kind'], string> = { bkash_wallet: 'bkash', nagad_wallet: 'nagad', bank: 'bank' };

export function BrandMark({ kind, size = 40 }: { kind: PayoutAccount['kind']; size?: number }) {
  return <img src={`/brand/payments/${FILE[kind]}.svg`} alt="" width={size} height={size} style={{ display: 'block', flex: 'none' }} />;
}
