import { compose } from './direct-messages';
import { esc, renderEmailHtml } from './email-layout';

// FR-NTF-09 (U10-25): every e-mail also goes as HTML in one layout, with no remote files and every inserted value escaped.
describe('the HTML of an e-mail', () => {
  it('FR-NTF-09 a code message has the code in a box, both languages, the text logotype and no remote picture, script or tracking', () => {
    const { html, text, subject } = compose('otp_signin_email', { code: '482913', minutes: '10' });
    expect(html).toContain('4 8 2 9 1 3');
    expect(html).toContain('lang="bn"');
    expect(html).toContain('lang="en"');
    expect(html).toContain('Trust</span><span');
    expect(html).not.toMatch(/<img|<script|<link|<iframe|src=|url\(|@import/i);
    expect(text).toContain('482913');
    expect(subject).not.toContain('482913');                       // never in the subject line
  });

  it('FR-NTF-09 a link message has a button and the address as a link; only http and https addresses become links', () => {
    const { html } = compose('email_verify', { link: 'https://tb.example/verify-email#token=abc', hours: '24' });
    expect(html).toContain('href="https://tb.example/verify-email#token=abc"');
    expect(html).toContain('Open / খুলুন');
    const bad = renderEmailHtml({ subject: 'S / T', bn: 'x', en: 'y', vars: { link: 'javascript:alert(1)' } });
    expect(bad).not.toContain('href="javascript');
  });

  it('FR-NTF-09 every inserted value is escaped, so a name or a parameter cannot add markup', () => {
    expect(esc(`<img src=x onerror="alert('x')">&`)).toBe('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
    const html = renderEmailHtml({ subject: 'A / <b>B</b>', bn: '<script>alert(1)</script>', en: '"quoted" & <i>', vars: { code: '12"><x' } });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>B</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('12"><x');                          // a code with markup is not shown as a code
  });
});
