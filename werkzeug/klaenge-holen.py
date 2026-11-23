#!/usr/bin/env python3
"""Holt die Aufnahmen aus werkzeug/auswahl.json von Wikimedia Commons,
schneidet sie zurecht und schreibt klaenge/*.ogg samt klaenge/katalog.json
und QUELLEN.md.

    python3 werkzeug/klaenge-holen.py            alles (vorhandene Rohdateien bleiben)
    python3 werkzeug/klaenge-holen.py regen-leicht wolf    nur diese

Braucht ffmpeg (mit libopus) und numpy, für .7z-Pakete von OpenGameArt
auch 7-Zip. Die Rohdateien liegen in werkzeug/.roh/ (nicht im Repo).

Erste Wahl ist Wikimedia Commons ("titel"). Ein Eintrag ohne "titel" kommt
nur von OpenGameArt. Hat ein Eintrag mit "titel" zusätzlich einen
Ersatz von OpenGameArt ("oga"), springt der ein, wenn Commons drosselt, die
Datei fehlt oder die Lizenz nicht passt:

  "oga": {"seite": "rain-loopable",          Kennung der Seite, opengameart.org/content/…
          "datei": "Rain%20OGG.zip",         Datei auf der Seite (Audio, .zip, .7z, .tar.gz)
          "innen": "*1.ogg",                 Muster für die Datei im Paket, auch eine Liste
          "name": "…", "max": 60, "teilen": 3}   wahlweise: weicht vom Commons-Eintrag ab

Passen bei einem Einzelgeräusch mehrere Dateien im Paket, wird jede ein Teil
(höchstens "teilen" viele). Urheber und Lizenz liest das Werkzeug von der Seite.
Ein späterer Lauf, bei dem Commons wieder antwortet, ersetzt den Ersatz durch die
Commons-Aufnahme. KK_OHNE_COMMONS=1 nimmt gleich den Ersatz.

Was mit einer Aufnahme geschieht, sagt ihre "art":
  bett    das ruhigste Stueck von "max" Sekunden, nahtlos zur Schleife
          geblendet (Ende in den Anfang), Lautheit angeglichen
  musik   von vorn, hoechstens "max" Sekunden, aus- und eingeblendet
  einzel  Stille vorn und hinten weg; mit "teilen" in so viele
          Einzelgeraeusche zerlegt, wie die Aufnahme hergibt (die lautesten)
"""
import fnmatch, html, io, json, os, re, shutil, subprocess, sys, tarfile, time, zipfile
import urllib.error, urllib.parse, urllib.request
import numpy as np

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROH = os.path.join(WURZEL, 'werkzeug', '.roh')
ZIEL = os.path.join(WURZEL, 'klaenge')
API = 'https://commons.wikimedia.org/w/api.php'
# Wikimedia bittet darum, im User-Agent eine Kontaktmöglichkeit zu nennen
# (https://meta.wikimedia.org/wiki/User-Agent_policy) und drosselt Anfragen
# ohne sie härter. KK_KONTAKT (E-Mail oder Adresse des eigenen Repos) wird
# angehängt, wenn gesetzt.
UA = 'Klangkulisse/0.1 (D&D-Klangkulisse; Werkzeug zum Holen freier Klaenge' + (
    '; ' + os.environ['KK_KONTAKT'] if os.environ.get('KK_KONTAKT') else '') + ')'
SR = 48000
GROESSTE = 90 * 1024 * 1024
# Wikimedia nimmt viele schnelle Downloads von einer Adresse übel (HTTP 429).
# Pause zwischen zwei Dateien und Zahl der Versuche je Datei — die Action
# setzt beides großzügig (KK_PAUSE, KK_VERSUCHE).
PAUSE = float(os.environ.get('KK_PAUSE', '5'))
VERSUCHE = int(os.environ.get('KK_VERSUCHE', '4'))
FREI = ('cc0', 'public domain', 'pd', 'cc by', 'cc-by', 'pdm')
OGA = 'https://opengameart.org'
# OpenGameArt nennt je Werk eine oder mehrere Lizenzen; wir nehmen die freieste.
# OGA-BY und GPL gehören nicht zu den Lizenzen der Klangkulisse.
OGA_LIZENZEN = [
    ('CC0', 'CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'),
    ('CC-BY 4.0', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'),
    ('CC-BY 3.0', 'CC BY 3.0', 'https://creativecommons.org/licenses/by/3.0/'),
    ('CC-BY-SA 4.0', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'),
    ('CC-BY-SA 3.0', 'CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/'),
]
AUDIO = ('.wav', '.ogg', '.oga', '.mp3', '.flac', '.aif', '.aiff', '.m4a', '.opus')


class Gedrosselt(Exception):
    """Wikimedia lässt diese Adresse gerade nicht herein (HTTP 429)."""


def anfrage(url, binaer=False):
    # Wikimedia bittet bei 429 um Geduld (Retry-After). Daran halten wir uns —
    # aber nicht endlos: nach drei Absagen bricht der Lauf ab und behält,
    # was er hat. Ein späterer Lauf macht dort weiter (die Rohdateien bleiben).
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for versuch in range(VERSUCHE):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                daten = r.read()
                return daten if binaer else json.loads(daten)
        except urllib.error.HTTPError as f:
            if f.code not in (429, 503):
                raise
            if versuch == VERSUCHE - 1:
                raise Gedrosselt(url)
            warte = min(int(f.headers.get('Retry-After') or 0) or 60 * 2 ** versuch, 900)
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


def oga_angaben(seite):
    """Titel, Urheber und Lizenz einer OpenGameArt-Seite (zwischengespeichert)."""
    puffer = os.path.join(ROH, 'oga', seite + '.json')
    if os.path.exists(puffer):
        with open(puffer, encoding='utf-8') as f:
            return json.load(f)
    url = OGA + '/content/' + seite
    t = anfrage(url, binaer=True).decode('utf-8', 'replace')
    lizenzen = set(re.findall(r"license-name'>([^<]+)<", t))
    frei = next((l for l in OGA_LIZENZEN if l[0] in lizenzen), None)
    titel = re.search(r'property="dc:title"><h2>([^<]+)', t) or re.search(r'<title>([^|<]+)', t)
    urheber = re.search(r"field-name-author-submitter.*?<a href=\"/users/[^\"]+\">([^<]+)</a>", t, re.S)
    aus = {
        'seite': url, 'titel': ohne_html(titel.group(1)) if titel else seite,
        'urheber': ohne_html(urheber.group(1)) if urheber else 'unbekannt',
        'lizenz': frei[1] if frei else ', '.join(sorted(lizenzen)) or '?',
        'lizenzUrl': frei[2] if frei else '', 'frei': bool(frei),
    }
    os.makedirs(os.path.dirname(puffer), exist_ok=True)
    with open(puffer, 'w', encoding='utf-8') as f:
        json.dump(aus, f, ensure_ascii=False)
    return aus


def sieben_zip():
    return shutil.which('7z') or shutil.which('7za') or next(
        (p for p in (r'C:\Program Files\7-Zip\7z.exe', r'C:\Program Files (x86)\7-Zip\7z.exe') if os.path.exists(p)), None)


def paket_inhalt(paket):
    """Die Audiodateien in einem Paket (oder die Datei selbst)."""
    n = paket.lower()
    if n.endswith('.zip'):
        with zipfile.ZipFile(paket) as z:
            namen = z.namelist()
    elif n.endswith(('.tar.gz', '.tgz', '.tar')):
        with tarfile.open(paket) as t:
            namen = [m.name for m in t.getmembers() if m.isfile()]
    elif n.endswith('.7z'):
        sz = sieben_zip()
        if not sz:
            raise RuntimeError('7-Zip fehlt (für %s)' % os.path.basename(paket))
        aus = subprocess.run([sz, 'l', '-slt', paket], capture_output=True, text=True, errors='replace', check=True).stdout
        namen = [z[7:] for z in aus.splitlines() if z.startswith('Path = ')][1:]
    else:
        return [None]
    return sorted(m for m in namen if m.lower().endswith(AUDIO) and '__MACOSX' not in m)


def paket_lesen(paket, name, ziel):
    """Eine Datei aus dem Paket nach `ziel` schreiben."""
    n = paket.lower()
    if n.endswith('.zip'):
        with zipfile.ZipFile(paket) as z:
            daten = z.read(name)
    elif n.endswith(('.tar.gz', '.tgz', '.tar')):
        with tarfile.open(paket) as t:
            daten = t.extractfile(name).read()
    else:
        daten = subprocess.run([sieben_zip(), 'x', '-so', paket, name], capture_output=True, check=True).stdout
    with open(ziel, 'wb') as f:
        f.write(daten)


def oga_holen(eintrag):
    """Lädt den Ersatz von OpenGameArt und gibt die Pfade der Rohdateien zurück."""
    o = eintrag['oga']
    datei = urllib.parse.unquote(o['datei'])
    # Windows verträgt manche Zeichen nicht im Dateinamen (etwa „?“).
    paket = os.path.join(ROH, 'oga', re.sub(r'[<>:"/\\|?*]', '_', datei))
    if not os.path.exists(paket):
        print('hole OGA', eintrag['id'], '(%s)' % datei, flush=True)
        daten = anfrage(OGA + '/sites/default/files/' + urllib.parse.quote(datei), binaer=True)
        if len(daten) > GROESSTE:
            raise RuntimeError('zu groß')
        os.makedirs(os.path.dirname(paket), exist_ok=True)
        with open(paket + '.teil', 'wb') as f:
            f.write(daten)
        os.replace(paket + '.teil', paket)
    inhalt = paket_inhalt(paket)
    if inhalt == [None]:
        return [paket]
    muster = o.get('innen') or '*'
    muster = [muster] if isinstance(muster, str) else muster
    treffer = [m for m in inhalt if any(fnmatch.fnmatch(m.replace('\\', '/').lower(), p.lower()) for p in muster)]
    if not treffer:
        raise RuntimeError('nichts passt zu %s in %s' % (muster, datei))
    if eintrag['art'] != 'einzel':
        treffer = treffer[:1]
    elif o.get('teilen', eintrag.get('teilen')):
        treffer = treffer[:o.get('teilen', eintrag.get('teilen'))]
    pfade = []
    for k, m in enumerate(treffer):
        ziel = os.path.join(ROH, 'oga-teile', '%s-%d%s' % (eintrag['id'], k + 1, os.path.splitext(m)[1].lower()))
        os.makedirs(os.path.dirname(ziel), exist_ok=True)
        paket_lesen(paket, m, ziel)
        pfade.append(ziel)
    return pfade


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


def verarbeiten(eintrag, xs):
    """xs: die gelesenen Rohdateien. Mehrere gibt es nur bei Einzelgeräuschen
    aus einem Paket — dann wird jede Datei ein Teil."""
    art = eintrag['art']
    x = xs[0]
    if art == 'bett':
        st = ruhigstes_stueck(x, eintrag.get('max', 90) + 3)
        return [pegeln(schleife(st), -24)]
    if art == 'musik':
        st = x[:int(eintrag.get('max', 120) * SR)]
        return [blende(pegeln(st, -20), 0.05, 3.0 if len(st) >= len(x) - SR else 4.0)]
    if len(xs) > 1:
        teile = [stille_weg(t, eintrag.get('max', 10)) for t in xs]
    elif eintrag.get('teilen'):
        teile = ereignisse(x, eintrag['teilen'], eintrag.get('max', 8))
    else:
        teile = [stille_weg(x, eintrag.get('max', 10))]
    return [blende(pegeln(t, -16, -1.0), 0.004, min(0.08, len(t) / SR / 4)) for t in teile if len(t) > SR * 0.1]


def schnitt_von(e):
    """Alles, was bestimmt, wie eine Aufnahme geschnitten wird."""
    return '|'.join(str(e.get(k, '')) for k in ('titel', 'art', 'max', 'teilen'))


def mit_ersatz(e):
    """Der Eintrag, wie er für den OpenGameArt-Ersatz gilt."""
    return {**e, **{k: e['oga'][k] for k in ('name', 'max', 'teilen') if k in e['oga']}}


def schnitt_oga(e):
    o, m = e['oga'], mit_ersatz(e)
    return '|'.join(['oga', o['seite'], o['datei'], json.dumps(o.get('innen', '*'))]
                    + [str(m.get(k, '')) for k in ('art', 'max', 'teilen')])


def schneiden(e, roh, schnitt, quelle, vorher=None):
    """Liest die Rohdateien, schneidet, schreibt klaenge/<id>*.ogg und gibt den Katalogeintrag zurück."""
    try:
        xs = [lesen(r) for r in roh]
    except subprocess.CalledProcessError as f:
        print('KAPUTT  ', e['id'], f.stderr.decode()[:200])
        return None
    teile = verarbeiten(e, xs)
    if not teile:
        print('LEER    ', e['id'])
        return None
    # Nur die eigenen alten Dateien weg: ein Muster wie "<id>-*.ogg" träfe auch
    # fremde (Teil 2 von "monster" heißt so wie die Kennung "monster-2").
    for alt_datei in (vorher or {}).get('dateien', []):
        if os.path.exists(os.path.join(ZIEL, alt_datei)):
            os.remove(os.path.join(ZIEL, alt_datei))
    dateien, dauer, kanaele = [], [], 1
    for k, t in enumerate(teile):
        name = e['id'] + ('-%d' % (k + 1) if len(teile) > 1 else '') + '.ogg'
        kanaele = max(kanaele, schreiben(os.path.join(ZIEL, name), t))
        dateien.append(name)
        dauer.append(round(len(t) / SR, 2))
    print('fertig  ', e['id'].ljust(16), len(dateien), 'Datei(en)', '%.1fs' % sum(dauer),
          quelle['lizenz'], '·', quelle['herkunft'], flush=True)
    return {
        'id': e['id'], 'name': e['name'], 'gruppe': e['gruppe'], 'art': e['art'],
        'dateien': dateien, 'dauer': dauer, 'kanaele': kanaele, 'schnitt': schnitt, 'quelle': quelle,
    }


def von_commons(e, i, vorher=None):
    """Katalogeintrag aus der Commons-Aufnahme, oder None. Wirft Gedrosselt."""
    if not i:
        print('FEHLT   ', e['id'], e['titel'])
        return None
    if not any(i['lizenz'].lower().startswith(fr) for fr in FREI):
        print('LIZENZ? ', e['id'], i['lizenz'])
        return None
    if i['bytes'] > GROESSTE:
        print('ZU GROSS', e['id'], i['bytes'] // 1024 // 1024, 'MB')
        return None
    roh = roh_pfad(e, i)
    if not os.path.exists(roh):
        print('hole    ', e['id'], '(%d kB)' % (i['bytes'] // 1024), flush=True)
        daten = anfrage(i['url'], binaer=True)
        with open(roh + '.teil', 'wb') as f:
            f.write(daten)
        os.replace(roh + '.teil', roh)
        time.sleep(PAUSE)
    return schneiden(e, [roh], schnitt_von(e), {
        'titel': e['titel'], 'seite': i['seite'], 'urheber': i['urheber'],
        'lizenz': i['lizenz'], 'lizenzUrl': i['lizenzUrl'], 'herkunft': 'Wikimedia Commons'}, vorher)


def von_oga(e, vorher=None):
    """Katalogeintrag aus dem OpenGameArt-Ersatz, oder None."""
    try:
        a = oga_angaben(e['oga']['seite'])
        if not a['frei']:
            print('LIZENZ? ', e['id'], 'OGA:', a['lizenz'])
            return None
        roh = oga_holen(e)
    except (Gedrosselt, RuntimeError, OSError, subprocess.CalledProcessError, KeyError, zipfile.BadZipFile) as f:
        print('OGA?    ', e['id'], f)
        return None
    return schneiden(mit_ersatz(e), roh, schnitt_oga(e), {
        'titel': a['titel'], 'seite': a['seite'], 'urheber': a['urheber'],
        'lizenz': a['lizenz'], 'lizenzUrl': a['lizenzUrl'], 'herkunft': 'OpenGameArt'}, vorher)


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

    ohne_commons = bool(os.environ.get('KK_OHNE_COMMONS'))
    gedrosselt = False
    info = {}
    if not ohne_commons:
        try:
            info = angaben([e['titel'] for e in auswahl if e.get('titel') and (not nur or e['id'] in nur)])
        except Gedrosselt:
            gedrosselt = True
    katalog = []
    for e in auswahl:
        vorher = alt.get(e['id'])
        # Schon geschnitten, mit denselben Vorgaben? Dann bleibt es, wie es ist —
        # Opus kodiert nicht bitgleich, ein neuer Schnitt wäre ein leerer Commit.
        vorhanden = vorher and all(os.path.exists(os.path.join(ZIEL, d)) for d in vorher['dateien'])
        da = vorhanden and not os.environ.get('KK_NEU')
        if (nur and e['id'] not in nur) or (da and vorher.get('schnitt') == schnitt_von(e)):
            if vorher:
                katalog.append(vorher)
            continue
        neu = None
        if e.get('titel') and not (gedrosselt or ohne_commons):
            try:
                neu = von_commons(e, info.get(e['titel']), vorher)
            except Gedrosselt:
                print('DROSSEL  Wikimedia drosselt diese Adresse — der Rest kommt, wo es geht, von OpenGameArt.', flush=True)
                gedrosselt = True
        if neu is None and e.get('oga'):
            if da and vorher.get('schnitt') == schnitt_oga(e):
                katalog.append(vorher)
                continue
            neu = von_oga(e, vorher)
        if neu is None and vorhanden:
            neu = vorher  # lieber der alte Schnitt als keiner
        if neu:
            katalog.append(neu)

    with open(kat_pfad, 'w', encoding='utf-8') as f:
        json.dump({'_hinweis': 'erzeugt von werkzeug/klaenge-holen.py', 'klaenge': katalog}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    quellen(katalog)
    ersatz = sum(1 for k in katalog if k['quelle'].get('herkunft') == 'OpenGameArt')
    print('Katalog: %d von %d Klängen (%d von OpenGameArt).' % (len(katalog), len(auswahl), ersatz))
    if gedrosselt:
        print('Wikimedia hat gedrosselt. Ein späterer Lauf holt die Commons-Aufnahmen nach.')
        sys.exit(2)


def quellen(katalog):
    z = ['# Quellen der Klänge', '',
         'Die Aufnahmen stammen von [Wikimedia Commons](https://commons.wikimedia.org) und',
         '[OpenGameArt](https://opengameart.org) und stehen unter freien Lizenzen. Sie wurden',
         'zugeschnitten, zu Schleifen geblendet, in der Lautstärke angeglichen und als Opus neu',
         'kodiert (`werkzeug/klaenge-holen.py`). Für Aufnahmen unter CC BY-SA gilt: die bearbeitete',
         'Fassung in `klaenge/` steht unter derselben Lizenz.',
         '', 'Erzeugt von `werkzeug/klaenge-holen.py` — nicht von Hand ändern.', '',
         '| Klang | Aufnahme | Fundort | Urheber | Lizenz |', '|---|---|---|---|---|']
    for k in sorted(katalog, key=lambda k: (k['gruppe'], k['name'])):
        q = k['quelle']
        lz = '[%s](%s)' % (q['lizenz'], q['lizenzUrl']) if q.get('lizenzUrl') else q['lizenz']
        z.append('| %s | [%s](%s) | %s | %s | %s |' % (
            k['name'], q['titel'].replace('|', '\\|'), q['seite'], q.get('herkunft', 'Wikimedia Commons'),
            q['urheber'].replace('|', '\\|'), lz))
    with open(os.path.join(WURZEL, 'QUELLEN.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(z) + '\n')


if __name__ == '__main__':
    main()
