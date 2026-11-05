'use strict';
// Règle d'or du 05/11/2026 (Arielle) : jamais d'emoji sur le site, uniquement des icônes SVG.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const PERMIS = new Set([...'©®™←↑→↓↔↕↖↗↘↙']);
function fichiers(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    if (['node_modules', '.git'].includes(e.name)) return [];
    const p = path.join(d, e.name);
    return e.isDirectory() ? fichiers(p) : /\.(html|css|js|json|xml|txt)$/.test(e.name) ? [p] : [];
  });
}

test('aucun emoji dans le site (pages FR/EN, styles, scripts, API)', () => {
  const fautes = [];
  for (const f of fichiers(RACINE)) {
    if (f.includes(path.sep + 'tests' + path.sep)) continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const e = [...l].filter((c) => /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(c) && !PERMIS.has(c));
      if (e.length) fautes.push(`${path.relative(RACINE, f)}:${i + 1} ${e.join(' ')}`);
    });
  }
  assert.deepStrictEqual(fautes, []);
});

test('les icônes SVG sont décoratives (aria-hidden)', () => {
  for (const f of ['public/index.html', 'public/en/index.html']) {
    const s = fs.readFileSync(path.join(RACINE, f), 'utf8');
    const icones = s.match(/<svg class="ico"[^>]*>/g) || [];
    assert.ok(icones.length >= 40, `${f} : icônes présentes`);
    assert.ok(icones.every((t) => /aria-hidden="true"/.test(t)), `${f} : aria-hidden`);
  }
});
