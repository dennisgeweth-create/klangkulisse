// Die mitgelieferten Szenen. Eine Szene ist eine Liste von Ebenen:
//
//   klang     Kennung (Katalog, 'synth:…' oder 'eigen:…') — oder eine Liste,
//             dann gilt die erste, die es gibt (Aufnahme, sonst erzeugt)
//   art       'bett'   läuft in Schleife
//             'musik'  läuft in Schleife, vorn, nicht rundum
//             'zufall' einzelne Ereignisse in zufälligen Abständen
//   pegel     0..1
//   ort       'rundum' oder { winkel, abstand } (Grad; 0 vorn, 90 rechts)
//   breite    0..1, wie sehr die Quelle sich verteilt
//   lfe       0..1, Anteil für den Subwoofer
//   hall      0..1, Anteil für den Hall der Szene
//   intervall [min, max] Sekunden zwischen zwei Ereignissen (zufall)
//   sektor    [von, bis] Grad, im Uhrzeigersinn, wo Ereignisse auftauchen
//   abstand   [min, max] für Ereignisse
//   tonhoehe  Halbtöne, tonStreu: zufällige Abweichung in Halbtönen
//   bewegung  'vorbei': das Ereignis zieht am Hörer vorbei
//
// hall der Szene: { dauer: Sekunden, daempfung: 0..1 }

export const SZENEN = [
  {
    id: 'gaststube', name: 'Gaststube', gruppe: 'Orte', symbol: '🍺',
    beschreibung: 'Volle Wirtsstube, Feuer im Kamin, Spielleute in der Ecke.',
    hall: { dauer: 1.2, daempfung: 0.7 },
    ebenen: [
      { klang: 'gasthaus', art: 'bett', pegel: 0.75, ort: 'rundum' },
      { klang: 'gespraech', art: 'bett', pegel: 0.3, ort: { winkel: 40, abstand: 0.9 }, hall: 0.2 },
      { klang: ['feuer-gras', 'synth:feuer'], art: 'bett', pegel: 0.45, ort: { winkel: -100, abstand: 0.7 }, lfe: 0.2 },
      { klang: 'musik-machaut', art: 'musik', pegel: 0.35, ort: { winkel: 130, abstand: 1.2 }, spreizung: 20, hall: 0.3 },
      { klang: 'muenzen', art: 'zufall', pegel: 0.4, intervall: [20, 60], sektor: [-60, 60], abstand: [0.6, 1.2], hall: 0.2 },
      { klang: 'klopfen', art: 'zufall', pegel: 0.3, intervall: [40, 110], sektor: [150, -150], abstand: [1.2, 1.6], hall: 0.3 },
    ],
  },
  {
    id: 'lagerfeuer', name: 'Lagerfeuer bei Nacht', gruppe: 'Wildnis', symbol: '🔥',
    beschreibung: 'Das Feuer vor euch, Grillen ringsum, im Dunkeln ruft ein Kauz.',
    hall: { dauer: 2.5, daempfung: 0.8 },
    ebenen: [
      { klang: ['lagerfeuer', 'synth:feuer'], art: 'bett', pegel: 0.8, ort: { winkel: 0, abstand: 0.55 }, breite: 0.2, lfe: 0.35 },
      { klang: 'synth:grillen', art: 'bett', pegel: 0.5, ort: 'rundum' },
      { klang: 'wald-nacht', art: 'bett', pegel: 0.45, ort: 'rundum' },
      { klang: 'kauz', art: 'zufall', pegel: 0.55, intervall: [25, 70], sektor: [100, -100], abstand: [1.3, 2.2], hall: 0.4 },
      { klang: 'schleiereule', art: 'zufall', pegel: 0.4, intervall: [60, 160], sektor: [-180, 180], abstand: [1.5, 2.5], hall: 0.4 },
      { klang: 'wolf', art: 'zufall', pegel: 0.45, intervall: [70, 200], sektor: [-180, 180], abstand: [2, 3], hall: 0.6 },
    ],
  },
  {
    id: 'wald', name: 'Wald am Morgen', gruppe: 'Wildnis', symbol: '🌲',
    beschreibung: 'Vogelstimmen, ein Bach zur Rechten, irgendwo hämmert ein Specht.',
    hall: { dauer: 1.8, daempfung: 0.8 },
    ebenen: [
      { klang: 'wald-morgen', art: 'bett', pegel: 0.75, ort: 'rundum' },
      { klang: ['bach', 'synth:bach'], art: 'bett', pegel: 0.4, ort: { winkel: 80, abstand: 1.1 } },
      { klang: 'synth:wind', art: 'bett', pegel: 0.15, ort: 'rundum' },
      { klang: 'specht', art: 'zufall', pegel: 0.45, intervall: [30, 90], sektor: [-160, 160], abstand: [1.4, 2.2], hall: 0.3 },
      { klang: 'kuckuck', art: 'zufall', pegel: 0.35, intervall: [45, 120], sektor: [-180, 180], abstand: [1.8, 2.6], hall: 0.3 },
    ],
  },
  {
    id: 'gewitter', name: 'Gewitter', gruppe: 'Wetter', symbol: '⛈',
    beschreibung: 'Prasselnder Regen, Böen, Donner rollt von allen Seiten heran.',
    hall: { dauer: 3, daempfung: 0.6 },
    ebenen: [
      { klang: ['regen-stark', 'synth:platzregen'], art: 'bett', pegel: 0.8, ort: 'rundum' },
      { klang: 'synth:wind', art: 'bett', pegel: 0.35, ort: 'rundum' },
      { klang: ['donner-grollen', 'synth:donner'], art: 'zufall', pegel: 0.8, intervall: [12, 35], sektor: [-180, 180], abstand: [1.5, 2.5], lfe: 0.9, hall: 0.3, breite: 0.4 },
      { klang: ['donner-schlag', 'synth:donner-nah'], art: 'zufall', pegel: 0.9, intervall: [40, 110], sektor: [-180, 180], abstand: [0.9, 1.3], lfe: 1, hall: 0.2, breite: 0.2 },
    ],
  },
  {
    id: 'kueste', name: 'Sturm an der Küste', gruppe: 'Wetter', symbol: '🌊',
    beschreibung: 'Brecher an den Klippen, Möwen im Wind.',
    hall: { dauer: 2, daempfung: 0.8 },
    ebenen: [
      { klang: ['brandung', 'synth:brandung'], art: 'bett', pegel: 0.85, ort: 'rundum', lfe: 0.4 },
      { klang: ['sturm', 'synth:sturmheulen'], art: 'bett', pegel: 0.5, ort: 'rundum' },
      { klang: 'moewe', art: 'zufall', pegel: 0.5, intervall: [8, 30], sektor: [-120, 120], abstand: [1.2, 2.2], hall: 0.2, bewegung: 'vorbei' },
    ],
  },
  {
    id: 'hafen', name: 'Hafen', gruppe: 'Orte', symbol: '⚓',
    beschreibung: 'Boote schlagen an den Steg, Wellen am Kai, eine Glocke in der Ferne.',
    hall: { dauer: 1.5, daempfung: 0.7 },
    ebenen: [
      { klang: 'hafen', art: 'bett', pegel: 0.7, ort: { winkel: -30, abstand: 0.8 }, breite: 0.4 },
      { klang: ['kiesstrand', 'synth:brandung'], art: 'bett', pegel: 0.45, ort: 'rundum' },
      { klang: 'moewe', art: 'zufall', pegel: 0.45, intervall: [10, 35], sektor: [-180, 180], abstand: [1.2, 2.2], bewegung: 'vorbei' },
      { klang: 'glocke', art: 'zufall', pegel: 0.3, intervall: [80, 200], sektor: [120, -120], abstand: [2.5, 3.5], hall: 0.5 },
    ],
  },
  {
    id: 'hoehle', name: 'Tropfsteinhöhle', gruppe: 'Unterwelt', symbol: '🦇',
    beschreibung: 'Tropfen hallen durch die Kammer, tief im Fels grollt es.',
    hall: { dauer: 4.5, daempfung: 0.4 },
    ebenen: [
      { klang: 'hoehle-tropfen', art: 'bett', pegel: 0.55, ort: 'rundum', hall: 0.3 },
      { klang: 'synth:flaeche-dunkel', art: 'bett', pegel: 0.2, ort: 'rundum', lfe: 0.3 },
      { klang: 'synth:tropfen', art: 'zufall', pegel: 0.5, intervall: [0.8, 5], sektor: [-180, 180], abstand: [0.6, 1.8], hall: 0.9, tonStreu: 2 },
      { klang: 'fledermaeuse', art: 'bett', pegel: 0.15, ort: { winkel: 160, abstand: 1.8 }, breite: 0.4, hall: 0.6 },
      { klang: 'synth:grollen', art: 'zufall', pegel: 0.6, intervall: [60, 180], sektor: [-180, 180], abstand: [1.5, 2], lfe: 1, breite: 0.6, hall: 0.3 },
    ],
  },
  {
    id: 'verlies', name: 'Verlies', gruppe: 'Unterwelt', symbol: '⛓',
    beschreibung: 'Feuchter Stein, rostige Riegel, irgendwo seufzt jemand.',
    hall: { dauer: 3.2, daempfung: 0.5 },
    ebenen: [
      { klang: ['drohne-keller', 'synth:flaeche-dunkel'], art: 'bett', pegel: 0.35, ort: 'rundum' },
      { klang: 'synth:tropfen', art: 'zufall', pegel: 0.4, intervall: [2, 9], sektor: [-180, 180], abstand: [0.8, 1.6], hall: 0.8 },
      { klang: 'riegel', art: 'zufall', pegel: 0.45, intervall: [35, 90], sektor: [90, -90], abstand: [1.5, 2.2], hall: 0.7 },
      { klang: 'wendeltreppe', art: 'zufall', pegel: 0.4, intervall: [70, 180], sektor: [120, -120], abstand: [1.6, 2.4], hall: 0.6 },
      { klang: 'seufzer', art: 'zufall', pegel: 0.35, intervall: [45, 120], sektor: [-180, 180], abstand: [1.2, 2], hall: 0.7 },
      { klang: 'atmen', art: 'bett', pegel: 0.12, ort: { winkel: 170, abstand: 1.6 }, hall: 0.5, stumm: true },
    ],
  },
  {
    id: 'gruft', name: 'Gruft', gruppe: 'Unterwelt', symbol: '💀',
    beschreibung: 'Eine kalte Fläche, ein schlagendes Herz, Krähen über dem Friedhof.',
    hall: { dauer: 3.8, daempfung: 0.45 },
    ebenen: [
      { klang: 'synth:flaeche-dunkel', art: 'bett', pegel: 0.35, ort: 'rundum', lfe: 0.3 },
      { klang: ['drohne-tunnel', 'synth:wind'], art: 'bett', pegel: 0.3, ort: 'rundum' },
      { klang: 'synth:herz', art: 'bett', pegel: 0.25, ort: { winkel: 0, abstand: 0.2 }, lfe: 0.8 },
      { klang: 'kraehe', art: 'zufall', pegel: 0.4, intervall: [25, 70], sektor: [-180, 180], abstand: [1.8, 2.8], hall: 0.5 },
      { klang: 'glocke', art: 'zufall', pegel: 0.3, intervall: [90, 240], sektor: [150, -150], abstand: [2.5, 3.5], hall: 0.7, tonhoehe: -3 },
    ],
  },
  {
    id: 'drachenhort', name: 'Drachenhort', gruppe: 'Kampf', symbol: '🐉',
    beschreibung: 'Glut, Atem wie ein Blasebalg, und dann das Brüllen.',
    hall: { dauer: 4, daempfung: 0.4 },
    ebenen: [
      { klang: 'synth:grossfeuer', art: 'bett', pegel: 0.45, ort: { winkel: 0, abstand: 1.4 }, breite: 0.5, lfe: 0.5 },
      { klang: 'synth:flaeche-dunkel', art: 'bett', pegel: 0.3, ort: 'rundum', lfe: 0.6 },
      { klang: 'synth:herz-schnell', art: 'bett', pegel: 0.2, ort: { winkel: 0, abstand: 0.1 }, lfe: 0.8, stumm: true },
      { klang: ['bruellen', 'monster'], art: 'zufall', pegel: 0.9, intervall: [25, 60], sektor: [-60, 60], abstand: [1.2, 1.8], lfe: 1, hall: 0.6, tonhoehe: -6, tonStreu: 1.5 },
      { klang: 'synth:grollen', art: 'zufall', pegel: 0.6, intervall: [30, 80], sektor: [-180, 180], abstand: [1.2, 2], lfe: 1, breite: 0.7 },
    ],
  },
  {
    id: 'schlacht', name: 'Schlacht', gruppe: 'Kampf', symbol: '⚔',
    beschreibung: 'Kriegstrommeln, Stahl auf Stahl, Sehnen schnellen.',
    hall: { dauer: 2, daempfung: 0.7 },
    ebenen: [
      { klang: 'synth:trommeln', art: 'bett', pegel: 0.6, ort: { winkel: 0, abstand: 1.4 }, breite: 0.3, lfe: 0.7, hall: 0.3 },
      { klang: 'synth:wind', art: 'bett', pegel: 0.25, ort: 'rundum' },
      { klang: 'metall', art: 'zufall', pegel: 0.6, intervall: [0.6, 3], sektor: [-110, 110], abstand: [0.8, 2], hall: 0.3, tonStreu: 2 },
      { klang: 'bogen', art: 'zufall', pegel: 0.5, intervall: [3, 10], sektor: [-180, 180], abstand: [0.8, 1.6], hall: 0.2 },
      { klang: 'schrei', art: 'zufall', pegel: 0.35, intervall: [15, 45], sektor: [-150, 150], abstand: [1.8, 2.8], hall: 0.5 },
      { klang: 'horn', art: 'zufall', pegel: 0.4, intervall: [60, 150], sektor: [-60, 60], abstand: [2.5, 3.5], hall: 0.6 },
    ],
  },
  {
    id: 'markt', name: 'Marktplatz', gruppe: 'Orte', symbol: '🛒',
    beschreibung: 'Gedränge, Hufe auf Pflaster, der Schmied hämmert am Rand.',
    hall: { dauer: 1.6, daempfung: 0.7 },
    ebenen: [
      { klang: 'markt', art: 'bett', pegel: 0.65, ort: 'rundum' },
      { klang: 'markt-ferne', art: 'bett', pegel: 0.25, ort: { winkel: 170, abstand: 1.8 }, breite: 0.5 },
      { klang: 'hufe-pflaster', art: 'bett', pegel: 0.25, ort: { winkel: -80, abstand: 1.4 } },
      { klang: 'schmiede', art: 'bett', pegel: 0.25, ort: { winkel: 110, abstand: 1.8 }, hall: 0.3 },
      { klang: 'hahn', art: 'zufall', pegel: 0.35, intervall: [40, 100], sektor: [-180, 180], abstand: [1.5, 2.5] },
      { klang: 'ziegen', art: 'zufall', pegel: 0.35, intervall: [30, 90], sektor: [-180, 180], abstand: [1.2, 2] },
    ],
  },
  {
    id: 'schmiede', name: 'Schmiede', gruppe: 'Orte', symbol: '⚒',
    beschreibung: 'Die Esse faucht, der Hammer fällt auf den Amboss.',
    hall: { dauer: 1.4, daempfung: 0.6 },
    ebenen: [
      { klang: 'schmiede', art: 'bett', pegel: 0.75, ort: { winkel: -20, abstand: 0.8 }, breite: 0.3, hall: 0.3 },
      { klang: ['esse', 'synth:grossfeuer'], art: 'bett', pegel: 0.45, ort: { winkel: 50, abstand: 0.9 }, lfe: 0.4 },
      { klang: 'schleifen', art: 'zufall', pegel: 0.4, intervall: [40, 100], sektor: [100, 170], abstand: [1, 1.5], hall: 0.3 },
    ],
  },
  {
    id: 'sumpf', name: 'Sumpf', gruppe: 'Wildnis', symbol: '🐸',
    beschreibung: 'Froschchor, stehendes Wasser, Krähen über dem Schilf.',
    hall: { dauer: 2, daempfung: 0.8 },
    ebenen: [
      { klang: 'froesche', art: 'bett', pegel: 0.65, ort: 'rundum' },
      { klang: 'teich', art: 'bett', pegel: 0.4, ort: 'rundum' },
      { klang: 'synth:flaeche-dunkel', art: 'bett', pegel: 0.1, ort: 'rundum' },
      { klang: 'kraehe', art: 'zufall', pegel: 0.4, intervall: [30, 90], sektor: [-180, 180], abstand: [1.5, 2.5], hall: 0.3 },
    ],
  },
  {
    id: 'schneesturm', name: 'Schneesturm', gruppe: 'Wetter', symbol: '❄',
    beschreibung: 'Eisiger Wind am Pass, Wölfe heulen in der Ferne.',
    hall: { dauer: 3, daempfung: 0.7 },
    ebenen: [
      { klang: ['wind-schnee', 'synth:wind'], art: 'bett', pegel: 0.6, ort: 'rundum' },
      { klang: ['wind-heulen', 'synth:sturmheulen'], art: 'bett', pegel: 0.5, ort: 'rundum' },
      { klang: 'wolf', art: 'zufall', pegel: 0.4, intervall: [50, 140], sektor: [-180, 180], abstand: [2.2, 3.2], hall: 0.6 },
      { klang: 'schnee-schritte', art: 'zufall', pegel: 0.3, intervall: [60, 160], sektor: [120, -120], abstand: [1, 1.6] },
    ],
  },
  {
    id: 'regennacht', name: 'Regennacht in der Stadt', gruppe: 'Wetter', symbol: '🌧',
    beschreibung: 'Regen an den Läden, Tropfen vom Vordach, ein Hund bellt.',
    hall: { dauer: 1.8, daempfung: 0.6 },
    ebenen: [
      { klang: ['regen-fenster', 'synth:regen'], art: 'bett', pegel: 0.65, ort: { winkel: 0, abstand: 0.8 }, breite: 0.5 },
      { klang: ['regen-veranda', 'synth:regen'], art: 'bett', pegel: 0.5, ort: 'rundum' },
      { klang: 'hund', art: 'zufall', pegel: 0.3, intervall: [60, 150], sektor: [-180, 180], abstand: [2.2, 3], hall: 0.5 },
      { klang: 'glocke', art: 'zufall', pegel: 0.25, intervall: [120, 300], sektor: [-180, 180], abstand: [2.5, 3.5], hall: 0.6 },
    ],
  },
  {
    id: 'wasserfall', name: 'Am Wasserfall', gruppe: 'Wildnis', symbol: '💧',
    beschreibung: 'Stromschnellen, ein Wasserfall vor euch, Vögel im Regen.',
    hall: { dauer: 2, daempfung: 0.7 },
    ebenen: [
      { klang: ['wasserfall', 'synth:fluss'], art: 'bett', pegel: 0.7, ort: { winkel: 0, abstand: 1 }, breite: 0.4, lfe: 0.4 },
      { klang: ['stromschnellen', 'synth:fluss'], art: 'bett', pegel: 0.5, ort: 'rundum' },
      { klang: 'wald-regen', art: 'bett', pegel: 0.3, ort: 'rundum' },
    ],
  },
  {
    id: 'tempel', name: 'Tempel der Zauberer', gruppe: 'Magie', symbol: '✨',
    beschreibung: 'Eine schwebende Fläche, Windspiele, ab und zu funkelt Magie auf.',
    hall: { dauer: 5, daempfung: 0.3 },
    ebenen: [
      { klang: 'synth:flaeche-weit', art: 'bett', pegel: 0.35, ort: 'rundum' },
      { klang: 'windspiel', art: 'bett', pegel: 0.3, ort: { winkel: 120, abstand: 1.4 }, hall: 0.5 },
      { klang: 'synth:zauber', art: 'zufall', pegel: 0.4, intervall: [10, 30], sektor: [-180, 180], abstand: [0.8, 1.6], hall: 0.8 },
      { klang: 'gong', art: 'zufall', pegel: 0.4, intervall: [70, 180], sektor: [-30, 30], abstand: [1.6, 2.2], hall: 0.8, lfe: 0.5 },
    ],
  },
  {
    id: 'reise', name: 'Auf der Landstraße', gruppe: 'Wildnis', symbol: '🐎',
    beschreibung: 'Schafweiden, ein leichter Wind, Reiter galoppieren vorbei.',
    hall: { dauer: 1.5, daempfung: 0.8 },
    ebenen: [
      { klang: 'schafweide', art: 'bett', pegel: 0.5, ort: 'rundum' },
      { klang: ['wald-abend', 'synth:wind'], art: 'bett', pegel: 0.4, ort: 'rundum' },
      { klang: 'galopp', art: 'zufall', pegel: 0.6, intervall: [60, 160], sektor: [-120, 120], abstand: [1.2, 1.6], bewegung: 'vorbei', lfe: 0.5 },
      { klang: 'kraehe', art: 'zufall', pegel: 0.3, intervall: [40, 120], sektor: [-180, 180], abstand: [1.8, 2.6] },
    ],
  },
];

// Die Geräuschleiste: ein Klick, ein Geräusch — wohin, wählt die Spielleitung.
export const LEISTE = [
  { klang: ['donner-nah', 'synth:donner-nah'], name: 'Donnerschlag', symbol: '⚡', lfe: 1 },
  { klang: 'synth:donner', name: 'Fernes Grollen', symbol: '☁', lfe: 0.8 },
  { klang: ['explosion', 'synth:donner-nah'], name: 'Explosion', symbol: '💥', lfe: 1 },
  { klang: 'synth:zauber', name: 'Zauber', symbol: '✨', hall: 0.5 },
  { klang: ['zauber', 'synth:zauber'], name: 'Zauberstoß', symbol: '🔮', hall: 0.3 },
  { klang: ['bruellen', 'monster'], name: 'Brüllen', symbol: '🐉', lfe: 1, tonhoehe: -6 },
  { klang: 'monster', name: 'Monster', symbol: '👹', lfe: 0.6 },
  { klang: 'baer', name: 'Bär', symbol: '🐻', lfe: 0.4 },
  { klang: 'wolf', name: 'Wolf', symbol: '🐺', hall: 0.4 },
  { klang: 'kraehen', name: 'Krähen', symbol: '🐦' },
  { klang: 'schrei', name: 'Schrei', symbol: '😱', hall: 0.3 },
  { klang: 'grusel-schritte', name: 'Grusel', symbol: '👣', hall: 0.4 },
  { klang: 'tuer-knarren', name: 'Tür knarrt', symbol: '🚪', hall: 0.3 },
  { klang: ['klopfen-2', 'klopfen'], name: 'Klopfen', symbol: '✊', hall: 0.3 },
  { klang: 'riegel', name: 'Riegel', symbol: '🔒', hall: 0.4 },
  { klang: 'muenzbeutel', name: 'Münzbeutel', symbol: '💰' },
  { klang: 'metall', name: 'Klingen', symbol: '⚔' },
  { klang: 'bogen', name: 'Bogen', symbol: '🏹' },
  { klang: 'schleifen', name: 'Schleifen', symbol: '🗡' },
  { klang: 'galopp', name: 'Reiter', symbol: '🐎', bewegung: 'vorbei', lfe: 0.5 },
  { klang: 'horn', name: 'Horn', symbol: '📯', hall: 0.5 },
  { klang: 'gong', name: 'Gong', symbol: '🔔', hall: 0.6, lfe: 0.5 },
  { klang: 'glocke', name: 'Glocke', symbol: '🛎', hall: 0.5 },
  { klang: 'jubel', name: 'Jubel', symbol: '🎉' },
  { klang: 'applaus', name: 'Applaus', symbol: '👏' },
  { klang: 'synth:grollen', name: 'Erdbeben', symbol: '🌋', lfe: 1 },
];

// Die erste Kennung aus `klang`, die es gibt.
export function klangWaehlen(klang, gibtEs) {
  const liste = Array.isArray(klang) ? klang : [klang];
  return liste.find((k) => gibtEs(k)) || null;
}
