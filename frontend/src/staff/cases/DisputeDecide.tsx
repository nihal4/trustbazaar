// The operator's decision on a dispute: the outcome, the split, the reason, and the second operator's approval when the decision needs one.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatMoney, parseTaka } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import styles from '../staff.module.css';
import { Action, Choice, staffError } from './common';
import { Button, Field, Input } from '../../shared/ui';
import { Outcome, Outcomes, CaseFile, caseKey } from './disputeTypes';

export function Decide({ f, t, lang }: { f: CaseFile; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState<'buyer' | 'seller' | ''>('');
  const [partial, setPartial] = useState<Outcomes['partialRefund']>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const money = (p: string) => formatMoney(BigInt(p), lang);
  const game = f.order.listing.itemKind === 'game_account' || f.game !== null;
  const parsed = parseTaka(amount);
  const itemRefund = parsed.ok ? String(parsed.poisha) : null;
  const preview = async () => {
    setPreviewError(null);
    setPartial(null);
    if (!itemRefund) {
      setPreviewError(t('staff.dispute.amount_invalid'));
      return;
    }
    try {
      const r = (await api.get(`/staff/disputes/${encodeURIComponent(f.dispute.id)}/outcome-preview?itemRefund=${itemRefund}`)) as Outcomes;
      setPartial(r.partialRefund);
    } catch (e) {
      setPreviewError(staffError(e, t, lang));
    }
  };
  const split =
    outcome === 'release'
      ? f.outcomes.release
      : outcome === 'full_refund' || outcome === 'refund_after_return'
        ? f.outcomes.fullRefund
        : outcome === 'partial_refund' && partial && partial.itemRefund === itemRefund
          ? partial
          : null;
  const valid = outcome !== '' && (outcome !== 'partial_refund' || split !== null) && (outcome !== 'refund_after_return' || payer !== '');
  const options: [Outcome, string][] = [
    ['release', t('staff.outcome.release')],
    ['full_refund', t('staff.outcome.full_refund')],
    ['partial_refund', t('staff.outcome.partial_refund')],
    ...(game ? [] : [['refund_after_return', t('staff.outcome.refund_after_return')] as [Outcome, string]]),
  ];
  return (
    <Action
      title={t('staff.dispute.decide_title')}
      button={t('staff.dispute.decide_button')}
      t={t}
      lang={lang}
      consequence={f.dispute.fourEyes ? t('staff.dispute.four_eyes') : t('staff.dispute.decide_consequence')}
      minReason={20}
      valid={valid}
      invalidText={t('staff.dispute.decide_incomplete')}
      run={(reason) =>
        api.post(`/staff/disputes/${encodeURIComponent(f.dispute.id)}/decision`, {
          outcome,
          reason,
          ...(outcome === 'partial_refund' ? { itemRefund } : {}),
          ...(outcome === 'refund_after_return' ? { returnPayer: payer } : {}),
        })
      }
      done={(r) => t((r as { status: string }).status === 'proposed' ? 'staff.dispute.proposed' : 'staff.dispute.decided')}
      onDone={() => void queryClient.invalidateQueries({ queryKey: caseKey(f.dispute.id) })}
    >
      <Choice
        legend={t('staff.dispute.outcome')}
        name="outcome"
        value={outcome}
        options={options}
        onChange={(v) => {
          setOutcome(v);
          setPartial(null);
        }}
      />
      {outcome === 'partial_refund' && (
        <div className={styles.field}>
          <Field id="item-refund" label={t('staff.dispute.amount', { max: money(f.outcomes.itemPrice) })}>
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setPartial(null);
                }}
              />
            )}
          </Field>
          <p>
            <Button variant="secondary" type="button" onClick={() => void preview()}>
              {t('staff.dispute.show_split')}
            </Button>
          </p>
          {previewError && <FormMessage kind="error">{previewError}</FormMessage>}
        </div>
      )}
      {outcome === 'refund_after_return' && (
        <Choice
          legend={t('staff.dispute.return_payer')}
          name="payer"
          value={payer}
          options={[
            ['buyer', t('staff.party.buyer')],
            ['seller', t('staff.party.seller')],
          ]}
          onChange={setPayer}
        />
      )}
      {split && (
        <p className={styles.split} role="status">
          {t('staff.dispute.split', { refunded: money(split.refunded), payout: money(split.sellerPayout) })}
        </p>
      )}
      {f.dispute.fourEyes && (
        <p>
          <strong>{t('staff.dispute.four_eyes')}</strong>
        </p>
      )}
    </Action>
  );
}
