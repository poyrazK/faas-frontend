// Reads what the console expects from apid, using the TypeScript compiler:
// - interfaces tagged `@go pkg.Type` (response shapes),
// - request bodies in functions tagged `@goBody pkg.Type`,
// - every "/v1/…" path the console calls, with its HTTP method when static.

import ts from 'typescript';

const jsDocTag = (node, name) => {
  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.text === name) {
      const comment = typeof tag.comment === 'string' ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
      return (comment ?? '').trim().split(/\s+/)[0] || '';
    }
  }
  return null;
};

/** The statement a JSDoc comment for this node would be attached to. */
function docHost(node) {
  let current = node;
  while (current && !ts.isVariableStatement(current) && !ts.isFunctionDeclaration(current) && !ts.isSourceFile(current)) {
    current = current.parent;
  }
  return current && !ts.isSourceFile(current) ? current : null;
}

function location(sf, node) {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${sf.fileName.replace(`${process.cwd()}/`, '')}:${line + 1}`;
}

/** Whether a property's type already tolerates null/undefined (or is any/unknown). */
function acceptsNull(type) {
  const loose = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Null | ts.TypeFlags.Undefined;
  if (type.flags & loose) return true;
  return type.isUnion() && type.types.some((t) => t.flags & loose);
}

/** "/v1/admin/x/${id}/y?${q}" → "/v1/admin/x/{}/y". Null when it is not a /v1 path. */
export function pathPattern(node) {
  let text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
  else if (ts.isTemplateExpression(node)) text = node.head.text + node.templateSpans.map((s) => `{}${s.literal.text}`).join('');
  else return null;
  if (!text.startsWith('/v1/')) return null;
  text = text.split('?')[0];
  // A substitution glued to a segment ("…/nodes${query}") is a query builder, not a path part.
  text = text.replace(/([^/]){}$/, '$1').replace(/([^/]){}(?=\/)/g, '$1');
  return text.replace(/\/$/, '') || null;
}

function objectKeys(expr, out, checker) {
  if (!expr) return true;
  if (ts.isParenthesizedExpression(expr)) return objectKeys(expr.expression, out, checker);
  if (ts.isConditionalExpression(expr)) return objectKeys(expr.whenTrue, out, checker) && objectKeys(expr.whenFalse, out, checker);
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return objectKeys(expr.right, out, checker);
  if (!ts.isObjectLiteralExpression(expr)) {
    // `...request`: a typed value contributes its declared properties.
    const type = checker?.getTypeAtLocation(expr);
    if (!type || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
    for (const sym of checker.getPropertiesOfType(type)) out.add(sym.getName());
    return true;
  }
  for (const prop of expr.properties) {
    if (ts.isSpreadAssignment(prop)) {
      if (!objectKeys(prop.expression, out, checker)) return false;
    } else if (prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
      out.add(prop.name.text);
    } else {
      return false;
    }
  }
  return true;
}

/** The static HTTP method of a request() call; null when it is computed. */
function methodOf(init) {
  if (!init) return 'GET';
  if (!ts.isObjectLiteralExpression(init)) return null;
  if (init.properties.some((p) => ts.isSpreadAssignment(p))) return null;
  const method = init.properties.find((p) => p.name?.getText() === 'method');
  if (!method) return 'GET';
  if (!ts.isPropertyAssignment(method)) return null; // shorthand `{ method }`: a variable
  return ts.isStringLiteral(method.initializer) ? method.initializer.text.toUpperCase() : null;
}

/** A literal compared against or used as a prefix test, not a request target. */
function isComparison(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isBinaryExpression(parent)) {
    const k = parent.operatorToken.kind;
    return k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      k === ts.SyntaxKind.EqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken;
  }
  if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)) {
    return ['startsWith', 'endsWith', 'includes', 'indexOf', 'replace', 'slice'].includes(parent.expression.name.text);
  }
  return false;
}

function bodyLiteral(init) {
  if (!init || !ts.isObjectLiteralExpression(init)) return undefined;
  const body = init.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === 'body');
  if (!body) return undefined;
  const value = body.initializer;
  if (ts.isCallExpression(value) && value.expression.getText() === 'JSON.stringify') return value.arguments[0];
  return null; // FormData or a prebuilt string: not checkable
}

/**
 * @param {string[]} rootNames files to analyze
 * @param {ts.CompilerOptions} options
 */
export function readConsole(rootNames, options) {
  const program = ts.createProgram(rootNames, { ...options, noEmit: true });
  const checker = program.getTypeChecker();
  const interfaces = [];
  const bodies = [];
  const calls = [];
  /** Every exported interface, tagged or not (for --suggest). */
  const all = [];

  for (const sf of program.getSourceFiles()) {
    if (!rootNames.includes(sf.fileName)) continue;
    const visit = (node) => {
      if (ts.isInterfaceDeclaration(node)) {
        const go = jsDocTag(node, 'go');
        const type = checker.getTypeAtLocation(node.name);
        const props = checker.getPropertiesOfType(type).map((sym) => ({
          name: sym.getName(),
          optional: (sym.getFlags() & ts.SymbolFlags.Optional) !== 0,
          nullable: acceptsNull(checker.getTypeOfSymbolAtLocation(sym, node)),
        }));
        const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (exported) all.push({ name: node.name.text, go, props, at: location(sf, node) });
        if (go) {
          const ignore = (jsDocTag(node, 'contractIgnore') ?? '').split(/[\s,]+/).filter(Boolean);
          interfaces.push({ name: node.name.text, go, props, ignore, at: location(sf, node) });
        }
      }

      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const callee = node.expression.getText(sf);
        const path = pathPattern(node.arguments[0]);
        if (path && /(^|\.)request$/.test(callee)) {
          const init = node.arguments[1];
          calls.push({ path, method: methodOf(init), at: location(sf, node) });
          const body = bodyLiteral(init);
          const host = docHost(node);
          const goBody = host ? jsDocTag(host, 'goBody') : null;
          if (body !== undefined && goBody !== '-') {
            const keys = new Set();
            let complete = false;
            if (body && ts.isObjectLiteralExpression(body)) {
              complete = objectKeys(body, keys, checker);
            } else if (body) {
              // A typed variable: its declared properties are what gets sent.
              const type = checker.getTypeAtLocation(body);
              if (!(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) {
                for (const sym of checker.getPropertiesOfType(type)) keys.add(sym.getName());
                complete = true;
              }
            }
            bodies.push({ go: goBody, keys: [...keys], complete, path, at: location(sf, node) });
          }
        } else if (path && !isComparison(node.arguments[0])) {
          calls.push({ path, method: null, at: location(sf, node) });
        }
      } else if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) &&
        !(node.parent && ts.isCallExpression(node.parent) && node.parent.arguments[0] === node)
      ) {
        const path = pathPattern(node);
        if (path && !isComparison(node) && !(node.parent && ts.isTemplateSpan(node.parent))) {
          calls.push({ path, method: null, at: location(sf, node) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { interfaces, bodies, calls, all };
}
