# Klangbild in den Stores veröffentlichen

Alles, was du zum Hochladen brauchst:

| Datei | Wofür |
| --- | --- |
| `../web-ext-artifacts/klangbild-firefox-1.0.0.zip` | Upload bei Firefox Add-ons |
| `../web-ext-artifacts/klangbild-chrome-1.0.0.zip` | Upload im Chrome Web Store |
| `listing-en.md`, `listing-de.md` | Name, Kurzbeschreibung, Beschreibung, Kategorie |
| `review-answers.md` | Begründungen der Berechtigungen, Datenschutz-Angaben, Hinweise für die Prüfer |
| `privacy-policy.md` | Datenschutzerklärung (Englisch + Deutsch) |
| `images/screenshot-*.png` | 4 Screenshots, 1280×800 |
| `images/promo-small-440x280.png` | Kleine Werbekachel (Chrome, Pflicht) |
| `images/promo-marquee-1400x560.png` | Große Werbekachel (Chrome, optional) |
| `../src/icons/icon-128.png` | Store-Icon (Chrome) |

Die ZIPs neu erzeugen: `npm run package`. Die Bilder neu erzeugen (z. B. nach Änderungen am Panel): `npm install`, dann `npm run store-assets`.

## Vorher erledigen

1. **Kontakt:** In `privacy-policy.md` ist ennortix@gmail.com als öffentliche Kontaktadresse eingetragen.
2. **Datenschutzerklärung öffentlich machen.** Der Chrome Web Store verlangt eine öffentliche URL. Einfachste Wege:
   - als öffentliches GitHub-Gist (Inhalt von `privacy-policy.md` einfügen, „Create public gist“) oder
   - im GitHub-Repository des Projekts, über GitHub Pages.
3. **Version prüfen:** steht in `package.json` (aktuell `1.0.0`) und wird beim Build in beide Manifeste übernommen. Für jedes spätere Update muss sie erhöht werden.

## Firefox Add-ons (kostenlos)

1. Auf <https://addons.mozilla.org/developers/> mit einem Mozilla-Konto anmelden.
2. „Submit a New Add-on“ → **„On this site“** wählen.
3. `klangbild-firefox-1.0.0.zip` hochladen. Die automatische Prüfung sollte ohne Fehler und Warnungen durchlaufen.
4. Frage nach Quellcode: **„No“** (siehe `review-answers.md`).
5. Eintrag ausfüllen mit `listing-en.md`; Kategorie „Photos, Music & Videos“; Lizenz wählen; Datenschutz-URL eintragen.
6. Unter „Notes for Reviewers“ den Text aus `review-answers.md` einfügen.
7. Screenshots hochladen (Bildunterschriften stehen in `listing-en.md`). Optional Deutsch als weitere Sprache mit `listing-de.md`.
8. Absenden. Die Prüfung dauert meist wenige Stunden bis einige Tage.

## Chrome Web Store (einmalig 5 US-$ Registrierung)

1. Auf <https://chrome.google.com/webstore/devconsole> anmelden und das Entwicklerkonto registrieren (einmalige Gebühr, E-Mail-Bestätigung).
2. „Neues Element“ → `klangbild-chrome-1.0.0.zip` hochladen.
3. **Store-Eintrag:** Beschreibung aus `listing-en.md`, Kategorie, Sprache; Icon `icon-128.png`, Screenshots und die kleine Werbekachel hochladen. Optional Deutsch als weitere Sprache hinzufügen.
4. **Datenschutz:** Zweck, Berechtigungs-Begründungen, „kein Remote-Code“ und die Datennutzung exakt wie in `review-answers.md`; Datenschutz-URL eintragen.
5. **Vertrieb:** „Öffentlich“, alle Regionen.
6. „Zur Überprüfung einreichen“. Wegen des Zugriffs auf alle Websites kann die Prüfung einige Tage dauern – die ausführliche Begründung in `review-answers.md` hilft dabei.

## Gut zu wissen

- Edge, Opera und Brave können Erweiterungen aus dem Chrome Web Store installieren. Für den eigenen Edge-Add-on-Store (kostenlos) funktioniert dieselbe Chrome-ZIP.
- Die Screenshots zeigen das echte Panel mit Beispielwerten und eine gezeichnete Beispielszene – keine fremden Inhalte, daher keine Rechteprobleme.
