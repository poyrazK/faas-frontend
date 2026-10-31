# Contract guard

Operator routes (`/v1/admin/*`) are not in apid's OpenAPI spec, so the
console's types are written by hand. This guard compares them with apid's Go
source and fails CI when they drift apart.

```bash
git clone --depth 1 https://github.com/poyrazK/faas .backend   # or point at any checkout
npm run contract -- --backend .backend
```

## What it checks

| Check | Fails when |
| --- | --- |
| Response types tagged `@go pkg.Type` | the console reads a field the Go struct no longer sends, or the Go type is gone |
| Request bodies in functions tagged `@goBody pkg.Type` | the console sends a field the Go struct does not have (apid decodes with `DisallowUnknownFields`, so this is a 400) |
| Every `/v1/…` path the console calls | apid has no route for the path, or not for that HTTP method |

Warnings (not failures): a field the console treats as always present that Go
marks `omitempty` or as a pointer, and request bodies without a `@goBody` tag.
`--verbose` also lists apid fields the console does not read yet.

It reads `pkg/api`, `pkg/apid/apidserver`, `pkg/state` and `pkg/platformflags`.
CI runs it on every PR and daily against apid's `main`
(`.github/workflows/contract.yml`).

## Tagging

```ts
/** @go api.ObsNodeRow */
export interface ObsNodeRow { … }

/** @goBody apidserver.runtimeConfigPatchRequest */
export const updateOperatorRuntimeConfig = (…) =>
  request(`/v1/admin/config/${key}`, { method: 'PATCH', body: JSON.stringify({ … }) });
```

- Find the Go type a handler serializes or decodes (`writeJSON(w, …, X)` /
  `decodeJSON(r, &req)`); unexported handler-local structs are fine
  (`apidserver.issueCreditPayload`).
- `npm run contract -- --backend .backend --suggest` proposes Go types for
  untagged interfaces and bodies by matching field names. Check the handler
  before accepting a suggestion: identical field sets can be coincidence.
- `@contractIgnore field_a field_b` skips fields the console derives itself.
- `@goBody -` marks a body with no request struct (say why after the dash).

## When it fails

The message names the console file and line. Fix the console type to match
apid, or, if apid is wrong, fix apid. Don't silence a failure with
`@contractIgnore` unless the field really is client-side.
