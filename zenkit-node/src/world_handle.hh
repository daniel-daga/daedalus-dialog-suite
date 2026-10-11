// The opaque handle wrapped in the External returned by loadWorld().
#pragma once

#include <zenkit/Archive.hh>
#include <zenkit/Misc.hh>
#include <zenkit/World.hh>

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace zenkit_node {

// A subtree `deleteVob` took out of the world and kept, so that `restoreVob`
// can put it back (level-editor.md §7).
//
// **It is the VOB itself, not a description of one.** The delete used to drop
// the last `shared_ptr` to the subtree, which is what made it uninvertible: a
// retail VOB carries per-class properties, children, an AI and an event manager
// that no op in `zen-world` describes, so an inverse built out of the fields
// anything here catalogues would restore a bare `zCVob` wearing the right name.
// Holding the pointer instead sidesteps the whole question — what comes back is
// what left, including the members nothing in this repo has ever named.
//
// It costs no memory a delete had not already spent: the subtree was resident
// before the call and this only declines to free it. It lives and dies with the
// handle, which is exactly when the history stacks that address it are cleared.
struct RetainedVob {
  // Where it came from, as the parsed index path — `restoreVob`'s guard, and
  // the reason no token has to cross a process boundary.
  std::vector<std::size_t> path;
  std::shared_ptr<zenkit::VirtualObject> vob;
};

// Everything needed to later re-save the world faithfully: the parsed world,
// the game version it was loaded as, the archive format of the source file and
// the top-level "oCWorld:zCWorld" wrapper object's name + version word.
struct WorldHandle {
  std::shared_ptr<zenkit::World> world;
  zenkit::GameVersion version;
  zenkit::ArchiveFormat format;
  std::string root_object_name;
  std::string root_class_name;
  std::uint16_t root_version;
  // The retained subtrees, newest last. A stack rather than a map because the
  // history is well nested: `WorldService` replays batches strictly LIFO and a
  // delete is alone in its batch, so a restore always wants the most recent
  // delete. `restoreVob` checks the path anyway — a mismatch means the history
  // and the world have disagreed about something, which is worth a refusal
  // rather than putting a subtree back in a slot it never occupied.
  std::vector<RetainedVob> retained;
};

}  // namespace zenkit_node
