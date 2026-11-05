#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import {
  analyzeMap,
  applyBatch,
  applyPatch,
  Batch,
  createEngine,
  formatIssues,
  formatReport,
  generateMap,
  getPath,
  jsonSchemas,
  newBatch,
  parsePack,
  playGame,
  simulate,
  validatePack,
  type GamePack,
  type GamePackInput,
  type PatchOp,
  type SimReport,
} from '@mesa/core';
import { findRoot, listPacks, loadPackInput, packDir, savePack, writeJson } from '@mesa/core/node';
import { collectAssets, renderAsset, setFontCss } from '@mesa/art';
import { rulesDoc } from './doc.ts';

const HELP = `mesa — motor de juegos de mesa (CLI)

Uso: pnpm mesa <comando> [args]

  packs                                   lista los packs
  validate <pack>                         valida esquema + coherencia (sale con 1 si hay errores)
  get <pack> <ruta>                       muestra el valor en una ruta (ej. /factions/google/battle)
  patch <pack> '<ops JSON>' [--dry]       aplica ops [{op,path,value}] y guarda si valida
  sim <pack> [--games N] [--k N] [--factions a,b] [--json] [--save nombre] [--vs nombre]
                                          simula partidas de bots y reporta balance
  sweep <pack> --path <ruta> --values a,b,c [--focus facción] [--games N]
                                          prueba valores de un parámetro y compara win rates
  play <pack> [--seed N] [--factions a,b,c] [--log N]
                                          juega una partida de bots y muestra el final del log
  map analyze <pack>                      métricas del mapa (grado, diámetro, cuellos, esquinas)
  map generate <pack> [--seed N] [--nodes N] [--corners N] [--degree X] [--apply]
                                          genera un mapa nuevo (con --apply lo guarda en el pack)
  assets <pack> [--only id,id] [--out dir] renderiza los assets a SVG (default packs/<pack>/assets/generated)
  doc <pack> [--out archivo]              reglas legibles (markdown) generadas desde los datos
  batch new <pack> <título>               crea un lote vacío en packs/<pack>/batches/
  batch apply <pack> <lote.json> [--dry]  aplica los patches pendientes del lote y lista las intenciones
  new <id> [--from <pack>] [--name "Nombre"]
                                          crea un pack nuevo (copia de otro o plantilla mínima)
  schema                                  regenera schemas/*.schema.json
`;

const argv = process.argv.slice(2);
const flags: Record<string, string | true> = {};
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const nxt = argv[i + 1];
    if (nxt !== undefined && !nxt.startsWith('--')) (flags[k] = nxt), i++;
    else flags[k] = true;
  } else pos.push(a);
}
const flag = (k: string) => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
const numFlag = (k: string, d: number) => (flag(k) !== undefined ? Number(flag(k)) : d);
const root = findRoot();

function load(id: string): { dir: string; input: GamePackInput; pack: GamePack } {
  const dir = packDir(id, root);
  const input = loadPackInput(dir);
  const { pack, issues } = validatePack(input);
  const errors = issues.filter((i) => i.level === 'error');
  if (!pack || errors.length) {
    console.error(formatIssues(issues));
    process.exit(1);
  }
  return { dir, input, pack };
}

function saveValidated(dir: string, input: GamePackInput, dry: boolean): boolean {
  const { issues } = validatePack(input);
  if (issues.length) console.log(formatIssues(issues));
  if (issues.some((i) => i.level === 'error')) {
    console.error('\n✗ No se guardó: el pack resultante tiene errores.');
    return false;
  }
  if (dry) {
    console.log('\n(dry-run: no se escribió nada)');
    return true;
  }
  const written = savePack(dir, input);
  console.log(written.length ? `\n✓ Guardado: ${written.join(', ')}` : '\n✓ Sin cambios en disco.');
  return true;
}

function loadFonts() {
  try {
    const req = createRequire(join(root, 'packages/art/package.json'));
    const b64 = (spec: string) => readFileSync(req.resolve(spec)).toString('base64');
    setFontCss(
      `@font-face{font-family:'Caveat';font-weight:700;src:url(data:font/woff2;base64,${b64('@fontsource/caveat/files/caveat-latin-700-normal.woff2')}) format('woff2');}` +
        `@font-face{font-family:'Patrick Hand';font-weight:400;src:url(data:font/woff2;base64,${b64('@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2')}) format('woff2');}`,
    );
  } catch {
    /* sin fuentes embebidas */
  }
}

const reportPath = (dir: string, name: string) => join(dir, 'reports', name.endsWith('.json') ? name : `${name}.json`);

function cmdSim(id: string) {
  const { dir, pack } = load(id);
  const r = simulate(pack, { games: numFlag('games', pack.pack.balance.games), factionsPerGame: flag('k') ? Number(flag('k')) : undefined, factions: flag('factions')?.split(',') });
  const vs = flag('vs') ?? (existsSync(reportPath(dir, 'baseline')) ? 'baseline' : undefined);
  const base = vs && existsSync(reportPath(dir, vs)) ? (JSON.parse(readFileSync(reportPath(dir, vs), 'utf8')) as SimReport) : undefined;
  if (flags.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(formatReport(r, base));
    if (base) console.log(`\n(Δ contra reports/${vs}.json)`);
  }
  if (flag('save')) {
    writeJson(reportPath(dir, flag('save')!), r);
    console.log(`✓ Reporte guardado en ${relative(root, reportPath(dir, flag('save')!))}`);
  }
  if (r.warnings.length && flags.strict) process.exit(2);
}

function cmdSweep(id: string) {
  const { pack, input } = load(id);
  const path = flag('path');
  const values = flag('values')?.split(',');
  if (!path || !values) throw new Error('Faltan --path y --values');
  const games = numFlag('games', 150);
  const focus = flag('focus') ?? path.match(/^\/factions\/([^/]+)/)?.[1];
  console.log(`sweep ${path} (actual: ${JSON.stringify(getPath(pack, path))}), ${games} partidas por valor\n`);
  console.log('valor        ' + (focus ? `${focus.padEnd(10)} ` : '') + 'rango win%            turnos  avisos');
  for (const raw of values) {
    const value = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw.startsWith('[') || raw.startsWith('{') ? JSON.parse(raw) : raw;
    const variant = parsePack(applyPatch(input, [{ op: 'replace', path, value }]));
    const r = simulate(variant, { games });
    const rates = Object.values(r.factions).map((f) => f.winRate);
    const fr = focus ? r.factions[focus]?.winRate : undefined;
    console.log(
      `${String(raw).padEnd(12)} ${fr !== undefined ? (Math.round(fr * 1000) / 10 + '%').padEnd(10) + ' ' : ''}${Math.round(Math.min(...rates) * 100)}–${Math.round(Math.max(...rates) * 100)}%`.padEnd(42) +
        `${String(r.avgTurns).padEnd(7)} ${r.warnings.length}`,
    );
  }
}

function cmdPlay(id: string) {
  const { pack } = load(id);
  const engine = createEngine(pack);
  const factions = flag('factions')?.split(',') ?? pack.factions.slice(0, Math.min(4, pack.pack.players.max)).map((f) => f.id);
  const s = playGame(engine, factions, numFlag('seed', 1));
  const n = numFlag('log', 40);
  for (const e of s.log.slice(-n)) console.log(`[t${e.turn}] ${e.faction ? `${e.faction}: ` : ''}${e.text}`);
  console.log(`\nGanador: ${s.winner ?? '—'} en ${s.turn} turnos · PV: ${s.order.map((f) => `${f} ${s.factions[f].vp}`).join(', ')}`);
}

function cmdMap(sub: string, id: string) {
  if (sub === 'analyze') {
    const { pack } = load(id);
    console.log(JSON.stringify(analyzeMap(pack.map), null, 2));
    return;
  }
  if (sub === 'generate') {
    const { dir, input, pack } = load(id);
    const map = generateMap({
      id: pack.map.id,
      name: pack.map.name,
      seed: numFlag('seed', Date.now() % 100000),
      nodes: numFlag('nodes', pack.map.nodes.length),
      corners: numFlag('corners', pack.map.startCorners.length),
      avgDegree: numFlag('degree', 3.1),
      terrains: pack.map.terrains,
      names: pack.map.nodes.map((n) => n.name),
    });
    const a = analyzeMap(map);
    console.log(JSON.stringify({ analysis: a, map }, null, 2));
    if (flags.apply) saveValidated(dir, { ...input, map: { ...map, $schema: (input.map as { $schema?: string }).$schema } }, false);
    return;
  }
  throw new Error(`map ${sub}: subcomando desconocido`);
}

function cmdAssets(id: string) {
  const { dir, pack } = load(id);
  loadFonts();
  const out = resolve(flag('out') ?? join(dir, 'assets', 'generated'));
  mkdirSync(out, { recursive: true });
  const only = flag('only')?.split(',');
  let n = 0;
  for (const a of collectAssets(pack)) {
    if (only && !only.includes(a.id)) continue;
    if (a.file) {
      cpSync(join(dir, a.file), join(out, `${a.id}${a.file.slice(a.file.lastIndexOf('.'))}`));
    } else writeFileSync(join(out, `${a.id}.svg`), renderAsset(pack, a));
    n++;
  }
  console.log(`✓ ${n} assets en ${relative(root, out)}`);
}

function cmdBatch(sub: string, id: string, arg?: string) {
  const { dir, input } = load(id);
  if (sub === 'new') {
    const title = arg ?? 'Lote';
    const name = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lote';
    const p = join(dir, 'batches', `${name}.json`);
    writeJson(p, newBatch(id, title));
    console.log(`✓ ${relative(root, p)}`);
    return;
  }
  if (sub === 'apply') {
    if (!arg) throw new Error('Falta el archivo del lote');
    const file = existsSync(arg) ? resolve(arg) : join(dir, 'batches', arg.endsWith('.json') ? arg : `${arg}.json`);
    const batch = Batch.parse(JSON.parse(readFileSync(file, 'utf8')));
    const res = applyBatch(input, batch);
    for (const id2 of res.applied) console.log(`✓ patch ${id2}: ${batch.items.find((i) => i.id === id2)?.title}`);
    for (const f of res.failed) console.log(`✗ patch ${f.id}: ${f.error}`);
    const ok = saveValidated(dir, res.pack, !!flags.dry);
    if (ok && !flags.dry) {
      for (const it of batch.items) if (res.applied.includes(it.id)) it.status = 'applied';
      writeJson(file, batch);
    }
    if (res.intents.length) {
      console.log(`\nIntenciones pendientes (${res.intents.length}) — las resuelve la skill aplicar-lote:`);
      for (const it of res.intents) console.log(`  • [${it.id}] ${it.title}: ${it.text}${it.targets.length ? `  (rutas: ${it.targets.join(', ')})` : ''}`);
    }
    return;
  }
  throw new Error(`batch ${sub}: subcomando desconocido`);
}

function cmdNew(id: string) {
  const dest = join(root, 'packs', id);
  if (existsSync(dest)) throw new Error(`Ya existe ${relative(root, dest)}`);
  const from = flag('from');
  if (from) {
    const src = packDir(from, root);
    cpSync(src, dest, { recursive: true, filter: (p) => !/[/\\](reports|batches|generated)([/\\]|$)/.test(p) });
    const input = loadPackInput(dest);
    input.pack = { ...input.pack, id, name: flag('name') ?? id };
    savePack(dest, input);
  } else {
    const tpl = JSON.parse(readFileSync(join(root, 'packages/cli/templates/minimal.json'), 'utf8')) as GamePackInput;
    tpl.pack = { ...tpl.pack, id, name: flag('name') ?? id };
    mkdirSync(dest, { recursive: true });
    savePack(dest, tpl);
  }
  console.log(`✓ Pack creado en ${relative(root, dest)}`);
  const { issues } = validatePack(loadPackInput(dest));
  if (issues.length) console.log(formatIssues(issues));
}

function cmdSchema() {
  const dir = join(root, 'schemas');
  rmSync(dir, { recursive: true, force: true });
  for (const [k, s] of Object.entries(jsonSchemas())) writeJson(join(dir, `${k}.schema.json`), s);
  console.log(`✓ schemas/ regenerado`);
}

try {
  const [cmd, a, b, c] = pos;
  switch (cmd) {
    case 'packs':
      for (const p of listPacks(root)) console.log(p);
      break;
    case 'validate': {
      const input = loadPackInput(packDir(a, root));
      const { issues } = validatePack(input);
      console.log(issues.length ? formatIssues(issues) : '✓ Pack válido, sin avisos.');
      if (issues.some((i) => i.level === 'error')) process.exit(1);
      break;
    }
    case 'get':
      console.log(JSON.stringify(getPath(load(a).pack, b ?? '/'), null, 2));
      break;
    case 'patch': {
      const { dir, input } = load(a);
      const ops = JSON.parse(b) as PatchOp[];
      saveValidated(dir, applyPatch(input, Array.isArray(ops) ? ops : [ops]), !!flags.dry);
      break;
    }
    case 'sim':
      cmdSim(a);
      break;
    case 'sweep':
      cmdSweep(a);
      break;
    case 'play':
      cmdPlay(a);
      break;
    case 'map':
      cmdMap(a, b);
      break;
    case 'assets':
      cmdAssets(a);
      break;
    case 'doc': {
      const md = rulesDoc(load(a).pack);
      if (flag('out')) writeFileSync(flag('out')!, md), console.log(`✓ ${flag('out')}`);
      else console.log(md);
      break;
    }
    case 'batch':
      cmdBatch(a, b, c);
      break;
    case 'new':
      cmdNew(a);
      break;
    case 'schema':
      cmdSchema();
      break;
    default:
      console.log(HELP);
      if (cmd && cmd !== 'help') process.exit(1);
  }
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
}
