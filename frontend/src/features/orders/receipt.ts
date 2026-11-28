// The receipt of an order, as a file the buyer can keep (U10-23). It is built in the browser from the order's own view: the item, the lines, the total, the
// day it was paid and the order number. It is one self-contained HTML page (the logo is inlined, the fonts are the system's, it opens and prints anywhere,
// on A4 or a phone) and exists only for an order that has been paid. Text only: every value is escaped (SEC-INP-03).
import { formatDateTime } from '../../lib/time.js';
import { formatMoney } from '../../lib/money.js';
import logoEn from '../../shared/brand/trustbazaar.svg?raw';
import logoBn from '../../shared/brand/trustbazaar-bn.svg?raw';
import type { Lang } from '../../shared/language/lang';
import type { T } from '../../shared/language/catalogue';
import type { OrderView } from './model';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A receipt exists once the payment has been made. */
export const hasReceipt = (o: OrderView): boolean => o.paidAt !== null && o.status !== 'awaiting_payment';

export function receiptFileName(o: OrderView): string {
  return `TrustBazaar-receipt-${o.id.slice(0, 8)}.html`;
}

export function buildReceipt(o: OrderView, t: T, lang: Lang, party: string | null): string {
  const money = (p: string) => formatMoney(BigInt(p), lang, { decimals: 'always' });
  const paidOn = o.paidAt ? formatDateTime(Date.parse(o.paidAt), lang) : '';
  const number = o.id.slice(0, 8).toUpperCase();
  const meta: [string, string][] = [
    [t('receipt.number'), number],
    [t('receipt.paid_on'), paidOn],
    ...(party ? [[t(o.role === 'buyer' ? 'receipt.seller' : 'receipt.buyer'), party] as [string, string]] : []),
    [t('receipt.delivery_method'), o.fulfilment ? t(`receipt.method.${o.fulfilment}`) : '—'],
  ];
  const lines: [string, string][] = [
    [o.listing.title + (o.quantity > 1 ? ' × ' + o.quantity : ''), money(o.itemPrice)],
    [t('receipt.delivery'), money(o.deliveryFee)],
  ];
  const metaHtml = meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  const lineHtml = lines.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${esc(v)}</td></tr>`).join('');
  const logo = lang === 'bn' ? logoBn : logoEn;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t('receipt.title'))} ${esc(number)} · TrustBazaar</title>
<style>
@page{size:A4;margin:16mm}
*{box-sizing:border-box}
body{margin:0;background:#eef1ef;color:#0f1720;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{max-width:44rem;margin:2rem auto;background:#fff;padding:2.5rem 2.5rem 2rem;border-top:6px solid #ff6b35}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;flex-wrap:wrap}
.logo{width:11rem;line-height:0}.logo svg{width:100%;height:auto}
.kind{text-align:right}.kind h1{margin:0;font-size:1.75rem;letter-spacing:-.02em}.kind p{margin:.125rem 0 0;color:#5a6672;font-size:.9375rem}
.paid{display:inline-block;margin-top:.5rem;padding:.125rem .625rem;border:1.5px solid #15803d;color:#15803d;font-weight:700;font-size:.8125rem;letter-spacing:.06em;text-transform:uppercase}
dl.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:1rem 1.5rem;margin:2rem 0;padding:1.25rem 0;border-top:1px solid #d5dbd8;border-bottom:1px solid #d5dbd8}
dl.meta dt{color:#5a6672;font-size:.8125rem;letter-spacing:.04em;text-transform:uppercase}dl.meta dd{margin:.125rem 0 0;font-weight:600;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse}th{text-align:left;color:#5a6672;font-size:.8125rem;letter-spacing:.04em;text-transform:uppercase;padding:.5rem 0;border-bottom:1px solid #0f1720}th.n,td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td{padding:.75rem 0;border-bottom:1px solid #e3e8e5;vertical-align:top}
.total td{border-bottom:0;border-top:2px solid #0f1720;padding-top:1rem;font-size:1.5rem;font-weight:700}
.note{margin:2rem 0 0;padding-top:1rem;border-top:1px solid #d5dbd8;color:#5a6672;font-size:.875rem}
.note p{margin:.25rem 0}
@media print{body{background:#fff}.sheet{margin:0;max-width:none;padding:0;border-top-width:6px;padding-top:1.5rem}}
@media(max-width:34rem){.sheet{margin:0;padding:1.5rem 1.25rem}.kind{text-align:left}}
</style></head>
<body><main class="sheet">
<header class="top"><div class="logo" role="img" aria-label="TrustBazaar">${logo}</div>
<div class="kind"><h1>${esc(t('receipt.title'))}</h1><p>${esc(t('receipt.number'))} ${esc(number)}</p><span class="paid">${esc(t('receipt.paid'))}</span></div></header>
<dl class="meta">${metaHtml}</dl>
<table><thead><tr><th>${esc(t('receipt.description'))}</th><th class="n">${esc(t('receipt.amount'))}</th></tr></thead>
<tbody>${lineHtml}<tr class="total"><td>${esc(t('receipt.total'))}</td><td class="n">${esc(money(o.total))}</td></tr></tbody></table>
<footer class="note"><p>${esc(t('receipt.note'))}</p><p>${esc(t('receipt.fee_note'))}</p><p>${esc(t('receipt.simulated'))}</p></footer>
</main></body></html>`;
}

/** Saves the receipt as a file (a download of a blob made here; nothing is sent anywhere). */
export function downloadReceipt(o: OrderView, t: T, lang: Lang, party: string | null): void {
  const url = URL.createObjectURL(new Blob([buildReceipt(o, t, lang, party)], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = receiptFileName(o);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
