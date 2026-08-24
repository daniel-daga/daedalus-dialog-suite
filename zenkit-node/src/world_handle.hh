// The opaque handle wrapped in the External returned by loadWorld().
#pragma once

#include <zenkit/Archive.hh>
#include <zenkit/Misc.hh>
#include <zenkit/World.hh>

#include <cstdint>
#include <memory>
#include <string>

namespace zenkit_node {

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
};

}  // namespace zenkit_node
