// Compares what the console expects (ts.mjs) with what apid serves (go.mjs).
// Errors are mismatches that break at runtime or silently show wrong data;
// warnings are worth a look but not proof of a bug.

import { jsonFields, routeMatches } from './go.mjs';

/**
 * @param {ReturnType<import('./go.mjs').indexGoTypes>} index
 * @param {{ method: string, path: string }[]} routes
 * @param {ReturnType<import('./ts.mjs').readConsole>} console_
 */
export function compareContract(index, routes, console_) {
  const errors = [];
  const warnings = [];
  const unused = [];

  for (const iface of console_.interfaces) {
    const fields = jsonFields(index, iface.go);
    if (!fields) {
      errors.push({ at: iface.at, message: `${iface.name} mirrors ${iface.go}, which no longer exists in apid` });
      continue;
    }
    for (const prop of iface.props) {
      if (iface.ignore.includes(prop.name)) continue;
      const field = fields.get(prop.name);
      if (!field) {
        errors.push({ at: iface.at, message: `${iface.name}.${prop.name} is not sent by ${iface.go} (renamed or removed?)` });
      } else if (
        !iface.go.endsWith('Request') && // the console sends these; Go-optional is fine
        !prop.optional &&
        !prop.nullable &&
        (field.omitempty || field.nullable) &&
        !field.goType.startsWith('[]') &&
        !field.goType.startsWith('map[')
      ) {
        warnings.push({
          at: iface.at,
          message: `${iface.name}.${prop.name} is required in TS but ${iface.go}.${field.go} can be absent or null (${field.goType}${field.omitempty ? ', omitempty' : ''})`,
        });
      }
    }
    const missing = [...fields.keys()].filter((k) => !iface.props.some((p) => p.name === k));
    if (missing.length) unused.push({ at: iface.at, message: `${iface.name} ignores ${iface.go} fields: ${missing.join(', ')}` });
  }

  for (const body of console_.bodies) {
    if (!body.go) {
      warnings.push({ at: body.at, message: `request body for ${body.path} has no @goBody tag, so its fields are not checked` });
      continue;
    }
    const fields = jsonFields(index, body.go);
    if (!fields) {
      errors.push({ at: body.at, message: `request body mirrors ${body.go}, which no longer exists in apid` });
      continue;
    }
    if (!body.complete) warnings.push({ at: body.at, message: `request body for ${body.go} is not a literal object; keys not checked` });
    for (const key of body.keys) {
      if (!fields.has(key)) {
        errors.push({ at: body.at, message: `sends "${key}", which ${body.go} does not accept (apid rejects unknown fields with 400)` });
      }
    }
  }

  const seen = new Set();
  for (const call of console_.calls) {
    const id = `${call.method ?? '*'} ${call.path}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const byPath = routes.filter((r) => routeMatches(r.path, call.path));
    if (byPath.length === 0) {
      errors.push({ at: call.at, message: `${call.path} is not served by apid` });
    } else if (call.method && !byPath.some((r) => r.method === call.method || (call.method === 'HEAD' && r.method === 'GET'))) {
      const served = [...new Set(byPath.map((r) => r.method))].join('/');
      errors.push({ at: call.at, message: `${call.method} ${call.path} is not served (apid serves ${served})` });
    }
  }

  return { errors, warnings, unused };
}

/** Names of Go structs whose JSON fields best match a TS interface, for tagging. */
export function suggestGoTypes(index, props, limit = 3) {
  const want = new Set(props.map((p) => p.name));
  if (want.size === 0) return [];
  const scored = [];
  for (const name of index.structs.keys()) {
    const fields = jsonFields(index, name);
    if (!fields || fields.size === 0) continue;
    let both = 0;
    for (const k of want) if (fields.has(k)) both++;
    if (both === 0) continue;
    const score = both / (want.size + fields.size - both);
    scored.push({ name, score, missing: [...want].filter((k) => !fields.has(k)) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
