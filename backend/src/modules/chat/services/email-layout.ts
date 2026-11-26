// The HTML of every e-mail the system sends (U10-25; docs/design/10_visual_v3.md): one layout, a light page with a white card, the logotype as text,
// the message in Bangla and in English one under the other, a one-time code in a ruled box and a link as a button. Built from tables and inline styles
// only (mail programs ignore the rest), no pictures or remote files, so nothing is loaded when the mail is opened and nothing is tracked. Every value
// that comes from a parameter is HTML-escaped. The text version of the same message always goes with it.
const INK = '#0b1514';
const MUTED = '#5a6b67';
const LINE = '#dde3e0';
const HOT = '#ff6b35';
const FONT = `'Figtree','Hind Siliguri','Noto Sans Bengali','Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif`;

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A link is shown only if it is an http(s) address; anything else is left as plain text. */
const safeUrl = (u: string): string | null => (/^https?:\/\/[^\s<>"']+$/.test(u) ? u : null);

const paragraph = (raw: string, link: string | null): string => {
  let html = esc(raw);
  if (link) html = html.split(esc(link)).join(`<a href="${esc(link)}" style="color:${HOT};text-decoration:underline;word-break:break-all;">${esc(link)}</a>`);
  return `<p style="margin:0 0 14px 0;font-size:16px;line-height:1.55;color:${INK};">${html}</p>`;
};

export interface EmailParts {
  subject: string;
  /** the filled body in Bangla, then in English */
  bn: string;
  en: string;
  vars: Record<string, string>;
}

export function renderEmailHtml({ subject, bn, en, vars }: EmailParts): string {
  const link = vars.link ? safeUrl(vars.link) : null;
  const code = vars.code && /^[0-9A-Za-z-]{4,12}$/.test(vars.code) ? vars.code : null;
  const codeBox = code
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px 0;"><tr><td align="center" style="border:1px solid ${LINE};border-left:3px solid ${HOT};padding:18px 12px;background:#fbfcfb;">
         <div style="font-size:34px;line-height:1.1;font-weight:700;letter-spacing:10px;color:${INK};font-family:${FONT};">${esc(code.split('').join(' '))}</div>
       </td></tr></table>`
    : '';
  const button = link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 20px 0;"><tr><td style="background:${HOT};"><a href="${esc(link)}" style="display:inline-block;padding:13px 26px;font-size:16px;font-weight:700;color:${INK};text-decoration:none;font-family:${FONT};">${esc(vars.button ?? 'Open')}</a></td></tr></table>`
    : '';
  const block = (lang: string, text: string) => `<div lang="${lang}">${text.split('\n').filter(Boolean).map((p) => paragraph(p, link)).join('')}</div>`;
  return `<!doctype html>
<html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef2f0;font-family:${FONT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(en.split('\n')[0] ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f0;"><tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${LINE};border-top:3px solid ${HOT};">
    <tr><td style="padding:22px 28px 14px 28px;border-bottom:1px solid ${LINE};font-size:24px;font-weight:700;letter-spacing:-0.5px;font-family:${FONT};"><span style="color:${HOT};">Trust</span><span style="color:${INK};">bazaar</span></td></tr>
    <tr><td style="padding:24px 28px 8px 28px;">
      <h1 style="margin:0 0 16px 0;font-size:21px;line-height:1.3;color:${INK};font-family:${FONT};">${esc(subject.split(' / ')[1] ?? subject)}</h1>
      ${codeBox}${button}
      ${block('bn', bn)}
      <div style="border-top:1px solid ${LINE};margin:8px 0 18px 0;"></div>
      ${block('en', en)}
    </td></tr>
    <tr><td style="padding:14px 28px 22px 28px;border-top:1px solid ${LINE};font-size:13px;line-height:1.5;color:${MUTED};">
      <span lang="en">TrustBazaar never asks for your code or password by phone, chat or e-mail.</span><br>
      <span lang="bn">TrustBazaar কখনও ফোন, চ্যাট বা ই-মেইলে আপনার কোড বা পাসওয়ার্ড চায় না।</span>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
