import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApi } from '../support/openapi';
import { routesOf } from '../support/routes';
import { startApp, TestApp } from '../support/app';

// IF-COM-04 and NFR-MNT-05: the HTTP API is documented in OpenAPI format, generated from the code. The document is docs/api/openapi.json; this test regenerates it from the running app and
// fails when the checked-in copy is out of date (UPDATE_OPENAPI=1 rewrites it), so the documentation cannot drift from the routes.
const FILE = join(__dirname, '..', '..', '..', 'docs', 'api', 'openapi.json');

type Operation = {
  operationId: string;
  security: unknown[];
  'x-access': string;
  summary: string;
  description?: string;
  parameters?: { name: string; in: string }[];
  responses: Record<string, unknown>;
};
type Doc = {
  openapi: string;
  servers: { url: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
};

describe('the OpenAPI document (IF-COM-04, NFR-MNT-05)', () => {
  let t: TestApp;
  let doc: Doc;
  beforeAll(async () => {
    t = await startApp();
    doc = buildOpenApi(t.app) as unknown as Doc;
  });
  afterAll(async () => t?.close());

  const operations = () => Object.entries(doc.paths).flatMap(([path, ops]) => Object.entries(ops).map(([method, op]) => ({ path, method, op })));

  it('IF-COM-04 every route of the backend is in the document, once, under the versioned path', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: '/api/v1' }]);
    expect(operations()).toHaveLength(routesOf(t.app).length);
    const ids = operations().map((o) => o.op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('IF-COM-04 every operation says who may call it, and the secured ones name a session scheme that exists', () => {
    const schemes = Object.keys(doc.components.securitySchemes);
    for (const { path, method, op } of operations()) {
      expect([path, method, typeof op['x-access']]).toEqual([path, method, 'string']);
      expect(op['x-access']).not.toBe('no policy declared');
      for (const requirement of op.security) for (const name of Object.keys(requirement as object)) expect(schemes).toContain(name);
    }
    const publicOnes = operations().filter((o) => o.op.security.length === 0).length;
    expect(publicOnes).toBeGreaterThan(0);
    expect(publicOnes).toBeLessThan(operations().length);
  });

  it('IF-COM-04 a path parameter of a route is a required path parameter of its operation', () => {
    for (const { path, op } of operations()) {
      for (const name of [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])) expect(op.parameters?.some((p) => p.name === name && p.in === 'path')).toBe(true);
    }
  });

  it('IF-COM-04 the body of a request is described from the DTO rules: required and optional fields, limits', () => {
    const signIn = doc.components.schemas.SignInDto as {
      required: string[];
      properties: Record<string, { type: string; maxLength?: number; minLength?: number }>;
    };
    expect(signIn.required).toEqual(['login', 'password']);
    expect(signIn.properties.password).toMatchObject({ type: 'string', minLength: 1, maxLength: 256 });
    const mfa = doc.components.schemas.MfaDto as { required: string[]; properties: Record<string, unknown> };
    expect(mfa.required).toEqual(['code']); // `remember` is optional
    expect(Object.keys(mfa.properties)).toEqual(['code', 'remember']);
    expect(doc.paths['/auth/signin'].post.summary).not.toMatch(/\(AuthController\)/); // it has the sentence of its doc comment
  });

  it('IF-COM-04 every operation is described by the doc comment of its handler (a new route comes with its sentence)', () => {
    const undescribed = operations()
      .filter((o) => !o.op.description)
      .map((o) => `${o.method.toUpperCase()} ${o.path}`);
    expect(undescribed).toEqual([]);
  });

  it('NFR-MNT-05 the checked-in document is the one the code generates (UPDATE_OPENAPI=1 rewrites it)', () => {
    const generated = `${JSON.stringify(doc, null, 2)}\n`;
    if (process.env.UPDATE_OPENAPI === '1') writeFileSync(FILE, generated);
    expect(readFileSync(FILE, 'utf8') === generated).toBe(true);
  });
});
