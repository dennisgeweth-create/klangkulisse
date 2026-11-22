#!/usr/bin/env python3
"""Sucht Audiodateien auf Wikimedia Commons und zeigt Lizenz, Laenge, Groesse.

    python3 werkzeug/commons-suche.py "rain" "thunder" ...
"""
import json, sys, time, urllib.error, urllib.parse, urllib.request

API = 'https://commons.wikimedia.org/w/api.php'
UA = 'Klangkulisse/0.1 (D&D-Klangkulisse; Werkzeug zum Finden freier Klaenge)'
FREI = ('cc0', 'public domain', 'pd', 'cc by', 'cc-by')

def holen(params):
    url = API + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for versuch in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as f:
            if f.code != 429 or versuch == 5:
                raise
            time.sleep(int(f.headers.get('Retry-After') or 0) or 5 * (versuch + 1))

def suchen(begriff, anzahl=30):
    d = holen({
        'action': 'query', 'format': 'json', 'generator': 'search',
        'gsrsearch': 'filetype:audio ' + begriff, 'gsrnamespace': 6, 'gsrlimit': anzahl,
        'prop': 'imageinfo', 'iiprop': 'url|size|mime|extmetadata|metadata',
        'iiextmetadatafilter': 'LicenseShortName|Artist|ImageDescription',
    })
    aus = []
    for p in d.get('query', {}).get('pages', {}).values():
        ii = p['imageinfo'][0]
        m = ii.get('extmetadata', {})
        lic = m.get('LicenseShortName', {}).get('value', '')
        laenge = None
        for md in ii.get('metadata') or []:
            if md.get('name') in ('length', 'playtime_seconds'):
                laenge = md.get('value')
        aus.append({'titel': p['title'], 'lizenz': lic, 'laenge': laenge, 'bytes': ii.get('size'),
                    'mime': ii.get('mime'), 'url': ii.get('url')})
    return aus

if __name__ == '__main__':
    for b in sys.argv[1:]:
        print('==', b, flush=True)
        time.sleep(2)
        for e in suchen(b):
            frei = any(e['lizenz'].lower().startswith(f) for f in FREI)
            l = e['laenge']
            try: l = '%5.0fs' % float(l)
            except (TypeError, ValueError): l = '   ?s'
            print(' %s %s %6dkB %-14s %s' % ('+' if frei else '-', l, (e['bytes'] or 0)//1024, e['lizenz'][:14], e['titel'][5:80]))
