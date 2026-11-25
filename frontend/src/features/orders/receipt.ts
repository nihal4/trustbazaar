// The receipt of an order, as a file the buyer can keep (U10-23). It is built in the browser from the order's own view: the item, the lines, the total,
// the day it was paid and the order number. It is a small self-contained HTML page (it opens and prints anywhere); it is only for an order that has been
// paid. Text only: every value is escaped (SEC-INP-03).
import { formatDateTime } from '../../lib/time.js';
import { formatMoney } from '../../lib/money.js';
import type { Lang } from '../../shared/language/lang';
import type { T } from '../../shared/language/catalogue';
import type { OrderView } from './model';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A receipt exists once the payment has been made and was not refunded in full. */
export const hasReceipt = (o: OrderView): boolean => o.paidAt !== null && o.status !== 'awaiting_payment';

export function receiptFileName(o: OrderView): string {
  return `TrustBazaar-receipt-${o.id.slice(0, 8)}.html`;
}

export function buildReceipt(o: OrderView, t: T, lang: Lang, seller: string | null): string {
  const money = (p: string) => formatMoney(BigInt(p), lang, { decimals: 'always' });
  const rows: [string, string][] = [
    [t('receipt.order'), o.id],
    [t('receipt.item'), o.listing.title],
    ...(seller ? [[t('receipt.seller'), seller] as [string, string]] : []),
    [t('receipt.quantity'), String(o.quantity)],
    [t('receipt.item_price'), money(o.itemPrice)],
    [t('receipt.delivery'), money(o.deliveryFee)],
    [t('receipt.paid_on'), o.paidAt ? formatDateTime(Date.parse(o.paidAt), lang) : ''],
  ];
  const body = rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t('receipt.title'))} ${esc(o.id.slice(0, 8))}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem;color:#111}h1{font-size:1.5rem;margin:0}p.sub{margin:.25rem 0 1.5rem;color:#555}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.625rem 0;border-top:1px solid #ccc;vertical-align:top}th{width:40%;font-weight:600;color:#333}.total td,.total th{border-top:2px solid #111;font-size:1.25rem}p.note{margin-top:1.5rem;color:#555;font-size:.875rem}</style></head>
<body><h1>TrustBazaar</h1><p class="sub">${esc(t('receipt.title'))}</p>
<table><tbody>${body}<tr class="total"><th scope="row">${esc(t('receipt.total'))}</th><td>${esc(money(o.total))}</td></tr></tbody></table>
<p class="note">${esc(t('receipt.note'))}</p></body></html>`;
}

/** Saves the receipt as a file (a download of a blob made here; nothing is sent anywhere). */
export function downloadReceipt(o: OrderView, t: T, lang: Lang, seller: string | null): void {
  const url = URL.createObjectURL(new Blob([buildReceipt(o, t, lang, seller)], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = receiptFileName(o);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
