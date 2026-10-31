import { ESLint } from 'eslint';
import * as path from 'path';

// DC-1 and the module boundaries of docs/design/09_integration.pdf, section 2.1, as enforced by
// .eslintrc.js. Each case lints one import as if it were written in the given file.
const backendRoot = path.resolve(__dirname, '..');
const eslint = new ESLint({
  cwd: backendRoot,
  // The boundary rule needs no type information; skip the TypeScript project for virtual files.
  // The cast: the installed type definitions describe ESLint 9's flat config, the project runs ESLint 8.
  overrideConfig: { parserOptions: { project: null } } as unknown as ESLint.Options['overrideConfig'],
});

async function boundaryErrors(file: string, importPath: string): Promise<string[]> {
  const [result] = await eslint.lintText(`import '${importPath}';\n`, {
    filePath: path.join(backendRoot, file),
  });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

describe('module import boundaries', () => {
  it.each([
    ['src/modules/listings/services/bid.service.ts', '../../orders/ports'],
    ['src/modules/listings/services/bid.service.ts', '../../orders/ports/escrow-commands'],
    ['src/modules/listings/listings.module.ts', '../orders/orders.module'],
    ['src/modules/listings/listings.module.ts', '../orders/ports'],
    ['src/modules/listings/services/bid.service.ts', 'src/modules/orders/ports'],
    ['src/modules/listings/services/bid.service.ts', '../db/bid.entity'],
    ['src/modules/listings/services/bid.service.ts', '../../../kernel/kernel.module'],
  ])('DC-1 %s may import %s', async (file, importPath) => {
    expect(await boundaryErrors(file, importPath)).toEqual([]);
  });

  it.each([
    ['src/modules/listings/services/bid.service.ts', '../../orders/services/escrow.service'],
    ['src/modules/listings/services/bid.service.ts', '../../orders/db/escrow.entity'],
    ['src/modules/listings/listings.module.ts', '../orders/services/escrow.service'],
    ['src/modules/listings/services/bid.service.ts', 'src/modules/orders/db/escrow.entity'],
    ['src/modules/game-accounts/services/handover.service.ts', '../../identity/http/auth.controller'],
    ['src/modules/trust/jobs/expiry.job.ts', '../../../modules/chat/adapters/sms.adapter'],
  ])('DC-1 %s may not import %s', async (file, importPath) => {
    const errors = await boundaryErrors(file, importPath);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/DC-1: import another unit only through its ports/);
  });

  it.each([
    ['src/kernel/kernel.module.ts', '../modules/orders/orders.module'],
    ['src/kernel/outbox/dispatcher.ts', '../../modules/chat/ports'],
  ])('the kernel %s may not import the unit %s', async (file, importPath) => {
    expect(await boundaryErrors(file, importPath)).toHaveLength(1);
  });
});
