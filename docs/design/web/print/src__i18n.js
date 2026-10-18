// TrustBazaar web client - message catalogues (Unit 8 reference module).
// Messages are plain text with {name} placeholders. No catalogue entry may contain markup:
// everything is rendered as text (SEC-INP-03).

/** @typedef {'en'|'bn'} Lang */

/**
 * @param {Record<string, string>} catalogue
 * @param {{strict?: boolean}} [o] strict: throw on a missing key or variable (tests and development)
 */
export function createT(catalogue, { strict = false } = {}) {
  /** @param {string} key @param {Record<string, string>} [vars] */
  return function t(key, vars = {}) {
    const msg = catalogue[key];
    if (msg === undefined) {
      if (strict) throw new Error(`missing message ${key}`);
      return key;
    }
    return msg.replace(/\{(\w+)\}/g, (_, name) => {
      if (!(name in vars)) {
        if (strict) throw new Error(`message ${key} needs {${name}}`);
        return '';
      }
      return vars[name];
    });
  };
}

/** @param {string} msg */
export function placeholders(msg) {
  return [...msg.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}
