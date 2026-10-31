import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { indexGoTypes, jsonFields, parseRoutes, routeMatches } from './go.mjs';
import { readConsole } from './ts.mjs';
import { compareContract } from './compare.mjs';

const GO = `package api

import "encoding/json"

// NodeRow is what the console renders.
type NodeRow struct {
	ID        string   \`json:"id"\`
	Name      string   \`json:"name"\` // trailing comment
	CPU       *float64 \`json:"cpu_pct,omitempty"\`
	Labels    []string \`json:"labels"\`
	internal  string
	Secret    string   \`json:"-"\`
	Stats     struct {
		Live int \`json:"live"\`
	} \`json:"stats"\`
	Base
}

type Base struct {
	CreatedAt string \`json:"created_at"\`
}

type Empty struct{}

type AfterEmpty struct {
	Seen bool \`json:"seen"\`
}

type (
	Grouped struct {
		Value json.RawMessage \`json:"value"\`
	}
	Alias = NodeRow
)

type PatchRequest struct {
	Value  json.RawMessage \`json:"value"\`
	Reason string          \`json:"reason"\`
}
`;

const SERVER = `package apidserver

func routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/admin/nodes/{name}", s.getNode)
	mux.Handle("PATCH /v1/admin/config/{key}", s.patch)
	mux.HandleFunc("POST /v1/admin/sites/", s.sites)
}
`;

const goFiles = [
  { path: 'pkg/api/types.go', text: GO },
  { path: 'pkg/apid/apidserver/server.go', text: SERVER },
];

describe('Go scanner', () => {
  const index = indexGoTypes(goFiles);

  it('reads json names, omitempty, pointers, embedding and nested structs', () => {
    const fields = jsonFields(index, 'api.NodeRow');
    expect([...fields.keys()].sort()).toEqual(['cpu_pct', 'created_at', 'id', 'labels', 'name', 'stats']);
    expect(fields.get('cpu_pct')).toMatchObject({ omitempty: true, nullable: true });
    expect(fields.get('id')).toMatchObject({ omitempty: false, nullable: false });
  });

  it('keeps reading after a one-line struct{} and inside type ( … ) groups', () => {
    expect(jsonFields(index, 'api.Empty').size).toBe(0);
    expect([...jsonFields(index, 'api.AfterEmpty').keys()]).toEqual(['seen']);
    expect(jsonFields(index, 'api.Grouped').get('value')).toMatchObject({ nullable: true });
    expect(jsonFields(index, 'api.Alias').has('id')).toBe(true);
  });

  it('reads the route table and matches console paths', () => {
    const routes = parseRoutes(goFiles);
    expect(routes).toEqual([
      { method: 'GET', path: '/v1/admin/nodes/{name}' },
      { method: 'PATCH', path: '/v1/admin/config/{key}' },
      { method: 'POST', path: '/v1/admin/sites/' },
    ]);
    expect(routeMatches('/v1/admin/nodes/{name}', '/v1/admin/nodes/{}')).toBe(true);
    expect(routeMatches('/v1/admin/nodes/{name}', '/v1/admin/nodes')).toBe(false);
    expect(routeMatches('/v1/admin/sites/', '/v1/admin/sites/{}/releases')).toBe(true);
  });
});

function consoleFrom(source) {
  const dir = mkdtempSync(join(tmpdir(), 'contract-'));
  const file = join(dir, 'client.ts');
  writeFileSync(file, source);
  return readConsole([file], { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
}

const CLIENT_HEADER = `
declare function request<T>(path: string, init?: { method?: string; body?: string }): Promise<T>;
`;

describe('contract comparison', () => {
  const index = indexGoTypes(goFiles);
  const routes = parseRoutes(goFiles);

  it('passes when the console matches apid', () => {
    const c = consoleFrom(`${CLIENT_HEADER}
/** @go api.NodeRow */
export interface NodeRow { id: string; name: string; cpu_pct?: number | null; created_at: string }
export const getNode = (name: string) => request<NodeRow>(\`/v1/admin/nodes/\${encodeURIComponent(name)}\`);
/** @goBody api.PatchRequest */
export const patch = (key: string, value: unknown, reason: string) =>
  request(\`/v1/admin/config/\${key}\`, { method: 'PATCH', body: JSON.stringify({ value, ...(reason ? { reason } : {}) }) });
`);
    const result = compareContract(index, routes, c);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('flags a field apid stopped sending', () => {
    const c = consoleFrom(`${CLIENT_HEADER}
/** @go api.NodeRow */
export interface NodeRow { id: string; hostname: string }
`);
    expect(compareContract(index, routes, c).errors.map((e) => e.message)).toEqual([
      'NodeRow.hostname is not sent by api.NodeRow (renamed or removed?)',
    ]);
  });

  it('flags a body field apid would reject — the config "scope" 400', () => {
    const c = consoleFrom(`${CLIENT_HEADER}
/** @goBody api.PatchRequest */
export const patch = (key: string) =>
  request(\`/v1/admin/config/\${key}\`, { method: 'PATCH', body: JSON.stringify({ value: 1, reason: 'x', scope: 'global' }) });
`);
    expect(compareContract(index, routes, c).errors.map((e) => e.message)).toEqual([
      'sends "scope", which api.PatchRequest does not accept (apid rejects unknown fields with 400)',
    ]);
  });

  it('flags removed routes, wrong methods and vanished Go types', () => {
    const c = consoleFrom(`${CLIENT_HEADER}
/** @go api.Gone */
export interface Gone { id: string }
export const a = () => request('/v1/admin/tenants');
export const b = (name: string) => request(\`/v1/admin/nodes/\${name}\`, { method: 'DELETE' });
`);
    expect(compareContract(index, routes, c).errors.map((e) => e.message)).toEqual([
      'Gone mirrors api.Gone, which no longer exists in apid',
      '/v1/admin/tenants is not served by apid',
      'DELETE /v1/admin/nodes/{} is not served (apid serves GET)',
    ]);
  });

  it('warns when a field the console treats as always present can be missing', () => {
    const c = consoleFrom(`${CLIENT_HEADER}
/** @go api.NodeRow */
export interface NodeRow { id: string; cpu_pct: number }
`);
    expect(compareContract(index, routes, c).warnings[0].message).toMatch(/NodeRow\.cpu_pct is required in TS but api\.NodeRow\.CPU can be absent or null/);
  });

  it('ignores prefix comparisons and reads typed-variable bodies', () => {
    const c = consoleFrom(`${CLIENT_HEADER}
interface Patch { value: unknown; reason: string; force: boolean }
export const isAdmin = (p: string) => p.startsWith('/v1/admin/') || p === '/v1';
/** @goBody api.PatchRequest */
export const patch = (key: string, body: Patch) =>
  request(\`/v1/admin/config/\${key}\`, { method: 'PATCH', body: JSON.stringify(body) });
`);
    expect(compareContract(index, routes, c).errors.map((e) => e.message)).toEqual([
      'sends "force", which api.PatchRequest does not accept (apid rejects unknown fields with 400)',
    ]);
  });
});
