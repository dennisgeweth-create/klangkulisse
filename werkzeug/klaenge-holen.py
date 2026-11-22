#!/usr/bin/env python3
"""Holt die Aufnahmen aus werkzeug/auswahl.json von Wikimedia Commons,
schneidet sie zurecht und schreibt klaenge/*.ogg samt klaenge/katalog.json
und QUELLEN.md.

    python3 werkzeug/klaenge-holen.py            alles (vorhandene Rohdateien bleiben)
    python3 werkzeug/klaenge-holen.py regen-leicht wolf    nur diese

Braucht ffmpeg (mit libopus) und numpy. Die Rohdateien liegen in
werkzeug/.roh/ (nicht im Repo).

Was mit einer Aufnahme geschieht, sagt ihre "art":
  bett    das ruhigste Stueck von "max" Sekunden, nahtlos zur Schleife
          geblendet (Ende in den Anfang), Lautheit angeglichen
  musik   von vorn, hoechstens "max" Sekunden, aus- und eingeblendet
  einzel  Stille vorn und hinten weg; mit "teilen" in so viele
          Einzelgeraeusche zerlegt, wie die Aufnahme hergibt (die lautesten)
"""
import html, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
import numpy as np

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROH = os.path.join(WURZEL, 'werkzeug', '.roh')
ZIEL = os.path.join(WURZEL, 'klaenge')
API = 'https://commons.wikimedia.org/w/api.php'
UA = 'Klangkulisse/0.1 (D&D-Klangkulisse; Werkzeug zum Holen freier Klaenge)'
SR = 48000
GROESSTE = 90 * 1024 * 1024
FREI = ('cc0', 'public domain', 'pd', 'cc by', 'cc-by', 'pdm')


class Gedrosselt(Exception):
    """Wikimedia lässt diese Adresse gerade nicht herein (HTTP 429)."""


def anfrage(url, binaer=False):
    # Wikimedia bittet bei 429 um Geduld (Retry-After). Daran halten wir uns —
    # aber nicht endlos: nach drei Absagen bricht der Lauf ab und behält,
    # was er hat. Ein späterer Lauf macht dort weiter (die Rohdateien bleiben).
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for versuch in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                daten = r.read()
                return daten if binaer else json.loads(daten)
        except urllib.error.HTTPError as f:
            if f.code not in (429, 503):
                raise
            if versuch == 3:
                raise Gedrosselt(url)
            warte = min(int(f.headers.get('Retry-After') or 0) or 30 * (versuch + 1), 900)
            print('  Wikimedia drosselt (%d) — warte %d s' % (f.code, warte), flush=True)
            time.sleep(warte)


def ohne_html(s):
    s = re.sub(r'<[^>]+>', '', s or '')
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


def angaben(titel):
    """Adresse, Urheber und Lizenz je Datei — in Bündeln zu 40."""
    aus = {}
    for i in range(0, len(titel), 40):
        teil = titel[i:i + 40]
        d = anfrage(API + '?' + urllib.parse.urlencode({
            'action': 'query', 'format': 'json', 'titles': '|'.join('File:' + t for t in teil),
            'prop': 'imageinfo', 'iiprop': 'url|size|extmetadata',
            'iiextmetadatafilter': 'LicenseShortName|LicenseUrl|Artist|Credit|AttributionRequired',
        }))
        normal = {n['to']: n['from'] for n in d['query'].get('normalized', [])}
        for p in d['query']['pages'].values():
            name = normal.get(p['title'], p['title'])[5:]
            if 'imageinfo' not in p:
                aus[name] = None
                continue
            ii = p['imageinfo'][0]
            m = ii.get('extmetadata', {})
            wert = lambda k: (m.get(k) or {}).get('value', '')
            aus[name] = {
                'url': ii['url'], 'bytes': ii.get('size', 0), 'seite': ii.get('descriptionurl'),
                'urheber': ohne_html(wert('Artist')) or 'unbekannt',
                'lizenz': ohne_html(wert('LicenseShortName')),
                'lizenzUrl': wert('LicenseUrl'),
            }
        time.sleep(1)
    # Die Antwort normalisiert Leerzeichen und Unterstriche; zurück auf die Schreibweise der Auswahl.
    return {t: aus.get(t) or aus.get(t.replace('_', ' ')) for t in titel}


def roh_pfad(eintrag, info):
    endung = os.path.splitext(urllib.parse.urlparse(info['url']).path)[1]
    return os.path.join(ROH, eintrag['id'] + endung)


def lesen(pfad):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', pfad, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                       capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).reshape(-1, 2).copy()


def schreiben(pfad, x):
    mono = np.allclose(x[:, 0], x[:, 1], atol=1e-3) or np.corrcoef(x[:, 0], x[:, 1])[0, 1] > 0.995
    daten = (x.mean(axis=1, keepdims=True) if mono else x).astype(np.float32)
    kan = daten.shape[1]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ac', str(kan), '-ar', str(SR), '-i', '-',
                    '-c:a', 'libopus', '-b:a', '64k' if kan == 1 else '96k', '-vbr', 'on',
                    '-application', 'audio', '-map_metadata', '-1', pfad],
                   input=daten.tobytes(), check=True)
    return kan


def huelle(x, schritt=0.02):
    """RMS je Schritt (Mono)."""
    m = x.mean(axis=1)
    n = int(SR * schritt)
    k = len(m) // n
    if k == 0:
        return np.array([np.sqrt(np.mean(m ** 2))]), n
    return np.sqrt(np.mean(m[:k * n].reshape(k, n) ** 2, axis=1)) + 1e-9, n


def rms(x):
    return float(np.sqrt(np.mean(x ** 2)) + 1e-12)


def pegeln(x, ziel_db, spitze_db=-1.0):
    g = 10 ** (ziel_db / 20) / rms(x)
    spitze = float(np.max(np.abs(x))) * g
    grenze = 10 ** (spitze_db / 20)
    if spitze > grenze:
        g *= grenze / spitze
    return x * g


def blende(x, ein, aus):
    x = x.copy()
    a, b = int(ein * SR), int(aus * SR)
    if a:
        x[:a] *= np.linspace(0, 1, a)[:, None]
    if b:
        x[-b:] *= np.linspace(1, 0, b)[:, None]
    return x


def ruhigstes_stueck(x, laenge):
    """Das Fenster mit den wenigsten Ausreissern (Griffgeraeusche, Autos) —
    gemessen als hoechster Pegel im Verhaeltnis zum mittleren."""
    n = int(laenge * SR)
    if len(x) <= n:
        return x
    env, schritt = huelle(x, 0.1)
    fenster = int(laenge / 0.1)
    best, best_wert = 0, None
    for start in range(0, len(env) - fenster, 20):  # alle zwei Sekunden
        e = env[start:start + fenster]
        wert = np.percentile(e, 99.5) / np.median(e)
        if best_wert is None or wert < best_wert:
            best, best_wert = start, wert
    a = best * schritt
    return x[a:a + n]


def schleife(x, ueber=3.0):
    """Nahtlose Schleife: das Ende wird leistungsgleich in den Anfang geblendet."""
    u = min(int(ueber * SR), len(x) // 4)
    t = np.linspace(0, np.pi / 2, u)[:, None]
    kopf, rest, schwanz = x[:u], x[u:len(x) - u], x[len(x) - u:]
    return np.concatenate([kopf * np.sin(t) + schwanz * np.cos(t), rest])


def ereignisse(x, anzahl, max_laenge):
    env, n = huelle(x, 0.02)
    boden = np.percentile(env, 20)
    schwelle = max(boden * 3.5, env.max() * 0.06)
    laut = env > schwelle
    stuecke, i = [], 0
    while i < len(laut):
        if not laut[i]:
            i += 1
            continue
        j = i
        luecke = 0
        while j < len(laut) and luecke < int(0.35 / 0.02):
            luecke = 0 if laut[j] else luecke + 1
            j += 1
        stuecke.append((i, j - luecke))
        i = j
    aus = []
    for a, b in stuecke:
        if (b - a) * 0.02 < 0.15:
            continue
        s = max(0, a * n - int(0.06 * SR))
        e = min(len(x), b * n + int(0.45 * SR))
        e = min(e, s + int(max_laenge * SR))
        aus.append((float(np.sum(env[a:b] ** 2)), s, e))
    aus = sorted(sorted(aus, reverse=True)[:anzahl], key=lambda t: t[1])
    # Nachbarn dürfen sich nicht überlappen.
    fertig = []
    for k, (_, s, e) in enumerate(aus):
        if k + 1 < len(aus):
            e = min(e, aus[k + 1][1])
        fertig.append(x[s:e])
    return fertig


def stille_weg(x, max_laenge):
    env, n = huelle(x, 0.02)
    schwelle = max(np.percentile(env, 10) * 2.5, env.max() * 0.02)
    laut = np.nonzero(env > schwelle)[0]
    if len(laut) == 0:
        return x[:int(max_laenge * SR)]
    s = max(0, laut[0] * n - int(0.03 * SR))
    e = min(len(x), (laut[-1] + 1) * n + int(0.3 * SR))
    return x[s:min(e, s + int(max_laenge * SR))]


def verarbeiten(eintrag, x):
    art = eintrag['art']
    if art == 'bett':
        st = ruhigstes_stueck(x, eintrag.get('max', 90) + 3)
        return [pegeln(schleife(st), -24)]
    if art == 'musik':
        st = x[:int(eintrag.get('max', 120) * SR)]
        return [blende(pegeln(st, -20), 0.05, 3.0 if len(st) >= len(x) - SR else 4.0)]
    if eintrag.get('teilen'):
        teile = ereignisse(x, eintrag['teilen'], eintrag.get('max', 8))
    else:
        teile = [stille_weg(x, eintrag.get('max', 10))]
    return [blende(pegeln(t, -16, -1.0), 0.004, min(0.08, len(t) / SR / 4)) for t in teile if len(t) > SR * 0.1]


def main():
    with open(os.path.join(WURZEL, 'werkzeug', 'auswahl.json'), encoding='utf-8') as f:
        auswahl = json.load(f)['klaenge']
    nur = set(sys.argv[1:])
    os.makedirs(ROH, exist_ok=True)
    os.makedirs(ZIEL, exist_ok=True)
    kat_pfad = os.path.join(ZIEL, 'katalog.json')
    alt = {}
    if os.path.exists(kat_pfad):
        with open(kat_pfad, encoding='utf-8') as f:
            alt = {k['id']: k for k in json.load(f)['klaenge']}

    info = angaben([e['titel'] for e in auswahl if not nur or e['id'] in nur])
    katalog = []
    gedrosselt = False
    for e in auswahl:
        if gedrosselt or (nur and e['id'] not in nur):
            if e['id'] in alt:
                katalog.append(alt[e['id']])
            continue
        i = info.get(e['titel'])
        if not i:
            print('FEHLT   ', e['id'], e['titel'])
            continue
        if not any(i['lizenz'].lower().startswith(fr) for fr in FREI):
            print('LIZENZ? ', e['id'], i['lizenz'])
            continue
        if i['bytes'] > GROESSTE:
            print('ZU GROSS', e['id'], i['bytes'] // 1024 // 1024, 'MB')
            continue
        roh = roh_pfad(e, i)
        if not os.path.exists(roh):
            print('hole    ', e['id'], '(%d kB)' % (i['bytes'] // 1024), flush=True)
            try:
                daten = anfrage(i['url'], binaer=True)
            except Gedrosselt:
                print('ABBRUCH  Wikimedia drosselt diese Adresse. Später noch einmal starten —', flush=True)
                print('         was schon da ist, bleibt; der nächste Lauf macht weiter.', flush=True)
                gedrosselt = True
                if e['id'] in alt:
                    katalog.append(alt[e['id']])
                continue
            with open(roh + '.teil', 'wb') as f:
                f.write(daten)
            os.replace(roh + '.teil', roh)
            time.sleep(1)
        try:
            x = lesen(roh)
        except subprocess.CalledProcessError as f:
            print('KAPUTT  ', e['id'], f.stderr.decode()[:200])
            continue
        for alt_datei in os.listdir(ZIEL):
            if re.fullmatch(re.escape(e['id']) + r'(-\d+)?\.ogg', alt_datei):
                os.remove(os.path.join(ZIEL, alt_datei))
        teile = verarbeiten(e, x)
        dateien, dauer, kanaele = [], [], 1
        for k, t in enumerate(teile):
            name = e['id'] + ('-%d' % (k + 1) if len(teile) > 1 else '') + '.ogg'
            kanaele = max(kanaele, schreiben(os.path.join(ZIEL, name), t))
            dateien.append(name)
            dauer.append(round(len(t) / SR, 2))
        print('fertig  ', e['id'].ljust(16), len(dateien), 'Datei(en)', '%.1fs' % sum(dauer), i['lizenz'], flush=True)
        katalog.append({
            'id': e['id'], 'name': e['name'], 'gruppe': e['gruppe'], 'art': e['art'],
            'dateien': dateien, 'dauer': dauer, 'kanaele': kanaele,
            'quelle': {'titel': e['titel'], 'seite': i['seite'], 'urheber': i['urheber'],
                       'lizenz': i['lizenz'], 'lizenzUrl': i['lizenzUrl']},
        })

    with open(kat_pfad, 'w', encoding='utf-8') as f:
        json.dump({'_hinweis': 'erzeugt von werkzeug/klaenge-holen.py', 'klaenge': katalog}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    quellen(katalog)
    print('Katalog: %d von %d Klängen.' % (len(katalog), len(auswahl)))
    if gedrosselt:
        sys.exit(2)


def quellen(katalog):
    z = ['# Quellen der Klänge', '',
         'Alle Aufnahmen stammen von [Wikimedia Commons](https://commons.wikimedia.org) und stehen unter',
         'freien Lizenzen. Sie wurden zugeschnitten, zu Schleifen geblendet, in der Lautstärke',
         'angeglichen und als Opus neu kodiert (`werkzeug/klaenge-holen.py`). Für Aufnahmen unter',
         'CC BY-SA gilt: die bearbeitete Fassung in `klaenge/` steht unter derselben Lizenz.',
         '', 'Erzeugt von `werkzeug/klaenge-holen.py` — nicht von Hand ändern.', '',
         '| Klang | Datei auf Commons | Urheber | Lizenz |', '|---|---|---|---|']
    for k in sorted(katalog, key=lambda k: (k['gruppe'], k['name'])):
        q = k['quelle']
        lz = '[%s](%s)' % (q['lizenz'], q['lizenzUrl']) if q.get('lizenzUrl') else q['lizenz']
        z.append('| %s | [%s](%s) | %s | %s |' % (k['name'], q['titel'].replace('|', '\\|'), q['seite'],
                                                  q['urheber'].replace('|', '\\|'), lz))
    with open(os.path.join(WURZEL, 'QUELLEN.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(z) + '\n')


if __name__ == '__main__':
    main()
