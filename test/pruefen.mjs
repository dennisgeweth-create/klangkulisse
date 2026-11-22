// Die Rechnung der Klangkulisse, ohne Browser:  node test/pruefen.mjs
import { AUFSTELLUNGEN, KANALFOLGEN, gewichte, aufKanaele, aufstellungFuer, normWinkel, zufallsOrt, abstandsWirkung } from '../js/raum.js';
import { ERZEUGER, erzeugen, nahtlos, zufallsQuelle } from '../js/synth.js';
import { SZENEN, LEISTE, klangWaehlen } from '../js/szenen.js';
import { readFileSync, existsSync } from 'node:fs';

let gut = 0;
const fehler = [];
function pruefe(bed, was) {
  if (bed) gut++;
  else fehler.push(was);
}
const nahe = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const leistung = (g, las) => g.reduce((s, v, i) => s + (las[i].lfe ? 0 : v * v), 0);

// ── Raum ──
for (const [name, a] of Object.entries(AUFSTELLUNGEN)) {
  const las = a.lautsprecher;
  for (const f of Object.values(KANALFOLGEN[name])) {
    pruefe(f.length === las.length && las.every((l) => f.includes(l.id)), `${name}: Kanalfolge enthält jeden Lautsprecher genau einmal`);
  }
  for (let w = -180; w <= 180; w += 7.5) {
    for (const breite of [0, 0.3, 1]) {
      for (const center of [0, 0.5, 1]) {
        const g = gewichte(name, { winkel: w, breite, center });
        pruefe(nahe(leistung(g, las), 1, 1e-9), `${name} ${w}° breite ${breite} center ${center}: Leistung 1`);
        pruefe(g.every((v) => v >= 0 && Number.isFinite(v)), `${name} ${w}°: Gewichte endlich und nicht negativ`);
      }
    }
  }
  // Steht die Quelle genau auf einem Lautsprecher, spielt nur er.
  for (const l of las.filter((l) => !l.lfe)) {
    const g = gewichte(name, { winkel: l.winkel, center: 1 });
    const i = las.indexOf(l);
    pruefe(nahe(g[i], 1, 1e-9), `${name}: auf ${l.id} spielt nur ${l.id}`);
  }
  // Spiegelbild: links und rechts tauschen.
  for (let w = 0; w <= 180; w += 15) {
    const g1 = gewichte(name, { winkel: w });
    const g2 = gewichte(name, { winkel: -w });
    for (const l of las) {
      if (l.lfe) continue;
      const gegen = las.findIndex((x) => !x.lfe && x.winkel === -l.winkel);
      pruefe(nahe(g1[las.indexOf(l)], g2[gegen], 1e-9), `${name}: ${w}° und −${w}° spiegeln sich (${l.id})`);
    }
  }
}
// Mitte ohne Center → je Hälfte auf FL und FR.
{
  const g = gewichte('7.1', { winkel: 0, center: 0 });
  pruefe(nahe(g[0], Math.SQRT1_2) && nahe(g[1], Math.SQRT1_2) && g[2] === 0, '7.1 ohne Center: vorn = FL+FR zu gleichen Teilen');
  const hinten = gewichte('7.1', { winkel: 180 });
  pruefe(nahe(hinten[6], Math.SQRT1_2) && nahe(hinten[7], Math.SQRT1_2), '7.1: 180° = BL+BR zu gleichen Teilen');
  const rechts = gewichte('7.1', { winkel: 120 });
  pruefe(rechts[5] > 0 && rechts[7] > 0 && rechts[0] === 0, '7.1: 120° liegt zwischen SR und BR');
  const breit = gewichte('7.1', { winkel: 0, breite: 1, center: 1 });
  pruefe(breit.filter((v, i) => i !== 3).every((v) => nahe(v, 1 / Math.sqrt(7))), '7.1: Breite 1 = gleich aus allen sieben');
  const nah = gewichte('7.1', { winkel: 90, abstand: 0 });
  pruefe(nah.filter((v, i) => i !== 3).every((v) => v > 0.3), '7.1: im Kopf des Hörers kommt es von überall');
  const lfe = gewichte('7.1', { winkel: 0, lfe: 0.7 });
  pruefe(lfe[3] === 0.7, '7.1: der LFE-Anteil geht unverändert durch');
  // Stereo: hinten links klingt links.
  const st = gewichte('stereo', { winkel: -150 });
  pruefe(st[0] > 0.99 && st[1] < 0.01, 'Stereo: hinten links wird links');
  // Kanalfolge Windows: BL vor SL.
  const k = aufKanaele('7.1', 'standard', gewichte('7.1', { winkel: -90 }));
  pruefe(nahe(k[6], 1) && nahe(k[4], 0), 'Windows-Folge: SL liegt auf Kanal 7');
  const k2 = aufKanaele('7.1', 'alsa', gewichte('7.1', { winkel: 0, center: 1 }));
  pruefe(nahe(k2[4], 1), 'ALSA-Folge: Center liegt auf Kanal 5');
}
pruefe(aufstellungFuer(8) === '7.1' && aufstellungFuer(6) === '5.1' && aufstellungFuer(2) === 'stereo' && aufstellungFuer(12) === '7.1', 'Aufstellung nach Kanalzahl');
pruefe(normWinkel(190) === -170 && normWinkel(-180) === 180 && normWinkel(540) === 180 && normWinkel(-30) === -30, 'Winkel normieren');
{
  const z = zufallsQuelle(5);
  let ok = true;
  for (let i = 0; i < 500; i++) {
    const o = zufallsOrt([150, -150], 1, 2, z);
    if (!(Math.abs(o.winkel) >= 150 && o.abstand >= 1 && o.abstand <= 2)) ok = false;
  }
  pruefe(ok, 'Zufallsort im Sektor hinten [150, −150]');
  const nah = abstandsWirkung(0.5);
  const fern = abstandsWirkung(3);
  pruefe(nah.pegel === 1 && fern.pegel < 0.3 && fern.tiefpass < nah.tiefpass, 'Abstand: fern ist leiser und dumpfer');
}

// ── Erzeuger ──
const SR = 24000; // halbe Rate genügt für die Prüfung und spart Zeit
for (const [id, e] of Object.entries(ERZEUGER)) {
  const v = erzeugen(id, SR, 0);
  const k = v.kanaele;
  let endlich = true, spitze = 0, summe = 0;
  for (const c of k) for (let i = 0; i < c.length; i++) {
    if (!Number.isFinite(c[i])) endlich = false;
    spitze = Math.max(spitze, Math.abs(c[i]));
    summe += c[i] * c[i];
  }
  pruefe(endlich, `${id}: nur endliche Werte`);
  pruefe(spitze <= 1 && spitze > 0.1, `${id}: Spitze ${spitze.toFixed(2)} zwischen 0,1 und 1`);
  pruefe(summe > 0, `${id}: nicht stumm`);
  pruefe(k.every((c) => c.length === k[0].length), `${id}: alle Kanäle gleich lang`);
  pruefe(v.schleife === (e.art === 'bett'), `${id}: Schleife genau dann, wenn bett`);
  if (v.schleife) {
    // Die Naht: der Sprung vom letzten zum ersten Wert ist nicht größer als
    // die üblichen Sprünge zwischen Nachbarn.
    for (const c of k) {
      let gross = 0;
      for (let i = 1; i < c.length; i++) gross = Math.max(gross, Math.abs(c[i] - c[i - 1]));
      const naht = Math.abs(c[0] - c[c.length - 1]);
      pruefe(naht <= gross * 1.05 + 1e-6, `${id}: Schleife ohne Knack an der Naht (${naht.toFixed(3)} ≤ ${gross.toFixed(3)})`);
    }
    pruefe(k[0].length / SR >= 5, `${id}: Schleife mindestens 5 s`);
  }
  // Gesät: zweimal dieselbe Variante ist derselbe Klang; eine andere ist anders.
  const w = erzeugen(id, SR, 0).kanaele[0];
  pruefe(w.length === k[0].length && w.every((x, i) => x === k[0][i]), `${id}: gleicher Startwert, gleicher Klang`);
  if (e.varianten > 1) {
    const anders = erzeugen(id, SR, 1).kanaele[0];
    pruefe(anders.length !== k[0].length || anders.some((x, i) => x !== k[0][i]), `${id}: Varianten unterscheiden sich`);
  }
}
{
  const a = new Float32Array(1000).map((_, i) => Math.sin(i / 10));
  const n = nahtlos(a, 100, 1);
  pruefe(n.length === 900, 'nahtlos(): kürzt um die Überblendung');
}

// ── Szenen ──
let katalog = [];
const katPfad = new URL('../klaenge/katalog.json', import.meta.url);
if (existsSync(katPfad)) katalog = JSON.parse(readFileSync(katPfad, 'utf8')).klaenge;
const auswahl = JSON.parse(readFileSync(new URL('../werkzeug/auswahl.json', import.meta.url), 'utf8')).klaenge;
const bekannt = new Set([...Object.keys(ERZEUGER), ...auswahl.map((a) => a.id)]);
pruefe(new Set(auswahl.map((a) => a.id)).size === auswahl.length, 'auswahl.json: jede Kennung nur einmal');
const ids = new Set();
for (const s of SZENEN) {
  pruefe(!ids.has(s.id), `Szene ${s.id}: Kennung eindeutig`);
  ids.add(s.id);
  pruefe(s.name && s.gruppe && s.ebenen.length > 0, `Szene ${s.id}: Name, Gruppe, Ebenen`);
  for (const e of s.ebenen) {
    const liste = Array.isArray(e.klang) ? e.klang : [e.klang];
    for (const k of liste) pruefe(bekannt.has(k), `Szene ${s.id}: Klang ${k} steht in der Auswahl oder ist ein Erzeuger`);
    pruefe(['bett', 'musik', 'zufall'].includes(e.art), `Szene ${s.id}: Art ${e.art}`);
    if (e.art === 'zufall') pruefe(Array.isArray(e.intervall) && e.intervall[0] <= e.intervall[1], `Szene ${s.id}: Intervall von ≤ bis`);
    // Ein Einzelgeräusch gehört in eine Ereignis-Ebene, eine Schleife nicht.
    for (const k of liste) {
      const a = ERZEUGER[k] ? ERZEUGER[k].art : (auswahl.find((x) => x.id === k) || {}).art;
      if (a === 'einzel') pruefe(e.art === 'zufall', `Szene ${s.id}: ${k} ist ein Einzelgeräusch und läuft als Ereignis`);
      if (a === 'bett') pruefe(e.art !== 'zufall', `Szene ${s.id}: ${k} ist eine Schleife und läuft nicht als Ereignis`);
    }
  }
  // Ohne jede Aufnahme spielt jede Szene noch etwas.
  const ohne = s.ebenen.filter((e) => klangWaehlen(e.klang, (k) => !!ERZEUGER[k]));
  pruefe(ohne.length > 0 || s.ebenen.every((e) => !(Array.isArray(e.klang))), `Szene ${s.id}: spielt auch ohne Aufnahmen etwas`);
}
for (const l of LEISTE) {
  const liste = Array.isArray(l.klang) ? l.klang : [l.klang];
  for (const k of liste) pruefe(bekannt.has(k), `Leiste ${l.name}: Klang ${k} bekannt`);
}
pruefe(klangWaehlen(['a', 'b', 'c'], (k) => k !== 'a') === 'b', 'klangWaehlen: die erste, die es gibt');
pruefe(klangWaehlen('x', () => false) === null, 'klangWaehlen: keine → null');

// ── Katalog (falls schon geladen) ──
for (const k of katalog) {
  pruefe(k.quelle && k.quelle.lizenz && k.quelle.urheber && k.quelle.seite, `Katalog ${k.id}: Lizenz, Urheber, Seite`);
  pruefe(/^(cc0|public domain|pd|cc by|pdm)/i.test(k.quelle.lizenz), `Katalog ${k.id}: freie Lizenz (${k.quelle.lizenz})`);
  for (const d of k.dateien) pruefe(existsSync(new URL('../klaenge/' + d, import.meta.url)), `Katalog ${k.id}: Datei ${d} liegt da`);
  pruefe(k.dateien.length === k.dauer.length, `Katalog ${k.id}: Dauer je Datei`);
}

if (fehler.length) {
  console.log(fehler.slice(0, 40).map((f) => '  ✗ ' + f).join('\n'));
  console.log(`\n${fehler.length} Fehler, ${gut} gut.`);
  process.exit(1);
}
console.log(`✓ ${gut} Prüfungen gut${katalog.length ? ` (Katalog: ${katalog.length} Klänge)` : ' (noch kein Katalog)'}.`);
