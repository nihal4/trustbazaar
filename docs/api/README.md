# The HTTP API

`openapi.json` is the OpenAPI 3.1 document of the backend's HTTP API (IF-COM-04, NFR-MNT-05). **It is generated from the code; do not edit it by hand.**

What it is made from:

| In the document | Comes from |
|---|---|
| every path, method and operation | the controllers' own routes (`backend/test/support/routes.ts`), so a route cannot be missing |
| `x-access`, `security` | the policy decorator of the route: `@Public`, `@SignedIn`, `@Verified`, `@Staff` or a credential |
| `x-step-up`, `x-rate-limit` | `@StepUp(...)` and `@RateLimit(...)` |
| request body and query parameters | the class-validator rules of the DTO class (type, format, length, enum, optional or required) |
| `summary`, `description` | the doc comment above the controller method; the property comments of a DTO |

Every path is under `/api/v1`. A request from a browser that changes state also carries the `X-CSRF-Token` header (the session cookies are in `components.securitySchemes`). Every refusal is a problem document (`application/problem+json`).

**Not described yet:** the shape of a successful answer. The services return plain objects, so the document says "the shape of the answer is not described yet" under each success status. Typing the answers is the next step if a typed client is wanted.

## Keeping it current

`backend/test/api/openapi.spec.ts` starts the backend, generates the document and compares it with this file: **the integration job fails when the file is out of date**, and when a route has no doc comment. After adding or changing a route:

```sh
cd backend
UPDATE_OPENAPI=1 npm run test:integration -- test/api/openapi.spec.ts   # needs PostgreSQL and Redis, as the integration job
git add ../docs/api/openapi.json
```

## Adding a route

1. Write the handler with its policy decorator (a route without one cannot be reached).
2. Put a doc comment above it: one sentence that begins with the requirement it serves when there is one (`/** FR-FIX-01: ... */`).
3. Describe the request with a DTO class and class-validator decorators, with a comment on each property worth one.
4. Regenerate the document as above.
