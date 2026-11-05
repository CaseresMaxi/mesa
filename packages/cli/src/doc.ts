import type { Cond, Effect, Expr, Faction, GamePack } from '@mesa/core';

/** Traduce el DSL a texto en castellano (para revisar que `summary` diga lo mismo que la mecánica). */
export function describeCond(c: Cond, p: GamePack): string {
  const t = p.rules.terms;
  if ('ruledBy' in c) return { self: 'lo gobernás', rival: 'lo gobierna un rival', none: 'no lo gobierna nadie', anyone: 'alguien lo gobierna' }[c.ruledBy];
  if ('has' in c) {
    const what = { warrior: 'guerreros', building: 'edificios', token: 'fichas', any: 'piezas' }[c.has];
    const who = { self: 'propios', rival: 'rivales', rivalArmy: 'rivales (no nómades)', any: 'de cualquiera' }[c.of];
    return `hay ${c.min && c.min > 1 ? `≥${c.min} ` : ''}${what} ${who}`;
  }
  if ('terrain' in c) return `es de ${p.map.terrains.find((x) => x.id === c.terrain)?.name ?? c.terrain}`;
  if ('supply' in c) return `te quedan ≥${c.min ?? 1} ${c.supply} en reserva`;
  if ('neighbor' in c) return `algún ${t.node} vecino cumple (${describeCond(c.neighbor, p)})`;
  if ('all' in c) return c.all.map((k) => describeCond(k, p)).join(' y ');
  if ('any' in c) return '(' + c.any.map((k) => describeCond(k, p)).join(' o ') + ')';
  if ('not' in c) return `no (${describeCond(c.not, p)})`;
  if ('corner' in c) return c.corner ? 'es esquina' : 'no es esquina';
  return '?';
}

export function describeExpr(e: Expr, p: GamePack, vars: Record<string, Expr> = {}): string {
  if (typeof e === 'number') return String(e);
  if ('count' in e) return `#${p.rules.terms.nodes} donde ${describeCond(e.where, p)}`;
  if ('stat' in e) return e.stat;
  if ('rivalsAt' in e) return `rivales en el ${p.rules.terms.node} del peón`;
  if ('ref' in e) return vars[e.ref] ? describeExpr(vars[e.ref], p, vars) : e.ref;
  if ('div' in e) return `⌊${describeExpr(e.div[0], p, vars)} / ${e.div[1]}⌋`;
  if ('mul' in e) return `${describeExpr(e.mul[0], p, vars)} × ${e.mul[1]}`;
  if ('sum' in e) return e.sum.map((k) => describeExpr(k, p, vars)).join(' + ');
  if ('min' in e) return `mín(${e.min.map((k) => describeExpr(k, p, vars)).join(', ')})`;
  if ('max' in e) return `máx(${e.max.map((k) => describeExpr(k, p, vars)).join(', ')})`;
  if ('table' in e) return `tabla [${e.table.join('·')}] según ${describeExpr(e.of, p, vars)}`;
  return '?';
}

function describeEffect(e: Effect, p: GamePack): string {
  switch (e.do) {
    case 'placeWarriors':
      return `+${e.amount} guerrero(s) en cada ${p.rules.terms.node} donde ${describeCond(e.where, p)}`;
    case 'gainVp':
      return `+${describeExpr(e.amount, p)} ${p.rules.terms.vp} (${e.why})`;
    case 'drawCards':
      return `roba ${e.amount} carta(s)`;
    case 'refreshItems':
      return `recupera ${e.amount} componente(s)`;
    case 'convertWarrior':
      return 'cambia 1 guerrero del rival más fuerte ahí por uno propio';
    case 'log':
      return `(texto: "${e.text}")`;
  }
}

function factionDoc(f: Faction, p: GamePack): string {
  const t = p.rules.terms;
  const L: string[] = [`### ${f.name} (\`${f.id}\`)`, '', `_${f.tagline}_`, ''];
  L.push(`- Arquetipo: **${f.archetype}** · ${f.warriors.count} ${f.warriors.name} · ${f.actions} acciones`);
  if (f.building) L.push(`- Edificios: ${f.building.count} × ${f.building.name} (PV al construir ${f.building.vp.join('·')})`);
  if (f.token) L.push(`- Fichas: ${f.token.count} × ${f.token.name}${f.token.requires.length ? ` — se colocan si ${f.token.requires.map((r) => describeCond(r.cond, p)).join(' y ')}` : ''}`);
  L.push(`- ${t.recruit}: ${f.recruit ? `+${f.recruit.amount} donde ${f.recruit.requires.map((r) => describeCond(r.cond, p)).join(' y ') || 'sea'}` : 'no'}`);
  L.push(`- ${t.move}: alcance ${f.move.range}${f.move.needsRule ? ', gobernando origen o destino' : ', sin necesidad de gobernar'}`);
  L.push(`- ${t.battle}: máx. ${f.battle.maxDice} dados${f.battle.free ? ', 1 gratis por turno' : ''}${f.battle.defenseBonus ? `, +${f.battle.defenseBonus} al defender` : ''}${f.battle.vpPerWarriorKill ? `, +${f.battle.vpPerWarriorKill} PV por guerrero eliminado` : ''}`);
  if (f.anyCard) L.push('- Cualquier carta paga en cualquier nodo.');
  if (f.special) {
    L.push(`- Especial **${f.special.name}** (1/turno): ${f.special.hint}`);
    if (f.special.requires.length) L.push(`  - requiere: ${f.special.requires.map((r) => describeCond(r.cond, p)).join('; ')}`);
    if (f.special.effects.length) L.push(`  - efecto: ${f.special.effects.map((e) => describeEffect(e, p)).join('; ')}`);
  }
  for (const e of f.onTurnStart) L.push(`- ${t.turnStart}: ${describeEffect(e, p)}`);
  for (const r of f.onClose) L.push(`- ${t.close}${r.id ? ` (${r.id})` : ''}: +${describeExpr(r.vp, p, r.vars ?? {})} ${t.vp}`);
  if (f.nomad) {
    const n = f.nomad;
    L.push(`- Nómade: componentes ${n.items.map((i) => `${i.name} (${i.verb})`).join(', ')}; empieza con ${n.startItems.join(', ')}; máx. ${n.maxItems}; recupera ${n.refreshPerTurn}/turno; mejora +${n.finetuneVp} PV; ayuda +${n.aidVp} PV.`);
  }
  if (f.summary.length) L.push('', 'Texto para jugadores:', ...f.summary.map((s) => `> ${s}`));
  return L.join('\n');
}

export function rulesDoc(p: GamePack): string {
  const t = p.rules.terms;
  const deck = p.cards.deck.reduce((a, g) => a + g.count, 0);
  const L = [
    `# ${p.pack.name}`,
    '',
    p.pack.description,
    '',
    '## Reglas generales',
    '',
    `- ${p.pack.players.min}–${p.pack.players.max} jugadores. Gana quien llega a **${p.rules.victoryVp} ${t.vp}**.`,
    `- Mano inicial ${p.rules.startingHand}, roba ${p.rules.drawPerTurn} al ${t.close}, mano máx. ${p.rules.handLimit}.`,
    `- Gobernar un ${t.node}: más guerreros + edificios que nadie (empate = nadie; los nómades no gobiernan).`,
    `- ${t.battle}: 1 d6 por guerrero (máx. según facción); ${p.rules.battle.hitOn}+ = impacto; defensor sin guerreros: +${p.rules.battle.undefendedBonus}. Cada edificio/ficha destruida: ${p.rules.battle.vpPerStructure} ${t.vp}.`,
    p.rules.effort ? `- ${t.effort}: quemar una carta de ${p.rules.effort.suit} → +1 acción (1/turno).` : '',
    '',
    `## Mapa: ${p.map.name}`,
    '',
    `${p.map.nodes.length} ${t.nodes}, ${p.map.edges.length} conexiones. Esquinas de inicio: ${p.map.startCorners.map((c) => p.map.nodes[c]?.name).join(', ')}.`,
    '',
    `| # | ${t.node} | terreno | slots | vecinos |`,
    '|---|---|---|---|---|',
    ...p.map.nodes.map((n) => {
      const nb = p.map.edges.filter((e) => e.includes(n.id)).map((e) => p.map.nodes[e[0] === n.id ? e[1] : e[0]]?.name);
      return `| ${n.id} | ${n.name}${n.corner ? ' ★' : ''} | ${n.terrain} | ${n.slots} | ${nb.join(', ')} |`;
    }),
    '',
    `## Mazo (${deck} cartas)`,
    '',
    ...p.cards.deck.map((g) => `- ${g.count} × ${p.cards.suits.find((s) => s.id === g.suit)?.name ?? g.suit}: ${g.names.join(', ')}`),
    '',
    '## Facciones',
    '',
    ...p.factions.map((f) => factionDoc(f, p) + '\n'),
  ];
  return L.filter((l) => l !== null).join('\n');
}
