// Golden-fixture authoring (docs/plans/level-editor-phase-0.md §2 C2).
#pragma once

#include <zenkit/Archive.hh>
#include <zenkit/Misc.hh>

#include <filesystem>

namespace zenkit_node {

// Builds a tiny deterministic world with ZenKit's own writer and saves it to
// `path`. Only ever invoked through the explicit `fixtures:regen` script —
// nothing regenerates fixtures automatically.
void AuthorFixtureWorld(std::filesystem::path const& path,
                        zenkit::ArchiveFormat format,
                        zenkit::GameVersion version);

}  // namespace zenkit_node
