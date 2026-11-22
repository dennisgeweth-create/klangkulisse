// Klänge aus Rechnung statt aus Aufnahmen: Regen, Wind, Feuer, Wasser,
// Donner, Grillen, Herzschlag, Trommeln, Klangflächen, Zauber. Jeder
// Erzeuger gibt Kanäle als Float32Array zurück — kein Web Audio, damit es
// auch unter Node läuft (test/pruefen.mjs). Der Motor macht daraus einen
// AudioBuffer.
//
// Alles ist mit einem Startwert gesät: derselbe Startwert, derselbe Klang.
// Schleifen (bett) sind nahtlos: ihr Ende ist in den Anfang geblendet.

// ── Grundbausteine ─────────────────────────────────────────────────

export function zufallsQuelle(saat = 1) {
  let a = saat >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Biquad nach dem Audio-EQ-Kochbuch (R. Bristow-Johnson).
export class Filter {
  constructor(art, sr, f, q = 0.707) {
    this.art = art;
    this.sr = sr;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.setze(f, q);
  }
  setze(f, q = this.q) {
    this.q = q;
    const w = 2 * Math.PI * Math.min(f, this.sr * 0.45) / this.sr;
    const cw = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (this.art === 'tief') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
    else if (this.art === 'hoch') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; } // Band, Spitze 0 dB
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cw) / a0; this.a2 = (1 - al) / a0;
  }
  tick(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export function weiss(z) {
  return () => z() * 2 - 1;
}

// Rosa Rauschen nach Paul Kellet.
export function rosa(z) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = z() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const y = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return y * 0.11;
  };
}

// Braunes Rauschen (aufsummiert, mit Leck gegen Wegdriften).
export function braun(z) {
  let y = 0;
  return () => {
    y = (y + 0.02 * (z() * 2 - 1)) * 0.998;
    return y * 3.5;
  };
}

// Langsame, glatte Zufallskurve zwischen 0 und 1 — eine Summe von Sinus
// mit zufälliger Phase. Periodisch über `laenge` Sekunden, damit Schleifen
// auch in der Bewegung nahtlos sind.
export function welle(z, laenge, tempo = 0.1, teile = 4) {
  const ts = [];
  for (let i = 0; i < teile; i++) {
    const f = Math.max(1, Math.round(tempo * laenge * (0.5 + z() * 1.5))) / laenge;
    ts.push({ f, p: z() * Math.PI * 2, a: 1 / (i + 1) });
  }
  const summe = ts.reduce((s, t) => s + t.a, 0);
  return (t) => {
    let v = 0;
    for (const x of ts) v += x.a * Math.sin(2 * Math.PI * x.f * t + x.p);
    return 0.5 + 0.5 * (v / summe);
  };
}

// Pareto-verteilte Stärke: viele leise, wenige laute Ereignisse.
function pareto(z, alpha = 2.2) {
  return Math.min(1, 0.08 / Math.pow(1 - z() * 0.999, 1 / alpha));
}

// Wartezeit bis zum nächsten Ereignis eines Poisson-Prozesses.
function warte(z, rate) {
  return -Math.log(1 - z()) / rate;
}

export function nahtlos(kanal, sr, sekunden) {
  const u = Math.min(Math.floor(sekunden * sr), Math.floor(kanal.length / 4));
  const n = kanal.length - u;
  const aus = new Float32Array(n);
  for (let i = 0; i < u; i++) {
    const t = (i / u) * Math.PI / 2;
    aus[i] = kanal[i] * Math.sin(t) + kanal[n + i] * Math.cos(t);
  }
  aus.set(kanal.subarray(u, n), u);
  return aus;
}

export function normieren(kanaele, spitze = 0.89) {
  let m = 0;
  for (const k of kanaele) for (let i = 0; i < k.length; i++) m = Math.max(m, Math.abs(k[i]));
  if (m > 0) {
    const g = spitze / m;
    for (const k of kanaele) for (let i = 0; i < k.length; i++) k[i] *= g;
  }
  return kanaele;
}

// Ein Ereignis (Tropfen, Knistern, Blase) an Stelle `ab` in den Kanal legen.
function legen(kanal, ab, daten, staerke) {
  const n = Math.min(daten.length, kanal.length - ab);
  for (let i = 0; i < n; i++) kanal[ab + i] += daten[i] * staerke;
}

function bett(sr, sekunden, ueber, kanalErzeuger, spitze = 0.7) {
  const kanaele = kanalErzeuger(Math.floor((sekunden + ueber) * sr));
  return { kanaele: normieren(kanaele.map((k) => nahtlos(k, sr, ueber)), spitze), schleife: true };
}

// ── Wetter ─────────────────────────────────────────────────────────

export function regen(sr, saat = 1, { staerke = 0.6 } = {}) {
  const z = zufallsQuelle(saat);
  const L = 24;
  return bett(sr, L, 2, (n) => [0, 1].map((kan) => {
    const k = new Float32Array(n);
    const rauschen = weiss(zufallsQuelle(saat * 7 + kan));
    const hp = new Filter('hoch', sr, 600 - staerke * 300);
    const tp = new Filter('tief', sr, 5000 + staerke * 4000);
    const zug = welle(z, L, 0.08);
    // Das Rauschen: viele Tropfen, zu weit weg, um sie einzeln zu hören.
    for (let i = 0; i < n; i++) {
      k[i] = tp.tick(hp.tick(rauschen())) * (0.55 + 0.45 * zug(i / sr)) * (0.25 + staerke * 0.5);
    }
    // Die nahen Tropfen: kurze Klicks, gefiltert.
    const band = new Filter('band', sr, 3000, 0.9);
    const klick = new Float32Array(n);
    for (let t = warte(z, 150 + staerke * 600); t * sr < n; t += warte(z, 150 + staerke * 600)) {
      klick[Math.floor(t * sr)] += (z() < 0.5 ? -1 : 1) * pareto(z);
    }
    for (let i = 0; i < n; i++) k[i] += band.tick(klick[i]) * 2.2;
    // Ab und zu ein dicker Tropfen auf Holz oder Blatt.
    for (let t = warte(z, 3); t * sr < n; t += warte(z, 3 + staerke * 8)) {
      const f = 700 + z() * 1800;
      const tau = 0.006 + z() * 0.01;
      const d = new Float32Array(Math.floor(tau * 6 * sr));
      for (let i = 0; i < d.length; i++) {
        const s = i / sr;
        d[i] = Math.sin(2 * Math.PI * f * s * (1 + s * 20)) * Math.exp(-s / tau);
      }
      legen(k, Math.floor(t * sr), d, 0.15 + pareto(z) * 0.5);
    }
    return k;
  }));
}

export function wind(sr, saat = 1, { heulen = 0.5 } = {}) {
  const z = zufallsQuelle(saat);
  const L = 30;
  return bett(sr, L, 3, (n) => [0, 1].map((kan) => {
    const k = new Float32Array(n);
    const r1 = rosa(zufallsQuelle(saat * 11 + kan));
    const r2 = braun(zufallsQuelle(saat * 13 + kan));
    const band = new Filter('band', sr, 400, 1 + heulen * 5);
    const tp = new Filter('tief', sr, 900);
    const boe = welle(z, L, 0.07, 5);
    const ton = welle(z, L, 0.05, 3);
    for (let i = 0; i < n; i++) {
      if (i % 128 === 0) {
        const t = i / sr;
        band.setze(220 + 700 * ton(t) * (0.5 + 0.5 * boe(t)), 1 + heulen * 5);
      }
      const b = boe(i / sr);
      const staerke = 0.15 + 0.85 * b * b;
      k[i] = (band.tick(r1()) * (0.5 + heulen * 1.5) + tp.tick(r2()) * 0.7) * staerke;
    }
    return k;
  }));
}

export function donner(sr, saat = 1, { nah = 0.5 } = {}) {
  const z = zufallsQuelle(saat);
  const dauer = 6 + z() * 4;
  const n = Math.floor(dauer * sr);
  // Ein paar rollende Spitzen, jede leiser als die erste.
  const spitzen = [{ t: 0.05 + (1 - nah) * 0.4, a: 1 }];
  let t = spitzen[0].t;
  for (let i = 0; i < 5; i++) {
    t += 0.3 + z() * 1.2;
    if (t > dauer - 2) break;
    spitzen.push({ t, a: 0.3 + z() * 0.6 });
  }
  const kanaele = [0, 1].map((kan) => {
    const k = new Float32Array(n);
    const br = braun(zufallsQuelle(saat * 17 + kan));
    const ws = weiss(zufallsQuelle(saat * 19 + kan));
    const tp = new Filter('tief', sr, 300 + nah * 500);
    const tp2 = new Filter('tief', sr, 120);
    const hp = new Filter('hoch', sr, 1500);
    for (let i = 0; i < n; i++) {
      const s = i / sr;
      let h = 0;
      for (const p of spitzen) {
        if (s < p.t) continue;
        const d = s - p.t;
        h += p.a * (d < 0.08 ? d / 0.08 : Math.exp(-(d - 0.08) / (0.6 + p.a * 0.8)));
      }
      const roll = tp.tick(br()) + tp2.tick(br()) * 1.5;
      // Der Knall: nur bei nahem Donner, ganz am Anfang.
      const d0 = s - spitzen[0].t;
      const knall = d0 >= 0 && d0 < 0.25 ? hp.tick(ws()) * Math.exp(-d0 / 0.05) * nah * 1.5 : 0;
      k[i] = roll * h + knall;
    }
    // Ausklingen.
    const aus = Math.floor(sr * 1.5);
    for (let i = 0; i < aus; i++) k[n - aus + i] *= 1 - i / aus;
    return k;
  });
  return { kanaele: normieren(kanaele, 0.95), schleife: false };
}

// ── Feuer und Wasser ───────────────────────────────────────────────

export function feuer(sr, saat = 1, { groesse = 0.5 } = {}) {
  const z = zufallsQuelle(saat);
  const L = 20;
  return bett(sr, L, 2, (n) => {
    const kanaele = [new Float32Array(n), new Float32Array(n)];
    for (let kan = 0; kan < 2; kan++) {
      const k = kanaele[kan];
      const br = braun(zufallsQuelle(saat * 23 + kan));
      const ws = weiss(zufallsQuelle(saat * 29 + kan));
      const tp = new Filter('tief', sr, 160 + groesse * 120);
      const hp = new Filter('hoch', sr, 2500);
      const lodern = welle(z, L, 0.3, 5);
      const zischen = welle(z, L, 1.5, 4);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        k[i] = tp.tick(br()) * (0.4 + 0.6 * lodern(t)) * (0.6 + groesse) + hp.tick(ws()) * 0.05 * zischen(t);
      }
    }
    // Knistern: kurze Rauschstöße, jeder mit eigener Farbe und Seite.
    const rate = 5 + groesse * 10;
    for (let t = warte(z, rate); t * sr < n; t += warte(z, rate)) {
      const gruppe = z() < 0.2 ? 2 + Math.floor(z() * 5) : 1;
      for (let g = 0; g < gruppe; g++) {
        const ab = Math.floor((t + g * (0.01 + z() * 0.04)) * sr);
        const tau = 0.0008 + z() * 0.004;
        const f = new Filter('band', sr, 1200 + z() * 5000, 0.8 + z() * 2);
        const d = new Float32Array(Math.floor(tau * 8 * sr));
        for (let i = 0; i < d.length; i++) d[i] = f.tick((z() * 2 - 1) * Math.exp(-i / sr / tau));
        const st = pareto(z, 1.8) * 6;
        const seite = z();
        legen(kanaele[0], ab, d, st * Math.cos(seite * Math.PI / 2));
        legen(kanaele[1], ab, d, st * Math.sin(seite * Math.PI / 2));
      }
    }
    return kanaele;
  });
}

// Wasser, das plätschert: viele kleine Luftblasen (Minnaert-Resonanzen),
// jede ein kurzer, nach oben gleitender Ton.
export function bach(sr, saat = 1, { wildheit = 0.5 } = {}) {
  const z = zufallsQuelle(saat);
  const L = 20;
  return bett(sr, L, 2, (n) => [0, 1].map((kan) => {
    const k = new Float32Array(n);
    const ws = rosa(zufallsQuelle(saat * 31 + kan));
    const band = new Filter('band', sr, 900, 0.6);
    for (let i = 0; i < n; i++) k[i] = band.tick(ws()) * (0.25 + wildheit * 0.4);
    const rate = 40 + wildheit * 120;
    for (let t = warte(z, rate); t * sr < n; t += warte(z, rate)) {
      const f0 = 350 * Math.pow(6, z());
      const tau = 0.006 + z() * 0.025;
      const d = new Float32Array(Math.floor(tau * 5 * sr));
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const s = i / sr;
        ph += 2 * Math.PI * f0 * (1 + s / tau * 0.6) / sr;
        d[i] = Math.sin(ph) * Math.exp(-s / tau);
      }
      legen(k, Math.floor(t * sr), d, pareto(z) * 0.9);
    }
    return k;
  }));
}

export function brandung(sr, saat = 1, { ruhe = 0.5 } = {}) {
  const z = zufallsQuelle(saat);
  const L = 48;
  // Die Wellen: jede läuft an, bricht und zieht sich zurück.
  const wellen = [];
  for (let t = 0; t < L + 4;) {
    const periode = 6 + z() * 5 + ruhe * 3;
    wellen.push({ t, an: 1.5 + z() * 1.5, ab: 3 + z() * 3, a: 0.6 + z() * 0.4 });
    t += periode;
  }
  const huelle = (s) => {
    let h = 0;
    for (const w of wellen) {
      const d = s - w.t;
      if (d < 0 || d > w.an + w.ab * 3) continue;
      h += w.a * (d < w.an ? Math.pow(d / w.an, 2) : Math.exp(-(d - w.an) / w.ab));
    }
    return h;
  };
  return bett(sr, L, 4, (n) => [0, 1].map((kan) => {
    const k = new Float32Array(n);
    const br = braun(zufallsQuelle(saat * 37 + kan));
    const rs = rosa(zufallsQuelle(saat * 41 + kan));
    const tp = new Filter('tief', sr, 500);
    const hp = new Filter('hoch', sr, 1800);
    const versatz = kan * 0.35;
    for (let i = 0; i < n; i++) {
      const s = i / sr;
      const h = huelle(s - versatz);
      if (i % 64 === 0) tp.setze(250 + 2200 * Math.min(1, h));
      const gischt = huelle(s - versatz - 0.4);
      k[i] = tp.tick(br() + rs() * 0.8) * (0.15 + h) + hp.tick(rs()) * gischt * gischt * 0.6;
    }
    return k;
  }));
}

export function tropfen(sr, saat = 1) {
  const z = zufallsQuelle(saat);
  const f0 = 700 + z() * 2200;
  const tau = 0.015 + z() * 0.03;
  const n = Math.floor((tau * 8 + 0.02) * sr);
  const k = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const s = i / sr;
    ph += 2 * Math.PI * f0 * (1 + Math.min(1, s / 0.04) * (0.4 + z() * 0.02)) / sr;
    k[i] = Math.sin(ph) * Math.exp(-s / tau) * Math.min(1, s / 0.0007);
  }
  return { kanaele: normieren([k], 0.9), schleife: false };
}

// ── Tiere und Leiber ───────────────────────────────────────────────

export function grillen(sr, saat = 1, { anzahl = 6 } = {}) {
  const z = zufallsQuelle(saat);
  const L = 15;
  const tiere = [];
  for (let i = 0; i < anzahl; i++) {
    tiere.push({
      f: 3800 + z() * 1600,
      // Zirpabstand so, dass er in L Sekunden aufgeht.
      periode: L / Math.round(L / (0.35 + z() * 0.6)),
      versatz: z(),
      pulse: 2 + Math.floor(z() * 3),
      seite: z(),
      a: 0.3 + z() * 0.7,
    });
  }
  const n = Math.floor(L * sr);
  const kanaele = [new Float32Array(n), new Float32Array(n)];
  for (const g of tiere) {
    const pulsLang = 0.012;
    const pulsAbst = 0.028;
    for (let t = g.versatz * g.periode; t < L; t += g.periode) {
      for (let p = 0; p < g.pulse; p++) {
        const ab = Math.floor((t + p * pulsAbst) * sr);
        const m = Math.floor(pulsLang * sr);
        for (let i = 0; i < m; i++) {
          const idx = (ab + i) % n; // ringsum: die Schleife ist von selbst nahtlos
          const s = i / m;
          const v = Math.sin(2 * Math.PI * g.f * (ab + i) / sr) * Math.sin(Math.PI * s) * g.a;
          kanaele[0][idx] += v * Math.cos(g.seite * Math.PI / 2);
          kanaele[1][idx] += v * Math.sin(g.seite * Math.PI / 2);
        }
      }
    }
  }
  // Ein Hauch Nacht darunter.
  for (let kan = 0; kan < 2; kan++) {
    const r = rosa(zufallsQuelle(saat * 43 + kan));
    const tp = new Filter('tief', sr, 400);
    // Etwas länger rechnen und das Ende in den Anfang blenden — wie bei bett().
    const roh = new Float32Array(n + sr);
    for (let i = 0; i < roh.length; i++) roh[i] = tp.tick(r()) * 0.05;
    const nacht = nahtlos(roh, sr, 1);
    const k = kanaele[kan];
    for (let i = 0; i < n; i++) k[i] += nacht[i];
  }
  return { kanaele: normieren(kanaele, 0.5), schleife: true };
}

export function herzschlag(sr, saat = 1, { bpm = 70 } = {}) {
  // Rund zehn Sekunden, ganz gleich wie schnell es schlägt.
  const schlaege = Math.max(4, Math.round((10 * bpm) / 60));
  const periode = 60 / bpm;
  const n = Math.floor(schlaege * periode * sr);
  const k = new Float32Array(n);
  const z = zufallsQuelle(saat);
  const schlag = (ab, f, tau, a) => {
    const m = Math.floor(tau * 6 * sr);
    let ph = 0;
    for (let i = 0; i < m && ab + i < n; i++) {
      const s = i / sr;
      ph += 2 * Math.PI * f * (1 - 0.3 * Math.min(1, s / tau)) / sr;
      k[ab + i] += Math.sin(ph) * Math.exp(-s / tau) * Math.min(1, s / 0.004) * a;
    }
  };
  for (let b = 0; b < schlaege; b++) {
    const t = b * periode + (z() - 0.5) * 0.01;
    schlag(Math.max(0, Math.floor(t * sr)), 58, 0.05, 1);
    schlag(Math.floor((t + periode * 0.32) * sr), 72, 0.04, 0.6);
  }
  const tp = new Filter('tief', sr, 180);
  for (let i = 0; i < n; i++) k[i] = tp.tick(k[i]);
  return { kanaele: normieren([k], 0.9), schleife: true };
}

// ── Kampf und Zauber ───────────────────────────────────────────────

export function trommeln(sr, saat = 1, { bpm = 84 } = {}) {
  const z = zufallsQuelle(saat);
  const schritt = 60 / bpm / 2; // Achtel
  const muster = [1, 0, 0, 0.5, 0, 0, 0.8, 0, 1, 0, 0, 0.5, 0, 0.6, 0.7, 0.4];
  const n = Math.floor(muster.length * schritt * 2 * sr);
  const kanaele = [new Float32Array(n), new Float32Array(n)];
  const schlag = (k, ab, f, a) => {
    const m = Math.floor(0.9 * sr);
    let ph = 0;
    const ws = weiss(z);
    const hp = new Filter('band', sr, 900, 0.8);
    for (let i = 0; i < m; i++) {
      const s = i / sr;
      ph += 2 * Math.PI * f * (1 + 0.8 * Math.exp(-s / 0.03)) / sr;
      const v = Math.sin(ph) * Math.exp(-s / 0.28) + hp.tick(ws()) * Math.exp(-s / 0.015) * 0.5;
      k[(ab + i) % n] += v * a;
    }
  };
  for (let wdh = 0; wdh < 2; wdh++) {
    muster.forEach((a, i) => {
      if (!a) return;
      const t = (wdh * muster.length + i) * schritt;
      // Zwei Trommler, links und rechts, nie ganz gleich.
      schlag(kanaele[0], Math.floor((t + z() * 0.012) * sr), 52 + z() * 4, a * (0.85 + z() * 0.15));
      schlag(kanaele[1], Math.floor((t + z() * 0.012) * sr), 58 + z() * 4, a * (0.85 + z() * 0.15));
    });
  }
  return { kanaele: normieren(kanaele, 0.9), schleife: true };
}

// Eine dunkle Klangfläche: Grundton, Quinte, Oktave, langsam atmend.
// Alle Frequenzen gehen in L Sekunden ganz auf — die Schleife hat keine Naht.
export function flaeche(sr, saat = 1, { grundton = 55, hell = 0.3 } = {}) {
  const z = zufallsQuelle(saat);
  const L = 32;
  const n = Math.floor(L * sr);
  const auf = (f) => Math.max(1, Math.round(f * L)) / L;
  const toene = [];
  for (const [verh, a] of [[1, 1], [1.5, 0.5], [2, 0.45], [3, 0.2], [4, 0.12 * (1 + hell * 3)], [5.04, 0.06 * (1 + hell * 4)]]) {
    for (const verstimmt of [-0.25, 0.25]) {
      toene.push({ f: auf(grundton * verh + verstimmt), a, p: z() * 6.28, atem: welle(z, L, 0.06, 2) });
    }
  }
  const kanaele = [0, 1].map((kan) => {
    const k = new Float32Array(n);
    toene.forEach((t, idx) => {
      const seite = (idx % 2 === kan) ? 1 : 0.6;
      for (let i = 0; i < n; i++) {
        const s = i / sr;
        k[i] += Math.sin(2 * Math.PI * t.f * s + t.p + kan * 0.7) * t.a * seite * (0.35 + 0.65 * t.atem(s));
      }
    });
    return k;
  });
  return { kanaele: normieren(kanaele, 0.6), schleife: true };
}

export function zauber(sr, saat = 1) {
  const z = zufallsQuelle(saat);
  const dauer = 2.5;
  const n = Math.floor(dauer * sr);
  const kanaele = [new Float32Array(n), new Float32Array(n)];
  const pentatonik = [0, 2, 4, 7, 9];
  const grund = 880 * Math.pow(2, Math.floor(z() * 5) / 12);
  const toene = 7 + Math.floor(z() * 6);
  for (let i = 0; i < toene; i++) {
    const stufe = pentatonik[i % 5] + 12 * Math.floor(i / 5);
    const f = grund * Math.pow(2, stufe / 12);
    const ab = Math.floor((i * (0.05 + z() * 0.04)) * sr);
    const seite = z();
    for (let j = 0; j < n - ab; j++) {
      const s = j / sr;
      const v = Math.sin(2 * Math.PI * f * s) * Math.exp(-s / 0.5) * Math.min(1, s / 0.002) * 0.3;
      kanaele[0][ab + j] += v * Math.cos(seite * Math.PI / 2);
      kanaele[1][ab + j] += v * Math.sin(seite * Math.PI / 2);
    }
  }
  // Ein Rauschen, das aufwärts streicht.
  for (let kan = 0; kan < 2; kan++) {
    const ws = weiss(zufallsQuelle(saat * 47 + kan));
    const band = new Filter('band', sr, 500, 3);
    for (let i = 0; i < n; i++) {
      const s = i / sr;
      if (i % 64 === 0) band.setze(500 + 6000 * Math.min(1, s / 0.8), 3);
      kanaele[kan][i] += band.tick(ws()) * Math.sin(Math.PI * Math.min(1, s / 1.2)) * (s < 1.2 ? 0.6 : 0);
    }
  }
  return { kanaele: normieren(kanaele, 0.9), schleife: false };
}

export function grollen(sr, saat = 1) {
  const z = zufallsQuelle(saat);
  const dauer = 5 + z() * 3;
  const n = Math.floor(dauer * sr);
  const kanaele = [0, 1].map((kan) => {
    const k = new Float32Array(n);
    const br = braun(zufallsQuelle(saat * 53 + kan));
    const tp = new Filter('tief', sr, 70);
    const tp2 = new Filter('tief', sr, 70);
    const zittern = welle(z, dauer, 2, 4);
    for (let i = 0; i < n; i++) {
      const s = i / sr;
      const h = Math.sin(Math.PI * s / dauer) ** 1.5;
      k[i] = tp2.tick(tp.tick(br())) * h * (0.6 + 0.4 * zittern(s));
    }
    return k;
  });
  return { kanaele: normieren(kanaele, 0.95), schleife: false };
}

// Ein Nachhall als Impulsantwort für den ConvolverNode des Motors:
// zwei unabhängige Rauschkanäle, exponentiell abklingend, oben dumpfer.
export function hallImpuls(sr, sekunden = 2.5, daempfung = 0.5, saat = 3) {
  const n = Math.floor(sekunden * sr);
  return [0, 1].map((kan) => {
    const k = new Float32Array(n);
    const ws = weiss(zufallsQuelle(saat + kan * 101));
    const tp = new Filter('tief', sr, 9000);
    for (let i = 0; i < n; i++) {
      const s = i / sr;
      if (i % 256 === 0) tp.setze(9000 * Math.exp(-s * daempfung * 2) + 300);
      k[i] = tp.tick(ws()) * Math.exp(-s * 6.9 / sekunden) * (s < 0.005 ? s / 0.005 : 1);
    }
    return k;
  });
}

// ── Das Verzeichnis ────────────────────────────────────────────────
// Was die Oberfläche anbietet. `art` wie im Katalog der Aufnahmen:
// bett = Schleife, einzel = Einzelgeräusch (mehrere Varianten).

export const ERZEUGER = {
  'synth:regen': { name: 'Regen', gruppe: 'Wetter', art: 'bett', fn: regen, opt: { staerke: 0.5 } },
  'synth:platzregen': { name: 'Platzregen', gruppe: 'Wetter', art: 'bett', fn: regen, opt: { staerke: 1 } },
  'synth:wind': { name: 'Wind', gruppe: 'Wetter', art: 'bett', fn: wind, opt: { heulen: 0.3 } },
  'synth:sturmheulen': { name: 'Heulender Sturm', gruppe: 'Wetter', art: 'bett', fn: wind, opt: { heulen: 1 } },
  'synth:donner': { name: 'Donner', gruppe: 'Wetter', art: 'einzel', fn: donner, opt: { nah: 0.3 }, varianten: 4 },
  'synth:donner-nah': { name: 'Naher Donnerschlag', gruppe: 'Wetter', art: 'einzel', fn: donner, opt: { nah: 1 }, varianten: 3 },
  'synth:feuer': { name: 'Feuer', gruppe: 'Feuer', art: 'bett', fn: feuer, opt: { groesse: 0.4 } },
  'synth:grossfeuer': { name: 'Großes Feuer', gruppe: 'Feuer', art: 'bett', fn: feuer, opt: { groesse: 1 } },
  'synth:bach': { name: 'Bach', gruppe: 'Wasser', art: 'bett', fn: bach, opt: { wildheit: 0.3 } },
  'synth:fluss': { name: 'Wilder Fluss', gruppe: 'Wasser', art: 'bett', fn: bach, opt: { wildheit: 1 } },
  'synth:brandung': { name: 'Brandung', gruppe: 'Wasser', art: 'bett', fn: brandung, opt: { ruhe: 0.5 } },
  'synth:tropfen': { name: 'Tropfen', gruppe: 'Unterwelt', art: 'einzel', fn: tropfen, opt: {}, varianten: 8 },
  'synth:grillen': { name: 'Grillen', gruppe: 'Natur', art: 'bett', fn: grillen, opt: { anzahl: 7 } },
  'synth:herz': { name: 'Herzschlag', gruppe: 'Ungeheuer', art: 'bett', fn: herzschlag, opt: { bpm: 64 } },
  'synth:herz-schnell': { name: 'Rasender Herzschlag', gruppe: 'Ungeheuer', art: 'bett', fn: herzschlag, opt: { bpm: 118 } },
  'synth:trommeln': { name: 'Kriegstrommeln', gruppe: 'Kampf', art: 'bett', fn: trommeln, opt: { bpm: 84 } },
  'synth:flaeche-dunkel': { name: 'Dunkle Fläche', gruppe: 'Unterwelt', art: 'bett', fn: flaeche, opt: { grundton: 49, hell: 0.1 } },
  'synth:flaeche-weit': { name: 'Weite Fläche', gruppe: 'Magie', art: 'bett', fn: flaeche, opt: { grundton: 110, hell: 0.8 } },
  'synth:zauber': { name: 'Zauberfunkeln', gruppe: 'Magie', art: 'einzel', fn: zauber, opt: {}, varianten: 5 },
  'synth:grollen': { name: 'Erdgrollen', gruppe: 'Unterwelt', art: 'einzel', fn: grollen, opt: {}, varianten: 3 },
};

// Variante `v` eines Erzeugers rechnen.
export function erzeugen(id, sr, v = 0) {
  const e = ERZEUGER[id];
  if (!e) throw new Error('Unbekannter Erzeuger: ' + id);
  return e.fn(sr, 1 + v * 977 + id.length * 31, e.opt);
}
