#!/usr/bin/env node
// Contract guard: fails when the console and apid disagree.
//
//   npm run contract -- --backend <path to a poyrazK/faas checkout>
//
// Options:
//   --verbose   also list apid fields the console does not read
//   --suggest   propose `@go` tags for interfaces that have none
//
// See scripts/contract/README.md for how to tag types.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { indexGoTypes, parseRoutes } from './go.mjs';
import { readConsole } from './ts.mjs';
import { compareContract, suggestGoTypes } from './compare.mjs';

const GO_DIRS = ['pkg/api', 'pkg/apid/apidserver', 'pkg/state', 'pkg/platformflags'];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const backend = option('backend') ?? process.env.APID_SOURCE;
if (!backend) {
  console.error('contract: pass --backend <path to a poyrazK/faas checkout> (or set APID_SOURCE)');
  process.exit(2);
}

function goFiles(root) {
  const files = [];
  for (const dir of GO_DIRS) {
    const abs = join(root, dir);
    let entries;
    try {
      entries = readdirSync(abs);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (f.endsWith('.go') && !f.endsWith('_test.go') && statSync(join(abs, f)).isFile()) {
        files.push({ path: join(dir, f), text: readFileSync(join(abs, f), 'utf8') });
      }
    }
  }
  return files;
}

function consoleFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...consoleFiles(p));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(resolve(p));
  }
  return out;
}

const files = goFiles(resolve(backend));
if (files.length === 0) {
  console.error(`contract: no Go sources under ${backend} (${GO_DIRS.join(', ')})`);
  process.exit(2);
}
const index = indexGoTypes(files);
const routes = parseRoutes(files);

const tsconfig = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const { options } = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, process.cwd());
const consoleData = readConsole(consoleFiles('src'), options);

if (flag('suggest')) {
  for (const iface of consoleData.all.filter((i) => !i.go)) {
    const picks = suggestGoTypes(index, iface.props);
    const line = picks.map((p) => `${p.name} (${Math.round(p.score * 100)}%${p.missing.length ? `, missing ${p.missing.join(' ')}` : ''})`).join(' | ');
    console.log(`${iface.at} ${iface.name}: ${line || 'no candidate'}`);
  }
  for (const body of consoleData.bodies.filter((b) => !b.go)) {
    const picks = suggestGoTypes(index, body.keys.map((name) => ({ name })));
    console.log(`${body.at} body ${body.path} {${body.keys.join(', ')}}: ${picks.map((p) => `${p.name} (${Math.round(p.score * 100)}%)`).join(' | ') || 'no candidate'}`);
  }
  process.exit(0);
}

const { errors, warnings, unused } = compareContract(index, routes, consoleData);
const annotate = process.env.GITHUB_ACTIONS === 'true';
const print = (level, item) => {
  if (annotate) {
    const [file, line] = item.at.split(':');
    console.log(`::${level} file=${file},line=${line}::${item.message}`);
  } else {
    console.log(`${level.padEnd(7)} ${item.at}  ${item.message}`);
  }
};

errors.forEach((e) => print('error', e));
warnings.forEach((w) => print('warning', w));
if (flag('verbose')) unused.forEach((u) => print('notice', u));

console.log(
  `\ncontract: ${consoleData.interfaces.length} response types, ${consoleData.bodies.length} request bodies, ` +
    `${new Set(consoleData.calls.map((c) => `${c.method} ${c.path}`)).size} endpoints checked against ` +
    `${index.structs.size} Go types and ${routes.length} routes — ${errors.length} error(s), ${warnings.length} warning(s)`,
);
process.exit(errors.length ? 1 : 0);
