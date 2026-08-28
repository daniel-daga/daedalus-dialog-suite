// Golden-fixture authoring (docs/plans/level-editor-phase-0.md §2 C2).
#pragma once

#include <zenkit/Archive.hh>
#include <zenkit/Misc.hh>

#include <filesystem>

namespace zenkit_node {

enum class FixtureVariant {
  // The C2 golden world (test/fixtures/minimal.g2.zen). Its bytes and its
  // normalizeWorld dump are checked in, so its content must never change
  // without an explicit, reviewed regeneration.
  kMinimal,
  // A mesh-extraction world: an n-gon, one vertex carrying two different
  // features, and an unreferenced material. Authored into a temp directory at
  // test time, never checked in — it backs no fidelity claim, so it is free to
  // change with the extractor it exercises.
  kMeshExtraction,
  // A world carrying one `oCNpc`. The golden fixture has none, which is why
  // `tools/fuzz-world.js --counts` cannot sweep the NPC reader's five element
  // counts (`numOverlays`, `numTalents`, `NumOfEntries`, `itemCount`,
  // `numInvSlots`) — a sweep only reaches the fields its fixture carries.
  // Authored into a temp directory at test time and never checked in; it backs
  // no fidelity claim.
  kNpc,
  // A world carrying one `zCCSCamera` with one trajectory keyframe and one
  // target keyframe. The golden fixture has no cutscene camera either, so
  // `tools/fuzz-world.js --counts` cannot reach the camera reader's two
  // element counts (`numPos`, `numTargets`). Authored into a temp directory at
  // test time and never checked in; it backs no fidelity claim.
  kCamera,
};

// Builds a tiny deterministic world with ZenKit's own writer and saves it to
// `path`. The kMinimal variant is only ever invoked through the explicit
// `fixtures:regen` script — nothing regenerates fixtures automatically.
//
// `packed_vobs` selects the `zCVob` write path: true is the packed `dataRaw`
// blob every checked-in fixture and every retail world uses, false is the
// unpacked one-entry-per-field form ZenGin also reads. The unpacked path has no
// other caller — `VirtualObject`'s `pack` flag is a file-static nothing else
// switches — so this argument is the only thing that exercises it.
void AuthorFixtureWorld(std::filesystem::path const& path,
                        zenkit::ArchiveFormat format,
                        zenkit::GameVersion version,
                        FixtureVariant variant = FixtureVariant::kMinimal,
                        bool packed_vobs = true);

// Writes the Phase 1a asset fixtures into `dir` — a proto mesh, a compiled
// zCMesh visual, a two-mipmap ZTEX, and the empty files the name-mapping tests
// need something to resolve to. Like the mesh-extraction world these are
// authored into a temp directory at test time and never checked in: they back
// no fidelity claim, so they are free to change with the extractor.
void AuthorFixtureAssets(std::filesystem::path const& dir);

}  // namespace zenkit_node
