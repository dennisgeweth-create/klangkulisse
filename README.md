# Klangkulisse

Raumklang für den Spieltisch: Szenen für Taverne, Lagerfeuer, Gewitter, Höhle, Schlacht und mehr, in **7.1**, 5.1 oder Stereo, direkt aus dem Browser. Gedacht für Pen-&-Paper-Runden (D&D und Verwandte), ähnlich wie Syrinscape, aber ohne Konto und ohne Installation.

- **Szenen** bestehen aus Ebenen: Schleifen (Regen, Wind, Gaststube), Musik und Zufallsereignisse (ein Kauz hinter euch, Donner von irgendwo, Krähen über dem Friedhof). Beim Szenenwechsel wird weich übergeblendet.
- **Echter Raum:** Jede Quelle hat einen Ort. Im Raumbild lassen sich Punkte ziehen, und der Klang wandert mit. Ereignisse tauchen in ihrem Sektor auf (vorn, hinten, ringsum), Reiter und Möwen ziehen vorbei.
- **Subwoofer** (LFE) bekommt nur, was durch 120 Hz passt. Donner, Trommeln, Drachenbrüllen und Erdgrollen schicken ihm ihren Anteil.
- **Geräuschleiste:** Donnerschlag, Tür, Wolf, Explosion und mehr auf Klick, aus der Richtung, die ihr am Kompass wählt.
- **Erzeugte Klänge:** Regen, Wind, Feuer, Bach, Brandung, Grillen, Donner, Herzschlag, Kriegstrommeln, Klangflächen und Zauber rechnet die Seite selbst. Sie sind lizenzfrei, endlos und ohne Download. Jede Szene spielt damit auch dann, wenn keine einzige Aufnahme da ist.
- **Aufnahmen** von Wikimedia Commons, ersatzweise von OpenGameArt (CC0, gemeinfrei, CC BY, CC BY-SA), zurechtgeschnitten und zu nahtlosen Schleifen geblendet. Siehe [QUELLEN.md](QUELLEN.md).
- **Eigene Klänge** per Drag & Drop. Sie bleiben im Browser (IndexedDB).
- **Eigene Szenen** speichern, als JSON sichern und auf einem anderen Rechner laden.

## Starten

```bash
python server.py
```

dann **http://localhost:8790** öffnen. Ein Server ist nötig, weil die Seite ES-Module und Klangdateien lädt; von `file://` aus verweigert der Browser beides. Es braucht kein npm und keinen Bauschritt.

Die Seite lässt sich genauso auf jeden Webspace oder GitHub Pages legen: Es sind nur statische Dateien.

## 7.1 aus dem Browser

1. Den Rechner per **HDMI** an den AV-Receiver anschließen (oder eine Soundkarte mit 7.1-Analogausgängen nehmen). Optisch/S/PDIF trägt kein 7.1-PCM.
2. **Windows:** Systemsteuerung → Sound → Wiedergabegerät → *Konfigurieren* → **7.1-Surround**.
   **macOS:** Audio-MIDI-Setup → Gerät → *Lautsprecher konfigurieren*.
3. **Chrome, Edge oder Firefox** nehmen und die Seite neu laden. Oben steht dann „7.1 · 8 Kanäle“.
4. Unter **⚙ Ausgang → Lautsprechertest** jeden Lautsprecher einzeln anspielen. Kommt das Rauschen aus dem falschen, die *Kanalfolge* wechseln.

Der Receiver bekommt 8 Kanäle PCM und spielt sie so, wie sie kommen. Eine Dolby-Kodierung ist dafür nicht nötig: Dolby Digital trägt ohnehin höchstens 5.1, und ein Browser kann es nicht erzeugen. Den Upmixer des Receivers (Dolby Surround, DTS Neural:X) für diese Quelle ausschalten, sonst mischt er die fertige Mischung noch einmal um.

Meldet das Gerät nur 2 Kanäle, spielt die Klangkulisse in Stereo: Hinten wird zu links und rechts, die Bewegungen bleiben hörbar.

## Wie es klingt, wo es klingt

```
Quelle ─┬─ Kanal L ─ Tiefpass (Abstand) ─ Pegel ─┬─ Gewicht je Lautsprecher (VBAP) ─┐
        └─ Kanal R ─ …                           ├─ LFE-Anteil ────────────────────┤
                                                 └─ Hallanteil ────────────────────┤
Szenenbus (zum Überblenden) ◄─────────────────────────────────────────────────────┘
  ─► Lautsprecherbus ─► ChannelMerger(8) ─► Gesamtpegel ─► weicher Begrenzer ─► Ausgang
```

- **Panning:** paarweise Amplitudenverteilung zwischen den Nachbarlautsprechern (2D-VBAP), leistungserhaltend. Aufstellung nach ITU-R BS.775: vorn ±30°, Center 0°, Seite ±90°, hinten ±150°.
- **Rundum-Schleifen** laufen in zwei versetzten Kopien, jede mit ihren Kanälen an eigenem Ort. So kommt aus jedem Lautsprecher etwas anderes, statt einer Phantomquelle in der Mitte.
- **Abstand:** Jenseits des Lautsprecherkreises wird es leiser und dumpfer. Nah am Hörer verliert eine Quelle ihre Richtung und kommt von überall.
- **Hall:** ein Faltungshall mit erzeugter Impulsantwort je Szene (Höhle lang, Gaststube kurz). Links geht an FL/SL/BL, rechts an FR/SR/BR.
- **Kanalfolge:** Der Browser reicht die Kanäle unverändert an das Betriebssystem weiter. Unter Windows (und über HDMI) gilt FL FR C LFE BL BR SL SR, für Linux/ALSA und Geräte, die Seite vor Hinten erwarten, gibt es eigene Folgen.

## Dateien

| Datei | Rolle |
|---|---|
| `index.html`, `stil.css` | die Seite |
| `js/raum.js` | Lautsprecheraufstellungen, Kanalfolgen, Panning-Rechnung. Reine Rechnung, läuft auch unter Node |
| `js/synth.js` | die erzeugten Klänge. Reine Rechnung, gesät (gleicher Startwert, gleicher Klang) |
| `js/motor.js` | Web-Audio-Graph: Ausgang, Szenen, Ebenen, Ereignisse, Bewegung, Test |
| `js/szenen.js` | die mitgelieferten Szenen und die Geräuschleiste |
| `js/speicher.js` | Einstellungen und Szenen (localStorage), eigene Klänge (IndexedDB) |
| `js/app.js` | die Oberfläche, ohne Framework |
| `klaenge/` | die geschnittenen Aufnahmen (Opus) und `katalog.json`. Erzeugt, nicht von Hand ändern |
| `werkzeug/auswahl.json` | **welche** Aufnahmen von Commons (und welcher Ersatz von OpenGameArt), wie sie heißen und wie sie geschnitten werden |
| `werkzeug/klaenge-holen.py` | holt, schneidet, pegelt und kodiert; schreibt Katalog und `QUELLEN.md` |
| `werkzeug/commons-suche.py` | sucht auf Commons nach Audiodateien und zeigt Lizenz, Länge und Größe |
| `test/pruefen.mjs` | die Rechnung ohne Browser (`node test/pruefen.mjs`) |
| `test/browser.mjs` | Routing in einem 8-Kanal-OfflineAudioContext und die Oberfläche in Chromium |

## Aufnahmen holen

```bash
python3 werkzeug/klaenge-holen.py            # alle aus der Auswahl
python3 werkzeug/klaenge-holen.py wolf kauz  # nur diese
```

Das braucht ffmpeg (mit libopus) und numpy, für die .7z-Pakete von OpenGameArt auch 7-Zip. Ohne lokale Werkzeuge geht es auch über GitHub: **Actions → Klänge holen → Run workflow**. Die Action holt, schneidet, prüft und committet `klaenge/`.

Was mit einer Aufnahme geschieht, sagt ihre `art` in der Auswahl:

- `bett`: das ruhigste Stück von `max` Sekunden (wenige Ausreißer wie Griffgeräusche), Ende in den Anfang geblendet, Lautheit angeglichen
- `einzel`: Stille vorn und hinten weg; mit `teilen: n` in die n lautesten Einzelgeräusche zerlegt
- `musik`: von vorn, aus- und eingeblendet

Erste Wahl ist Wikimedia Commons (`titel`). Die meisten Einträge haben zusätzlich einen Ersatz von [OpenGameArt](https://opengameart.org) (`oga`: Seite, Datei, bei Paketen ein Muster für die Datei darin). Der springt ein, wenn Commons drosselt, die Datei fehlt oder die Lizenz nicht passt. Urheber und Lizenz liest das Werkzeug von der OpenGameArt-Seite; von mehreren Lizenzen nimmt es die freieste, OGA-BY und GPL nie. Ein späterer Lauf, bei dem Commons antwortet, ersetzt den Ersatz durch die Commons-Aufnahme. `KK_OHNE_COMMONS=1` nimmt gleich den Ersatz.

Wikimedia drosselt Rechenzentrums-Adressen (Cloud, GitHub Actions) oft hart (HTTP 429). Das Werkzeug hält sich an `Retry-After`, bricht nach einigen Absagen ab und behält, was es hat. Ein späterer Lauf macht dort weiter, schon geschnittene Klänge bleiben unangetastet. Bleibt die Action hängen, geht es am schnellsten vom eigenen Rechner aus, denn eine Heimadresse wird kaum gedrosselt. Unter Windows:

```powershell
winget install Python.Python.3.12 Gyan.FFmpeg   # einmalig, danach neues Terminal
py -m pip install numpy
$env:KK_KONTAKT = "deine@adresse.de"             # empfohlen: Wikimedia will einen Kontakt im User-Agent
py werkzeug\klaenge-holen.py
git add klaenge QUELLEN.md; git commit -m "Klänge geholt"; git push
```

Neue Klänge finden:

```bash
python3 werkzeug/commons-suche.py "wolf howl" "tavern" "sword"
```

## Prüfen

```bash
node test/pruefen.mjs          # rund 3500 Prüfungen der Rechnung
python server.py &             # dann:
node test/browser.mjs          # Routing (8 Kanäle) und Oberfläche, breit und schmal
```

## Lizenz

Der Code steht unter MIT (`LICENSE`). Die Aufnahmen in `klaenge/` behalten ihre eigenen Lizenzen (CC0, gemeinfrei, CC BY, CC BY-SA). Wer, was und wo steht in [QUELLEN.md](QUELLEN.md) und in der Seite unter *Quellen & Lizenzen*. Bearbeitete Fassungen von CC-BY-SA-Aufnahmen stehen unter CC BY-SA.
