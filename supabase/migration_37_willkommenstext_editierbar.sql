-- ============================================================================
-- Migration 37: Willkommenstext auf der Landing-Seite admin-editierbar
-- machen. Zwei Teile, analog zum Impressum in app_settings gespeichert:
-- - welcome_text_intro:   immer sichtbarer Teil (Intro + Schlusssatz)
-- - welcome_text_details: Teil hinter dem Button "Warum - Wie - Kosten"
-- Wird nur eingefügt, falls noch nicht vorhanden (ON CONFLICT DO NOTHING),
-- damit bestehende Installationen exakt den bisherigen Text als Startwert
-- bekommen und sich an der Anzeige zunächst nichts ändert.
-- ============================================================================
-- Im Supabase SQL-Editor ausführen.
-- ============================================================================

insert into app_settings (key, value) values (
  'welcome_text_intro',
$$Du möchtest einfach eine Mitfahrgelegenheit buchen? Oder als Fahrer deine freien Plätze anbieten, um Fahrtkosten zu teilen und neue Leute kennenzulernen? Dann bist du hier genau richtig!

Schön, dass du da bist — gute Fahrt!$$
) on conflict (key) do nothing;

insert into app_settings (key, value) values (
  'welcome_text_details',
$$Ich habe diese Plattform ins Leben gerufen, um eine schlanke, preiswerte und unkomplizierte Alternative zu den grossen Anbietern zu schaffen. Für Mitfahrer ist die Nutzung komplett gebührenfrei. Ganz umsonst lässt sich ein solches Projekt im Hintergrund aber leider nicht betreiben.

Damit die Webseite rund um die Uhr sicher online bleibt, fallen laufende Kosten an — zum Beispiel für die Domain, das Webhosting, verschlüsselte SSL-Zertifikate, den automatischen E-Mail-Versand (Buchungsbestätigungen) sowie für Rechtstexte und die Transaktionsgebühren der Zahlungsanbieter.

Um diese Ausgaben fair zu decken, setzen wir auf ein einfaches Unterstützer-Modell:

- Als Fahrer schliesst du für lediglich 1 € pro Monat ein kleines Abo ab. Damit kannst du flexibel Fahrten für den laufenden und den Folgemonat veröffentlichen.
- Als Mitfahrer buchst du komplett kostenlos. Wenn dir der Dienst gefällt, freuen wir uns natürlich über ein freiwilliges Trinkgeld.$$
) on conflict (key) do nothing;
