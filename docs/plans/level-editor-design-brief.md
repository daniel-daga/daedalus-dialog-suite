# Design-Dokument: Moderner ZenGin-Level-Editor

**Status:** Entwurf / Diskussionsgrundlage
**Zweck:** Vorgabe für die Architekturausarbeitung. Dieses Dokument legt Ziele, Scope und bekannte Constraints fest — nicht die konkrete technische Architektur.

> Repo note: this is the original (German) design brief, checked in verbatim as
> the source input for [`level-editor.md`](level-editor.md), which contains the
> viability analysis and the proposed architecture answering the open questions
> in section 10.

---

## 1. Motivation

Der offizielle Spacer (und auch Spacer.NET) bleibt im Vergleich zu modernen Engine-Editoren wie Unity, Godot oder Unreal deutlich zurück. Fehlend sind unter anderem:

- Gizmos für Translation/Rotation/Skalierung statt reiner Zahlenfelder
- verlässliches Undo/Redo
- Szenengraph mit Drag-&-Drop-Reparenting
- Multi-Select und Batch-Editing von VOB-Properties
- Asset-Browser mit Thumbnails
- Live-Feedback statt kryptischer Compiler-Meldungen nach dem Speichern

Gleichzeitig sind die Dateiformate der ZenGin inzwischen gut erschlossen. Das Projekt muss also **nicht** bei Reverse Engineering anfangen, sondern kann auf bestehenden Bibliotheken aufsetzen.

---

## 2. Verfügbare Vorarbeiten

| Projekt | Rolle | Anmerkung |
|---|---|---|
| **ZenKit** (GothicKit) | Primäre Datenschicht | C++17, liest/schreibt ZenGin-Formate, enthält Daedalus-VM; Backend von OpenGothic; Wrapper für C# und Java verfügbar |
| **ZenLib** (ataulien) | Referenzimplementierung | Vorgänger von ZenKit, weiterhin nützlich als Doku |
| **OpenGothic** | Referenz-Renderer / Preview-Runtime | Reimplementierung der Engine, DX12/Vulkan/Metal |
| **zen** (MordragT) | Rust-Alternative | ZEN→glTF-Export in Arbeit |
| **KrxImpExp** | Blender-Bridge | Import/Export von 3DS, ASC, MSH, MRM, ZEN — **GPL, Lizenz beachten** |
| **Eigener Tree-sitter-Daedalus-Parser** | Skript-Intelligenz | Bereits vorhanden; siehe Abschnitt 5 |

**Vorgabe:** ZenKit ist die Default-Wahl für Serialisierung. Falls stattdessen Rust bevorzugt wird, muss der Round-Trip-Fidelity-Test (Abschnitt 9) als Gate gegen die ZenKit-Implementierung laufen.

---

## 3. Scope

### Phase 1 — VOB-Editing (Kern, höchster Nutzen / geringstes Risiko)

Laden einer kompilierten ZEN, Bearbeiten des VOB-Baums, Zurückschreiben. **Der BSP-Baum und das Weltmesh bleiben unangetastet**, weil sich das Terrain nicht ändert. Damit entfällt der riskanteste Teil komplett.

Umfang:
- VOB-Baum als Szenengraph mit Gizmos, Undo/Redo, Multi-Select
- Property-Editor mit typisiertem Schema pro VOB-Klasse
- Asset-Browser für Visuals (MRM/MSH/ASC) mit Preview
- Waynet-Editing (siehe 4.3)
- NPC-Visualisierung und Tagesablauf-Vorschau aus den Skripten (siehe 5.1)

### Phase 2 — Portal-/Sektor-Validierung und -Authoring

Siehe Abschnitt 4.1. Validierung zuerst, Authoring optional danach.

### Phase 3 — Multi-ZEN-Workspace

Siehe Abschnitt 4.2.

### Später / optional

Szenario-Kontext für kapitelabhängige Routinen und dynamische Spawns (Abschnitt 5.2). Ausdrücklich keine hohe Priorität — die Architektur soll es nur nicht verbauen.

### Explizit außerhalb des Scope (vorerst)

- **Eigener BSP-Compiler.** Die Heuristiken des Original-Compilers (Ebenenwahl, Sektorerkennung, Portal-Zuordnung) sind nicht dokumentiert. Eine Eigenimplementierung produziert leicht formal gültige, aber schlecht performende oder subtil kaputte Levels — inklusive Kollisionsfehlern, weil der BSP-Baum in ZenGin auch für Physik genutzt wird.
- **Terrain-Sculpting.** Folgt zwingend aus dem obigen Punkt.
- Windows-only-Modding-Tools (Union) — 32-Bit-Abhängigkeiten.

---

## 4. Die drei zentralen Pain Points

### 4.1 Portale und Sektoren

**Wichtige Korrektur eines verbreiteten Missverständnisses:** Portale sind **keine positionierten Objekte**. Sie sind Metadaten am Weltmesh, kodiert über Material-Namen auf Polygonen:

- Portalflächen: Materialien der Form `P:_<name>` bzw. `P:<name>_`
- Sektoren: Materialien mit `S:`-Präfix
- Occluder: Material `GHOSTOCCLUDER` (unsichtbare Wände, die dem BSP-Algorithmus während der Kompilierung helfen)

Authoring passiert daher eigentlich im 3D-Programm (klassisch 3ds Max, heute Blender + KrxImpExp), nicht im Spacer. Der Spacer kompiliert nur und meldet Fehler.

**Bekannte Fehlermeldung:**

```
zBSP(zCBspTree::CreateBspSectors) : Illegal Sector Portals: <NAME>
```

Häufig gefolgt von einer Access Violation. Dokumentierte Ursachen: fehlendes Gegenstück, Teil auf der falschen Seite, Überschneidungen mit Welten. Ein belegter Forumsfall betrifft einen Modder, der **gar keine Portale wollte** — die Material-Benennung im Mesh hat sie versehentlich erzeugt.

**Validierungs-Checkliste (Phase 2, priorisiert):**

*Statisch, billig, sofort nützlich:*
1. **Paarung** — jedes Portal-Material hat sein Gegenstück; beide referenzierten Sektornamen existieren als `S:`-Sektoren
2. **Orientierung** — Portalflächen-Normalen zeigen konsistent zu den benannten Sektoren (vermutlich das „falsche Seite" der Fehlermeldung)
3. **Versehentliche Portale** — Faces, deren Material zufällig mit `P:` beginnt, ohne dass das gewollt war

*Geometrisch, aufwendiger:*
4. **Schnittfreiheit** — Portalpolygone dürfen andere Weltgeometrie nicht schneiden; Flächen sollten planar und konvex sein
5. **Sektor-Dichtheit** — Flood-Fill vom Sektorinneren; entkommt es ins Freie, ist der Sektor undicht. (Spacer hat dafür „Detect leaks", dessen genaue Funktion undokumentiert ist.)
6. **Triangle-Limits** — 65.536 Dreiecke pro Objekt im .3ds-Format

**Design-Entscheidung:** Validierung läuft *vor* dem Kompilieren und zeigt Ergebnisse räumlich im Viewport an — Sektoren farbig, Portalflächen mit Paarungs-Verbindungslinie, Fehler als anklickbare Marker, die die Kamera zur betroffenen Fläche fahren. Der Fehler soll nicht mehr als kryptischer Log-Eintrag nach dem Kompilieren auftauchen.

**Optionales Authoring:** Face-Selection direkt im Editor mit Materialzuweisung und Autocomplete über bestehende Sektornamen. Bemerkenswert: Die Community empfiehlt für Portal-Setup ausgerechnet den Spacer-Editor-Modus, obwohl Material-Arbeit sonst bequemer extern erledigt wird — die Lücke im Blender-Roundtrip ist also anerkannt. Wenn Face-Materialzuweisung *mit* Live-Validierung kombiniert wird, füllt der Editor genau diese Lücke.

### 4.2 Multi-ZEN-Workspace

Große Welten sind aus zwei Gründen aufgeteilt:

1. **3ds-Limit:** 65.536 Dreiecke pro Objekt. SURFACE.3DS wurde z. B. in vier etwa gleich große Teile zerlegt, die beim Kompilieren wieder zu einem Objekt zusammengeführt werden.
2. **ZEN-Zusammenführung per Makro:** Mehrere kompilierte ZENs werden über ein Makro (Tools > Macros) verbunden; VOB-Bäume werden dabei ebenfalls gemergt. Bei Gothic 2 erkennbar an Ordnern mit `NEWWORLD.ZEN` plus mehreren Dateien mit „part" im Namen.

Bei Gothic 1 sind Bereiche wie `OldCamp`, `NewCamp`, `PsiCamp` eigenständige Meshes neben `Surface`. Weitere Teile (AbandonedMine, Demontower, FreeMine, OrcCity, OrcGraveyard, OrcTempel …) landen beim naiven Import im Koordinatenursprung statt an ihrer Weltposition.

**Design-Entscheidung:** Der Part-Split ist ein **Speicherformat, kein Arbeitsmodell**. Der Editor lädt alle Parts gleichzeitig, hält ihre Weltkoordinaten korrekt und erlaubt nahtlose Navigation durch die Gesamtwelt. Editiert wird weiterhin im jeweiligen Part (Zuordnung sichtbar in der UI); beim Export werden nur geänderte Parts zurückgeschrieben.

Damit entfällt der Neulade-Zyklus beim Wechsel zwischen Bereichen. Nebeneffekt: Transformationen ganzer Part-Bäume werden trivial — in Spacer braucht man dafür heute zSlang.

Die GMC nennt als Alternative ein einziges Weltmesh mit internen Submeshes; Nachteil dort ist, dass dann nicht mehrere Personen gleichzeitig an der Welt arbeiten können. Der Editor sollte beide Layouts unterstützen, da er den Split ohnehin abstrahiert.

### 4.3 Waynet

Waypoints und Freepoints bilden den Navigationsgraphen. In Spacer wird dieser Graph über Zahlenfelder und Listen bearbeitet, was bei Pfaden mit Verzweigungen schnell unübersichtlich wird.

**Anforderungen:**
- Waypoints als Graph im Viewport, Kanten sichtbar
- Kanten per Klick verbinden/trennen
- Pfad-Zeichenmodus (mehrere Waypoints in Folge setzen, automatisch verketten)
- Validierung: verwaiste Waypoints, unerreichbare Teilgraphen, Duplikat-Namen
- Cross-Check gegen Daedalus (siehe 5)

---

## 5. Daedalus-Integration über den Tree-sitter-Parser

Der bereits vorhandene Tree-sitter-Parser hebt das Projekt von „Level-Editor" auf „IDE" und ist damit einer der stärksten Differenzierungspunkte gegenüber allen bestehenden Tools.

**Funktionen:**

- **Autocomplete für Instanznamen.** Beim Platzieren eines Items keine Eingabe von `ITMW_1H_SWORD_...` aus dem Kopf, sondern durchsuchbare Liste aller Daedalus-Instanzen, gefiltert nach passender Klasse.
- **Cross-Validierung Skript ↔ ZEN.** Referenziert eine NPC-Routine einen Waypoint, den es im Level nicht gibt? Zeigt ein Trigger auf einen VOB-Namen, der nicht existiert? Diese Fehlerklasse fällt sonst erst beim Spielstart auf. Die Prüfung läuft in beide Richtungen.
- **Go-to-Definition / Find-Usages.** Rechtsklick auf einen NPC im Level springt zur Daedalus-Instanz und umgekehrt. Tree-sitters inkrementelles Reparsing ist genau dafür ausgelegt.
- **Integrierter Skripteditor** mit Syntax-Highlighting, damit kein zweites Werkzeug parallel offen sein muss.

**Hinweis zur Kodierung:** Daedalus-Quelldateien und ZEN-Strings verwenden Windows-1252, nicht UTF-8. Umlaute in Instanznamen und Dialogtexten sind real; der Parser und die Serialisierung müssen das konsistent behandeln.

### 5.1 NPC-Visualisierung und Tagesablauf-Vorschau

**Ausgangslage:** NPCs existieren nicht in der ZEN. Sie werden zur Laufzeit über `Wld_InsertNpc(instance, spawnPoint)` eingefügt — klassisch aus der `Startup.d`, mit Instanzname und Waypoint-Namen als String. Die ZEN kennt nur den Waypoint. Deshalb kann Spacer prinzipiell keine Charaktere anzeigen: In der Datei, die er bearbeitet, steht keiner.

Dasselbe gilt für Tagesabläufe. Routinen sind Daedalus-Funktionen (Konvention `Rtn_Start_<id>`), in denen `TA_*`-Aufrufe je eine Aktivität mit Startzeit, Endzeit und Waypoint in der Todo-Liste des NPC registrieren. Beispielhafte Form:

```
FUNC VOID Rtn_Start_1 () {
    //             Start   End
    TA_Sleep      (23,00, 03,00, "OCR_HUT_1");
    TA_SitAround  (03,00, 05,30, "OCR_HUT_Z5_SIT3");
    TA_SitCampfire(18,00, 23,00, "OCR_CAMPFIRE_A_MOVEMENT1");
};
```

Da der Tree-sitter-Parser beide Seiten erschließt (Skripte und ZEN/Waynet), lassen sich Funktionen bauen, die in keinem bestehenden Tool existieren. Dies ist eines der stärksten Alleinstellungsmerkmale des Projekts.

**Funktionen:**

- **NPC-Rendering im Viewport.** Alle `Wld_InsertNpc`-Aufrufe einsammeln, Waypoint-Namen gegen die Waynet auflösen, Visual aus dem `B_SetNpcVisual`-Aufruf der Instanz ableiten (Body, Head, Face, Armor-Instanz) und den Charakter an seiner Position darstellen. Analog für `Wld_InsertItem`.
- **Zeit-Slider (00:00–24:00).** `TA_*`-Aufrufe tragen Zeitfenster und Waypoint. Für jede Uhrzeit ist damit statisch auswertbar, wo jeder NPC sein sollte. Beim Ziehen des Sliders wandert die Bevölkerung des Levels mit. Bewusst **statische Auswertung, keine Simulation** — ausreichend, um Platzierungs- und Zeitkonflikte zu erkennen, ohne Pathfinding oder AI nachzubauen.
- **Belegungs-Konflikte.** Zwei NPCs mit `TA_Sleep` auf demselben Bett-Waypoint im überlappenden Zeitfenster. Analog für Sitzplätze und andere exklusive Mobsis.
- **Lücken- und Überlappungsprüfung** in der Routine eines NPC über 24 Stunden.

**Validierungen (belegte Fehlerklassen):**

1. **Freepoint statt Waypoint.** Der häufigste Anfängerfehler: Ein NPC erscheint nicht, weil der Spawn auf einem Freepoint statt einem Waypoint liegt. Direkt prüfbar, sobald Waynet und Skript gemeinsam im Speicher liegen.
2. **Nicht existierende Waypoints** in `Wld_InsertNpc` oder in `TA_*`-Aufrufen.
3. **Verwaiste Waypoints** — in der ZEN vorhanden, von keinem Skript referenziert (Warnung, kein Fehler).
4. **Doppelte NPC-IDs.** IDs müssen eindeutig sein.

**Bekannte Grenze:** Die Auswertung funktioniert nur für **statisch analysierbare** Spawns. Respawn- und Monster-Skripte rufen `Wld_InsertNpc` in Schleifen mit Zufallswerten, Guild-Abfragen und Distanzprüfungen auf. Solche Aufrufe darf der Editor nicht raten — sie sind als „dynamisch, nicht darstellbar" zu kennzeichnen und aus Konfliktprüfungen auszunehmen. Eine falsche Darstellung wäre hier schädlicher als gar keine.

**Abgrenzung:** Eine echte Ausführung der Skripte über die Daedalus-VM (in ZenKit vorhanden) wäre die Alternative zur statischen Analyse. Das ist mächtiger, aber deutlich aufwendiger und bringt Laufzeitzustand ins Editor-Modell. Vorschlag: statische Analyse zuerst; VM-Ausführung als spätere Option offenhalten, falls die Abdeckung nicht reicht.

### 5.2 Szenario-Kontext (Ausbaustufe, **nicht Phase 1**)

> **Priorität: niedrig.** Dieser Abschnitt beschreibt eine Erweiterung von 5.1, keine Grundfunktion. Die Basisversion aus 5.1 — Startzustand, ein Zeit-Slider, statische Spawns — liefert bereits den Großteil des Nutzens. Der Szenario-Kontext sollte erst angegangen werden, wenn Phase 1 steht, und die Architektur sollte ihn lediglich *nicht verbauen*.

**Problem:** Ein NPC hat nicht *eine* Routine. `Npc_ExchangeRoutine(npc, routineName)` löscht die Routinenliste und baut eine neue, indem die Funktion `Rtn_{routineName}_{npc.id}` aufgerufen wird. Daraus folgt die verbreitete Namenskonvention `Rtn_Start_<id>`, `Rtn_Kapitel2_<id>`, `Rtn_Tot_<id>` usw. Welche Routine gilt, hängt vom Story-Zustand ab.

Dasselbe gilt für dynamische Spawns: Deren Bedingungen sind Laufzeitzustand — Heldenlevel, Gilde, Distanz zum Waypoint, Zufallswerte, Kapitel- und Quest-Variablen.

**Konsequenz:** Ein Zeit-Slider allein liefert keine eindeutige Aussage. Eine zweite Achse wäre nötig: ein **Szenario-Kontext**, in dem der Nutzer Kapitel, Heldengilde, Heldenlevel und relevante Quest-Flags setzt. Erst Kontext + Uhrzeit ergeben einen definierten Weltzustand.

Konzeptionell ist das partielle Auswertung: Mit gesetztem Kontext lassen sich viele Bedingungen statisch entscheiden, die vorher offen waren. Was übrig bleibt — `Hlp_Random`, Distanz zum Helden — bleibt unauflösbar und ist weiterhin als „dynamisch" zu markieren statt zu raten (siehe Grenze in 5.1).

**Nutzen, falls umgesetzt:** Presets wie „Kapitel 1, Startzustand" oder „Kapitel 4, Held ist Magier" werden zum Testwerkzeug. Durch die Kapitel klicken und sehen, ob ein Lager plötzlich leer ist oder ein NPC nach dem Wechsel auf einem inzwischen gelöschten Waypoint steht.

**Vorgabe an die Architektur:** Der Weltzustand, gegen den ausgewertet wird, sollte von Anfang an ein explizites Objekt sein — auch wenn es in Phase 1 nur den konstanten Startzustand enthält. Dann ist die spätere Erweiterung ein Austausch dieses Objekts und kein Umbau der Auswertungslogik.

**Offen:** Ob die Konvention `Rtn_<name>_<id>` in Mods zuverlässig eingehalten wird, oder ob die Zuordnung Routine → Kontext aus den `Npc_ExchangeRoutine`-Aufrufstellen rekonstruiert werden muss. Letzteres ist robuster, aber aufwendiger.

---

## 6. UI-Basis: Godot-Plugin vs. eigenständige Anwendung

### Option A — Godot-Editor-Plugin (empfohlen für Phase 1)

GDExtension in C++ oder Rust, bindet ZenKit ein, importiert ZEN-Welten als Godot-Szenen.

*Vorteil:* Gizmos, Undo-Stack, Szenenbaum, Asset-Browser, Docking — alles vorhanden. Der Aufwand beschränkt sich auf Gothic-spezifische Logik.

*Risiko:* **Round-Trip-Treue.** ZEN enthält Strukturen ohne Godot-Gegenstück (BSP-Baum, Portale, VOB-spezifische Flags, Waynet). Diese müssen entweder als Metadaten an den Nodes mitgeführt oder unverändert aus der Quell-ZEN durchgereicht werden. **Das ist die zentrale Architekturfrage für Option A und muss vor Implementierungsbeginn geklärt sein.**

*Koordinatensystem:* ZenGin und Godot unterscheiden sich in Handedness und Einheiten. Die Konvertierung muss zentral, verlustfrei und in beide Richtungen getestet sein — nicht verstreut über die Codebasis.

### Option B — Eigenständige Anwendung (ImGui + eigener Renderer)

Mehr Aufwand, volle Kontrolle, kein Impedance-Mismatch beim Round-Trip. OpenGothics ZenKit-basierter Renderer wäre eine mögliche Grundlage.

**Empfehlung:** Phase 1 als Godot-Plugin, sofern das Metadaten-Durchreichen sauber lösbar ist. Der Round-Trip-Test aus Abschnitt 9 entscheidet das früh und objektiv.

---

## 7. Weitere Constraints und Fallstricke

- **Vertex-Lighting.** Die Beleuchtung wird über „Compile Light" ins Weltmesh gebacken. Verschobene oder geänderte Licht-VOBs erfordern ein erneutes Backen — der Editor muss diesen Zustand als „stale" kennzeichnen, statt stillschweigend falsche Beleuchtung anzuzeigen.
- **Savegame-Bruch.** Geänderte ZENs invalidieren bestehende Spielstände. Der Editor sollte davor warnen, wenn Welten bearbeitet werden, für die Saves existieren.
- **G1/G2-Versionsunterschiede.** ZEN-Archivversionen und VOB-Felder unterscheiden sich zwischen Gothic 1 und Gothic 2 (und nochmals bei Night of the Raven). Die Zielversion muss explizit pro Projekt gesetzt werden, nicht geraten.
- **Binärkompatibilität.** OpenGothic ist nicht binärkompatibel zum Original; mit dem AST-SDK erstellte Mods und der DirectX11-Mod funktionieren dort nicht. Falls OpenGothic als Preview-Runtime dient, ist das eine Einschränkung, keine Blockade — aber sie muss dokumentiert sein.
- **Lizenzen.** KrxImpExp steht unter GPLv3. Bei Einbindung oder Ableitung ist die Lizenzkompatibilität des Gesamtprojekts zu prüfen. ZenKit-Lizenz separat verifizieren.
- **Keine Assets ausliefern.** Wie OpenGothic setzt der Editor eine legale Gothic-Installation voraus und bringt keine Spieldaten mit.

---

## 8. Zusätzliche Chance: Preview-Runtime

Da OpenGothic dieselbe Datenschicht nutzt, ist ein „Play from here"-Button realistisch: aktuelle ZEN speichern, OpenGothic mit Startposition an der Editor-Kamera starten. Das würde den Iterationszyklus (heute: Speichern, Spiel starten, hinlaufen) massiv verkürzen. Nicht Phase 1, aber die Architektur sollte es nicht verbauen.

---

## 9. Akzeptanzkriterien

**Gate 1 — Round-Trip-Fidelity (blockierend für alles Weitere)**

Original-ZEN laden, ohne jede Änderung speichern, Ergebnis mit dem Original vergleichen. Byte-Identität ist wünschenswert; wo sie formatbedingt nicht erreichbar ist (Reihenfolge, Padding), muss ein semantischer Vergleich zeigen, dass VOB-Baum, Materialien, BSP-Daten und Waynet unverändert sind.

Dieser Test läuft gegen alle Original-Welten von Gothic 1 und Gothic 2 inklusive aller Parts. Solange er nicht durchläuft, ist keine Editier-Funktionalität vertrauenswürdig.

**Gate 2 — Spielbarkeit**

Eine über den Editor veränderte Welt (VOB verschoben, Item hinzugefügt) startet in OpenGothic *und* im Original-Gothic ohne Fehler und verhält sich wie erwartet.

**Gate 3 — Validierung**

Die Portal-Checks aus 4.1 erkennen einen künstlich eingebauten Fehler jeder gelisteten Kategorie, bevor kompiliert wird.

---

## 10. Offene Fragen für die Architekturausarbeitung

1. Godot-Plugin oder eigenständig? Entscheidung anhand von Gate 1.
2. Wie werden nicht-abbildbare ZEN-Strukturen im Zwischenmodell gehalten — Passthrough-Blob oder vollständiges Datenmodell?
3. Sprache/Bindings: ZenKit direkt in C++, oder über die C#-/Rust-Schiene?
4. Wie wird der Tree-sitter-Parser eingebunden — In-Process-Bibliothek oder Language-Server über LSP?
5. Projektdatei-Format: Wie werden Part-Zuordnung, Zielversion (G1/G2/NotR) und Pfade zur Gothic-Installation persistiert?
6. Multi-User: Soll der Part-Split als Kollaborationsmechanismus erhalten bleiben, oder ist ein anderes Modell (Locking, Merge) vorgesehen?
