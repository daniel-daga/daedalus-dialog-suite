# Gate 2b run sheet — the ops candidate `03` never saw

Built 2026-08-28 by `node tools/mutate.js <outDir>`, against retail NewWorld
(`b4dac867…`). Candidate `03` of the 2026-08-25 pass was built on 2026-08-27,
and **seven ops plus twenty-six authorable classes have landed since**
(`docs/plans/level-editor.md` §16.2). This sheet is what turns them into a
verdict.

The record of what *has* passed is
[`engine-acceptance-2026-08-25.md`](engine-acceptance-2026-08-25.md). Nothing
here is claimed until it is run.

> **Run 2026-08-28. Result in the acceptance record, *"Gate 2b — the run"*.**
> Every candidate loaded and played; most of the observation rows below could
> not be judged in retail NewWorld — the ambient fog and the live soundscape
> mask them, and the chest was never found.
>
> **`06` answered it on 2026-08-29 and every row of it passed** — red fog, the
> carried sound radius, and an authored chest the player opens.
>
> **`07a`/`07b`/`07c` were built 2026-08-29 and have NOT been run.** They are
> `05`'s own two observation rows in `06`'s frame — the last thing this sheet
> leaves unwitnessed. Until somebody plays them, `05` is still "loads and
> plays" and nothing more.

## Running it

```
node tools/mutate.js C:\path\to\cand
powershell -ExecutionPolicy Bypass -File tools/engine-batch.ps1 -Exe Gothic2 -Dir C:\path\to\cand
```

Fullscreen — windowed crashes on this machine (Environment). The script installs
each `*.zen` in name order as `NewWorld.zen`, waits for the engine, and restores
the pristine backup afterwards.

**`00` runs first and must pass, in the same session.** A control that was not
run is not a control, and every row below is an A/B against it. `-Only 00,03`
narrows the batch without losing that rule — run `00` in any subset.

Candidates `03`–`05` are each built **from the pristine source**, not from the
one before, so a failure localizes to one domain instead of implicating the
whole op set.

---

## 03 — class properties, the edits only the engine can witness

The gap §16.2 calls the sharpest: `SetVobClassProp` has never run in an engine at
all, and a sound or a fog zone written wrongly is **invisible in the viewport**.

| What changed | Where | Look for |
|---|---|---|
| `zCZoneZFog` → `rangeCenter` 16000→4000, `overrideColor` on, colour red | `2/597`, ~2000 units from START | **Red fog closing in.** The most decisive row on the sheet |
| `zCVobSound` → `radius` 600→5000 | `2/1266`, a TORCH_BURN | Torch crackle audible right across the clearing, not only at the torch |
| `oCZoneMusic` → `volume` 1→0.15, all three | `2/37`, `2/38`, `2/39` (XARDAS_XAR) | Tower music much quieter. All three changed, or the others would mask it |
| `SetVobProp` → `dynamicShadows`, `presetName`, `bias` | `2/70`, a big flat rock | Nothing specific. These keys' claim is that a world carrying them still loads and behaves |

**If the fog does not change:** first check you are inside the zone before
calling it a failure — that row is inconclusive from outside it, not negative.

## 04 — the classes I1–I5 taught `AddVob` to build

`AddVob` is on Gate 2's list, but the engine has seen it author a bare `zCVob`
and an `oCItem`. It now authors 27 classes. Everything below is placed within
~300 units of START, so one look covers the lot.

| VOB | Look for |
|---|---|
| `GATE2B_CHEST` (`oCMobContainer`, unlocked) | **Opens.** Empty — the contents list is not catalogued — but it must open. This is row 7 for a VOB the editor made |
| `GATE2B_LIGHT` (`zCVobLight`, magenta, range 1500) | A magenta cast no retail light in the tower would explain |
| `GATE2B_SOUND` (`zCVobSound` + `soundName` after) | Torch crackle where no torch is. Tests place-then-configure, which is what a user actually does |
| `GATE2B_PFX` (`zCPFXController`, `LIGHTCONE.PFX`) | A light cone. The effect is already in this world, so nothing visible means our writer, not a missing asset |
| `GATE2B_TRIGGER`, `GATE2B_MOVER`, `GATE2B_DOOR`, a music zone | Nothing. **`target` is not authorable** (§16.15), so a trigger fires at nothing — their claim is only that the world still loads and behaves with them in it |

A locked chest was deliberately not authored: it needs a key or pick string the
catalogue cannot write, so it would be unopenable rather than a test.

## 05 — the subtree delete, and all five waynet ops

| What changed | Look for |
|---|---|
| `DeleteVob` on `2/1248` — a wall torch **and its five children** (lens flare, two lights, two particle effects), 318 units from START | **The whole torch is gone**: no post, no flame, no glow, no crackle. A partial removal is the interesting failure |
| `AddWaypoint` `GATE2B_WP`, two edges, renamed to `GATE2B_WP_RENAMED`, then moved, then one edge removed | Nothing directly visible. Covered by the row below |
| `RemoveWaypoint` on `NW_XARDAS_TOWER_IN1_32` — a leaf **no script names**, renumbering the 2,895 waypoints after it | **NPC routines still work.** Xardas still walks to his bookstand and reads (`TA_Read_Bookstand`, `NW_XARDAS_TOWER_IN1_28`); Lester still sleeps at `..._31` |

The deleted waypoint is named by no script on purpose: a broken route then
implicates the writer, not a routine that lost its waypoint.

**Why NPC pathing is the waynet assertion.** Renumbering is the risk the whole
waynet op set carries — §16.7 answered `DeleteWaypoint` with a history barrier
rather than a stable-identity scheme — and routines are the only in-engine
witness to a net that renumbered wrongly.

---

## 06 — the same edits, in a frame they can be seen in

Built 2026-08-28, **after** `03`–`05` came back "loads and plays" with almost
nothing observed. It is the answer to why: retail NewWorld masks every signal the
sheet asks for. This candidate clears the spawn's neighbourhood first and then
puts the edits where the hero is already looking.

A genuinely minimal *world* is not reachable — the game boots NewWorld through a
script layer that spawns every NPC at `NW_*` waypoints, so swapping the file
breaks the scripts rather than the scenery. A minimal *frame* is, and it is the
same experiment.

**What it clears:** every `zCVobLight`, `zCVobSound`, `zCVobSoundDaytime` and
`zCPFXController` within 6,000 units of START, plus **every** `zCZoneZFog` in the
world (a zone's position says nothing about the volume its box covers, so a
distant one can still be the one you are standing in). Measured: 239 VOBs — 196
lights, 37 sounds, 6 fog zones — and **zero** of any other class. `oCMobFire` is
deliberately kept: a fire is an interactive mob a routine can name, and its light
and particle children are separate VOBs that go without it. The world's own
`zCZoneZFogDefault` is not a placed VOB and survives, so the control still looks
normal.

| What to look for | Where |
|---|---|
| **The screen is red.** An authored `zCZoneZFog`, its own 8,000-unit box centred on the spawn, `rangeCenter` 3,000, `overrideColor` on, pure red. `AddVob` builds the zone; **`SetVobClassProp` is the only thing that makes it red** — a grey world here is that op failing, and it is the one row nothing else on this sheet can substitute for | you spawn inside it |
| **A chest, dead ahead, and it opens.** `GATE2B_MIN_CHEST`, `oCMobContainer`, unlocked. 250 units along START's own direction vector, with nothing else within 250 units of it — `04`'s chest was placed on a guessed axis and was never found. **The only row still open**, and it took four fixes to get here: `showVisual` (a real `insertVob` defect), a measured bbox, a ground snap and a `focusName` | first frame |
| **A torch crackle with no torch.** `GATE2B_MIN_SOUND` sits 3,000 units ahead with `radius` 8,000, in a frame where every other sound is gone. Audible at the spawn **only if the radius reached the file** — a binary, not a loudness judgement | from the spawn, without moving |
| Magenta light overhead | already confirmed in the 2026-08-28 run; kept because the frame's own lights were just deleted and this is what lights the chest |

**The music-volume row is deliberately absent.** Two music themes, or the same
theme at two volumes, are not a judgement a person can make reliably in a live
world — that row failed in the first run for a reason no candidate fixes. Whatever
witnesses `oCZoneMusic.volume` will not be an ear, and it is left unclaimed rather
than tested badly.

**Known residue, not a defect:** fires survive by design, so a `FIRE_MEDIUM.pfx`
and its decals still burn about 340 units from the chest. Their light and sound
children are gone, so they glow and do not crackle.

---

## 07 — `05`'s two observation rows, in a frame they can be seen in

Built 2026-08-29, after `06` proved the instrument. `05` loaded and played and
was observed at nothing: the torch it deletes was one of ~196 lights inside the
spawn's neighbourhood, and the waypoint renumber was never watched at all. These
three are `06`'s frame pointed at those two rows.

`-Only 00,07` runs the control and all three — `engine-batch.ps1` matches the
first two characters of the filename, so `07a`, `07b` and `07c` are one subset.

### 07a / 07b — the subtree delete, and its own A/B

**The pair is the experiment.** `07a` clears the frame and *keeps* the torch;
`07b` clears the same frame and then deletes the torch subtree with one
`DeleteVob`. One difference between two files, and `00` cannot serve as the
control here: in retail that torch is one light among hundreds and picking it
out is the whole problem.

**What they clear:** every `zCVobLight`, `zCVobSound`, `zCVobSoundDaytime` and
`zCPFXController` within 6,000 units of START **except the torch subtree** —
230 paths, 231 VOBs with their children. Fog is deliberately left alone: the
ambient range is 16,000 units and the torch is 318 away, so no zone can hide
this row, and clearing them would be a second difference from `00` for nothing.

| Candidate | What you should see at the wall, 318 units from the spawn |
|---|---|
| `07a` | **One torch, burning, alone.** Post, flame, sparks, flare, and the only two lights left in the frame. Everything else that lit or sounded near the spawn is gone |
| `07b` | **Nothing there.** No post, no flame, no sparks, no flare, no glow. **A partial removal is the interesting failure** — a flame with no post, a glow with no flame — and this frame is what makes one visible |

**Look at the right torch.** `2/76` is the same wall-torch model 102 units away
in plan and **884 units lower** — a second storey of the same wall. It keeps its
post, flame and flare in both candidates (its two lights are cleared with the
rest of the frame), so a torch still burning *below* the one under test is the
control working, not the delete failing. This trap found the assertion before it
found a person: an XZ-only proximity check counted ten pieces of torch where
six were expected.

**The frame's other fires still show a flame.** A torch's flame and sparks are
plain `zCVob`s carrying `FIRE_MEDIUM.pfx` and `FIRE_SPARKS.pfx` visuals, not
`zCPFXController`s, so the clearing does not take them. What makes the test
torch the only *lit* thing in the frame is its two `zCVobLight` children — the
same reason `06` leaves fires burning.

### 07c — the renumber, and nothing else

`RemoveWaypoint` on `NW_XARDAS_TOWER_IN1_32` (index 63), renumbering the 2,895
waypoints after it. **No VOB is touched and no other waynet op runs**: `05`
bundled this with a subtree delete and four other waynet edits, so a broken
routine there would have implicated six changes at once. Here it can only be
the renumber.

| What to do | Look for |
|---|---|
| Go to Xardas's tower and watch | **Xardas still walks to his bookstand and reads** — `TA_Read_Bookstand` at `NW_XARDAS_TOWER_IN1_28`. **Lester still sleeps** at `..._31` |

Both waypoints are asserted present in the saved file, and both sit *before* the
deleted one in stored order — so they do not move, and what has to survive is a
route computed across 2,895 waypoints that did. The deleted waypoint is named by
no script on purpose: a broken route then implicates the writer, not a routine
that lost its waypoint.

**Verified before the engine sees it:** 2,959 → 2,958 waypoints, the deleted
name absent, both watched names present, `danglingEdges` 0, and the VOB count
unchanged at 23,288 — which is the "nothing else" claim, checked rather than
asserted.

---

## What was verified before the engine ever ran

Every candidate was reloaded and asserted, not merely written
(2026-08-28): in `06` exactly one fog zone survives and it is ours, no light or
sound VOB is left inside the 6,000-unit frame, and the fog's `overrideColor` and
`rangeCenter`, the sound's `radius` and `soundName`, and the chest's `locked`
all read back off the saved file; all four `03` writes read back; all seven `04` VOBs carry the
class and the properties asked for; and in `05` the torch subtree is **exactly
six VOBs** lighter, the renamed waypoint survives at its moved position with
**exactly one** surviving edge, the deleted waypoint is absent, and
`danglingEdges` is 0.

`07a`/`07b`/`07c` are asserted the same way and it paid twice: the torch's six
pieces are all standing in `07a` and none in `07b`, both counted by full 3D
proximity after the second wall torch 884 units below was mistaken for them; the
frame holds exactly the torch's two lights in `07a` and nothing in `07b`; the
VOB total is checked against the deleted paths **plus their children**, which is
231 VOBs for 230 paths and not the 230 the first version expected; and `07c`
loses exactly one waypoint, keeps both names its routines use, ends with no
dangling edge and changes no VOB at all.

So a failure in the engine is a fidelity or semantics failure, not a write that
never happened.

**One trap this build found, recorded so the next one does not repeat it:**
waynet indices are `getWaynet`'s, and `normalizeWorld` orders its waypoints
differently. Measuring against the wrong list addresses a waypoint on the far
side of the map. The ops' index+name guard is what caught it — it refused the
edge rather than joining the wrong pair, and it should never be weakened.
