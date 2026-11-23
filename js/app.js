// Die Oberfläche. Kein Framework: h() baut DOM, zeichnen() baut die
// Teile neu, die sich geändert haben. Schieber reden direkt mit dem Motor
// und zeichnen nichts neu — sonst verlöre man beim Ziehen den Griff.

import { Motor } from './motor.js';
import { AUFSTELLUNGEN, KANALFOLGEN, KANALFOLGE_NAMEN, normWinkel } from './raum.js';
import { ERZEUGER } from './synth.js';
import { SZENEN, LEISTE } from './szenen.js';
import { einstellungen, eigeneSzenen, eigeneKlaenge } from './speicher.js';

// ── DOM-Helfer ─────────────────────────────────────────────────────

const SVG = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'circle', 'line', 'path', 'text', 'rect', 'polygon', 'title']);

function h(tag, props, ...kinder) {
  const svg = SVG_TAGS.has(tag);
  const el = svg ? document.createElementNS(SVG, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (!svg && k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kinder.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : String(k));
  }
  return el;
}

function ersetzen(ziel, ...inhalt) {
  if (!ziel) return;
  ziel.replaceChildren(...inhalt.flat(Infinity).filter((x) => x != null && x !== false));
}

const $ = (sel) => document.querySelector(sel);

// ── Zustand ────────────────────────────────────────────────────────

const EINST_VORGABE = { aufstellung: 'auto', folge: 'standard', center: 0.5, lfe: 0.6, pegel: 0.8, ueberblenden: 4 };

const z = {
  gestartet: false,
  info: null,
  einst: { ...EINST_VORGABE, ...einstellungen.lesen() },
  katalog: [],
  eigene: [],
  eigeneSzenen: eigeneSzenen.lesen(),
  aktiv: null, // Kopie der laufenden Szene (wird bearbeitet)
  geaendert: false,
  laedt: false,
  offen: null, // aufgeklappte Ebene
  leisteOrt: 'zufall',
  dialog: null,
  filter: '',
  meldungen: [],
};

let motor = null;

function alleSzenen() {
  return [...SZENEN, ...z.eigeneSzenen];
}

function einstSichern() {
  einstellungen.schreiben(z.einst);
}

function melden(text, art = 'info') {
  const m = { text, art, id: Math.random() };
  z.meldungen.push(m);
  zeichneMeldungen();
  setTimeout(() => {
    z.meldungen = z.meldungen.filter((x) => x !== m);
    zeichneMeldungen();
  }, art === 'fehler' ? 7000 : 3500);
}

// Name und Herkunft eines Klangs, gleich welcher Art.
function klangInfo(id) {
  if (!id) return null;
  if (ERZEUGER[id]) return { id, name: ERZEUGER[id].name, gruppe: ERZEUGER[id].gruppe, art: ERZEUGER[id].art, erzeugt: true };
  const k = z.katalog.find((x) => x.id === id);
  if (k) return k;
  const e = z.eigene.find((x) => x.id === id);
  if (e) return { ...e, gruppe: 'Eigene', eigen: true };
  return null;
}

function gibtEs(id) {
  return !!klangInfo(id);
}

function waehlen(klang) {
  const liste = Array.isArray(klang) ? klang : [klang];
  return liste.find(gibtEs) || null;
}

function alleKlaenge() {
  const synth = Object.keys(ERZEUGER).map((id) => klangInfo(id));
  const eigen = z.eigene.map((e) => klangInfo(e.id));
  return [...z.katalog, ...synth, ...eigen];
}

// ── Start ──────────────────────────────────────────────────────────

async function vorbereiten() {
  try {
    const r = await fetch('klaenge/katalog.json', { cache: 'no-cache' });
    if (r.ok) z.katalog = (await r.json()).klaenge || [];
  } catch (f) {
    console.warn('Kein Katalog', f);
  }
  try {
    z.eigene = await eigeneKlaenge.liste();
  } catch (f) {
    console.warn(f);
  }
  motor = new Motor({ katalog: z.katalog, eigeneLaden: (id) => eigeneKlaenge.daten(id) });
  motor.eigeneInfo = (id) => z.eigene.find((e) => e.id === id) || null;
  motor.bei(beiMotor);
  geruest();
  zeichnen();
}

async function starten() {
  try {
    z.info = await motor.starten(z.einst);
    z.gestartet = true;
    zeichnen();
    if (z.info.maxKanaele < 8) {
      melden(`Das Ausgabegerät meldet ${z.info.maxKanaele} Kanäle — gespielt wird in ${AUFSTELLUNGEN[z.info.aufstellung].name}. Für 7.1 siehe ⚙ → Hinweise.`);
    } else {
      melden(`7.1 erkannt: ${z.info.maxKanaele} Kanäle.`);
    }
  } catch (f) {
    melden('Audio ließ sich nicht starten: ' + f.message, 'fehler');
  }
}

function beiMotor(art, d) {
  if (art === 'aufbau') {
    z.info = d;
    zeichneKopf();
    if (z.aktiv) zeichneBuehne();
    if (z.dialog === 'einst') zeichneDialog();
  } else if (art === 'ereignis') {
    blitz(d.ort, d.ebene);
  } else if (art === 'einzel') {
    blitz(d.ort, -1);
  } else if (art === 'fehler') {
    melden(`Klang „${d.klang}“: ${d.text}`, 'fehler');
  } else if (art === 'test') {
    testAnzeige(d.index, d.dauer);
  }
}

// ── Szenen spielen ─────────────────────────────────────────────────

async function szeneSpielen(def) {
  if (!z.gestartet) await starten();
  if (!z.gestartet) return;
  z.aktiv = JSON.parse(JSON.stringify(def));
  z.geaendert = false;
  z.offen = null;
  z.laedt = true;
  zeichneKopf();
  zeichneSzenen();
  zeichneBuehne();
  try {
    await motor.szeneSpielen(z.aktiv, { ueberblenden: z.einst.ueberblenden });
  } catch (f) {
    melden(f.message, 'fehler');
  }
  z.laedt = false;
  zeichneBuehne();
}

function allesAus() {
  if (!motor || !motor.ctx) return;
  motor.szeneStoppen(1.5);
  z.aktiv = null;
  zeichneKopf();
  zeichneSzenen();
  zeichneBuehne();
}

// Nach einer Änderung am Aufbau der Szene (Ebene dazu oder weg): neu
// einsetzen, kurz überblendet.
async function szeneNeu() {
  z.geaendert = true;
  zeichneBuehne();
  await motor.szeneSpielen(z.aktiv, { ueberblenden: 0.8 });
  zeichneBuehne();
}

function ebeneAendern(i, aenderung, neuZeichnen = false) {
  Object.assign(z.aktiv.ebenen[i], aenderung);
  motor.ebeneAendern(i, aenderung);
  if (!z.geaendert) {
    z.geaendert = true;
    zeichneSzenenKopf();
  }
  if (neuZeichnen) zeichneBuehne();
}

function szeneSpeichern() {
  const s = JSON.parse(JSON.stringify(z.aktiv));
  const eigen = z.eigeneSzenen.findIndex((x) => x.id === s.id);
  if (eigen >= 0) {
    z.eigeneSzenen[eigen] = s;
  } else {
    s.id = 'eigen-' + Date.now().toString(36);
    s.name = s.name + ' (eigen)';
    s.gruppe = 'Eigene';
    z.eigeneSzenen.push(s);
    z.aktiv.id = s.id;
    z.aktiv.name = s.name;
    z.aktiv.gruppe = s.gruppe;
  }
  eigeneSzenen.schreiben(z.eigeneSzenen);
  z.geaendert = false;
  melden(`„${s.name}“ gespeichert.`);
  zeichneSzenen();
  zeichneBuehne();
}

function szeneLoeschen(id) {
  const s = z.eigeneSzenen.find((x) => x.id === id);
  if (!s || !confirm(`„${s.name}“ löschen?`)) return;
  z.eigeneSzenen = z.eigeneSzenen.filter((x) => x.id !== id);
  eigeneSzenen.schreiben(z.eigeneSzenen);
  if (z.aktiv && z.aktiv.id === id) allesAus();
  zeichneSzenen();
}

function neueSzene() {
  const s = { id: 'eigen-' + Date.now().toString(36), name: 'Neue Szene', gruppe: 'Eigene', symbol: '🎧', beschreibung: '', hall: { dauer: 2, daempfung: 0.6 }, ebenen: [] };
  z.eigeneSzenen.push(s);
  eigeneSzenen.schreiben(z.eigeneSzenen);
  szeneSpielen(s);
}

function szenenAusfuhr() {
  const daten = JSON.stringify({ klangkulisse: 1, szenen: z.eigeneSzenen }, null, 1);
  const a = h('a', { href: URL.createObjectURL(new Blob([daten], { type: 'application/json' })), download: 'klangkulisse-szenen.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function szenenEinfuhr(datei) {
  try {
    const d = JSON.parse(await datei.text());
    const neu = (d.szenen || []).filter((s) => s && Array.isArray(s.ebenen));
    for (const s of neu) {
      s.id = 'eigen-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      s.gruppe = 'Eigene';
      z.eigeneSzenen.push(s);
    }
    eigeneSzenen.schreiben(z.eigeneSzenen);
    melden(`${neu.length} Szene(n) übernommen.`);
    zeichneSzenen();
  } catch (f) {
    melden('Die Datei ließ sich nicht lesen: ' + f.message, 'fehler');
  }
}

// ── Gerüst ─────────────────────────────────────────────────────────

function geruest() {
  ersetzen($('#app'),
    h('header', { id: 'kopf' }),
    h('main', { id: 'mitte' },
      h('nav', { id: 'szenen' }),
      h('section', { id: 'buehne' }),
      h('aside', { id: 'leiste' })),
    h('div', { id: 'dialog' }),
    h('div', { id: 'meldungen' }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && z.dialog) dialogZu();
  });
}

function zeichnen() {
  zeichneKopf();
  zeichneSzenen();
  zeichneBuehne();
  zeichneLeiste();
  zeichneDialog();
  zeichneMeldungen();
}

function zeichneKopf() {
  const i = z.info;
  const chip = !z.gestartet
    ? h('span', { class: 'chip' }, 'nicht gestartet')
    : h('span', { class: 'chip ' + (i.aufstellung === '7.1' ? 'gut' : 'mittel'), title: `Abtastrate ${i.abtastrate} Hz, Gerät meldet ${i.maxKanaele} Kanäle` },
      `${AUFSTELLUNGEN[i.aufstellung].name} · ${i.kanaele} Kanäle`);
  ersetzen($('#kopf'),
    h('div', { class: 'marke' }, h('span', { class: 'logo' }, '🔊'), h('h1', null, 'Klangkulisse')),
    chip,
    h('div', { class: 'kopf-rechts' },
      h('label', { class: 'pegel', title: 'Gesamtlautstärke' }, '🔉',
        h('input', {
          type: 'range', min: 0, max: 1, step: 0.01, value: z.einst.pegel,
          oninput: (e) => { z.einst.pegel = +e.target.value; if (motor && motor.ctx) motor.einstellen({ pegel: z.einst.pegel }); },
          onchange: einstSichern,
        })),
      h('button', { class: 'knopf warn', onclick: allesAus, disabled: !z.aktiv, title: 'Alles ausblenden' }, '⏹ Stille'),
      h('button', { class: 'knopf', onclick: () => dialogAuf('klaenge') }, '📁 Eigene Klänge'),
      h('button', { class: 'knopf', onclick: () => dialogAuf('einst') }, '⚙ Ausgang')));
}

function zeichneSzenen() {
  const gruppen = new Map();
  for (const s of alleSzenen()) {
    if (!gruppen.has(s.gruppe)) gruppen.set(s.gruppe, []);
    gruppen.get(s.gruppe).push(s);
  }
  ersetzen($('#szenen'),
    h('div', { class: 'spalten-kopf' }, h('h2', null, 'Szenen'),
      h('button', { class: 'knopf klein', onclick: neueSzene, title: 'Leere Szene anlegen' }, '+ Neu')),
    [...gruppen].map(([g, liste]) => h('div', { class: 'gruppe' },
      h('h3', null, g),
      liste.map((s) => {
        const fehlen = s.ebenen.filter((e) => !waehlen(e.klang)).length;
        const aktiv = z.aktiv && z.aktiv.id === s.id;
        return h('button', {
          class: 'szene' + (aktiv ? ' aktiv' : ''),
          onclick: () => szeneSpielen(s),
          title: s.beschreibung + (fehlen ? `\n${fehlen} Klang/Klänge fehlen.` : ''),
        },
        h('span', { class: 'symbol' }, s.symbol || '🎧'),
        h('span', { class: 'szene-text' },
          h('b', null, s.name),
          h('small', null, s.beschreibung || `${s.ebenen.length} Ebenen`)),
        fehlen ? h('span', { class: 'fehlt', title: `${fehlen} Klang/Klänge fehlen` }, fehlen) : null);
      }))),
    h('div', { class: 'szenen-fuss' },
      h('button', { class: 'knopf klein', onclick: szenenAusfuhr, disabled: !z.eigeneSzenen.length }, '⇩ Eigene sichern'),
      h('label', { class: 'knopf klein' }, '⇧ Laden',
        h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => e.target.files[0] && szenenEinfuhr(e.target.files[0]) }))));
}

// ── Die Bühne: laufende Szene ──────────────────────────────────────

function zeichneSzenenKopf() {
  const ziel = $('#buehne .buehne-kopf');
  if (ziel) ziel.replaceWith(buehnenKopf());
}

function buehnenKopf() {
  const s = z.aktiv;
  const eigen = z.eigeneSzenen.some((x) => x.id === s.id);
  return h('div', { class: 'buehne-kopf' },
    h('span', { class: 'symbol gross' }, s.symbol || '🎧'),
    h('div', { class: 'titel' },
      eigen
        ? h('input', { class: 'titel-feld', value: s.name, onchange: (e) => { s.name = e.target.value; z.geaendert = true; zeichneSzenenKopf(); } })
        : h('h2', null, s.name),
      h('p', null, z.laedt ? 'lädt …' : s.beschreibung)),
    h('div', { class: 'aktionen' },
      z.geaendert ? h('button', { class: 'knopf gold', onclick: szeneSpeichern }, eigen ? '💾 Speichern' : '💾 Als eigene speichern') : null,
      eigen ? h('button', { class: 'knopf klein', onclick: () => szeneLoeschen(s.id), title: 'Szene löschen' }, '🗑') : null));
}

function zeichneBuehne() {
  const b = $('#buehne');
  if (!z.aktiv) {
    ersetzen(b, h('div', { class: 'leer' },
      h('div', { class: 'leer-symbol' }, '🎧'),
      h('h2', null, z.gestartet ? 'Stille.' : 'Bereit, wenn ihr es seid.'),
      h('p', null, 'Wählt links eine Szene — sie blendet weich über. Rechts liegen einzelne Geräusche für den richtigen Moment.'),
      !z.gestartet ? h('button', { class: 'knopf gold gross', onclick: starten }, '▶ Klang einschalten') : null,
      h('p', { class: 'fein' }, z.katalog.length
        ? `${z.katalog.length} Aufnahmen und ${Object.keys(ERZEUGER).length} erzeugte Klänge an Bord.`
        : `Noch keine Aufnahmen im Ordner klaenge/ — es spielen die ${Object.keys(ERZEUGER).length} erzeugten Klänge. Aufnahmen holt werkzeug/klaenge-holen.py.`)));
    return;
  }
  const s = z.aktiv;
  ersetzen(b,
    buehnenKopf(),
    h('div', { class: 'buehne-innen' },
      h('div', { class: 'raum-rahmen' }, raum(s), h('p', { class: 'fein mitte' }, 'Punkte ziehen: dorthin wandert der Klang. Ring = rundum.')),
      h('div', { class: 'ebenen' },
        s.ebenen.map((e, i) => ebenenZeile(e, i)),
        h('button', { class: 'knopf breit', onclick: () => dialogAuf('waehlen') }, '+ Ebene hinzufügen'),
        hallZeile(s))));
}

function hallZeile(s) {
  const hall = s.hall || { dauer: 2, daempfung: 0.6 };
  const neu = (a) => {
    s.hall = { ...hall, ...a };
    motor.hallSetzen(s.hall);
    z.geaendert = true;
    zeichneSzenenKopf();
  };
  return h('div', { class: 'hall-zeile' },
    h('span', null, '🏛 Raumhall'),
    schieber('Länge', hall.dauer, 0.3, 6, 0.1, (v) => neu({ dauer: v }), (v) => v.toFixed(1) + ' s'),
    schieber('Dämpfung', hall.daempfung, 0, 1, 0.05, (v) => neu({ daempfung: v })));
}

function schieber(name, wert, min, max, schritt, beiAenderung, zeigen = (v) => Math.round(v * 100) + ' %') {
  const anzeige = h('output', null, zeigen(+wert));
  return h('label', { class: 'schieber' },
    h('span', null, name),
    h('input', {
      type: 'range', min, max, step: schritt, value: wert,
      oninput: (e) => { anzeige.textContent = zeigen(+e.target.value); },
      onchange: (e) => beiAenderung(+e.target.value),
    }),
    anzeige);
}

// Schieber, der schon beim Ziehen wirkt (Pegel).
function livePegel(wert, beiAenderung) {
  return h('input', {
    type: 'range', class: 'ebenen-pegel', min: 0, max: 1, step: 0.01, value: wert,
    oninput: (e) => beiAenderung(+e.target.value),
  });
}

const ART_NAME = { bett: 'Schleife', musik: 'Musik', zufall: 'Ereignisse' };

function ebenenZeile(e, i) {
  const id = waehlen(e.klang);
  const info = klangInfo(id);
  const offen = z.offen === i;
  const zeile = h('div', { class: 'ebene' + (e.stumm ? ' stumm' : '') + (id ? '' : ' fehlt-ganz'), 'data-i': i },
    h('div', { class: 'ebene-kopf' },
      h('button', { class: 'stumm-knopf', title: e.stumm ? 'Einschalten' : 'Stumm', onclick: () => ebeneAendern(i, { stumm: !e.stumm }, true) }, e.stumm ? '🔇' : '🔊'),
      h('span', { class: 'punkt', style: { background: farbe(i) } }),
      h('div', { class: 'ebene-name' },
        h('b', null, info ? info.name : (Array.isArray(e.klang) ? e.klang[0] : e.klang)),
        h('small', null, ART_NAME[e.art] || e.art, id ? '' : ' · Klang fehlt',
          info && info.erzeugt ? ' · erzeugt' : '')),
      livePegel(e.pegel ?? 0.8, (v) => ebeneAendern(i, { pegel: v })),
      h('button', { class: 'auf-knopf', onclick: () => { z.offen = offen ? null : i; zeichneBuehne(); }, title: 'Einstellungen' }, offen ? '▴' : '▾')),
    offen ? ebenenDetails(e, i) : null);
  return zeile;
}

function ebenenDetails(e, i) {
  const teile = [];
  if (e.art !== 'zufall') {
    teile.push(h('label', { class: 'haken' },
      h('input', { type: 'checkbox', checked: e.ort === 'rundum', onchange: (ev) => ebeneAendern(i, { ort: ev.target.checked ? 'rundum' : { winkel: 0, abstand: 1 } }, true) }),
      'rundum (aus allen Lautsprechern)'));
    teile.push(schieber('Breite', e.breite ?? (e.ort === 'rundum' ? 0.25 : 0.1), 0, 1, 0.05, (v) => ebeneAendern(i, { breite: v })));
  } else {
    const [a, b] = e.intervall || [5, 20];
    teile.push(schieber('Abstand min.', a, 0.5, 300, 0.5, (v) => ebeneAendern(i, { intervall: [v, Math.max(v, b)] }, true), (v) => v + ' s'));
    teile.push(schieber('Abstand max.', b, 0.5, 600, 0.5, (v) => ebeneAendern(i, { intervall: [Math.min(a, v), v] }, true), (v) => v + ' s'));
    teile.push(h('label', { class: 'auswahl' }, h('span', null, 'Woher'),
      h('select', { onchange: (ev) => ebeneAendern(i, { sektor: SEKTOREN[ev.target.value].s }, true) },
        Object.entries(SEKTOREN).map(([k, v]) => h('option', { value: k, selected: sektorName(e.sektor) === k }, v.name)))));
    teile.push(h('label', { class: 'haken' },
      h('input', { type: 'checkbox', checked: e.bewegung === 'vorbei', onchange: (ev) => ebeneAendern(i, { bewegung: ev.target.checked ? 'vorbei' : null }) }),
      'zieht vorbei'));
    teile.push(schieber('Tonhöhe', e.tonhoehe || 0, -12, 12, 1, (v) => ebeneAendern(i, { tonhoehe: v }), (v) => (v > 0 ? '+' : '') + v + ' HT'));
    teile.push(h('button', { class: 'knopf klein', onclick: () => motor.szene && motor.szene.ebenen[i] && motor.szene.ebenen[i].puffer && motor.einmal(motor.szene, motor.szene.ebenen[i]) }, '▶ jetzt einmal'));
  }
  teile.push(schieber('Hall', e.hall || 0, 0, 1, 0.05, (v) => ebeneAendern(i, { hall: v })));
  teile.push(schieber('Subwoofer', e.lfe || 0, 0, 1, 0.05, (v) => ebeneAendern(i, { lfe: v })));
  const info = klangInfo(waehlen(e.klang));
  return h('div', { class: 'ebene-details' },
    teile,
    h('div', { class: 'ebene-fuss' },
      info && info.quelle ? h('small', { class: 'quelle' }, `${info.quelle.urheber} · ${info.quelle.lizenz}`) : null,
      h('button', { class: 'knopf klein warn', onclick: () => { z.aktiv.ebenen.splice(i, 1); z.offen = null; szeneNeu(); } }, 'Ebene entfernen')));
}

const SEKTOREN = {
  ringsum: { name: 'ringsum', s: [-180, 180] },
  vorn: { name: 'vorn', s: [-60, 60] },
  hinten: { name: 'hinten', s: [120, -120] },
  links: { name: 'links', s: [-150, -30] },
  rechts: { name: 'rechts', s: [30, 150] },
  seiten: { name: 'vorn und seitlich', s: [-110, 110] },
};

function sektorName(s) {
  if (!s) return 'ringsum';
  const k = Object.entries(SEKTOREN).find(([, v]) => v.s[0] === s[0] && v.s[1] === s[1]);
  return k ? k[0] : 'ringsum';
}

const FARBEN = ['#e0a64a', '#6fb3d9', '#9bd17a', '#d9798d', '#b59be6', '#e6d36f', '#78d6c4', '#e68c5c'];
const farbe = (i) => FARBEN[i % FARBEN.length];

// ── Der Raum (SVG) ─────────────────────────────────────────────────

// Abstand → Radius in der Zeichnung: bis zum Lautsprecherkreis linear,
// darüber hinaus gestaucht, damit „weit weg“ noch aufs Bild passt.
const radius = (a) => (a <= 1 ? a : 1 + Math.min(2, a - 1) * 0.22);
const abstandAus = (r) => (r <= 1 ? r : 1 + (r - 1) / 0.22);
const punktAus = (w, a) => {
  const r = radius(a);
  const rad = (w * Math.PI) / 180;
  return [r * Math.sin(rad), -r * Math.cos(rad)];
};

function raum(s) {
  const aufst = (z.info && z.info.aufstellung) || '7.1';
  const las = AUFSTELLUNGEN[aufst].lautsprecher;
  const svg = h('svg', { viewBox: '-1.6 -1.6 3.2 3.2', class: 'raum', id: 'raum' },
    h('circle', { cx: 0, cy: 0, r: 1, class: 'raum-kreis' }),
    h('circle', { cx: 0, cy: 0, r: 1.44, class: 'raum-fern' }),
    h('circle', { cx: 0, cy: 0, r: 0.5, class: 'raum-nah' }),
    // Hörer, Blick nach vorn
    h('path', { d: 'M -0.07 0.05 L 0 -0.1 L 0.07 0.05 Z', class: 'hoerer' }),
    las.filter((l) => !l.lfe).map((l) => {
      const [x, y] = punktAus(l.winkel, 1);
      return h('g', { class: 'lautsprecher', 'data-id': l.id },
        h('rect', { x: x - 0.06, y: y - 0.06, width: 0.12, height: 0.12, rx: 0.025, transform: `rotate(${l.winkel} ${x} ${y})` }),
        h('text', { x: x * 1.17, y: y * 1.17 + 0.03, 'text-anchor': 'middle' }, l.id));
    }),
    las.some((l) => l.lfe) ? h('g', { class: 'lautsprecher lfe' },
      h('rect', { x: 0.62, y: -1.12, width: 0.14, height: 0.14, rx: 0.03 }),
      h('text', { x: 0.69, y: -1.18, 'text-anchor': 'middle' }, 'LFE')) : null,
    h('g', { id: 'blitze' }));
  s.ebenen.forEach((e, i) => {
    if (e.stumm || !waehlen(e.klang)) return;
    if (e.art === 'zufall') {
      svg.append(sektorBogen(e.sektor || [-180, 180], e.abstand || [0.8, 1.6], farbe(i)));
    } else if (e.ort === 'rundum' || e.ort == null) {
      svg.append(h('circle', { cx: 0, cy: 0, r: 0.78 + (i % 4) * 0.04, class: 'rundum', stroke: farbe(i) }));
    } else {
      svg.append(griff(e, i));
    }
  });
  return svg;
}

function sektorBogen([von, bis], [a1, a2], f) {
  let breite = bis - von;
  if (breite <= 0) breite += 360;
  const r1 = radius(a1);
  const r2 = radius(a2);
  if (breite >= 359) {
    return h('g', null,
      h('circle', { cx: 0, cy: 0, r: (r1 + r2) / 2, class: 'sektor', stroke: f, 'stroke-width': Math.max(0.02, r2 - r1) }));
  }
  const p = (w, r) => {
    const rad = (w * Math.PI) / 180;
    return `${(r * Math.sin(rad)).toFixed(3)} ${(-r * Math.cos(rad)).toFixed(3)}`;
  };
  const gross = breite > 180 ? 1 : 0;
  const d = `M ${p(von, r1)} L ${p(von, r2)} A ${r2} ${r2} 0 ${gross} 1 ${p(von + breite, r2)} L ${p(von + breite, r1)} A ${r1} ${r1} 0 ${gross} 0 ${p(von, r1)} Z`;
  return h('path', { d, class: 'sektor-flaeche', fill: f });
}

function griff(e, i) {
  const ort = e.ort || { winkel: 0, abstand: 1 };
  const [x, y] = punktAus(ort.winkel ?? 0, ort.abstand ?? 1);
  const info = klangInfo(waehlen(e.klang));
  const g = h('g', { class: 'griff', transform: `translate(${x} ${y})` },
    h('circle', { r: 0.075, fill: farbe(i) }),
    h('text', { y: 0.17, 'text-anchor': 'middle' }, info ? kurz(info.name) : ''));
  g.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const svg = g.ownerSVGElement;
    g.setPointerCapture(ev.pointerId);
    let letzte = 0;
    const bewegen = (mv) => {
      const pt = svg.createSVGPoint();
      pt.x = mv.clientX;
      pt.y = mv.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      const r = Math.min(1.44, Math.hypot(p.x, p.y));
      const winkel = Math.round(normWinkel((Math.atan2(p.x, -p.y) * 180) / Math.PI));
      const abstand = +Math.max(0.05, abstandAus(r)).toFixed(2);
      const [nx, ny] = punktAus(winkel, abstand);
      g.setAttribute('transform', `translate(${nx} ${ny})`);
      const jetzt = performance.now();
      if (jetzt - letzte > 40) {
        letzte = jetzt;
        ebeneAendern(i, { ort: { winkel, abstand } });
      }
      g._ort = { winkel, abstand };
    };
    const los = () => {
      g.removeEventListener('pointermove', bewegen);
      g.removeEventListener('pointerup', los);
      if (g._ort) ebeneAendern(i, { ort: g._ort });
    };
    g.addEventListener('pointermove', bewegen);
    g.addEventListener('pointerup', los);
  });
  return g;
}

function kurz(name) {
  const n = name.replace(/\s*\(.*\)$/, '');
  return n.length > 14 ? n.slice(0, 13) + '…' : n;
}

// Ein Ereignis aufleuchten lassen, wo es erklingt.
function blitz(ort, ebene) {
  const ziel = document.getElementById('blitze');
  if (!ziel || !ort) return;
  const [x, y] = punktAus(ort.winkel, ort.abstand ?? 1);
  const c = h('circle', { cx: x, cy: y, r: 0.08, class: 'blitz', fill: ebene >= 0 ? farbe(ebene) : '#fff' });
  ziel.append(c);
  setTimeout(() => c.remove(), 1600);
}

// ── Geräuschleiste ─────────────────────────────────────────────────

const RICHTUNGEN = [
  { k: 0, n: 'vorn' }, { k: 45, n: 'vorn rechts' }, { k: 90, n: 'rechts' }, { k: 135, n: 'hinten rechts' },
  { k: 180, n: 'hinten' }, { k: -135, n: 'hinten links' }, { k: -90, n: 'links' }, { k: -45, n: 'vorn links' },
];

function leisteOrt() {
  if (z.leisteOrt === 'zufall') return { winkel: Math.round(Math.random() * 360 - 180), abstand: 1 + Math.random() * 0.4 };
  if (z.leisteOrt === 'mitte') return { winkel: 0, abstand: 0.1 };
  return { winkel: z.leisteOrt, abstand: 1 };
}

function kompass() {
  const svg = h('svg', { viewBox: '-1.2 -1.2 2.4 2.4', class: 'kompass' });
  RICHTUNGEN.forEach((r) => {
    const rad = (r.k * Math.PI) / 180;
    const x = Math.sin(rad) * 0.82;
    const y = -Math.cos(rad) * 0.82;
    svg.append(h('circle', {
      cx: x, cy: y, r: 0.2, class: 'richtung' + (z.leisteOrt === r.k ? ' an' : ''),
      onclick: () => { z.leisteOrt = r.k; zeichneLeiste(); },
    }, h('title', null, r.n)));
  });
  svg.append(h('circle', { cx: 0, cy: 0, r: 0.26, class: 'richtung' + (z.leisteOrt === 'mitte' ? ' an' : ''), onclick: () => { z.leisteOrt = 'mitte'; zeichneLeiste(); } }, h('title', null, 'mitten im Raum')));
  return svg;
}

function zeichneLeiste() {
  ersetzen($('#leiste'),
    h('div', { class: 'spalten-kopf' }, h('h2', null, 'Geräusche')),
    h('div', { class: 'leiste-ort' },
      kompass(),
      h('div', null,
        h('p', { class: 'fein' }, 'Woher?'),
        h('button', { class: 'knopf klein' + (z.leisteOrt === 'zufall' ? ' gold' : ''), onclick: () => { z.leisteOrt = 'zufall'; zeichneLeiste(); } }, '🎲 zufällig'),
        h('p', { class: 'fein' }, z.leisteOrt === 'zufall' ? 'irgendwo ringsum' : z.leisteOrt === 'mitte' ? 'mitten im Raum' : RICHTUNGEN.find((r) => r.k === z.leisteOrt).n))),
    h('div', { class: 'leiste-raster' },
      LEISTE.map((l) => {
        const id = waehlen(l.klang);
        return h('button', {
          class: 'geraeusch', disabled: !id,
          title: id ? klangInfo(id).name : 'Klang fehlt',
          onclick: async (ev) => {
            if (!z.gestartet) await starten();
            const knopf = ev.currentTarget;
            knopf.classList.add('spielt');
            setTimeout(() => knopf.classList.remove('spielt'), 600);
            try {
              await motor.einzelSpielen(l.klang, leisteOrt(), { lfe: l.lfe ?? 0.3, hall: l.hall ?? 0.15, tonhoehe: l.tonhoehe || 0, bewegung: l.bewegung });
            } catch (f) {
              melden(f.message, 'fehler');
            }
          },
        }, h('span', { class: 'symbol' }, l.symbol), h('small', null, l.name));
      })),
    h('p', { class: 'fein quellen-link' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); dialogAuf('quellen'); } }, 'Quellen & Lizenzen der Aufnahmen')));
}

// ── Dialoge ────────────────────────────────────────────────────────

function dialogAuf(name) {
  z.dialog = name;
  z.filter = '';
  zeichneDialog();
}

function dialogZu() {
  z.dialog = null;
  zeichneDialog();
}

function zeichneDialog() {
  const ziel = $('#dialog');
  if (!z.dialog) {
    ersetzen(ziel);
    ziel.className = '';
    return;
  }
  ziel.className = 'offen';
  const inhalt = { einst: dialogEinst, klaenge: dialogKlaenge, waehlen: dialogWaehlen, quellen: dialogQuellen }[z.dialog]();
  ersetzen(ziel, h('div', { class: 'schleier', onclick: dialogZu }), h('div', { class: 'fenster', role: 'dialog' }, inhalt));
}

function fensterKopf(titel) {
  return h('div', { class: 'fenster-kopf' }, h('h2', null, titel), h('button', { class: 'zu', onclick: dialogZu, title: 'Schließen' }, '✕'));
}

function dialogEinst() {
  const i = z.info;
  const aufst = i ? i.aufstellung : (z.einst.aufstellung === 'auto' ? '7.1' : z.einst.aufstellung);
  const folgen = KANALFOLGEN[aufst];
  const aendern = (a) => {
    Object.assign(z.einst, a);
    einstSichern();
    if (motor && motor.ctx) motor.einstellen(a);
    zeichneDialog();
    zeichneKopf();
  };
  const las = AUFSTELLUNGEN[aufst].lautsprecher;
  return [
    fensterKopf('Ausgang'),
    h('div', { class: 'fenster-innen' },
      i ? h('p', { class: 'hinweis ' + (i.maxKanaele >= 8 ? 'gut' : '') },
        `Das Ausgabegerät meldet ${i.maxKanaele} Kanäle. Gespielt wird in ${AUFSTELLUNGEN[i.aufstellung].name} (${i.kanaele} Kanäle, ${i.abtastrate} Hz).`)
        : h('p', { class: 'hinweis' }, 'Noch nicht gestartet.', ' ', h('button', { class: 'knopf klein gold', onclick: async () => { await starten(); zeichneDialog(); } }, '▶ Starten')),
      h('div', { class: 'feld-reihe' },
        h('label', { class: 'auswahl' }, h('span', null, 'Aufstellung'),
          h('select', { onchange: (e) => aendern({ aufstellung: e.target.value, folge: 'standard' }) },
            [['auto', 'Automatisch (was das Gerät kann)'], ['7.1', '7.1'], ['5.1', '5.1'], ['stereo', 'Stereo']].map(([k, n]) =>
              h('option', { value: k, selected: z.einst.aufstellung === k }, n)))),
        h('label', { class: 'auswahl' }, h('span', null, 'Kanalfolge'),
          h('select', { onchange: (e) => aendern({ folge: e.target.value }), disabled: Object.keys(folgen).length < 2 },
            Object.keys(folgen).map((k) => h('option', { value: k, selected: (i ? i.folge : z.einst.folge) === k }, KANALFOLGE_NAMEN[k] || k))))),
      h('h3', null, 'Lautsprechertest'),
      h('p', { class: 'fein' }, 'Ein Klick: Rauschen nur aus diesem Lautsprecher. Kommt es woanders heraus, die Kanalfolge wechseln. Der Subwoofer bekommt einen tiefen Ton.'),
      i ? h('div', { class: 'test-raum' },
        las.map((l, idx) => {
          const pos = l.lfe ? { left: '78%', top: '8%' } : (() => {
            const [x, y] = punktAus(l.winkel, 1);
            return { left: 50 + x * 38 + '%', top: 50 + y * 38 + '%' };
          })();
          return h('button', { class: 'test-knopf', 'data-test': idx, style: pos, onclick: () => motor.testKanal(idx) }, h('b', null, l.id), h('small', null, l.name));
        }),
        h('div', { class: 'test-hoerer' }, '🙂'),
        h('button', { class: 'knopf klein test-umlauf', onclick: () => motor.testUmlauf(10) }, '↻ Umlauf')) : null,
      h('h3', null, 'Mischung'),
      schieber('Center bei Ambiente', z.einst.center, 0, 1, 0.05, (v) => aendern({ center: v })),
      schieber('Subwoofer', z.einst.lfe, 0, 1, 0.05, (v) => aendern({ lfe: v })),
      schieber('Überblenden', z.einst.ueberblenden, 0, 12, 0.5, (v) => aendern({ ueberblenden: v }), (v) => v + ' s'),
      h('h3', null, 'So kommt 7.1 aus dem Browser'),
      h('ol', { class: 'anleitung' },
        h('li', null, 'Rechner per ', h('b', null, 'HDMI'), ' an den AV-Receiver (oder eine 7.1-Soundkarte mit analogen Ausgängen). Optisch/S/PDIF trägt kein 7.1.'),
        h('li', null, 'Windows: Systemsteuerung → Sound → Wiedergabegerät → ', h('i', null, 'Konfigurieren'), ' → ', h('b', null, '7.1-Surround'), '. Unter macOS: Audio-MIDI-Setup → Lautsprecher konfigurieren.'),
        h('li', null, 'Chrome, Edge oder Firefox benutzen und die Seite neu laden. Oben muss dann „7.1 · 8 Kanäle“ stehen.'),
        h('li', null, 'Der Receiver bekommt 8 Kanäle PCM und spielt sie so, wie sie kommen — Dolby-Kodierung ist dafür nicht nötig. Sein Upmixer (Dolby Surround/DTS Neural:X) sollte für PCM aus sein, sonst mischt er um.')),
      h('p', { class: 'fein' }, 'Meldet das Gerät nur 2 Kanäle, spielt die Klangkulisse Stereo: hinten wird links/rechts, und die Bewegungen bleiben hörbar.')),
  ];
}

function dialogKlaenge() {
  const hochladen = async (dateien, art) => {
    let n = 0;
    for (const d of dateien) {
      if (!/^audio\//.test(d.type) && !/\.(ogg|oga|opus|mp3|wav|flac|m4a|aac|webm)$/i.test(d.name)) continue;
      try {
        await eigeneKlaenge.ablegen(d, art);
        n++;
      } catch (f) {
        melden(`${d.name}: ${f.message}`, 'fehler');
      }
    }
    z.eigene = await eigeneKlaenge.liste();
    melden(`${n} Datei(en) übernommen.`);
    zeichneDialog();
    zeichneSzenen();
  };
  const zone = h('div', { class: 'ablage' },
    h('p', null, 'Dateien hierher ziehen oder wählen (OGG, MP3, WAV, FLAC, M4A).'),
    h('div', { class: 'feld-reihe' },
      h('label', { class: 'knopf' }, '+ als Schleife',
        h('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true, onchange: (e) => hochladen(e.target.files, 'bett') })),
      h('label', { class: 'knopf' }, '+ als Einzelgeräusch',
        h('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true, onchange: (e) => hochladen(e.target.files, 'einzel') })),
      h('label', { class: 'knopf' }, '+ als Musik',
        h('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true, onchange: (e) => hochladen(e.target.files, 'musik') }))));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drueber'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drueber'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drueber'); hochladen(e.dataTransfer.files, 'bett'); });
  return [
    fensterKopf('Eigene Klänge'),
    h('div', { class: 'fenster-innen' },
      h('p', { class: 'fein' }, 'Eigene Dateien bleiben in diesem Browser (IndexedDB) und gehen nirgendwohin. In jeder Szene unter „+ Ebene hinzufügen“ zu finden.'),
      zone,
      z.eigene.length ? h('table', { class: 'liste' },
        h('tr', null, h('th', null, 'Name'), h('th', null, 'Art'), h('th', null, 'Größe'), h('th')),
        z.eigene.map((e) => h('tr', null,
          h('td', null, h('input', { value: e.name, onchange: async (ev) => { await eigeneKlaenge.aendern(e.id, { name: ev.target.value }); z.eigene = await eigeneKlaenge.liste(); } })),
          h('td', null, h('select', { onchange: async (ev) => { await eigeneKlaenge.aendern(e.id, { art: ev.target.value }); z.eigene = await eigeneKlaenge.liste(); } },
            Object.entries(ART_NAME_KLANG).map(([k, n]) => h('option', { value: k, selected: e.art === k }, n)))),
          h('td', null, Math.round(e.bytes / 1024) + ' kB'),
          h('td', null,
            h('button', { class: 'knopf klein', onclick: () => vorhoeren(e.id) }, '▶'),
            h('button', { class: 'knopf klein warn', onclick: async () => { if (!confirm(`„${e.name}“ löschen?`)) return; await eigeneKlaenge.loeschen(e.id); z.eigene = await eigeneKlaenge.liste(); motor.puffer.delete(e.id); zeichneDialog(); zeichneSzenen(); } }, '🗑'))))) : h('p', { class: 'fein mitte' }, 'Noch keine eigenen Klänge.')),
  ];
}

const ART_NAME_KLANG = { bett: 'Schleife', einzel: 'Einzelgeräusch', musik: 'Musik' };

async function vorhoeren(id) {
  if (!z.gestartet) await starten();
  try {
    await motor.einzelSpielen(id, { winkel: 0, abstand: 0.9 }, { hall: 0, lfe: 0.2 });
  } catch (f) {
    melden(f.message, 'fehler');
  }
}

function dialogWaehlen() {
  const liste = h('div', { class: 'klang-liste' });
  const fuellen = () => {
    const f = z.filter.trim().toLowerCase();
    const gruppen = new Map();
    for (const k of alleKlaenge()) {
      if (f && !(k.name + ' ' + k.gruppe + ' ' + k.id).toLowerCase().includes(f)) continue;
      if (!gruppen.has(k.gruppe)) gruppen.set(k.gruppe, []);
      gruppen.get(k.gruppe).push(k);
    }
    ersetzen(liste, [...gruppen].sort((a, b) => a[0].localeCompare(b[0])).map(([g, ks]) => h('div', { class: 'klang-gruppe' },
      h('h3', null, g),
      ks.map((k) => h('div', { class: 'klang-eintrag' },
        h('button', { class: 'knopf klein', title: 'Vorhören', onclick: () => vorhoeren(k.id) }, '▶'),
        h('span', { class: 'klang-name' }, k.name, h('small', null, ART_NAME_KLANG[k.art] || k.art, k.erzeugt ? ' · erzeugt' : '', k.quelle ? ' · ' + k.quelle.lizenz : '')),
        h('button', { class: 'knopf klein gold', onclick: () => ebeneDazu(k) }, '+ dazu'))))));
  };
  fuellen();
  return [
    fensterKopf('Ebene hinzufügen'),
    h('div', { class: 'fenster-innen' },
      h('input', { class: 'suche', placeholder: 'Suchen … (Regen, Wolf, Feuer)', value: z.filter, oninput: (e) => { z.filter = e.target.value; fuellen(); } }),
      liste),
  ];
}

function ebeneDazu(k) {
  const art = k.art === 'einzel' ? 'zufall' : k.art;
  const e = { klang: k.id, art, pegel: 0.6 };
  if (art === 'zufall') Object.assign(e, { intervall: [10, 40], sektor: [-180, 180], abstand: [1, 2], hall: 0.2 });
  else if (art === 'musik') Object.assign(e, { ort: { winkel: 0, abstand: 1.2 } });
  else e.ort = 'rundum';
  z.aktiv.ebenen.push(e);
  z.offen = z.aktiv.ebenen.length - 1;
  dialogZu();
  szeneNeu();
}

function dialogQuellen() {
  const gruppen = [...new Set(z.katalog.map((k) => k.gruppe))];
  return [
    fensterKopf('Quellen & Lizenzen'),
    h('div', { class: 'fenster-innen' },
      h('p', null, 'Die Aufnahmen stammen von Wikimedia Commons und OpenGameArt und stehen unter freien Lizenzen (CC0, gemeinfrei, CC BY, CC BY-SA). Sie wurden zugeschnitten, zu Schleifen geblendet und neu kodiert. Die erzeugten Klänge (Regen, Wind, Feuer, Donner …) rechnet die Klangkulisse selbst.'),
      !z.katalog.length ? h('p', { class: 'hinweis' }, 'Noch keine Aufnahmen geladen.') : null,
      gruppen.map((g) => h('div', null,
        h('h3', null, g),
        h('table', { class: 'liste quellen' },
          z.katalog.filter((k) => k.gruppe === g).map((k) => h('tr', null,
            h('td', null, k.name),
            h('td', null, h('a', { href: k.quelle.seite, target: '_blank', rel: 'noopener' }, k.quelle.urheber)),
            h('td', null, k.quelle.lizenzUrl ? h('a', { href: k.quelle.lizenzUrl, target: '_blank', rel: 'noopener' }, k.quelle.lizenz) : k.quelle.lizenz))))))),
  ];
}

function testAnzeige(index, dauer) {
  const k = document.querySelector(`[data-test="${index}"]`);
  if (!k) return;
  k.classList.add('spielt');
  setTimeout(() => k.classList.remove('spielt'), dauer * 1000);
}

function zeichneMeldungen() {
  ersetzen($('#meldungen'), z.meldungen.map((m) => h('div', { class: 'meldung ' + m.art }, m.text)));
}

vorbereiten();
