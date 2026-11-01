import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The client-side rules of docs/design/08_frontend.pdf (sections 3.2 and 8.2), as enforced by
// eslint.config.js. Each case lints a few lines as if they were written in the given file.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: root });

async function errors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(root, file) });
  return result.messages.filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message}`);
}

describe('text only', () => {
  it('SEC-INP-03 dangerouslySetInnerHTML is refused', async () => {
    const found = await errors(
      'src/features/chat/Message.tsx',
      'export const M = ({ t }: { t: string }) => <p dangerouslySetInnerHTML={{ __html: t }} />;\n',
    );
    expect(found).toEqual([expect.stringMatching(/^react\/no-danger/)]);
  });

  it.each([
    ['el.innerHTML = text;'],
    ['el.outerHTML = text;'],
    ["el.insertAdjacentHTML('beforeend', text);"],
    ['document.write(text);'],
  ])('SEC-INP-03 %s is refused', async (line) => {
    const found = await errors('src/shared/Show.ts', `export function show(el: HTMLElement, text: string) { ${line} }\n`);
    expect(found).toEqual([expect.stringMatching(/SEC-INP-03/)]);
  });

  it('SEC-INP-03 textContent is allowed', async () => {
    expect(await errors('src/shared/Show.ts', 'export function show(el: HTMLElement, t: string) { el.textContent = t; }\n')).toEqual([]);
  });
});

describe('browser storage', () => {
  it.each([
    ["localStorage.setItem('token', t);"],
    ["window.localStorage.setItem('token', t);"],
    ["sessionStorage.setItem('draft', t);"],
  ])('SEC-SES-03 %s is refused', async (line) => {
    const found = await errors('src/features/account/session.ts', `export function keep(t: string) { ${line} }\n`);
    expect(found).toEqual([expect.stringMatching(/SEC-SES-03/)]);
  });

  it('SEC-SES-03 the language module may keep the language choice', async () => {
    expect(await errors('src/shared/language/storage.ts', "export const k = () => localStorage.getItem('tb-lang');\n")).toEqual([]);
  });

  it('SEC-SES-03 the rest of the shell may not use browser storage', async () => {
    const found = await errors('src/shared/language/Language.tsx', "export const k = () => localStorage.getItem('tb-lang');\n");
    expect(found).toEqual([expect.stringMatching(/SEC-SES-03/)]);
  });
});

describe('import boundaries', () => {
  it.each([
    ['src/features/orders/OrderPage.tsx', '../../lib/money.js'],
    ['src/features/orders/OrderPage.tsx', '../../shared/Money'],
    ['src/features/orders/OrderPage.tsx', './useOrder'],
    ['src/entries/staff.tsx', '../staff/queues/Queues'],
    ['src/staff/cases/CaseFile.tsx', '../../shared/ConfirmDialog'],
  ])('NFR-MNT-07 Unit 8 section 3.2: %s may import %s', async (file, path) => {
    expect(await errors(file, `import '${path}';\n`)).toEqual([]);
  });

  it.each([
    ['src/features/orders/OrderPage.tsx', '../checkout/useCheckout'],
    ['src/features/orders/OrderPage.tsx', '../../features/chat/Thread'],
    ['src/features/game/screens/Offer.tsx', '../../listings/ListingCard'],
  ])('NFR-MNT-07 Unit 8 section 3.2: %s may not import %s', async (file, path) => {
    expect(await errors(file, `import '${path}';\n`)).toEqual([
      expect.stringMatching(/a feature may not import another feature/),
    ]);
  });

  it.each([
    ['src/entries/app.tsx', '../staff/queues/Queues'],
    ['src/features/account/Profile.tsx', '../../staff/admin/Users'],
    ['src/shared/Header.tsx', '../staff/cases/CaseFile'],
  ])('FR-OPS-04 %s may not import staff code %s', async (file, path) => {
    expect(await errors(file, `import '${path}';\n`)).toEqual([expect.stringMatching(/FR-OPS-04/)]);
  });

  it.each([['react'], ['react-dom/client'], ['../features/game/Credentials'], ['../shared/Money']])(
    'SEC-GAM-03 the credentials entry may not import %s',
    async (path) => {
      expect(await errors('src/entries/secure.tsx', `import '${path}';\n`)).toEqual([
        expect.stringMatching(/SEC-GAM-03/),
      ]);
    },
  );

  it('SEC-GAM-03 the credentials entry may import the reference modules', async () => {
    expect(await errors('src/entries/secure.tsx', "import '../lib/redirect.js';\n")).toEqual([]);
  });
});
