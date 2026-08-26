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
};

// Builds a tiny deterministic world with ZenKit's own writer and saves it to
// `path`. The kMinimal variant is only ever invoked through the explicit
// `fixtures:regen` script — nothing regenerates fixtures automatically.
void AuthorFixtureWorld(std::filesystem::path const& path,
                        zenkit::ArchiveFormat format,
                        zenkit::GameVersion version,
                        FixtureVariant variant = FixtureVariant::kMinimal);

// Writes the Phase 1a asset fixtures into `dir` — a proto mesh, a compiled
// zCMesh visual, a two-mipmap ZTEX, and the empty files the name-mapping tests
// need something to resolve to. Like the mesh-extraction world these are
// authored into a temp directory at test time and never checked in: they back
// no fidelity claim, so they are free to change with the extractor.
void AuthorFixtureAssets(std::filesystem::path const& dir);

}  // namespace zenkit_node
