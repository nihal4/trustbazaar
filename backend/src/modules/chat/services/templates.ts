// Rendering a notification in its recipient's language (docs/design/06_chat_notifications.pdf section 7.1).
// Notifications store the template and its parameters, never rendered text, so the text is made here when a
// notice is shown or sent: {name} is replaced by the parameter; numbers are written with the language's digits
// and grouping (amounts are passed in taka). A parameter the template names but the notice lacks stays empty.
export type Language = 'bn' | 'en';

export interface TemplateTexts {
  titleEn: string;
  titleBn: string;
  bodyEn: string;
  bodyBn: string;
}

const NUMBER = { bn: new Intl.NumberFormat('bn-BD', { maximumFractionDigits: 2 }), en: new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }) };

export function render(t: TemplateTexts, params: Record<string, unknown>, lang: Language): { title: string; body: string } {
  const fill = (text: string) =>
    text.replace(/\{([a-z_]+)\}/g, (_, k: string) => {
      const v = params[k];
      if (typeof v === 'number') return NUMBER[lang].format(v);
      return v === undefined || v === null ? '' : String(v);
    });
  return lang === 'en' ? { title: fill(t.titleEn), body: fill(t.bodyEn) } : { title: fill(t.titleBn), body: fill(t.bodyBn) };
}

/** Amounts are kept in poisha (Unit 2); notices show taka. */
export const taka = (poisha: unknown): number => Number(BigInt(String(poisha ?? 0))) / 100;
