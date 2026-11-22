// Was die Klangkulisse sich merkt — alles im Browser, nichts geht hinaus.
//   localStorage  Einstellungen und eigene Szenen
//   IndexedDB     eigene Klangdateien (können groß sein)

const SCHLUESSEL = { einst: 'kk_einst', szenen: 'kk_szenen' };

function lesen(k, vorgabe) {
  try {
    const t = localStorage.getItem(k);
    return t ? JSON.parse(t) : vorgabe;
  } catch (f) {
    return vorgabe;
  }
}

function schreiben(k, wert) {
  try {
    localStorage.setItem(k, JSON.stringify(wert));
    return true;
  } catch (f) {
    return false;
  }
}

export const einstellungen = {
  lesen: () => lesen(SCHLUESSEL.einst, {}),
  schreiben: (e) => schreiben(SCHLUESSEL.einst, e),
};

export const eigeneSzenen = {
  lesen: () => lesen(SCHLUESSEL.szenen, []),
  schreiben: (liste) => schreiben(SCHLUESSEL.szenen, liste),
};

// ── IndexedDB ──

let db = null;
function oeffnen() {
  if (db) return db;
  db = new Promise((ok, fehl) => {
    if (!('indexedDB' in window)) return fehl(new Error('Dieser Browser kann keine Dateien speichern.'));
    const r = indexedDB.open('klangkulisse', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('dateien', { keyPath: 'id' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fehl(r.error);
  });
  return db;
}

async function vorgang(modus, fn) {
  const d = await oeffnen();
  return new Promise((ok, fehl) => {
    const tx = d.transaction('dateien', modus);
    const r = fn(tx.objectStore('dateien'));
    tx.oncomplete = () => ok(r && r.result);
    tx.onerror = () => fehl(tx.error);
  });
}

export const eigeneKlaenge = {
  // Nur die Angaben, ohne die Daten.
  async liste() {
    const alle = await vorgang('readonly', (s) => s.getAll());
    return (alle || []).map(({ daten, ...rest }) => ({ ...rest, bytes: daten ? daten.byteLength : 0 }));
  },
  async daten(id) {
    const e = await vorgang('readonly', (s) => s.get(id));
    return e ? e.daten.slice(0) : null; // Kopie: decodeAudioData löst den Puffer ab
  },
  async ablegen(datei, art) {
    const id = 'eigen:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const daten = await datei.arrayBuffer();
    const eintrag = {
      id, name: datei.name.replace(/\.[^.]+$/, ''), art, typ: datei.type, daten,
      datum: new Date().toISOString(), gruppe: 'Eigene',
    };
    await vorgang('readwrite', (s) => s.put(eintrag));
    return id;
  },
  async aendern(id, aenderung) {
    const e = await vorgang('readonly', (s) => s.get(id));
    if (!e) return;
    await vorgang('readwrite', (s) => s.put({ ...e, ...aenderung }));
  },
  async loeschen(id) {
    await vorgang('readwrite', (s) => s.delete(id));
  },
};
