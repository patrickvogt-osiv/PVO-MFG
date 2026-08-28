# Mitfahrt buchen

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
