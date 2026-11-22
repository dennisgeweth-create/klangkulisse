# Klangkulisse

Raumklang (7.1/5.1/Stereo) für Pen-&-Paper im Browser. Statische Seite,
ES-Module, kein npm, kein Bauschritt. Übersicht und Aufbau: `README.md`.

## Nach jeder Änderung

```bash
node test/pruefen.mjs              # Rechnung: Panning, Erzeuger, Szenen, Katalog
python server.py &                 # http://localhost:8790
node test/browser.mjs              # 8-Kanal-Routing (OfflineAudioContext) + Oberfläche
```

Wer an der Oberfläche war, prüft sie auch im Browser — breit (1400) und
schmal (390); `test/browser.mjs` tut beides.

## Regeln

- `js/raum.js` und `js/synth.js` bleiben ohne Web Audio und ohne DOM: sie
  laufen unter Node in den Prüfungen.
- `klaenge/`, `klaenge/katalog.json` und `QUELLEN.md` erzeugt
  `werkzeug/klaenge-holen.py` aus `werkzeug/auswahl.json` — nie von Hand.
- Nur freie Lizenzen (CC0, gemeinfrei, CC BY, CC BY-SA). Urheber und
  Lizenz jeder Aufnahme stehen im Katalog und werden in der Seite gezeigt.
- Jede Szenen-Ebene mit Aufnahme bekommt möglichst einen erzeugten Ersatz
  (`klang: ['aufnahme', 'synth:…']`), damit die Szene auch ohne Download spielt.
- Kein DynamicsCompressor im Ausgang: der kann nur 2 Kanäle.
