// Der Raum: wo die Lautsprecher stehen und wie viel jeder von einer
// Quelle bekommt. Reine Rechnung, ohne Web Audio — läuft im Browser und
// unter Node (test/pruefen.mjs).
//
// Winkel in Grad, von oben gesehen: 0 = vorn, +90 = rechts, −90 = links,
// ±180 = hinten. Abstand 0 = mitten im Kopf des Hörers, 1 = am Rand des
// Raums (dort, wo die Lautsprecher stehen), darüber = weiter weg.

// Die Aufstellungen nach ITU-R BS.775 / Dolby. Die Reihenfolge hier ist
// die der Lautsprecher im Raum — welcher Ausgangskanal zu welchem
// Lautsprecher geht, steht in KANALFOLGEN.
export const AUFSTELLUNGEN = {
  stereo: {
    name: 'Stereo',
    lautsprecher: [
      { id: 'FL', name: 'Links', winkel: -30 },
      { id: 'FR', name: 'Rechts', winkel: 30 },
    ],
  },
  '5.1': {
    name: '5.1',
    lautsprecher: [
      { id: 'FL', name: 'Vorn links', winkel: -30 },
      { id: 'FR', name: 'Vorn rechts', winkel: 30 },
      { id: 'FC', name: 'Center', winkel: 0 },
      { id: 'LFE', name: 'Subwoofer', lfe: true },
      { id: 'SL', name: 'Surround links', winkel: -110 },
      { id: 'SR', name: 'Surround rechts', winkel: 110 },
    ],
  },
  '7.1': {
    name: '7.1',
    lautsprecher: [
      { id: 'FL', name: 'Vorn links', winkel: -30 },
      { id: 'FR', name: 'Vorn rechts', winkel: 30 },
      { id: 'FC', name: 'Center', winkel: 0 },
      { id: 'LFE', name: 'Subwoofer', lfe: true },
      { id: 'SL', name: 'Seite links', winkel: -90 },
      { id: 'SR', name: 'Seite rechts', winkel: 90 },
      { id: 'BL', name: 'Hinten links', winkel: -150 },
      { id: 'BR', name: 'Hinten rechts', winkel: 150 },
    ],
  },
};

// Welcher Ausgangskanal (Index) welchen Lautsprecher trägt. Der Browser
// reicht die Kanäle unverändert ans Betriebssystem weiter
// (channelInterpretation 'discrete'), also gilt dessen Reihenfolge.
// Windows (WAVEFORMATEXTENSIBLE) — und damit Chrome, Edge und Firefox
// unter Windows: FL FR FC LFE BL BR SL SR. Andere Geräte ordnen anders;
// der Lautsprechertest zeigt, ob es stimmt, und die Zuordnung lässt sich
// von Hand ändern.
export const KANALFOLGEN = {
  stereo: { standard: ['FL', 'FR'] },
  '5.1': {
    standard: ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'],
    alsa: ['FL', 'FR', 'SL', 'SR', 'FC', 'LFE'],
  },
  '7.1': {
    standard: ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR'],
    alsa: ['FL', 'FR', 'BL', 'BR', 'FC', 'LFE', 'SL', 'SR'],
    'seite-zuerst': ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR', 'BL', 'BR'],
  },
};

export const KANALFOLGE_NAMEN = {
  standard: 'Windows / HDMI (FL FR C LFE BL BR SL SR)',
  alsa: 'Linux ALSA (FL FR BL BR C LFE SL SR)',
  'seite-zuerst': 'Seite vor Hinten (FL FR C LFE SL SR BL BR)',
};

export function kanalZahl(aufstellung) {
  return AUFSTELLUNGEN[aufstellung].lautsprecher.length;
}

// Die passende Aufstellung zu dem, was das Gerät kann.
export function aufstellungFuer(maxKanaele) {
  if (maxKanaele >= 8) return '7.1';
  if (maxKanaele >= 6) return '5.1';
  return 'stereo';
}

// Winkel auf (−180, 180] bringen.
export function normWinkel(w) {
  let x = ((w + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

// Die Lautsprecher des Rings (ohne LFE), nach Winkel geordnet.
function ring(aufstellung, mitCenter) {
  return AUFSTELLUNGEN[aufstellung].lautsprecher
    .map((l, i) => ({ ...l, index: i }))
    .filter((l) => !l.lfe && (mitCenter || l.id !== 'FC'))
    .sort((a, b) => a.winkel - b.winkel);
}

// Paarweises Amplitudenpanning (2D-VBAP mit Sinus/Kosinus-Überblendung):
// die Quelle liegt zwischen zwei Nachbarn im Ring und teilt ihre Leistung
// zwischen ihnen. Bei Stereo liegt "hinten" außerhalb des Paars — dort wird
// der Winkel auf die Vorderseite gespiegelt (hinten links klingt links).
function paarGewichte(aufstellung, winkel, mitCenter) {
  const r = ring(aufstellung, mitCenter);
  const n = AUFSTELLUNGEN[aufstellung].lautsprecher.length;
  const g = new Array(n).fill(0);
  let w = normWinkel(winkel);
  if (aufstellung === 'stereo') {
    if (w > 90) w = 180 - w;
    if (w < -90) w = -180 - w;
    const p = Math.min(1, Math.max(0, (w + 30) / 60));
    g[r[0].index] = Math.cos(p * Math.PI / 2);
    g[r[1].index] = Math.sin(p * Math.PI / 2);
    // Außerhalb des Paars (über ±30°) bleibt es ganz auf einer Seite.
    return g;
  }
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    let von = a.winkel;
    let bis = b.winkel;
    if (bis <= von) bis += 360; // das Paar über hinten (BR → BL)
    let x = w;
    if (x < von) x += 360;
    if (x >= von && x <= bis) {
      const p = (x - von) / (bis - von);
      g[a.index] += Math.cos(p * Math.PI / 2);
      g[b.index] += Math.sin(p * Math.PI / 2);
      return g;
    }
  }
  return g;
}

// Die Gewichte je Ausgang (in der Reihenfolge der Aufstellung) für eine
// Quelle. Leistungserhaltend: die Summe der Quadrate ist 1 (ohne LFE).
//
//   breite   0 = punktgenau, 1 = gleichmäßig aus allen Lautsprechern
//   abstand  nahe 0 wird die Quelle von selbst breit — sie ist "überall"
//   center   0..1, wie stark der Center mitspielt (für Ambiente oft 0)
//   lfe      0..1, Anteil für den Subwoofer (er bekommt nur Bässe)
export function gewichte(aufstellung, { winkel = 0, breite = 0, abstand = 1, center = 1, lfe = 0 } = {}) {
  const las = AUFSTELLUNGEN[aufstellung].lautsprecher;
  const n = las.length;
  const mitCenter = center > 0 && las.some((l) => l.id === 'FC');
  const punkt = paarGewichte(aufstellung, winkel, mitCenter);
  // Der Center wird abgeschwächt, nicht ausgelassen: was er nicht trägt,
  // geht an das Paar, als stünde er nicht da.
  let g = punkt;
  if (mitCenter && center < 1) {
    const ohne = paarGewichte(aufstellung, winkel, false);
    g = punkt.map((v, i) => Math.sqrt(center * v * v + (1 - center) * ohne[i] * ohne[i]));
  }
  // Nah am Hörer verliert eine Quelle ihre Richtung.
  const nah = Math.max(0, Math.min(1, 1 - abstand * 2));
  const b = Math.max(0, Math.min(1, Math.max(breite, nah)));
  if (b > 0) {
    const teilnehmer = las.map((l, i) => (!l.lfe && (mitCenter || l.id !== 'FC') ? i : -1)).filter((i) => i >= 0);
    const gleich = 1 / Math.sqrt(teilnehmer.length);
    g = g.map((v, i) => (teilnehmer.includes(i) ? Math.sqrt((1 - b) * v * v + b * gleich * gleich) : 0));
  }
  // Auf Leistung 1 bringen.
  const summe = Math.sqrt(g.reduce((s, v) => s + v * v, 0)) || 1;
  g = g.map((v) => v / summe);
  const lfeIndex = las.findIndex((l) => l.lfe);
  if (lfeIndex >= 0) g[lfeIndex] = Math.max(0, Math.min(1, lfe));
  return g;
}

// Lautstärke und Höhendämpfung aus dem Abstand: jenseits des Rings wird es
// leiser und dumpfer, wie im Freien.
export function abstandsWirkung(abstand) {
  const d = Math.max(0, abstand);
  const pegel = d <= 1 ? 1 : 1 / (1 + (d - 1) * 1.5);
  const tiefpass = d <= 1 ? 20000 : Math.max(800, 20000 / (1 + (d - 1) * 4));
  return { pegel, tiefpass };
}

// Ordnet die Gewichte (Reihenfolge der Aufstellung) auf die Ausgangskanäle
// des Geräts um.
export function aufKanaele(aufstellung, folge, g) {
  const las = AUFSTELLUNGEN[aufstellung].lautsprecher;
  const reihe = (KANALFOLGEN[aufstellung][folge] || KANALFOLGEN[aufstellung].standard);
  return reihe.map((id) => g[las.findIndex((l) => l.id === id)]);
}

// Zufälliger Ort in einem Sektor. Ein Sektor [von, bis] wird im
// Uhrzeigersinn gelesen: [150, −150] ist das Stück hinten.
export function zufallsOrt(sektor, abstandVon, abstandBis, zufall = Math.random) {
  const [von, bis] = sektor || [-180, 180];
  let breite = bis - von;
  if (breite <= 0) breite += 360;
  return {
    winkel: normWinkel(von + zufall() * breite),
    abstand: abstandVon + zufall() * (abstandBis - abstandVon),
  };
}
