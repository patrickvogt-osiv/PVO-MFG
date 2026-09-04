# pickaride

Persönliche Buchungsplattform für deine Standard-Autofahrtstrecken (z.B. Basel–München
inkl. Zwischenstopps). Nur Personen, denen du einen Einladungslink schickst, können
Plätze buchen — für die ganze Strecke oder für eine Teilstrecke.

Läuft als **installierbare Web-App (PWA)** im Browser, auf dem Smartphone wie eine
normale App nutzbar (Icon auf dem Homescreen), ohne App Store.

## Wie es funktioniert

- **Admin-Bereich** (`/admin`, nur für dich, mit E-Mail/Passwort-Login):
  Strecken inkl. Zwischenstopps anlegen, Fahrten veröffentlichen (Datum, Startzeit,
  Plätze), Autos und Fahrer verwalten, Mitfahrer einladen, alle Buchungen einsehen
  (inkl. Angabe, welcher Fahrer welche Fahrt fährt).
- **Fahrer-Bereich** (`/driver/DEIN-TOKEN`): eigener Einladungslink für Fahrer.
  Ein Fahrer sieht und veröffentlicht darüber nur seine eigenen Fahrten (Strecke,
  Auto, Datum/Zeit, Plätze) und sieht, wer bei seinen Fahrten mitfährt. Fahrer
  legst du im Admin-Bereich im Tab „Fahrer" an, genau wie Mitfahrer.
  **Bist du selbst auch Fahrer?** Leg dich dort einfach zusätzlich als Fahrer an
  und nutze parallel deinen eigenen Fahrer-Link, oder veröffentliche deine
  Fahrten direkt im Admin-Bereich und wähle dich selbst als Fahrer aus — beides
  funktioniert.
- **Einladungslink für Mitfahrer** (`/invite/DEIN-TOKEN`): Diesen Link schickst du
  per WhatsApp, Threema oder Signal an eine Person. Über den Link sieht sie offene
  Fahrten und kann einen Abschnitt buchen (Start- und Zielort frei wählbar, inkl.
  Kapazitätsprüfung pro Teilstrecke).
- Kein Passwort für Mitfahrer oder Fahrer nötig — der jeweilige Link selbst ist
  das Ticket. Du kannst den Zugang jederzeit im Admin-Bereich widerrufen.
- **Selbstanmeldung ohne Einladungslink**: Wer die App ohne Token öffnet (z.B.
  über die reine Basis-URL), sieht zwei Buttons ("Anmeldung als Mitfahrer/-in"
  / "Anmeldung als Fahrer/-in") und kann sich mit Vorname, Name, Mobilnummer
  und E-Mail anmelden. Die Anfrage wird sofort (aber gesperrt) angelegt; die
  Person bekommt danach einen Button, der eine vorausgefüllte E-Mail an
  `VITE_ADMIN_EMAIL` öffnet — mit dem fertigen, aber noch inaktiven
  Einladungslink. Du schaltest den Zugang wie gewohnt über "Zugang
  wiederherstellen" im jeweiligen Tab frei.
- **Alle Beträge sind in EUR.** Jeder Fahrer kann in seinem eigenen Bereich
  ("⚙️ Meine Einstellungen") zusätzlich hinterlegen:
  - einen Zahlungshinweis/-link (z.B. PayPal.me-Link oder Freitext wie "Twint
    an 079 123 45 67") — wird Mitfahrern beim Buchen angezeigt
  - eine persönliche Referenzwährung (ISO 4217, z.B. CHF)
  - eine Rate in EUR pro 100 km, mit Live-Umrechnung in die Referenzwährung
  Im Admin-Bereich (Tab „Strecken") kannst du beim Bearbeiten einer Strecke
  eine "Vergleichswährung (Fahrer)" auswählen — dann werden Gesamtbetrag,
  Mitfahrbeitrag und der aus Distanz berechnete EUR/100km-Wert jeweils mit
  dem umgerechneten Wert in Klammern angezeigt.
- **Fahrten schließen/öffnen**: Ein Fahrer kann eine veröffentlichte Fahrt
  "schließen" (z.B. wenn er über die App keine weiteren Buchungen mehr
  annehmen möchte). Mitfahrer sehen die Fahrt weiterhin, können aber nicht
  mehr darüber buchen; sind noch Plätze frei, wird stattdessen der Hinweis
  angezeigt, dass Restplätze über andere Plattformen gebucht werden können.
- **Fahrer können eigene Strecken anlegen**: Über "🗺️ Meine Strecken" im
  eigenen Bereich kann ein Fahrer komplett eigenständig neue Strecken mit
  Start/Ziel/Zwischenstopps, Adressen, Mitfahrbeiträgen und
  Entfernungsberechnung anlegen und verwalten — unabhängig vom Admin. Beim
  Veröffentlichen einer Fahrt stehen weiterhin **alle** Strecken zur Wahl
  (auch vom Admin oder anderen Fahrern angelegte), bearbeiten/löschen darf
  ein Fahrer aber nur seine eigenen.
- **Bewertungssystem**: Mitfahrer können jede eigene, bereits stattgefundene
  Fahrt für den Fahrer bewerten (1-5 Sterne je Kategorie): Fahrerlebnis,
  Pünktlichkeit am Startpunkt, Fahrweise, Sauberkeit, Kommunikation. Eine
  Bewertung pro Buchung, nachträglich änderbar. Der Durchschnitt wird
  angezeigt: Mitfahrern beim Ansehen einer Fahrt, dem Fahrer selbst in seinen
  Einstellungen, und dem Admin im Tab „Fahrer". Umgekehrt können Fahrer ihre
  Mitfahrer nach der Fahrt ebenfalls bewerten (1-5 Sterne): Pünktlichkeit am
  Startpunkt, Sauberkeit, Kommunikation — sichtbar für den Fahrer selbst
  (beim Bewerten), den Mitfahrer (eigene Einstellungen) und den Admin (Tab
  „Mitfahrer").
- **Buy Me a Coffee (vorbereitet, noch nicht aktiv verifiziert)**: Im Admin-
  Bereich, Tab „Einstellungen", hinterlegst du den **einen** Projekt-Link
  (z.B. `buymeacoffee.com/deinprojekt`) — diesen einen Link nutzen alle
  Fahrer und Mitfahrer zum Unterstützen, es gibt keinen Link pro Person.
  Bei jedem Fahrer (Tab „Fahrer") und Mitfahrer (Tab „Mitfahrer") kannst du
  zusätzlich einen Abo-Status ("☕ Buy-Me-a-Coffee-Abo aktiv") und ein
  letztes Zahldatum pflegen — aktuell noch von Hand, da es noch keine echte
  Zahlungsprüfung gibt. Im Kopfbereich der jeweiligen Person erscheint ein
  ☕-Icon: farbig bei aktivem Abo, durchgestrichen/ausgegraut sonst; ein Klick
  führt zum Projekt-Link. Eine spätere echte Verifizierung (z.B. über die
  Buy-Me-a-Coffee-Webhook-API) kann direkt auf `bmc_subscription_active` und
  `bmc_last_payment_date` aufsetzen.
- **Fahrer-Kontakt mit WhatsApp-Link**: Mitfahrer sehen jetzt bei den
  Fahrten-Suchergebnissen, der Fahrt-Detailansicht und "Meine Buchungen"
  zusätzlich Namen und Mobilnummer des Fahrers. Ist die Nummer im
  internationalen Format hinterlegt (z.B. `+41 79 123 45 67`), erscheint ein
  Link "💬 WhatsApp", der den Chat direkt öffnet (`wa.me`-Link). Ohne
  Ländervorwahl kann WhatsApp die Nummer nicht korrekt zuordnen — deshalb
  weisen die Eingabefelder für die Mobilnummer entsprechend darauf hin.
- **Fahrt-Veröffentlichung an aktives Abo geknüpft**: Ein Fahrer kann eine
  neue Fahrt nur veröffentlichen, wenn sein `bmc_subscription_active` aktiv
  ist UND das Fahrtdatum höchstens 40 Tage nach dem hinterlegten
  `bmc_last_payment_date` liegt. Das wird serverseitig in
  `fn_driver_create_trip` geprüft (nicht umgehbar) und dem Fahrer im
  "Fahrt veröffentlichen"-Formular vorab klar angezeigt (inkl. Datum, bis zu
  dem er veröffentlichen darf).
- **Flexible Datumssuche**: Findet eine Suche mit Datum+Flexibilität eine
  Fahrt an einem abweichenden Tag, erscheint ein Hinweis wie "Diese Fahrt
  findet 2 Tage später statt als gesucht."

## Setup (einmalig, ca. 15 Minuten)

### 1. Supabase-Projekt anlegen (kostenlos)

1. Auf [supabase.com](https://supabase.com) ein kostenloses Konto/Projekt anlegen.
2. Im Dashboard: **SQL Editor** → neue Query → Inhalt von `supabase/schema.sql`
   einfügen → **Run**. Das erstellt alle Tabellen, Sicherheitsregeln und Funktionen.

   **Hattest du schon eine ältere Version dieses Projekts eingerichtet** (schema.sql
   bereits einmal ausgeführt)? Dann `schema.sql` NICHT erneut ausführen (sonst
   Fehler wegen bereits existierender Tabellen). Führe stattdessen der Reihe nach
   im SQL-Editor aus, was du noch nicht hattest:
   - `supabase/migration_2_autos_und_beitrag.sql` (Autos, Mitfahrbeitrag)
   - `supabase/migration_3_adressen_und_gesamtbetrag.sql` (Adressen, Gesamtbetrag)
   - `supabase/migration_4_auto_notiz.sql` (Auto-Notiz auch für Mitfahrer sichtbar)
   - `supabase/migration_5_fahrer.sql` (Fahrer als eigene Rolle mit Einladungslink)
   - `supabase/migration_6_auto_fahrer_zuordnung.sql` (Autos gehören einem Fahrer)
   - `supabase/migration_7_entfernungen.sql` (Entfernung/Fahrzeit zwischen Streckenpunkten)
   - `supabase/migration_8_land.sql` (Land als Adressfeld)
   - `supabase/migration_9_via_zwischenstopps.sql` (Zwischenstopps in der Fahrtenübersicht)
   - `supabase/migration_10_segment_distanz.sql` (Distanz & Ankunftszeit pro Verbindung für Mitfahrer)
   - `supabase/migration_11_buchungen_distanz.sql` (Distanz & Ankunftszeit auch bei Meine Buchungen)
   - `supabase/migration_12_fahrtensuche.sql` (Fahrtensuche nach Ort/Land für Mitfahrer)
   - `supabase/migration_13_zielort_suche.sql` (Zielort/Zielland in der Fahrtensuche)
   - `supabase/migration_14_freie_plaetze_und_datum.sql` (korrekte freie Plätze in der Übersicht)
   - `supabase/migration_15_segment_verfuegbarkeit_suche.sql` (passgenaue Verfügbarkeit für gesuchte Verbindung)
   - `supabase/migration_16_selbstanmeldung.sql` (Selbstanmeldung für Mitfahrer/Fahrer ohne Einladungslink)
   - `supabase/migration_17_eur_fahrerprofil_schliessen.sql` (EUR-Basis, Fahrer-Zahlungsinfo/-währung/-rate, Fahrten schließen/öffnen)
   - `supabase/migration_18_fahrer_eigene_strecken.sql` (Fahrer können eigene Strecken anlegen/verwalten)
   - `supabase/migration_19_fahrer_eigene_autos.sql` (Fahrer können eigene Autos anlegen/verwalten)
   - `supabase/migration_20_auto_details.sql` (Auto-Größe, Antrieb, Ausstattung)
   - `supabase/migration_21_kartenansicht.sql` (Koordinaten je Stopp für Kartenansicht)
   - `supabase/migration_22_kontaktdaten_einstellungen.sql` (Telefon/E-Mail bei Fahrer- und Mitfahrer-Einstellungen)
   - `supabase/migration_23_fahrer_via_zwischenstopps.sql` (Zwischenstopps in der eigenen Fahrtenliste des Fahrers)
   - `supabase/migration_24_bewertungssystem.sql` (Bewertungssystem für Fahrer)
   - `supabase/migration_25_mitfahrer_bewertungssystem.sql` (Bewertungssystem für Mitfahrer)
   - `supabase/migration_26_zwischenstopp_loeschen_fehler.sql` (klare Fehlermeldung beim Löschen belegter Zwischenstopps)
   - `supabase/migration_27_buymeacoffee_vorbereitung.sql` (Buy Me a Coffee Link vorbereiten, noch nicht aktiv)
   - `supabase/migration_28_bmc_projekt_und_status.sql` (BMC-Umbau: ein Projekt-Link + Abo-Status pro Person)
   - `supabase/migration_29_fahrer_kontakt_whatsapp.sql` (Fahrername/-telefonnummer bei Suchergebnissen & Buchungen)
   - `supabase/migration_30_abo_pflicht_veroeffentlichen.sql` (Fahrt-Veröffentlichung nur mit aktivem Abo, 40-Tage-Fenster)
   - `supabase/migration_31_fahrer_email_benachrichtigung.sql` (Fahrer-E-Mail für Benachrichtigungen verfügbar machen)
   - `supabase/migration_32_umkreissuche.sql` (Koordinaten je Stopp für Umkreissuche)
   - `supabase/migration_33_suchauftrag_benachrichtigung.sql` (Suchauftrag speichern & bei neuen Fahrten per E-Mail informieren)
   - `supabase/migration_34_auto_entfernung_beim_veroeffentlichen.sql` (automatische Entfernungsberechnung beim Veröffentlichen)
   - `supabase/migration_35_suchauftrag_verwaltung.sql` (Übersicht & Löschen gespeicherter Suchaufträge)
   - `supabase/migration_36_fahrt_kopieren.sql` (Fahrt kopieren)
   - `supabase/migration_37_willkommenstext_editierbar.sql` (Willkommenstext admin-editierbar)
   - `supabase/migration_38_email_log.sql` (dauerhaftes E-Mail-Versand-Log)
3. Unter **Authentication → Users** einen Benutzer für dich selbst anlegen
   (E-Mail + Passwort) — das ist dein Admin-Login für `/admin`.
4. Unter **Project Settings → API** findest du:
   - `Project URL` → wird zu `VITE_SUPABASE_URL`
   - `anon public` Key → wird zu `VITE_SUPABASE_ANON_KEY`

### 2. Projekt konfigurieren

```bash
cp .env.example .env
```

Trage in `.env` die Werte aus Schritt 1.4 ein, sowie `VITE_ADMIN_EMAIL` — die
E-Mail-Adresse, an die Selbstanmeldungen (siehe unten) geschickt werden.

### 3. Lokal testen

```bash
npm install
npm run dev
```

Öffne die angezeigte lokale Adresse. Unter `/admin` anmelden, eine Strecke mit
Zwischenstopps anlegen, eine Fahrt veröffentlichen, eine Person einladen und den
generierten Link in einem anderen Browser/Tab testen.

### 4. Veröffentlichen (damit der Link auf dem Smartphone funktioniert)

Am einfachsten mit [Vercel](https://vercel.com) oder [Netlify](https://netlify.com)
(beide kostenlos für dieses Projekt):

1. Projekt zu einem GitHub-Repository pushen (die `.env` bleibt dank `.gitignore`
   automatisch draußen — niemals `.env` selbst hochladen/deployen).
2. Bei Vercel/Netlify das Repository importieren.
3. Als Umgebungsvariablen `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` und
   `VITE_ADMIN_EMAIL` **direkt in den Projekteinstellungen** eintragen (dieselben
   Werte wie in deiner `.env`) — nicht als Datei hochladen.
4. Deployen. Du erhältst eine URL wie `https://deine-app.vercel.app`.

**Hinweis für Netlify:** Die Datei `netlify.toml` ist bereits enthalten und regelt
zwei Dinge automatisch:
- Netlifys Secrets-Scanner warnt sonst fälschlich vor `VITE_SUPABASE_URL`/
  `VITE_SUPABASE_ANON_KEY` im Build-Output. Das ist kein echtes Sicherheitsrisiko:
  diese Werte sind bei Supabase bewusst öffentlich/client-seitig (abgesichert wird
  über Row Level Security in der Datenbank, nicht durch Geheimhaltung des
  anon-Keys) und müssen im Frontend-Bundle stehen, damit die App funktioniert.
- Ohne Konfiguration würden Unterseiten wie `/invite/TOKEN` oder `/admin` bei
  direktem Aufruf oder Neuladen einen 404-Fehler zeigen (typisch bei
  React-Router-Apps auf statischem Hosting). `netlify.toml` leitet alle Pfade
  auf `index.html` um, damit das clientseitige Routing greift.

**Falls die Secrets-Warnung trotzdem erscheint:** Netlify hat zusätzlich ein
neueres "Secret scanning with smart detection"-Feature (auf bezahlten Plänen
automatisch aktiv), das unabhängig von der `netlify.toml`-Einstellung läuft.
Falls das anschlägt: im Netlify-Dashboard unter
**Project configuration → Environment variables** eine Variable
`SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES` anlegen und dort die drei
**tatsächlichen Werte** (nicht die Variablennamen!) von `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` und `VITE_ADMIN_EMAIL` kommagetrennt eintragen,
danach neu deployen.

Ab jetzt zeigen die Einladungslinks im Admin-Bereich automatisch auf diese Adresse.

### 5. Auf dem Smartphone installieren

Die Adresse (oder direkt einen Einladungslink) im Handy-Browser öffnen →
"Zum Home-Bildschirm hinzufügen" (iOS Safari) bzw. "App installieren"
(Android Chrome). Danach startet die App wie eine normale App vom Homescreen.

## Struktur

```
src/
  pages/InvitePage.jsx      Buchungsseite für eingeladene Personen
  pages/AdminLogin.jsx      Admin-Login
  pages/AdminDashboard.jsx  Verwaltung: Personen, Strecken, Fahrten
  lib/supabaseClient.js     Supabase-Verbindung
supabase/schema.sql         Datenbankschema, Sicherheitsregeln, Buchungslogik
```

## Wie die Teilstrecken-Kapazität berechnet wird

Jede Fahrt hat eine Gesamtplatzzahl. Bucht jemand z.B. "Basel → Ulm" und jemand
anders "Ulm → München", überschneiden sich diese Abschnitte nicht und beide können
unabhängig voneinander die volle Platzzahl nutzen. Überschneiden sich Abschnitte
(z.B. "Basel → München" und "Ulm → Augsburg"), wird geprüft, ob die Summe der
Plätze auf dem überschneidenden Teilstück die Gesamtkapazität übersteigt. Das
passiert direkt in der Datenbank (`fn_create_booking` in `supabase/schema.sql`),
damit auch bei gleichzeitigen Buchungen keine Überbuchung entstehen kann.

## Sicherheit

- Eingeladene Personen haben **keinen direkten Datenbankzugriff** — sie können nur
  über kontrollierte Funktionen lesen/schreiben, die ihren Einladungs-Token prüfen.
- Der Admin-Bereich ist per Supabase-Auth (E-Mail/Passwort) geschützt.
- Einladungslinks kannst du jederzeit einzeln widerrufen, ohne die Person zu löschen.

## Neue Buchungen live mitbekommen (Fahrer-Bereich)

Solange ein Fahrer seine eigene Seite geöffnet hat, wird alle 20 Sekunden im
Hintergrund unauffällig geprüft, ob eine neue Buchung eingegangen ist (kein
Neuladen, kein Ladezustand). Bei einer neuen Buchung erscheint:
- ein Hinweis-Banner oben auf der Seite (verschwindet nach ca. 12 Sekunden),
- zusätzlich eine Browser-Benachrichtigung, **falls** der Fahrer das im Tab
  "Einstellungen" über den Button "Browser-Benachrichtigungen aktivieren"
  erlaubt hat.

Das funktioniert rein clientseitig über wiederholtes Abfragen
(`fn_driver_list_trips`) und Vergleich der gebuchten Plätze — keine
zusätzliche Server-Infrastruktur nötig. Eine "echte" Push-Benachrichtigung,
die auch bei geschlossenem Tab ankommt, würde einen separaten Push-Dienst
(Service Worker + Push API + Serverkomponente) erfordern und ist damit
bewusst nicht Teil dieser einfachen Lösung.

## E-Mail-Benachrichtigungen per SMTP (1&1/IONOS)

Bei jeder Buchung und Stornierung verschickt die App automatisch E-Mails
(Fahrer bei neuer/stornierter Buchung, Mitfahrer als Bestätigung) — über eine
Supabase Edge Function, die sich per SMTP bei deinem 1&1/IONOS-Postfach
anmeldet. Muss einmalig eingerichtet werden:

### 1. Supabase CLI installieren (falls noch nicht vorhanden)

```bash
npm install -g supabase
supabase login
```

### 2. Mit deinem Projekt verknüpfen

Im Projektordner:

```bash
supabase link --project-ref DEIN-PROJEKT-REF
```

(`DEIN-PROJEKT-REF` findest du in der Supabase-Projekt-URL, z.B.
`abcdefghijk` bei `https://abcdefghijk.supabase.co`.)

### 3. SMTP-Zugangsdaten als Secrets hinterlegen

**Niemals** Passwörter im Code oder in `.env` speichern — Supabase Secrets
sind dafür da:

```bash
supabase secrets set SMTP_HOST=smtp.ionos.de
supabase secrets set SMTP_PORT=465
supabase secrets set SMTP_USER=deine-adresse@deine-domain.de
supabase secrets set SMTP_PASS=DEIN-POSTFACH-PASSWORT
supabase secrets set SMTP_FROM_NAME=pickaride
```

Falls Port 465 bei dir nicht funktioniert, `SMTP_PORT=587` versuchen (dann
verwendet IONOS STARTTLS statt direktem SSL).

**Kopie an dich selbst (BCC):** Wird jetzt **nicht** über ein Secret,
sondern direkt in der App gesteuert: Admin-Bereich → Tab „Einstellungen" →
Feld „E-Mail-BCC an". Trägst du dort eine Adresse ein, bekommt sie eine
Kopie jeder automatisch verschickten E-Mail (Posteingang, nicht
"Gesendet"-Ordner — SMTP-Versand füllt diesen Ordner grundsätzlich nicht,
das ist reines Verhalten von E-Mail-Programmen wie Outlook/Thunderbird).
Leer lassen = keine Kopie. Änderungen wirken sofort, ohne Redeploy.

### 4. Edge Function deployen

```bash
supabase functions deploy send-email
```

### 5. Testen

Nach dem Deploy: In der App eine Testbuchung durchführen (mit einer echten
E-Mail-Adresse bei Fahrer und Mitfahrer hinterlegt) und prüfen, ob beide
Postfächer eine E-Mail erhalten. Bei Problemen:

```bash
supabase functions logs send-email
```

zeigt die Logs der Funktion inkl. eventueller SMTP-Fehlermeldungen (z.B.
falsches Passwort, falscher Port).

### Wichtig zu wissen

- Schlägt der E-Mail-Versand fehl, wird das nur in der Browser-Konsole
  geloggt — die eigentliche Buchung/Stornierung funktioniert unabhängig
  davon immer. E-Mails sind eine Zusatzfunktion, kein Blocker.
- 1&1/IONOS begrenzt den Versand (anfangs ca. 50 E-Mails/Stunde, später bis
  zu 500/Tag) — für den privaten Rahmen dieses Projekts ausreichend.
- Diese Lösung wird direkt beim Buchen/Stornieren aus dem Browser heraus
  ausgelöst. Für eine noch robustere Variante (unabhängig davon, ob der
  Browser die Anfrage vollständig abschließt) ließe sich stattdessen ein
  Supabase **Database Webhook** auf die `bookings`-Tabelle einrichten, der
  dieselbe Edge Function serverseitig aufruft — bei Bedarf gerne als
  nächsten Ausbauschritt.

## Umkreissuche bei der Fahrtensuche

Neben der Suche nach exaktem Ortsnamen gibt es jetzt zwei Slider — einen
direkt über dem Feld "Startort" und einen direkt über "Zielort" — mit denen
sich jeweils unabhängig ein Umkreis von ±10 bis ±50 km (in 10-km-Schritten,
Voreinstellung ±10 km) einstellen lässt. Wählt ein Mitfahrer den Start-
bzw. Zielort **aus den Vorschlägen** aus (nicht nur getippt), werden dessen
Koordinaten übernommen; die Suche findet dann auch Fahrten mit einem
Start-/Zielpunkt, der zwar anders heißt, aber innerhalb des gewählten
Radius liegt (Luftlinie) — z.B. "München" findet dann auch eine Fahrt ab
"Haar", wenn der Slider auf ±20 km oder mehr steht.

**Voraussetzung:** Die Koordinaten der Streckenpunkte müssen bekannt sein —
das ist automatisch der Fall, sobald für die jeweilige Strecke einmal
"Entfernungen & Fahrzeiten berechnen" ausgeführt wurde (Admin- oder
Fahrer-Bereich). Ohne das keine Koordinaten, keine Umkreissuche für diese
Strecke — die normale Namenssuche funktioniert davon unabhängig immer.

## Suchauftrag: "Informiere mich, wenn neue Fahrten eingestellt werden"

Nach einer Suche erscheint oberhalb der Trefferliste ein Button
"🔔 Informiere mich, wenn neue Fahrten eingestellt werden!" — sofern Start-
und Zielort **aus den Vorschlägen ausgewählt** wurden (Koordinaten bekannt)
und eine E-Mail-Adresse hinterlegt ist. Ein Klick speichert einen
Suchauftrag.

Wird danach eine **neue** Fahrt veröffentlicht (egal ob vom Fahrer selbst
oder vom Admin), wird geprüft: Hat die Strecke einen Punkt innerhalb von
**20 km** um den gespeicherten Startort UND — später in der Streckenfolge —
einen Punkt innerhalb von 20 km um den gespeicherten Zielort? Falls ja,
bekommt der Mitfahrer automatisch eine E-Mail.

**Voraussetzung:** Wie bei der Umkreissuche müssen die Koordinaten der
Streckenpunkte bekannt sein (einmal "Entfernungen berechnen" pro Strecke).
Im Tab "Einstellungen" gibt es unter "🔔 Meine Suchaufträge" eine Übersicht
aller gespeicherten Suchaufträge mit Lösch-Möglichkeit.

## Automatische Entfernungsberechnung beim Veröffentlichen

Klickt ein Fahrer oder der Admin auf "Veröffentlichen" und für die gewählte
Strecke wurden noch nie Entfernungen berechnet (fehlende Koordinaten oder
Distanzen), wird das jetzt automatisch nachgeholt — bevor die Fahrt
gespeichert wird. Während der Berechnung erscheint "📍 Entfernungen für die
gewählte Strecke werden berechnet …" statt des Veröffentlichen-Buttons; das
kann je nach Anzahl Stopps ein paar Sekunden dauern (Nominatim erfordert aus
Fairness-Gründen ca. 1 Sekunde Pause zwischen Anfragen).

Das funktioniert **für jede Strecke**, unabhängig davon, wem sie gehört
(eigene, admin-angelegte oder eine andere Fahrer-Strecke) — dafür gibt es
zwei bewusst eng begrenzte Funktionen, die ausschließlich Koordinaten,
Entfernungen und (nur falls noch 0) Standardpreise schreiben dürfen, aber
keine sonstigen Änderungen an der Strecke (Name, Adressen, Reihenfolge)
zulassen.

Schlägt die automatische Berechnung fehl (z.B. Adressdienst nicht
erreichbar, Adresse nicht auffindbar), wird die Fahrt trotzdem ganz normal
veröffentlicht — nur eben ohne Entfernungen, wie bisher auch ohne dieses
Feature. Das manuelle "Entfernungen & Fahrzeiten berechnen" im Streckeneditor
bleibt zusätzlich bestehen und funktioniert unverändert.

## Fahrt kopieren (Fahrer-Bereich)

Bei jeder eigenen Fahrt in "Meine Fahrten" — egal ob bevorstehend oder
bereits vergangen — gibt es jetzt einen Button "Kopieren". Er befüllt das
"Fahrt veröffentlichen"-Formular oben mit Strecke und Auto der gewählten
Fahrt; die Sitzplätze werden als Vorschlag übernommen. Datum und Startzeit
bleiben bewusst leer und müssen neu eingetragen werden. Ein Hinweis-Banner
zeigt an, dass gerade eine Vorlage aktiv ist ("Vorlage entfernen" setzt das
Formular zurück).

Die neue Fahrt durchläuft danach ganz normal alle bestehenden Prüfungen
(aktives Abo, 40-Tage-Fenster, automatische Entfernungsberechnung falls
nötig, Suchauftrag-Benachrichtigungen) — es ist technisch keine
"Kopie", sondern einfach eine neue Fahrt mit vorausgefüllten Werten.

## Impressum

Unter `/impressum` gibt es jetzt eine öffentliche Impressum-Seite. Der Text
wird im Admin-Bereich unter "Einstellungen" → Feld "Impressum" gepflegt
(Freitext, mehrzeilig) — dort trägst du deine rechtlich vollständigen Angaben
ein (Name/Firma, Anschrift, Kontaktmöglichkeit; je nach Land können weitere
Pflichtangaben nötig sein, das kann ich als KI nicht rechtssicher für dich
beurteilen).

Ein "Impressum"-Link erscheint jeweils unten auf:
- der Landing-/Anmeldeseite (ohne Einladungslink),
- der Hauptseite der Mitfahrer,
- der Hauptseite der Fahrer.

**Keine neue Datenbank-Migration nötig** — nutzt die bereits vorhandene
`app_settings`-Tabelle und `fn_get_app_setting`-Funktion (aus dem
Buy-Me-a-Coffee-Umbau).

## Willkommenstext auf der Landing-Seite selbst pflegen

Der zweigeteilte Willkommenstext (immer sichtbarer Teil + Teil hinter dem
Button "Warum - Wie - Kosten") liegt jetzt ebenfalls in `app_settings` und
lässt sich im Admin-Bereich unter "Einstellungen" bearbeiten — zwei
Textfelder, eine Leerzeile erzeugt jeweils einen neuen Absatz. Migration 37
befüllt beide Felder einmalig mit dem bisherigen Text als Startwert (nur
falls noch nicht vorhanden), damit sich an der Anzeige zunächst nichts
ändert, bis du selbst etwas änderst.

## E-Mail-Log (dauerhaft)

Jeder Versandversuch der Edge Function "send-email" (Buchung, Stornierung,
Suchauftrag-Benachrichtigung usw.) wird jetzt dauerhaft in der Tabelle
`email_log` gespeichert: Zeitpunkt, Adressat, Betreff, Ergebnis
(Erfolg/Fehler) und bei Fehlern die genaue Fehlermeldung (z.B. das
IONOS-Sendelimit).

Einsehbar im Admin-Bereich unter dem neuen Tab **"E-Mail-Log"** — mit
Filter nach Erfolg/Fehler, zeigt die letzten 300 Einträge.

**Wichtig:** Damit das funktioniert, muss die aktualisierte Edge Function
neu deployt werden (`supabase functions deploy send-email`) — sie schreibt
jetzt zusätzlich in `email_log`, nachdem sie den eigentlichen Versand
versucht hat. Schlägt das Loggen selbst fehl (sollte praktisch nie
vorkommen), wird das nur in den Function-Logs vermerkt und verhindert nie
den eigentlichen E-Mail-Versand.
