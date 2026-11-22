// Die Klangkulisse im echten Browser:  node test/browser.mjs [bilder-ordner]
// Braucht den Server (python server.py) und Playwright mit Chromium.
//
// 1. Das Routing: der Motor spielt in einen OfflineAudioContext mit
//    8 Kanälen. Was links steht, muss aus dem linken Lautsprecher kommen.
// 2. Die Oberfläche: starten, Szene wählen, Geräusch, Dialoge — ohne Fehler
//    in der Konsole, breit und schmal.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.env.KK_URL || 'http://localhost:8790/';
const bilder = process.argv[2] || null;
let gut = 0;
const fehler = [];
const pruefe = (b, was) => (b ? gut++ : fehler.push(was));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// ── 1. Routing ──
{
  const seite = await browser.newPage();
  const konsole = [];
  seite.on('pageerror', (e) => konsole.push(e.message));
  await seite.goto(URL);
  const ergebnis = await seite.evaluate(async () => {
    const { Motor } = await import('./js/motor.js');
    const messen = async (ebene, einst = {}) => {
      const sr = 48000;
      const ctx = new OfflineAudioContext(8, sr * 2, sr);
      const m = new Motor({ kontext: ctx });
      await m.starten({ aufstellung: '7.1', folge: 'standard', center: 1, lfe: 1, pegel: 1, ...einst });
      await m.szeneSpielen({ id: 't', name: 't', ebenen: [{ art: 'bett', pegel: 1, hall: 0, lfe: 0, breite: 0, spreizung: 0, ...ebene }] }, { ueberblenden: 0 });
      const b = await ctx.startRendering();
      const rms = [];
      for (let c = 0; c < 8; c++) {
        const d = b.getChannelData(c);
        let s = 0;
        for (let i = sr / 2; i < d.length; i++) s += d[i] * d[i];
        rms.push(Math.sqrt(s / (d.length - sr / 2)));
      }
      return rms;
    };
    return {
      links: await messen({ klang: 'synth:regen', ort: { winkel: -90, abstand: 1 } }),
      mitte: await messen({ klang: 'synth:regen', ort: { winkel: 0, abstand: 1 } }),
      hintenRechts: await messen({ klang: 'synth:regen', ort: { winkel: 150, abstand: 1 } }),
      sub: await messen({ klang: 'synth:trommeln', ort: { winkel: 0, abstand: 1 }, lfe: 1 }),
      rundum: await messen({ klang: 'synth:regen', ort: 'rundum' }),
      alsa: await messen({ klang: 'synth:regen', ort: { winkel: 0, abstand: 1 } }, { folge: 'alsa' }),
    };
  });
  // Windows-Folge: 0 FL, 1 FR, 2 FC, 3 LFE, 4 BL, 5 BR, 6 SL, 7 SR
  const groesster = (r, ohne = []) => r.map((v, i) => [v, i]).filter(([, i]) => !ohne.includes(i)).sort((a, b) => b[0] - a[0])[0][1];
  const zeig = (r) => r.map((v) => v.toFixed(3)).join(' ');
  pruefe(groesster(ergebnis.links) === 6, 'links (−90°) kommt aus Kanal 7 = SL: ' + zeig(ergebnis.links));
  pruefe(ergebnis.links[6] > 20 * Math.max(ergebnis.links[1], ergebnis.links[5], ergebnis.links[7]), 'links: rechts bleibt still: ' + zeig(ergebnis.links));
  pruefe(groesster(ergebnis.mitte) === 2, 'vorn (0°) kommt aus Kanal 3 = Center: ' + zeig(ergebnis.mitte));
  pruefe(groesster(ergebnis.hintenRechts) === 5, 'hinten rechts (150°) kommt aus Kanal 6 = BR: ' + zeig(ergebnis.hintenRechts));
  pruefe(ergebnis.sub[3] > 0.01, 'Trommeln mit LFE: der Subwoofer (Kanal 4) spielt: ' + zeig(ergebnis.sub));
  pruefe(ergebnis.mitte[3] < 1e-4, 'ohne LFE-Anteil bleibt der Subwoofer still: ' + zeig(ergebnis.mitte));
  // Rundum spielen die sechs um den Hörer; der Center bleibt bei Breite 0 frei für Stimmen.
  const ru = ergebnis.rundum.filter((_, i) => i !== 2 && i !== 3);
  pruefe(Math.min(...ru) > 0.25 * Math.max(...ru), 'rundum: alle sechs Lautsprecher ringsum spielen: ' + zeig(ergebnis.rundum));
  pruefe(groesster(ergebnis.alsa) === 4, 'ALSA-Folge: Center liegt auf Kanal 5: ' + zeig(ergebnis.alsa));
  pruefe(konsole.length === 0, 'Routing: keine Seitenfehler: ' + konsole.join(' | '));
  await seite.close();
}

// ── 2. Oberfläche ──
for (const [breite, hoehe, name] of [[1400, 900, 'breit'], [390, 844, 'schmal']]) {
  const seite = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  const konsole = [];
  seite.on('pageerror', (e) => konsole.push('Seite: ' + e.message));
  seite.on('console', (m) => m.type() === 'error' && konsole.push('Konsole: ' + m.text()));
  await seite.goto(URL);
  await seite.waitForSelector('.szene');
  const szenen = await seite.locator('.szene').count();
  pruefe(szenen >= 15, `${name}: Szenenliste zeigt ${szenen} Szenen`);
  await seite.getByRole('button', { name: '▶ Klang einschalten' }).click();
  await seite.waitForSelector('.chip.mittel, .chip.gut');
  await seite.locator('.szene', { hasText: 'Lagerfeuer bei Nacht' }).click();
  await seite.waitForSelector('.ebene');
  await seite.waitForFunction(() => !document.querySelector('.titel p') || document.querySelector('.titel p').textContent !== 'lädt …', null, { timeout: 30000 });
  pruefe(await seite.locator('.ebene').count() === 6, `${name}: Lagerfeuer hat sechs Ebenen`);
  pruefe(await seite.locator('#raum .griff').count() >= 1, `${name}: der Raum zeigt einen Griff für das Feuer`);
  // Ebene aufklappen, stumm schalten
  await seite.locator('.auf-knopf').first().click();
  pruefe(await seite.locator('.ebene-details').count() === 1, `${name}: Ebene klappt auf`);
  await seite.locator('.stumm-knopf').nth(1).click();
  pruefe(await seite.locator('.ebene.stumm').count() >= 1, `${name}: Ebene lässt sich stumm schalten`);
  // Ein Geräusch aus der Leiste
  await seite.locator('.richtung').nth(2).click();
  await seite.locator('.geraeusch:not([disabled])').first().click();
  await seite.waitForTimeout(300);
  // Griff ziehen
  const griff = seite.locator('#raum .griff').first();
  const kasten = await griff.boundingBox();
  if (kasten) {
    await seite.mouse.move(kasten.x + kasten.width / 2, kasten.y + kasten.height / 2);
    await seite.mouse.down();
    await seite.mouse.move(kasten.x + 60, kasten.y + 40, { steps: 5 });
    await seite.mouse.up();
  }
  pruefe(await seite.locator('.buehne-kopf .knopf.gold').count() === 1, `${name}: nach dem Ziehen gibt es „Als eigene speichern“`);
  if (bilder) await seite.screenshot({ path: `${bilder}/szene-${name}.png`, fullPage: name === 'schmal' });
  // Ebene hinzufügen
  await seite.getByRole('button', { name: '+ Ebene hinzufügen' }).click();
  await seite.fill('.suche', 'Brandung');
  pruefe(await seite.locator('.klang-eintrag').count() >= 1, `${name}: die Suche findet Brandung`);
  await seite.locator('.klang-eintrag .knopf.gold').first().click();
  await seite.waitForTimeout(500);
  pruefe(await seite.locator('.ebene').count() === 7, `${name}: eine Ebene mehr`);
  // Speichern als eigene Szene
  await seite.locator('.buehne-kopf .knopf.gold').click();
  pruefe(await seite.locator('.szene', { hasText: '(eigen)' }).count() === 1, `${name}: die eigene Szene steht in der Liste`);
  // Ausgang
  await seite.getByRole('button', { name: '⚙ Ausgang' }).click();
  await seite.waitForSelector('.test-knopf');
  await seite.locator('.test-knopf').first().click();
  pruefe(await seite.locator('.test-knopf.spielt').count() === 1, `${name}: Lautsprechertest leuchtet`);
  if (bilder) await seite.screenshot({ path: `${bilder}/ausgang-${name}.png` });
  await seite.keyboard.press('Escape');
  pruefe(await seite.locator('#dialog.offen').count() === 0, `${name}: Escape schließt`);
  // Quellen und eigene Klänge öffnen sich
  await seite.getByRole('button', { name: '📁 Eigene Klänge' }).click();
  pruefe(await seite.locator('.ablage').count() === 1, `${name}: Eigene Klänge öffnet`);
  await seite.keyboard.press('Escape');
  await seite.getByText('Quellen & Lizenzen der Aufnahmen').click();
  pruefe(await seite.locator('.fenster h2', { hasText: 'Quellen' }).count() === 1, `${name}: Quellen öffnet`);
  await seite.keyboard.press('Escape');
  // Andere Szene, dann Stille
  await seite.locator('.szene', { hasText: 'Gewitter' }).click();
  await seite.waitForTimeout(800);
  await seite.getByRole('button', { name: '⏹ Stille' }).click();
  pruefe(await seite.locator('.leer').count() === 1, `${name}: Stille leert die Bühne`);
  // Keine Waagerechte zum Scrollen
  const zuBreit = await seite.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  pruefe(!zuBreit, `${name}: nichts ragt seitlich heraus`);
  pruefe(konsole.length === 0, `${name}: keine Fehler: ` + konsole.join(' | '));
  await seite.close();
}

await browser.close();
if (fehler.length) {
  console.log(fehler.map((f) => '  ✗ ' + f).join('\n'));
  console.log(`\n${fehler.length} Fehler, ${gut} gut.`);
  process.exit(1);
}
console.log(`✓ ${gut} Browserprüfungen gut.`);
