# Klangbild in den Stores veröffentlichen

Alles, was du zum Hochladen brauchst:

| Datei | Wofür |
| --- | --- |
| `../web-ext-artifacts/klangbild-firefox-1.2.0.zip` | Upload bei Firefox Add-ons |
| `../web-ext-artifacts/klangbild-chrome-1.2.0.zip` | Upload im Chrome Web Store |
| `chrome/` | Texte für den Chrome Web Store, eine Datei pro Feld und Sprache |
| `firefox/` | Texte für Firefox Add-ons, eine Datei pro Feld und Sprache |
| `review-answers.md` | Begründungen der Berechtigungen, Datenschutz-Angaben, Hinweise für die Prüfer |
| `privacy-policy.md` | Datenschutzerklärung (Englisch + Deutsch) |
| `images/screenshot-*.png` | 4 Screenshots, 1280×800 |
| `images/promo-small-440x280.png` | Kleine Werbekachel (Chrome, Pflicht) |
| `images/promo-marquee-1400x560.png` | Große Werbekachel (Chrome, optional) |
| `../src/icons/icon-128.png` | Store-Icon (Chrome) |

## Texte zum Kopieren

Jede `.txt`-Datei ist genau ein Feld: öffnen, Strg+A, Strg+C, einfügen. Reiner Text, beide Stores zeigen kein Markdown an.

**Name** (beide Stores, alle Sprachen): `Klangbild – Live Audio & Video Editing`

| Feld | Chrome Web Store | Firefox Add-ons |
| --- | --- | --- |
| Kurzbeschreibung EN | kommt aus dem Manifest, kein Feld | `firefox/summary-en.txt` (max. 250 Zeichen) |
| Kurzbeschreibung DE | `chrome/summary-de.txt` (max. 132 Zeichen) | `firefox/summary-de.txt` |
| Beschreibung EN | `chrome/description-en.txt` | `firefox/description-en.txt` |
| Beschreibung DE | `chrome/description-de.txt` | `firefox/description-de.txt` |
| Tags | – (Chrome hat keine, **nie** in die Beschreibung!) | `firefox/tags.txt`, ein Tag pro Zeile |
| Bildunterschriften | – | `firefox/captions-en.txt` / `-de.txt`, Zeile 1–4 = Screenshot 1–4 |
| Kategorie | Productivity → Tools (alternativ Lifestyle → Entertainment) | Photos, Music & Videos |

Die Chrome-Beschreibungen nennen keine fremden Marken (YouTube, Netflix, …): Chrome hat die erste Fassung wegen einer Keyword-Liste abgelehnt („Keyword-Spam“, Yellow Argon), Markennamen in Aufzählungen werden dort ähnlich streng gesehen. Bei Firefox ist das kein Problem.

Die ZIPs neu erzeugen: `npm run package`. Die Bilder neu erzeugen (z. B. nach Änderungen am Panel): `npm install`, dann `npm run store-assets`.

## Vorher erledigen

1. **Kontakt:** In `privacy-policy.md` ist ennortix@gmail.com als öffentliche Kontaktadresse eingetragen.
2. **Datenschutzerklärung öffentlich machen.** Der Chrome Web Store verlangt eine öffentliche URL. Einfachste Wege:
   - als öffentliches GitHub-Gist (Inhalt von `privacy-policy.md` einfügen, „Create public gist“) oder
   - im GitHub-Repository des Projekts, über GitHub Pages.
3. **Version prüfen:** steht in `package.json` (aktuell `1.2.0`) und wird beim Build in beide Manifeste übernommen. Für jedes spätere Update muss sie erhöht werden.
4. **Datenschutzerklärung aktualisiert (Stand 2. November 2026):** „Weiterschauen“ speichert Wiedergabepositionen lokal. `docs/privacy.html` muss deshalb vor dem Einreichen von 1.2.0 veröffentlicht sein (committen und pushen, GitHub Pages aktualisiert sich dann selbst).

## Update auf 1.2.0 (Eintrag existiert schon)

**Firefox:** <https://addons.mozilla.org/developers/> → Klangbild → „Upload New Version“ → `klangbild-firefox-1.2.0.zip`. Quellcode-Frage: „No“. Versionshinweise siehe unten. Danach unter „Edit Product Page“ Kurzbeschreibung und Beschreibung aus `firefox/` ersetzen (EN und DE), „Notes for Reviewers“ aus `review-answers.md`.

**Chrome:** Developer Dashboard → Klangbild → „Paket“ → „Neues Paket hochladen“ → `klangbild-chrome-1.2.0.zip`. Im „Store-Eintrag“ die Beschreibung aus `chrome/` ersetzen (EN und DE), unter „Datenschutz“ die `storage`-Begründung aus `review-answers.md` aktualisieren. Dann „Zur Überprüfung einreichen“.

**Versionshinweise 1.2.0** (Firefox-Feld „Release notes“):

> New: skip silence, continue watching, rules for addresses, ambilight, voice ↔ background, loudness leveling, reverb, stereo width, color vision correction, sleep timer, options page with backup, the Firefox sidebar with timeline, extended limits and a mixer for all tabs, and sliders with three rings (steps of 1, 5 or 10, or turn them like a knob). Plus many fixes.

> Neu: Pausen überspringen, Weiterschauen, Regeln für Adressen, Ambilight, Stimme ↔ Hintergrund, Lautstärke angleichen, Hall, Stereobreite, Farbsehschwäche-Korrektur, Sleep-Timer, Optionsseite mit Sicherung, die Firefox-Seitenleiste mit Zeitleiste, erweiterten Grenzen und einem Mischpult für alle Tabs sowie Regler mit drei Ringen (Schritte von 1, 5 oder 10, oder wie ein Drehknopf drehen). Dazu viele Korrekturen.

**Screenshots:** `images/` zeigt noch das Panel von 1.0.0. Für neue: `npm run store-assets`.

## Firefox Add-ons (kostenlos)

1. Auf <https://addons.mozilla.org/developers/> mit einem Mozilla-Konto anmelden.
2. „Submit a New Add-on“ → **„On this site“** wählen.
3. `klangbild-firefox-1.2.0.zip` hochladen. Die automatische Prüfung sollte ohne Fehler und Warnungen durchlaufen.
4. Frage nach Quellcode: **„No“** (siehe `review-answers.md`).
5. Eintrag ausfüllen mit den Dateien aus `firefox/` (siehe Tabelle oben); Lizenz wählen; Datenschutz-URL eintragen.
6. Unter „Notes for Reviewers“ den Text aus `review-answers.md` einfügen.
7. Screenshots hochladen, Bildunterschriften aus `firefox/captions-en.txt`. Optional Deutsch als weitere Sprache mit den `-de.txt`-Dateien.
8. Absenden. Die Prüfung dauert meist wenige Stunden bis einige Tage.

## Chrome Web Store (einmalig 5 US-$ Registrierung)

1. Auf <https://chrome.google.com/webstore/devconsole> anmelden und das Entwicklerkonto registrieren (einmalige Gebühr, E-Mail-Bestätigung).
2. „Neues Element“ → `klangbild-chrome-1.2.0.zip` hochladen.
3. **Store-Eintrag:** Beschreibung aus `chrome/description-en.txt`, Kategorie, Sprache; Icon `icon-128.png`, Screenshots und die kleine Werbekachel hochladen. Optional Deutsch als weitere Sprache hinzufügen (`chrome/summary-de.txt`, `chrome/description-de.txt`).
4. **Datenschutz:** Zweck, Berechtigungs-Begründungen, „kein Remote-Code“ und die Datennutzung exakt wie in `review-answers.md`; Datenschutz-URL eintragen.
5. **Vertrieb:** „Öffentlich“, alle Regionen.
6. „Zur Überprüfung einreichen“. Wegen des Zugriffs auf alle Websites kann die Prüfung einige Tage dauern – die ausführliche Begründung in `review-answers.md` hilft dabei.

## Gut zu wissen

- Edge, Opera und Brave können Erweiterungen aus dem Chrome Web Store installieren. Für den eigenen Edge-Add-on-Store (kostenlos) funktioniert dieselbe Chrome-ZIP.
- Die Screenshots zeigen das echte Panel mit Beispielwerten und eine gezeichnete Beispielszene – keine fremden Inhalte, daher keine Rechteprobleme.
