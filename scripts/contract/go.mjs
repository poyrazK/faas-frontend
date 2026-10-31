// Reads the parts of apid's Go source the console depends on: the JSON shape
// of wire structs (pkg/api, pkg/apid/apidserver) and the mux route table.
// A purpose-built scanner, not a Go parser: it understands struct fields,
// json tags, embedding and nested anonymous structs, which is all the wire
// types use. Anything it cannot read is skipped, never guessed.

const TYPE_DECL = /^type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+(struct\s*\{|=\s*([\w.*\[\]]+)|([\w.]+)\s*$)/;
const JSON_TAG = /`[^`]*\bjson:"([^"]*)"[^`]*`/;
const ROUTE = /\bmux\.Handle(?:Func)?\(\s*"([A-Z]+)\s+(\/[^"\s]*)"/g;

/** "*Foo" | "[]api.Foo" → nullable on the wire (absent or null in JSON). */
export function isNullableGoType(goType) {
  return /^(\*|\[\]|map\[|json\.RawMessage|any\b|interface\s*\{)/.test(goType);
}

function stripComment(line) {
  // Backtick tags never contain "//" in this codebase; strings in field lines don't either.
  const i = line.indexOf('//');
  return i === -1 ? line : line.slice(0, i);
}

function parseTag(raw) {
  const m = raw.match(JSON_TAG);
  if (!m) return null;
  const [name, ...opts] = m[1].split(',');
  return { name, omitempty: opts.includes('omitempty') || opts.includes('omitzero') };
}

/**
 * Parses one struct body (the lines between "{" and the matching "}") into
 * fields and embedded types. Nested anonymous structs count as one field
 * whose tag sits on their closing line.
 */
function parseStructBody(lines) {
  const fields = [];
  const embeds = [];
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]).trim();
    if (!line) continue;

    // Nested anonymous struct: `Name struct {` … `} \`json:"name"\``
    const nested = line.match(/^([A-Z]\w*)\s+(\[\]|\*)?struct\s*\{\s*$/);
    if (nested) {
      let depth = 1;
      let j = i + 1;
      for (; j < lines.length && depth > 0; j++) {
        const l = stripComment(lines[j]);
        depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
      }
      const closing = lines[j - 1] ?? '';
      const tag = parseTag(closing);
      if (tag?.name !== '-') {
        fields.push({
          go: nested[1],
          json: tag?.name || nested[1],
          omitempty: !!tag?.omitempty,
          nullable: !!nested[2],
          goType: `${nested[2] ?? ''}struct{…}`,
        });
      }
      i = j - 1;
      continue;
    }

    const tag = parseTag(line);
    const head = line.replace(/`[^`]*`/, '').trim();
    const parts = head.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      // Embedded type: inlined into the parent unless it carries a json name.
      const typeName = parts[0].replace(/^\*/, '');
      if (tag && tag.name && tag.name !== '-') {
        fields.push({ go: typeName.split('.').pop(), json: tag.name, omitempty: tag.omitempty, nullable: parts[0].startsWith('*'), goType: parts[0] });
      } else if (!tag || tag.name === '') {
        embeds.push(typeName);
      }
      continue;
    }
    if (parts.length >= 2) {
      const names = head.slice(0, head.indexOf(parts[parts.length - 1])).split(',').map((s) => s.trim()).filter(Boolean);
      const goType = parts[parts.length - 1];
      for (const raw of names) {
        const name = raw.split(/\s+/)[0];
        if (!/^[A-Z]/.test(name)) continue; // unexported: never serialized
        if (tag?.name === '-') continue;
        fields.push({
          go: name,
          json: tag?.name || name,
          omitempty: !!tag?.omitempty,
          nullable: isNullableGoType(goType),
          goType,
        });
      }
    }
  }
  return { fields, embeds };
}

const GROUP_START = /^type\s*\(\s*$/;
const GROUP_MEMBER = /^\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+(struct\s*\{.*|=\s*([\w.*\[\]]+)|([\w.]+)\s*)$/;

const braceDelta = (line) => {
  const l = stripComment(line).replace(/`[^`]*`/g, '').replace(/"(?:[^"\\]|\\.)*"/g, '');
  return (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
};

/**
 * Reads one type declaration whose right-hand side starts at `rest` on line
 * `i`. Returns the index of its last line.
 */
function readDecl(name, rest, aliasTarget, lines, i, pkg, path, structs, aliases) {
  if (aliasTarget) {
    if (!/^(string|int|int64|bool|float64|\[\]|map\[)/.test(aliasTarget)) aliases.set(name, qualify(aliasTarget, pkg));
    return i;
  }
  if (!rest.startsWith('struct')) return i;
  const open = rest.slice(rest.indexOf('{') + 1);
  let depth = 1 + braceDelta(open);
  const body = [];
  let j = i;
  if (depth > 0) {
    for (j = i + 1; j < lines.length; j++) {
      depth += braceDelta(lines[j]);
      if (depth <= 0) break;
      body.push(lines[j]);
    }
  }
  const parsed = parseStructBody(body);
  structs.set(name, { name, path, ...parsed, embeds: parsed.embeds.map((e) => qualify(e, pkg)) });
  return j;
}

/**
 * Indexes every struct (and type alias) in the given Go files by
 * "<package>.<Type>", including members of grouped `type ( … )` blocks.
 * @param {{ path: string, text: string }[]} files
 */
export function indexGoTypes(files) {
  const structs = new Map();
  const aliases = new Map();
  for (const { path, text } of files) {
    if (path.endsWith('_test.go')) continue;
    const pkg = text.match(/^package\s+(\w+)/m)?.[1];
    if (!pkg) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (GROUP_START.test(lines[i])) {
        for (i = i + 1; i < lines.length && !/^\)/.test(lines[i]); i++) {
          const m = lines[i].match(GROUP_MEMBER);
          if (m) i = readDecl(`${pkg}.${m[1]}`, m[2], m[3] ?? m[4]?.trim(), lines, i, pkg, path, structs, aliases);
        }
        continue;
      }
      const decl = lines[i].match(TYPE_DECL);
      if (!decl) continue;
      const rest = lines[i].slice(lines[i].indexOf(decl[2]));
      i = readDecl(`${pkg}.${decl[1]}`, rest, decl[3] ?? decl[4], lines, i, pkg, path, structs, aliases);
    }
  }
  return { structs, aliases };
}

function qualify(typeName, pkg) {
  const bare = typeName.replace(/^\*/, '');
  return bare.includes('.') ? bare : `${pkg}.${bare}`;
}

/**
 * The JSON object a Go struct marshals to: own fields plus fields of embedded
 * structs (outer fields win, as in encoding/json). Null when unknown.
 * @returns {Map<string, { go: string, json: string, omitempty: boolean, nullable: boolean, goType: string }> | null}
 */
export function jsonFields(index, qualifiedName, seen = new Set()) {
  let name = qualifiedName;
  for (let hops = 0; index.aliases.has(name) && hops < 5; hops++) name = index.aliases.get(name);
  const struct = index.structs.get(name);
  if (!struct || seen.has(name)) return null;
  seen.add(name);
  const out = new Map();
  for (const embedded of struct.embeds) {
    const inner = jsonFields(index, embedded, seen);
    if (inner) for (const [k, v] of inner) out.set(k, v);
  }
  for (const field of struct.fields) out.set(field.json, field);
  return out;
}

/**
 * Every route apid registers: `mux.Handle[Func]("METHOD /path", …)`.
 * @param {{ path: string, text: string }[]} files
 */
export function parseRoutes(files) {
  const routes = [];
  for (const { path, text } of files) {
    if (path.endsWith('_test.go')) continue;
    for (const m of text.matchAll(ROUTE)) routes.push({ method: m[1], path: m[2] });
  }
  return routes;
}

/** Splits "/v1/admin/x/{id}" into segments, with any "{…}" as a wildcard. */
const segments = (p) => p.replace(/\/+$/, '').split('/').map((s) => (/^\{.*\}$/.test(s) ? '*' : s));

/**
 * Whether a console path (wildcards written "{}") is served by a route.
 * Go's ServeMux treats a trailing "/" as a subtree, so "/v1/x/" matches
 * anything below it.
 */
export function routeMatches(routePath, consolePath) {
  const r = segments(routePath);
  const c = segments(consolePath);
  const subtree = routePath.endsWith('/') && routePath !== '/';
  if (!subtree && r.length !== c.length) return false;
  if (subtree && c.length < r.length) return false;
  return r.every((seg, i) => seg === '*' || c[i] === '*' || seg === c[i]);
}
