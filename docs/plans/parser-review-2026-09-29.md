# Code Review: Daedalus Dialog Suite Parser

## Ergebnis nach Fixes

Alle sechs Befunde sind behoben. R6 kam im Upstream zwischenzeitlich an; R1–R5
wurden anschließend lokal mit Regressionstests und minimalen Parserkorrekturen
geschlossen:

- R1: Bei verschachtelten Bedingungen mit innerem OR wechselt die Funktion in
  Raw-Modus; reine UND-Ketten bleiben strukturiert.
- R2: Operanden unter einem bereits erfassten unären Ausdruck werden nicht
  nochmals als einzelne Conditions aufgenommen.
- R3: Binäre Guards, die das strukturierte Condition-Modell nicht abbildet,
  erhalten den vollständigen Originalblock im Raw-Modus.
- R4: Ein nichttriviales, unbedingtes TRUE-Return auf Funktionsebene löst Raw-
  Modus aus und bewahrt die gesamte Kontrollflussfolge.
- R5: Binär- und Zuweisungsoperatoren werden anhand des Tokens statt der
  Kinderposition gesucht, damit Kommentar-Kinder den Operator nicht verdecken.
- R6: Stringliteral-Information bleibt bis zur Codegenerierung erhalten.

Nachprüfung: ursprünglicher Testlauf mit allen Regressionen: **307 bestanden**;
`npm run lint`, `npm run typecheck` und `git diff --check` erfolgreich. Keine
Engine-Ausführung.

## Frühere Nachprüfung nach Pull am 2026-09-29

Aktueller Remote-Stand: `5c472f0` mit Parser-Fix `6d61921`.
Alle sechs ursprünglichen Reproduktionen wurden nach erneutem TypeScript-Build ausgeführt.

| Befund | Aktueller Status |
|---|---|
| R1: Verschachtelte if-Blöcke mit innerem OR | Weiterhin reproduzierbar |
| R2: Doppelte Operanden bei Negation | Weiterhin reproduzierbar |
| R3: Verlorene Bitmasken-Prüfung | Weiterhin reproduzierbar |
| R4: Gelöschtes abschließendes TRUE-Return | Weiterhin reproduzierbar |
| R5: Kommentar statt Zuweisungsoperator | Weiterhin reproduzierbar |
| R6: Stringliteral verliert Quotes | Behoben; Reproduktion jetzt regulärer Regressionstest |

Der neue Fix für tief verschachtelte logische Ausdrücke bewahrt beispielsweise
`((A || B) && C) && D`. Das ist ein anderer Fall als R1, bei dem zwei verschachtelte
if-Statements kombiniert werden. Auch die Projektion einer gemeinsam verwendeten
Information-Funktion auf mehrere Dialoge wurde behoben; die neuen Upstream-Tests
für beide Fälle bestehen.

Verifikation: 301 reguläre Upstream-Tests bestanden; von den sechs lokalen
Review-Reproduktionen besteht R6, während R1–R5 weiterhin fehlschlagen und als
TODO markiert bleiben. Lint und Typecheck erfolgreich. Kein Engine-Test.

Präzisierung zu R5: Der Operatorverlust ist bestätigt. Der permissive Syntaxparser
akzeptiert `value /* note */ 1;` weiterhin; der konkrete Nachweis ist daher die
zerstörte Zuweisung, nicht eine vom eigenen Parser gemeldete Syntaxverletzung.

Die folgenden Abschnitte dokumentieren die ursprüngliche Prüfung vor diesem Pull.

Geprüfter Stand: `cbe10c3c03b0c5f3d20c665da63a29e34587b21a` (`master`).
Scope: `daedalus-parser`, insbesondere Grammar, semantische Besucher, Conditions und Codegen. Kein PR-Diff; Review des aktuellen Zustands. Keine Implementierung geändert und nichts auf GitHub veröffentlicht.

## Ergebnis

Sechs unabhängig reproduzierte Fehler verändern beim Roundtrip die Programmbedeutung oder erzeugen ungültigen Code. Alle folgenden Condition-Beispiele wurden in diesem vollständigen Kontext geprüft:

```daedalus
instance D(C_INFO) { condition = Cond; };
func int Cond() { /* hier den jeweiligen Eingabeblock einsetzen */ };
```

Die Eingaben werden ohne Syntaxfehler akzeptiert. Generierung erfolgt über `parseSemanticModel` und `SemanticCodeGenerator.generateFunction` mit ausgeschalteten Kommentaren/Section-Headers; `preserveSourceStyle` bleibt auf seinem Standardwert `true`.

## R1 — P1: Verschachtelte Bedingungen verlieren ihre Verknüpfung

Stelle: `daedalus-parser/src/semantic/visitors/linking-visitor.ts:382–389`.

Eingabe: `if (A) { if (B || C) { return TRUE; }; };`

Ausgabe: `if (A || B || C) { return TRUE; };`

`maybeSetConditionOperator` überschreibt den funktionsweiten Operator auch für einen verschachtelten `if`. Die flache Condition-Liste verliert damit die notwendige äußere UND-Verknüpfung. Bei `A=0, B=1, C=0` wird ein ursprünglich gesperrter Dialog freigegeben. Verschachtelte Kontrollflüsse müssen als Baum modelliert oder vollständig im Raw-Modus erhalten werden.

## R2 — P1: Negierte Ausdrücke werden zusätzlich in ihre Operanden zerlegt

Stelle: `daedalus-parser/src/semantic/visitors/linking-visitor.ts:352–365`.

Eingabe: `if (!(A || B)) { return TRUE; };`

Ausgabe: `if (!(A || B) && A && B) { return TRUE; };`

Der vollständige unäre Ausdruck wird als generische Condition gespeichert; der Visitor läuft anschließend weiter in seine Kinder und nimmt `A` und `B` zusätzlich auf. Die erzeugte Bedingung ist nie wahr. Nach Übernahme eines vollständigen Ausdrucks dürfen seine Nachfahren nicht erneut als eigenständige Conditions erfasst werden.

## R3 — P1: Bitmasken-Prüfungen verschwinden vollständig

Stelle: `daedalus-parser/src/semantic/visitors/linking-visitor.ts:337–345`.

Eingabe: `if (flags & 1) { return TRUE; };`

Ausgabe: `return TRUE;`

Nichtvergleichende binäre Ausdrücke werden hier nicht übernommen. Zugleich werden ihre Operanden durch `hasNonLogicalBinaryAncestor` unterdrückt. Das leere Condition-Modell führt im Generator zum unbedingten TRUE-Return. Nicht strukturierbare Ausdrücke benötigen einen vollständigen Raw-Fallback, bevor ein leeres Modell generiert wird.

## R4 — P1: Ein abschließendes unbedingtes TRUE-Return wird gelöscht

Stelle: `daedalus-parser/src/semantic/visitors/linking-visitor.ts:256–263`.

Eingabe: `if (A) { return TRUE; }; return TRUE;`

Ausgabe: `if (A) { return TRUE; };`

Obwohl `isTrivialTopLevelTrueReturn` bei vorhandenen Conditions false liefert, endet derselbe Zweig danach trotzdem mit `return true` und überspringt das Statement. Die ursprünglich bedingungslos erfolgreiche Funktion hängt nach dem Speichern von `A` ab. Nichttriviale Top-Level-Returns müssen den Raw-Modus auslösen.

## R5 — P2: Inline-Kommentare werden als Operator gelesen

Stelle: `daedalus-parser/src/semantic/parsers/ast-constants.ts:14–21`; zusätzlich positionelle Operanden in `condition-parsers.ts:65–68`.

Eingabe: `func void F() { value /* note */ += 1; };`

Ausgabe im Funktionskörper: `value /* note */ 1;`

Tree-sitter liefert Kommentare als zusätzliche Kinder. `child(1)` ist in diesem Fall der Kommentar statt `+=`. Die Ausgabe enthält einen Syntaxfehler. Auch `if (A /* note */ == 1) { return TRUE; };` verliert seine Bedingung und wird zu `return TRUE;`. Operatoren und Operanden müssen unabhängig von Kommentarpositionen gelesen werden, z. B. über benannte Grammar-Felder bzw. gefilterte Tokens.

## R6 — P2: Stringvergleiche verlieren ihre Anführungszeichen

Stelle: `daedalus-parser/src/semantic/parsers/condition-parsers.ts:306–310`; Ausgabe in `VariableCondition.generateCode`.

Eingabe: `if (name == "Hero") { return TRUE; };`

Ausgabe: `if (name == Hero) { return TRUE; };`

`normalizeStringLiterals: true` entfernt die Quotes; die VariableCondition speichert keine Information mehr, dass der Wert ein Stringliteral war. Codegen setzt den Text ungequotet ein. Dadurch entsteht eine Symbolreferenz statt eines Literals. Den Rohtext oder einen expliziten Literaltyp bis zur Generierung erhalten.

## Verifikation und Grenzen

- Ursprüngliche Tests: **296 bestanden, 0 fehlgeschlagen** (`npm test`).
- `npm run lint` und `npm run typecheck`: erfolgreich.
- Sechs zusätzliche ausführbare Reproduktionen: `daedalus-parser/test/review-condition-fidelity.test.js`. Alle sechs Assertions schlagen auf dem geprüften Stand erwartungsgemäß fehl. Sie sind ausdrücklich als TODO markiert, damit der bestehende Testlauf nicht rot wird. TODO beim jeweiligen Fix entfernen.
- R1–R4 prüfen die Wahrheitstabellen der konkreten Beispiele. Dafür wird nur der hier zwischen JavaScript und Daedalus gemeinsame Ausdrucks-/Kontrollfluss verwendet; dies ist kein Gothic-Engine-Test.
- R5 prüft auch, dass die generierte Ausgabe erneut syntaktisch gültig sein müsste; R6 prüft den Erhalt des Literals.
- Der native Build gelang mit separat entpackten Node-24.19.0-Headern, nachdem node-gyp zunächst am lokalen `fchown` beim Entpacken scheiterte.
- Keine Gothic-Laufzeit und kein externer Mod-/Retail-Korpus verfügbar; keine Aussage über vollständige Sprachabdeckung oder Engine-Kompatibilität.
- Die offenen Repository-Issues wurden gelesen. Diese Review-Befunde sind lokal in diesem Dokument und den Reproduktionen festgehalten; es wurden keine Issues, Kommentare oder PRs veröffentlicht.

Empfohlene Reihenfolge: zuerst die vier Kontrollfluss-/Condition-Verluste beheben, dann kommentarrobuste AST-Auswertung und Erhalt von Stringliteral-Typen. Jeder Fix sollte den zugehörigen TODO-Test zu einem normalen Regressionstest machen.
