// The OpenAPI document of the HTTP API, generated from the code (IF-COM-04, NFR-MNT-05; U11-11). Nothing in it is written by hand:
//   - the paths, methods and handlers are the controllers' own routes (test/support/routes.ts), so a route cannot be missing from it;
//   - who may call a route (public, signed in, staff, a credential), its step-up action and its rate limit are the policy decorators' metadata;
//   - the request body and the query are described from the class-validator rules of the DTO classes (type, format, length, enum, optional);
//   - the summary and description of an operation or a property are the doc comments of the controller method or the DTO property.
// What it does not describe yet: the shape of a successful answer (the services return plain objects); the document says so. The checked-in copy is docs/api/openapi.json,
// kept current by test/api/openapi.spec.ts (`UPDATE_OPENAPI=1 npm run test:integration -- test/api/openapi.spec.ts` rewrites it).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { getMetadataStorage } from 'class-validator';
import * as ts from 'typescript';
import { STAFF_COOKIES, USER_COOKIES } from '../../src/modules/identity/security/cookies';
import type { Policy } from '../../src/kernel/http/policies';
import { type Route, routesOf } from './routes';

type Json = Record<string, unknown>;

/** The doc comments of the controllers and DTOs, by 'Class' and 'Class.member'. */
export function sourceDocs(root = join(__dirname, '..', '..', 'src')): Map<string, string> {
  const docs = new Map<string, string>();
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(controller|dto)\.ts$/.test(name)) files.push(path);
    }
  };
  walk(root);
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const textOf = (node: ts.Node): string | undefined => {
      const parts = ts
        .getJSDocCommentsAndTags(node)
        .filter(ts.isJSDoc)
        .map((d) => ts.getTextOfJSDocComment(d.comment) ?? '');
      const text = parts.join('\n').trim();
      return text || undefined;
    };
    sf.forEachChild((n) => {
      if (!ts.isClassDeclaration(n) || !n.name) return;
      const cls = n.name.text;
      const own = textOf(n);
      if (own) docs.set(cls, own);
      for (const m of n.members) {
        if (!m.name || !(ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m))) continue;
        const text = textOf(m);
        if (text) docs.set(`${cls}.${m.name.getText(sf)}`, text);
      }
    });
  }
  return docs;
}

const ENDPOINT_PARAM = /:(\w+)/g;

/** A class-validator DTO as a JSON schema: each property's type, format, limits and enum from its rules; optional unless it must be present. */
function schemaOf(dto: new (...a: unknown[]) => unknown, docs: Map<string, string>): Json {
  const metas = getMetadataStorage().getTargetValidationMetadatas(dto, '', false, false);
  const byProperty = new Map<string, typeof metas>();
  for (const m of metas) byProperty.set(m.propertyName, [...(byProperty.get(m.propertyName) ?? []), m]);
  const properties: Record<string, Json> = {};
  const required: string[] = [];
  for (const [prop, ms] of [...byProperty].sort(([a], [b]) => a.localeCompare(b))) {
    const has = (name: string) => ms.find((m) => m.name === name);
    const arg = (name: string, i = 0) => has(name)?.constraints?.[i];
    const designed = Reflect.getMetadata('design:type', dto.prototype, prop) as unknown;
    const p: Json = {};
    if (has('isInt')) p.type = 'integer';
    else if (has('isNumber')) p.type = 'number';
    else if (has('isBoolean')) p.type = 'boolean';
    else if (has('isArray')) p.type = 'array';
    else if (has('isString') || has('isEmail') || has('isUuid') || has('isISO8601') || has('isUrl') || has('matches') || has('isIn') || has('isEnum'))
      p.type = 'string';
    else if (designed === Number) p.type = 'number';
    else if (designed === Boolean) p.type = 'boolean';
    else if (designed === Array) p.type = 'array';
    else if (designed === String) p.type = 'string';
    else p.type = 'object';
    if (has('isEmail')) p.format = 'email';
    if (has('isUuid')) p.format = 'uuid';
    if (has('isISO8601')) p.format = 'date-time';
    if (has('isUrl')) p.format = 'uri';
    if (has('isIn')) p.enum = arg('isIn');
    if (has('isEnum')) p.enum = Object.values(arg('isEnum') as object);
    if (has('minLength')) p.minLength = arg('minLength');
    if (has('maxLength')) p.maxLength = arg('maxLength');
    if (has('length')) {
      p.minLength = arg('length', 0);
      if (arg('length', 1) !== undefined) p.maxLength = arg('length', 1);
    }
    if (has('matches')) p.pattern = String((arg('matches') as RegExp).source);
    if (has('min')) p.minimum = arg('min');
    if (has('max')) p.maximum = arg('max');
    const doc = docs.get(`${dto.name}.${prop}`);
    if (doc) p.description = doc;
    properties[prop] = p;
    if (!ms.some((m) => m.type === 'conditionalValidation')) required.push(prop);
  }
  const out: Json = { type: 'object', properties };
  if (required.length) out.required = required;
  const doc = docs.get(dto.name);
  if (doc) out.description = doc;
  return out;
}

/** What a route's policy means for a caller, in the security vocabulary of the document. */
function access(policy: Policy | undefined): { security: Json[]; text: string } {
  switch (policy?.kind) {
    case 'public':
      return { security: [], text: 'public: anyone, including guests' };
    case 'signed-in':
      return { security: [{ userSession: [], csrf: [] }], text: 'signed in: a member with an active or suspended account' };
    case 'verified':
      return {
        security: [{ userSession: [], csrf: [] }],
        text: `verified: KYC and e-mail verified, an active account${policy.action ? `, not restricted from "${policy.action}"` : ''}`,
      };
    case 'staff':
      return { security: [{ staffSession: [], csrf: [] }], text: `staff: ${policy.roles.join(' or ')}` };
    case 'credential':
      return { security: [], text: `credential: not a session, verified by the endpoint itself (${policy.credential})` };
    default:
      return { security: [], text: 'no policy declared' };
  }
}

const firstSentence = (text: string): string => {
  const line = text.split('\n')[0];
  const cut = /^(.*?[.!?])(\s|$)/.exec(line);
  return (cut ? cut[1] : line).slice(0, 200);
};

/** The OpenAPI 3.1 document of the running app's routes. */
export function buildOpenApi(app: INestApplication, docs: Map<string, string> = sourceDocs()): Json {
  const routes = routesOf(app);
  const schemas: Record<string, Json> = {};
  const paths: Record<string, Record<string, Json>> = {};
  const tags = new Set<string>();
  const operationIds = new Set<string>();
  for (const r of routes) {
    const path = r.path.replace(ENDPOINT_PARAM, '{$1}');
    const tag = r.controller.name.replace(/Controller$/, '');
    tags.add(tag);
    const operationId = `${r.controller.name}_${r.methodName}`;
    if (operationIds.has(operationId)) throw new Error(`operationId ${operationId} is not unique (a handler with two routes)`);
    operationIds.add(operationId);
    const doc = docs.get(`${r.controller.name}.${r.methodName}`);
    const { security, text } = access(r.policy);
    const parameters: Json[] = [];
    for (const name of [...r.path.matchAll(ENDPOINT_PARAM)].map((m) => m[1])) parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } });
    for (const a of r.args.filter((x) => x.kind === 'header' && x.name))
      parameters.push({ name: a.name, in: 'header', required: false, schema: { type: 'string' } });
    let requestBody: Json | undefined;
    for (const a of r.args) {
      const cls = a.type as (new (...x: unknown[]) => unknown) | undefined;
      if (!cls || typeof cls !== 'function' || [String, Number, Boolean, Object, Array].includes(cls as never)) continue;
      if (a.kind === 'body') {
        schemas[cls.name] ??= schemaOf(cls, docs);
        requestBody = { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${cls.name}` } } } };
      } else if (a.kind === 'query') {
        const s = schemaOf(cls, docs) as { properties: Record<string, Json>; required?: string[] };
        for (const [name, schema] of Object.entries(s.properties)) parameters.push({ name, in: 'query', required: (s.required ?? []).includes(name), schema });
      }
    }
    const op: Json = {
      operationId,
      tags: [tag],
      summary: doc ? firstSentence(doc) : `${r.methodName} (${r.controller.name})`,
      ...(doc ? { description: doc } : {}),
      'x-access': text,
      ...(r.stepUp ? { 'x-step-up': r.stepUp } : {}),
      ...(r.rateLimit ? { 'x-rate-limit': r.rateLimit } : {}),
      security,
      ...(parameters.length ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses: {
        [String(r.httpCode ?? (r.method === 'POST' ? 201 : 200))]: { description: 'Success. The shape of the answer is not described yet.' },
        default: {
          description: 'A problem document (RFC 9457): type, title, status, correlationId and field errors.',
          content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
        },
      },
    };
    (paths[path] ??= {})[r.method.toLowerCase()] = op;
  }
  schemas.Problem = {
    type: 'object',
    description: 'The answer to every refusal and failure (kernel/http/problems.ts).',
    properties: {
      type: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'integer' },
      correlationId: { type: 'string' },
      errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, reason: { type: 'string' } } } },
    },
  };
  const sorted = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return {
    openapi: '3.1.0',
    info: {
      title: 'TrustBazaar API',
      version: (JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }).version,
      description:
        'Generated from the code (IF-COM-04, NFR-MNT-05): do not edit by hand; run `UPDATE_OPENAPI=1 npm run test:integration -- test/api/openapi.spec.ts`. Every path is under /api/v1. A route declares who may call it (x-access); ' +
        'a state-changing request from a browser also carries the X-CSRF-Token header. The shape of a successful answer is not described yet.',
    },
    servers: [{ url: '/api/v1' }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths: Object.fromEntries(
      Object.entries(paths)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([p, ops]) => [p, sorted(ops)]),
    ),
    components: {
      securitySchemes: {
        userSession: { type: 'apiKey', in: 'cookie', name: USER_COOKIES.access, description: "A member's session cookie." },
        staffSession: {
          type: 'apiKey',
          in: 'cookie',
          name: STAFF_COOKIES.access,
          description: "A staff member's session cookie (separate from the member's, I-51).",
        },
        csrf: {
          type: 'apiKey',
          in: 'header',
          name: 'X-CSRF-Token',
          description: 'Equal to the CSRF cookie; required on state-changing requests that carry a session.',
        },
      },
      schemas: sorted(schemas),
    },
  };
}

export type { Route };
