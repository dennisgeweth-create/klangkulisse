// Der Motor: Web Audio, ein Ausgang mit 2, 6 oder 8 Kanälen.
//
// Der Weg eines Klangs:
//
//   Quelle ─┬─ (Kanal L) ─ Tiefpass ─ Pegel ─┬─ Gewicht je Lautsprecher ─┐
//           └─ (Kanal R) ─ …                 ├─ LFE-Anteil ──────────────┤
//                                            └─ Hallanteil ──────────────┤
//                                                                        ▼
//   Szenenbus (je Lautsprecher + LFE + Hall, für das Überblenden) ─► Lautsprecherbus
//   ─► ChannelMerger(n) ─► Gesamtpegel ─► Begrenzer ─► destination (n Kanäle, discrete)
//
// Der Subwoofer bekommt nur, was durch den 120-Hz-Tiefpass passt.
// Der Hall ist ein ConvolverNode mit erzeugter Impulsantwort; sein
// Stereo-Ausgang geht links an FL/SL/BL, rechts an FR/SR/BR.

import { AUFSTELLUNGEN, KANALFOLGEN, aufstellungFuer, gewichte, abstandsWirkung, zufallsOrt, normWinkel } from './raum.js';
import { ERZEUGER, erzeugen, hallImpuls, rosa, zufallsQuelle } from './synth.js';
import { klangWaehlen } from './szenen.js';

const ZEIT = 0.05; // Zeitkonstante für weiche Änderungen

export class Motor {
  constructor({ katalog = [], katalogPfad = 'klaenge/', eigeneLaden = null, kontext = null } = {}) {
    this.katalog = new Map(katalog.map((k) => [k.id, k]));
    this.katalogPfad = katalogPfad;
    this.eigeneLaden = eigeneLaden; // id → Promise<ArrayBuffer>
    // Ein fertiger Kontext (z. B. OfflineAudioContext für die Prüfung) statt eines eigenen.
    this.ctx = kontext;
    this.puffer = new Map(); // klangId → Promise<AudioBuffer[]>
    this.szene = null;
    this.hoerer = new Set();
    this.einst = { aufstellung: 'auto', folge: 'standard', center: 0.5, lfe: 0.6, pegel: 0.8 };
  }

  // ── Ereignisse für die Oberfläche ──
  bei(fn) { this.hoerer.add(fn); return () => this.hoerer.delete(fn); }
  melden(art, daten) { for (const f of this.hoerer) f(art, daten); }

  // ── Start und Aufbau ──────────────────────────────────────────

  // Muss aus einem Klick heraus gerufen werden (Autoplay-Regeln).
  async starten(einst = {}) {
    Object.assign(this.einst, einst);
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    }
    if (this.ctx.state === 'suspended' && this.ctx.resume && !(this.ctx instanceof OfflineAudioContext)) await this.ctx.resume();
    this.aufbauen();
    return this.info();
  }

  info() {
    const d = this.ctx && this.ctx.destination;
    return {
      laeuft: !!this.ctx && this.ctx.state === 'running',
      maxKanaele: d ? d.maxChannelCount : 0,
      aufstellung: this.aufstellung,
      kanaele: this.n,
      folge: this.einst.folge,
      abtastrate: this.ctx ? this.ctx.sampleRate : 0,
    };
  }

  // Den Ausgang (neu) bauen — beim Start und wenn sich die Aufstellung ändert.
  aufbauen() {
    const ctx = this.ctx;
    const max = ctx.destination.maxChannelCount || 2;
    let a = this.einst.aufstellung === 'auto' ? aufstellungFuer(max) : this.einst.aufstellung;
    if (AUFSTELLUNGEN[a].lautsprecher.length > max) a = aufstellungFuer(max);
    const neu = a !== this.aufstellung || this.folge !== this.einst.folge;
    if (!neu && this.merger) return;
    const lief = this.szene && this.szene.def;
    if (this.szene) this.szeneAbbauen(this.szene, 0);
    if (this.ausgang) this.ausgang.disconnect();
    this.leiste = null; // hing am alten Ausgang

    this.aufstellung = a;
    this.folge = KANALFOLGEN[a][this.einst.folge] ? this.einst.folge : 'standard';
    const las = AUFSTELLUNGEN[a].lautsprecher;
    const n = (this.n = las.length);
    const reihe = KANALFOLGEN[a][this.folge];

    const d = ctx.destination;
    d.channelCount = n;
    d.channelCountMode = 'explicit';
    d.channelInterpretation = 'discrete';

    const merger = (this.merger = ctx.createChannelMerger(n));
    const gesamt = (this.gesamt = ctx.createGain());
    gesamt.channelCount = n;
    gesamt.channelCountMode = 'explicit';
    gesamt.channelInterpretation = 'discrete';
    gesamt.gain.value = this.einst.pegel;
    // Sicherung gegen Übersteuern. Kein DynamicsCompressor: der kann nur
    // zwei Kanäle. Ein weicher Clipper kann jede Zahl — bis 0,7 bleibt
    // alles unberührt, darüber biegt er sanft auf höchstens 1.
    const begrenzer = ctx.createWaveShaper();
    begrenzer.channelCount = n;
    begrenzer.channelCountMode = 'explicit';
    begrenzer.channelInterpretation = 'discrete';
    begrenzer.curve = weicheKurve();
    begrenzer.oversample = '2x';
    merger.connect(gesamt).connect(begrenzer).connect(d);
    this.ausgang = begrenzer;

    // Ein Bus je Lautsprecher, an den Kanal, den das Gerät dafür erwartet.
    this.lautsprecher = las.map((l) => {
      const g = ctx.createGain();
      g.channelCount = 1;
      g.channelCountMode = 'explicit';
      g.connect(merger, 0, reihe.indexOf(l.id));
      return g;
    });

    // Subwoofer: Summe → zweimal Tiefpass (24 dB/Oktave) → LFE-Kanal.
    const lfeIndex = las.findIndex((l) => l.lfe);
    this.lfeEin = ctx.createGain();
    this.lfeEin.channelCount = 1;
    this.lfeEin.channelCountMode = 'explicit';
    const t1 = ctx.createBiquadFilter();
    const t2 = ctx.createBiquadFilter();
    for (const t of [t1, t2]) { t.type = 'lowpass'; t.frequency.value = 120; t.Q.value = 0.707; }
    this.lfeEin.connect(t1).connect(t2);
    if (lfeIndex >= 0) t2.connect(this.lautsprecher[lfeIndex]);
    // Ohne Subwoofer (Stereo) bleibt der Bass in den Hauptlautsprechern.

    // Hall
    this.hallEin = ctx.createGain();
    this.hallEin.channelCount = 1;
    this.hallEin.channelCountMode = 'explicit';
    this.hall = ctx.createConvolver();
    this.hall.normalize = true;
    this.hallSetzen({ dauer: 2, daempfung: 0.5 });
    const teiler = ctx.createChannelSplitter(2);
    this.hallEin.connect(this.hall).connect(teiler);
    las.forEach((l, i) => {
      if (l.lfe) return;
      const seite = l.winkel < 0 ? 0 : l.winkel > 0 ? 1 : -1;
      const g = ctx.createGain();
      const zahl = las.filter((x) => !x.lfe && x.winkel !== 0).length / 2;
      g.gain.value = 1 / Math.sqrt(zahl);
      if (seite >= 0) teiler.connect(g, seite);
      else { teiler.connect(g, 0); teiler.connect(g, 1); g.gain.value *= 0.5; }
      g.connect(this.lautsprecher[i]);
    });

    this.melden('aufbau', this.info());
    if (lief) this.szeneSpielen(lief, { ueberblenden: 0.5 });
  }

  hallSetzen({ dauer = 2, daempfung = 0.5 } = {}) {
    const schluessel = dauer + '/' + daempfung;
    if (this.hallSchluessel === schluessel) return;
    this.hallSchluessel = schluessel;
    const sr = this.ctx.sampleRate;
    const k = hallImpuls(sr, dauer, daempfung);
    const b = this.ctx.createBuffer(2, k[0].length, sr);
    b.copyToChannel(k[0], 0);
    b.copyToChannel(k[1], 1);
    this.hall.buffer = b;
  }

  einstellen(einst) {
    Object.assign(this.einst, einst);
    if (!this.ctx) return;
    if ('pegel' in einst) this.gesamt.gain.setTargetAtTime(einst.pegel, this.ctx.currentTime, ZEIT);
    if ('aufstellung' in einst || 'folge' in einst) this.aufbauen();
    if ('center' in einst || 'lfe' in einst) this.alleNeuSetzen();
  }

  // ── Klänge laden ──────────────────────────────────────────────

  klangInfo(id) {
    if (ERZEUGER[id]) return { id, ...ERZEUGER[id], quelle: { urheber: 'Klangkulisse', lizenz: 'erzeugt' } };
    if (this.katalog.has(id)) return this.katalog.get(id);
    return this.eigeneInfo ? this.eigeneInfo(id) : null;
  }

  gibtEs(id) {
    return !!id && (!!ERZEUGER[id] || this.katalog.has(id) || (!!this.eigeneInfo && !!this.eigeneInfo(id)));
  }

  waehlen(klang) {
    return klangWaehlen(klang, (id) => this.gibtEs(id));
  }

  // Alle Varianten eines Klangs als AudioBuffer.
  laden(id) {
    if (!this.puffer.has(id)) {
      const p = this.ladenRoh(id).catch((f) => {
        this.puffer.delete(id);
        throw f;
      });
      this.puffer.set(id, p);
    }
    return this.puffer.get(id);
  }

  async ladenRoh(id) {
    const ctx = this.ctx;
    if (ERZEUGER[id]) {
      const e = ERZEUGER[id];
      const varianten = e.art === 'einzel' ? e.varianten || 1 : 1;
      const aus = [];
      for (let v = 0; v < varianten; v++) {
        // Zwischen den Varianten den Browser atmen lassen.
        await new Promise((r) => setTimeout(r, 0));
        const { kanaele } = erzeugen(id, ctx.sampleRate, v);
        const b = ctx.createBuffer(kanaele.length, kanaele[0].length, ctx.sampleRate);
        kanaele.forEach((k, i) => b.copyToChannel(k, i));
        aus.push(b);
      }
      return aus;
    }
    const k = this.katalog.get(id);
    if (k) {
      return Promise.all(k.dateien.map(async (d) => {
        const r = await fetch(this.katalogPfad + d);
        if (!r.ok) throw new Error(d + ' ließ sich nicht laden (' + r.status + ')');
        return ctx.decodeAudioData(await r.arrayBuffer());
      }));
    }
    if (this.eigeneLaden) {
      const daten = await this.eigeneLaden(id);
      if (daten) return [await ctx.decodeAudioData(daten)];
    }
    throw new Error('Unbekannter Klang: ' + id);
  }

  // ── Stimmen: ein klingender Puffer mit Ort ────────────────────

  // Strahler: ein Mono-Signal mit eigenem Ort. Eine Stereoquelle hat zwei.
  strahler(eingang, ausgangKanal, bus, ort) {
    const ctx = this.ctx;
    const tp = ctx.createBiquadFilter();
    tp.type = 'lowpass';
    tp.Q.value = 0.5;
    const pegel = ctx.createGain();
    if (ausgangKanal == null) eingang.connect(tp);
    else eingang.connect(tp, ausgangKanal);
    tp.connect(pegel);
    const gs = this.lautsprecher.map((_, i) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      pegel.connect(g).connect(bus.lautsprecher[i]);
      return g;
    });
    const lfe = ctx.createGain();
    const hall = ctx.createGain();
    pegel.connect(lfe).connect(bus.lfe);
    pegel.connect(hall).connect(bus.hall);
    const s = { tp, pegel, gs, lfe, hall, ort: { ...ort } };
    this.ortSetzen(s, ort, 0);
    return s;
  }

  ortSetzen(s, ort, zeit = ZEIT, wann = this.ctx.currentTime) {
    Object.assign(s.ort, ort);
    const o = s.ort;
    const g = gewichte(this.aufstellung, {
      winkel: o.winkel, breite: o.breite || 0, abstand: o.abstand ?? 1,
      center: this.einst.center, lfe: 0,
    });
    const { pegel, tiefpass } = abstandsWirkung(o.abstand ?? 1);
    const setz = (param, wert) => {
      if (zeit === 0) param.setValueAtTime(wert, wann);
      else param.setTargetAtTime(wert, wann, zeit);
    };
    s.gs.forEach((node, i) => setz(node.gain, g[i] * pegel));
    setz(s.tp.frequency, Math.min(tiefpass, o.tiefpass || 20000));
    setz(s.lfe.gain, (o.lfe || 0) * this.einst.lfe * pegel);
    setz(s.hall.gain, (o.hall || 0) * Math.min(1, 0.6 + (o.abstand ?? 1) * 0.4));
  }

  // Eine Bewegung als Kette von Rampen vorausplanen (z. B. ein Reiter,
  // der vorbeigaloppiert): von Ort a nach Ort b über `dauer` Sekunden.
  bewegen(s, a, b, dauer, start) {
    const schritte = Math.max(8, Math.ceil(dauer * 6));
    let dw = normWinkel(b.winkel - a.winkel);
    for (let i = 0; i <= schritte; i++) {
      const p = i / schritte;
      const t = start + p * dauer;
      // Der Abstand ist in der Mitte am kleinsten: die Quelle kommt nah heran.
      const nah = Math.sin(Math.PI * p);
      const ort = {
        winkel: a.winkel + dw * p,
        abstand: a.abstand + (b.abstand - a.abstand) * p - nah * 0.5 * Math.min(a.abstand, b.abstand),
      };
      const g = gewichte(this.aufstellung, { winkel: ort.winkel, breite: s.ort.breite || 0, abstand: Math.max(0.3, ort.abstand), center: this.einst.center });
      const { pegel, tiefpass } = abstandsWirkung(ort.abstand);
      s.gs.forEach((node, k) => (i === 0 ? node.gain.setValueAtTime(g[k] * pegel, t) : node.gain.linearRampToValueAtTime(g[k] * pegel, t)));
      if (i === 0) s.tp.frequency.setValueAtTime(tiefpass, t);
      else s.tp.frequency.linearRampToValueAtTime(tiefpass, t);
    }
  }

  // ── Szenen ────────────────────────────────────────────────────

  // Ein Bus je Szene: über ihn wird ein- und ausgeblendet.
  busBauen() {
    const ctx = this.ctx;
    const bus = {
      lautsprecher: this.lautsprecher.map((ziel) => {
        const g = ctx.createGain();
        g.gain.value = 0;
        g.connect(ziel);
        return g;
      }),
      lfe: ctx.createGain(),
      hall: ctx.createGain(),
    };
    bus.lfe.gain.value = 0;
    bus.hall.gain.value = 0;
    bus.lfe.connect(this.lfeEin);
    bus.hall.connect(this.hallEin);
    bus.alle = [...bus.lautsprecher, bus.lfe, bus.hall];
    return bus;
  }

  blenden(bus, ziel, dauer) {
    const t = this.ctx.currentTime;
    for (const g of bus.alle) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      if (dauer <= 0) g.gain.setValueAtTime(ziel, t);
      else g.gain.linearRampToValueAtTime(ziel, t + dauer);
    }
  }

  async szeneSpielen(def, { ueberblenden = 3 } = {}) {
    if (!this.ctx) throw new Error('Erst starten.');
    const alt = this.szene;
    const sz = { def, bus: this.busBauen(), ebenen: [], weg: false };
    this.szene = sz;
    this.melden('szene', { id: def.id, laedt: true });
    // Erst alles laden, dann zusammen einsetzen — sonst kommt der Regen vor dem Wind.
    const geladen = await Promise.all(def.ebenen.map((e) => {
      const id = this.waehlen(e.klang);
      if (!id) return null;
      return this.laden(id).catch((f) => {
        console.warn(f);
        this.melden('fehler', { klang: id, text: String(f.message || f) });
        return null;
      });
    }));
    if (sz.weg) return;
    if (def.hall) this.hallSetzen(def.hall);
    def.ebenen.forEach((e, i) => {
      const eb = { def: { ...e }, puffer: geladen[i], stimmen: new Set(), stumm: !!e.stumm, timer: null };
      sz.ebenen.push(eb);
      if (eb.puffer && !eb.stumm) this.ebeneAn(sz, eb);
    });
    if (alt) this.szeneAbbauen(alt, ueberblenden);
    this.blenden(sz.bus, 1, alt ? ueberblenden : Math.min(1.5, ueberblenden));
    this.melden('szene', { id: def.id, laedt: false });
  }

  szeneStoppen(dauer = 2) {
    if (!this.szene) return;
    this.szeneAbbauen(this.szene, dauer);
    this.szene = null;
    this.melden('szene', { id: null });
  }

  szeneAbbauen(sz, dauer) {
    sz.weg = true;
    this.blenden(sz.bus, 0, dauer);
    for (const eb of sz.ebenen) clearTimeout(eb.timer);
    setTimeout(() => {
      for (const eb of sz.ebenen) this.ebeneAus(eb, 0);
      for (const g of sz.bus.alle) g.disconnect();
    }, (dauer + 0.2) * 1000);
  }

  ebeneAn(sz, eb) {
    const e = eb.def;
    if (e.art === 'zufall') {
      const naechste = (erste) => {
        const [a, b] = e.intervall || [5, 20];
        const warte = erste ? Math.random() * Math.min(a, 4) : a + Math.random() * (b - a);
        eb.timer = setTimeout(() => {
          if (sz.weg || eb.stumm) return;
          this.einmal(sz, eb);
          naechste(false);
        }, warte * 1000);
      };
      naechste(true);
    } else {
      this.dauerton(sz, eb);
    }
  }

  ebeneAus(eb, dauer = 0.5) {
    clearTimeout(eb.timer);
    const t = this.ctx.currentTime;
    for (const st of eb.stimmen) {
      st.zug.gain.setTargetAtTime(0, t, dauer / 4 || 0.001);
      try { st.quelle.stop(t + dauer + 0.05); } catch (f) { /* schon aus */ }
    }
    eb.stimmen.clear();
  }

  // Zug: der Pegel der Ebene, vor dem Ort.
  zugBauen(e) {
    const z = this.ctx.createGain();
    z.gain.value = e.pegel ?? 0.8;
    return z;
  }

  // Ein Dauerton (bett, musik): läuft in Schleife, an festem Ort oder rundum.
  dauerton(sz, eb) {
    const ctx = this.ctx;
    const e = eb.def;
    const b = eb.puffer[0];
    const rundum = e.ort === 'rundum' || (e.ort == null && e.art !== 'musik');
    // Rundum: zwei versetzte Kopien, jede mit ihren Kanälen an eigenem Ort —
    // so kommt aus allen Lautsprechern etwas anderes (kein Phantomschall in der Mitte).
    const kopien = rundum && this.n > 2 ? 2 : 1;
    const t = ctx.currentTime + 0.05;
    for (let k = 0; k < kopien; k++) {
      const q = ctx.createBufferSource();
      q.buffer = b;
      q.loop = e.schleife !== false;
      if (e.tonhoehe) q.playbackRate.value = Math.pow(2, e.tonhoehe / 12);
      const zug = this.zugBauen(e);
      q.connect(zug);
      const orte = this.dauerOrte(e, b.numberOfChannels, rundum, k, kopien);
      // Jeder Kanal der Aufnahme wird ein eigener Strahler mit eigenem Ort.
      let strahler;
      if (b.numberOfChannels > 1) {
        const teiler = ctx.createChannelSplitter(b.numberOfChannels);
        zug.connect(teiler);
        strahler = orte.map((o, c) => this.strahler(teiler, c % b.numberOfChannels, sz.bus, o));
      } else {
        strahler = orte.map((o) => this.strahler(zug, null, sz.bus, o));
      }
      const st = { quelle: q, zug, strahler, rundum, kopie: k, kopien };
      eb.stimmen.add(st);
      q.start(t, k === 0 ? (e.versatz || 0) % b.duration : (b.duration * k) / kopien);
    }
  }

  // Wo die Kanäle eines Dauertons stehen.
  dauerOrte(e, kanaele, rundum, kopie, kopien) {
    const basis = {
      breite: e.breite ?? (rundum ? 0.25 : 0.1), lfe: e.lfe || 0, hall: e.hall || 0,
      tiefpass: e.tiefpass, abstand: e.abstand ?? 1,
    };
    if (rundum) {
      // Kopie 0 vorn, Kopie 1 hinten; je Kanal links/rechts.
      const mitte = kopien === 1 ? [[-60, 60]] : [[-55, 55], [-130, 130]];
      const [l, r] = mitte[kopie];
      return kanaele > 1 ? [{ ...basis, winkel: l }, { ...basis, winkel: r }] : [{ ...basis, winkel: kopie ? 180 : 0, breite: Math.max(basis.breite, 0.6) }];
    }
    const w = e.ort && typeof e.ort === 'object' ? e.ort.winkel ?? 0 : 0;
    const a = e.ort && typeof e.ort === 'object' ? e.ort.abstand ?? 1 : 1;
    const spreiz = e.spreizung ?? (e.art === 'musik' ? 50 : 30);
    return kanaele > 1
      ? [{ ...basis, abstand: a, winkel: w - spreiz / 2 }, { ...basis, abstand: a, winkel: w + spreiz / 2 }]
      : [{ ...basis, abstand: a, winkel: w }];
  }

  // Ein Zufallsereignis: eine der Varianten, an einem Ort im Sektor.
  einmal(sz, eb, ortVorgabe) {
    const e = eb.def;
    const b = eb.puffer[Math.floor(Math.random() * eb.puffer.length)];
    const ort = ortVorgabe || zufallsOrt(e.sektor, ...(e.abstand || [0.8, 1.6]));
    const st = this.einzelStimme(b, sz.bus, {
      ...ort, breite: e.breite || 0, lfe: e.lfe || 0, hall: e.hall || 0, tiefpass: e.tiefpass,
    }, {
      pegel: (e.pegel ?? 0.8) * (1 - Math.random() * (e.pegelStreu ?? 0.3)),
      tonhoehe: (e.tonhoehe || 0) + (Math.random() * 2 - 1) * (e.tonStreu ?? 1),
      bewegung: e.bewegung,
    });
    eb.stimmen.add(st);
    st.quelle.onended = () => eb.stimmen.delete(st);
    this.melden('ereignis', { ebene: sz.ebenen.indexOf(eb), ort, dauer: b.duration });
  }

  einzelStimme(b, bus, ort, { pegel = 0.8, tonhoehe = 0, bewegung } = {}) {
    const ctx = this.ctx;
    const q = ctx.createBufferSource();
    q.buffer = b;
    q.playbackRate.value = Math.pow(2, tonhoehe / 12);
    const zug = ctx.createGain();
    zug.gain.value = pegel;
    zug.channelCount = 1;
    zug.channelCountMode = 'explicit'; // Einzelgeräusche: mono an einem Punkt
    q.connect(zug);
    const s = this.strahler(zug, null, bus, ort);
    const t = ctx.currentTime + 0.02;
    if (bewegung === 'vorbei') {
      const dauer = b.duration / q.playbackRate.value;
      const richtung = Math.random() < 0.5 ? -1 : 1;
      const weit = 70 + Math.random() * 90;
      this.bewegen(s, { winkel: ort.winkel - richtung * weit / 2, abstand: 1.6 }, { winkel: ort.winkel + richtung * weit / 2, abstand: 1.6 }, dauer, t);
    }
    q.start(t);
    const st = { quelle: q, zug, strahler: [s] };
    q.addEventListener('ended', () => setTimeout(() => { zug.disconnect(); s.pegel.disconnect(); }, 50));
    return st;
  }

  // Ein Geräusch aus der Leiste, außerhalb der Szene (eigener Bus, voll offen).
  async einzelSpielen(klang, ort = { winkel: 0, abstand: 1 }, { pegel = 0.9, hall = 0.15, lfe = 0.3, tonhoehe = 0, bewegung } = {}) {
    const id = this.waehlen(klang);
    if (!id) throw new Error('Diesen Klang gibt es nicht: ' + klang);
    const puffer = await this.laden(id);
    if (!this.leiste) {
      this.leiste = this.busBauen();
      this.blenden(this.leiste, 1, 0);
    }
    const b = puffer[Math.floor(Math.random() * puffer.length)];
    const st = this.einzelStimme(b, this.leiste, { ...ort, hall, lfe }, { pegel, tonhoehe: tonhoehe + (Math.random() * 2 - 1) * 0.5, bewegung });
    this.melden('einzel', { id, ort, dauer: b.duration });
    return st;
  }

  // ── Eingriffe in die laufende Szene ───────────────────────────

  ebeneAendern(index, aenderung) {
    const sz = this.szene;
    if (!sz || !sz.ebenen[index]) return;
    const eb = sz.ebenen[index];
    Object.assign(eb.def, aenderung);
    const t = this.ctx.currentTime;
    if ('stumm' in aenderung) {
      eb.stumm = aenderung.stumm;
      if (eb.stumm) this.ebeneAus(eb, 0.6);
      else if (eb.puffer) this.ebeneAn(sz, eb);
      return;
    }
    if ('pegel' in aenderung) {
      for (const st of eb.stimmen) {
        if (eb.def.art !== 'zufall') st.zug.gain.setTargetAtTime(aenderung.pegel, t, ZEIT);
      }
    }
    if ('ort' in aenderung || 'breite' in aenderung || 'hall' in aenderung || 'lfe' in aenderung || 'spreizung' in aenderung) {
      for (const st of eb.stimmen) this.dauerNeuOrten(eb, st);
    }
  }

  dauerNeuOrten(eb, st) {
    if (eb.def.art === 'zufall') return;
    const b = eb.puffer[0];
    const rundum = eb.def.ort === 'rundum' || (eb.def.ort == null && eb.def.art !== 'musik');
    const orte = this.dauerOrte(eb.def, b.numberOfChannels, rundum, st.kopie || 0, st.kopien || 1);
    st.strahler.forEach((s, i) => this.ortSetzen(s, orte[i] || orte[0]));
  }

  alleNeuSetzen() {
    if (!this.szene) return;
    for (const eb of this.szene.ebenen) for (const st of eb.stimmen) this.dauerNeuOrten(eb, st);
  }

  // ── Lautsprechertest ──────────────────────────────────────────

  // Rosa Rauschen nur auf einem Lautsprecher (Index in der Aufstellung).
  testKanal(i, dauer = 1.6) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const n = Math.floor(dauer * sr);
    const b = ctx.createBuffer(1, n, sr);
    const k = b.getChannelData(0);
    const r = rosa(zufallsQuelle(i + 1));
    const lfe = AUFSTELLUNGEN[this.aufstellung].lautsprecher[i].lfe;
    for (let j = 0; j < n; j++) {
      const s = j / sr;
      const huelle = Math.min(1, s / 0.05, (dauer - s) / 0.2);
      k[j] = (lfe ? Math.sin(2 * Math.PI * 45 * s) * 0.8 : r() * 0.6) * huelle;
    }
    const q = ctx.createBufferSource();
    q.buffer = b;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    q.connect(g).connect(this.lautsprecher[i]);
    q.start();
    q.onended = () => g.disconnect();
    this.melden('test', { index: i, dauer });
  }

  // Ein Klang wandert einmal im Kreis um den Hörer.
  async testUmlauf(dauer = 10) {
    if (!this.leiste) {
      this.leiste = this.busBauen();
      this.blenden(this.leiste, 1, 0);
    }
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const n = Math.floor(dauer * sr);
    const b = ctx.createBuffer(1, n, sr);
    const k = b.getChannelData(0);
    const r = rosa(zufallsQuelle(99));
    for (let j = 0; j < n; j++) {
      const s = j / sr;
      // Pulsierendes Rauschen: die Richtung ist leichter zu hören als bei gleichmäßigem.
      k[j] = r() * 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * s)) * Math.min(1, s / 0.2, (dauer - s) / 0.3);
    }
    const q = ctx.createBufferSource();
    q.buffer = b;
    const zug = ctx.createGain();
    zug.gain.value = 0.5;
    q.connect(zug);
    const s = this.strahler(zug, null, this.leiste, { winkel: 0, abstand: 1 });
    const t = ctx.currentTime + 0.05;
    const schritte = 72;
    for (let i = 0; i <= schritte; i++) {
      const w = (i / schritte) * 360;
      const g = gewichte(this.aufstellung, { winkel: w, center: 1 });
      s.gs.forEach((node, kk) => node.gain.linearRampToValueAtTime(g[kk], t + (i / schritte) * dauer));
    }
    q.start(t);
    this.melden('umlauf', { dauer });
  }
}

// Kennlinie des Begrenzers: linear bis 0,7, dann tanh-artig gegen 1.
function weicheKurve(n = 4097) {
  const k = new Float32Array(n);
  const knie = 0.7;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knie ? a : knie + (1 - knie) * Math.tanh((a - knie) / (1 - knie));
    k[i] = Math.sign(x) * y;
  }
  return k;
}
