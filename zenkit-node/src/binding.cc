// N-API binding around ZenKit (docs/plans/level-editor.md §4).
#include <napi.h>

#include <zenkit/Archive.hh>
#include <zenkit/Misc.hh>
#include <zenkit/Stream.hh>
#include <zenkit/World.hh>
#include <zenkit/vobs/VirtualObject.hh>
#include <zenkit/world/WayNet.hh>

#include <cstddef>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "encoding.hh"
#include "fixture.hh"
#include "zenkit-version.h"

namespace {

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

zenkit::GameVersion ParseGameVersion(Napi::Env env, Napi::Value value) {
  if (!value.IsString()) {
    throw Napi::TypeError::New(env, "gameVersion must be 'g1' or 'g2'");
  }
  std::string const str = value.As<Napi::String>().Utf8Value();
  if (str == "g1") return zenkit::GameVersion::GOTHIC_1;
  if (str == "g2") return zenkit::GameVersion::GOTHIC_2;
  throw Napi::TypeError::New(env, "gameVersion must be 'g1' or 'g2', got '" + str + "'");
}

char const* GameVersionName(zenkit::GameVersion version) {
  return version == zenkit::GameVersion::GOTHIC_1 ? "g1" : "g2";
}

std::filesystem::path PathFromValue(Napi::Env env, Napi::Value value) {
  if (!value.IsString()) {
    throw Napi::TypeError::New(env, "path must be a string");
  }
  // Build the path from UTF-16 so non-ASCII paths work on Windows.
  std::u16string const utf16 = value.As<Napi::String>().Utf16Value();
  return std::filesystem::path {std::wstring {utf16.begin(), utf16.end()}};
}

std::vector<std::byte> ReadFileBytes(Napi::Env env, std::filesystem::path const& path) {
  std::ifstream stream {path, std::ios::binary | std::ios::ate};
  if (!stream) {
    throw Napi::Error::New(env, "failed to open world file: " + path.string());
  }
  auto size = stream.tellg();
  stream.seekg(0, std::ios::beg);
  std::vector<std::byte> bytes(static_cast<std::size_t>(size));
  if (size > 0 && !stream.read(reinterpret_cast<char*>(bytes.data()), size)) {
    throw Napi::Error::New(env, "failed to read world file: " + path.string());
  }
  return bytes;
}

constexpr std::uint32_t kBspVersionG2 = 0x4090000;

// Mirrors ZenKit's internal determine_world_version (src/World.cc): scan the
// archive's top-level objects for "MeshAndBsp" and read the BSP version word
// that follows. Unlike ZenKit, a world without a MeshAndBsp section is an
// error here — the version is never guessed (level-editor.md §9).
zenkit::GameVersion DetectWorldVersion(zenkit::Read* r) {
  auto archive = zenkit::ReadArchive::from(r);

  if (archive->is_save_game()) {
    throw std::runtime_error {"cannot detect the world version of a save-game"};
  }

  zenkit::ArchiveObject chunk {};
  archive->read_object_begin(chunk);

  while (!archive->read_object_end()) {
    archive->read_object_begin(chunk);

    if (chunk.object_name == "MeshAndBsp") {
      auto bsp_version = r->read_uint();
      return bsp_version == kBspVersionG2 ? zenkit::GameVersion::GOTHIC_2
                                          : zenkit::GameVersion::GOTHIC_1;
    }

    archive->skip_object(true);
  }

  throw std::runtime_error {
      "cannot verify the world's game version: no MeshAndBsp section found in the archive"};
}

WorldHandle* UnwrapHandle(Napi::Env env, Napi::Value value) {
  if (!value.IsExternal()) {
    throw Napi::TypeError::New(env, "expected a world handle returned by loadWorld()");
  }
  auto* handle = value.As<Napi::External<WorldHandle>>().Data();
  if (handle == nullptr || !handle->world) {
    throw Napi::Error::New(env, "invalid world handle");
  }
  return handle;
}

Napi::Value LoadWorld(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto path = PathFromValue(env, info[0]);
  auto requested = ParseGameVersion(env, info[1]);
  auto bytes = ReadFileBytes(env, path);

  try {
    // Fail loudly on a version mismatch before parsing anything else.
    auto detect_read = zenkit::Read::from(&bytes);
    auto detected = DetectWorldVersion(detect_read.get());
    if (detected != requested) {
      throw Napi::Error::New(env,
                             std::string {"game version mismatch: world file is "} +
                                 GameVersionName(detected) + " but " + GameVersionName(requested) +
                                 " was requested (the version is never guessed)");
    }

    // Capture the archive format and the top-level wrapper object's identity
    // for later save fidelity.
    auto handle = std::make_unique<WorldHandle>();
    handle->version = requested;

    auto header_read = zenkit::Read::from(&bytes);
    auto archive = zenkit::ReadArchive::from(header_read.get());
    handle->format = archive->get_header().format;

    zenkit::ArchiveObject root {};
    if (!archive->read_object_begin(root) || root.class_name != "oCWorld:zCWorld") {
      throw Napi::Error::New(env, "expected an 'oCWorld:zCWorld' root object, got '" +
                                      root.class_name + "'");
    }
    handle->root_object_name = root.object_name;
    handle->root_class_name = root.class_name;
    handle->root_version = root.version;

    auto world_read = zenkit::Read::from(&bytes);
    handle->world = std::make_shared<zenkit::World>();
    handle->world->load(world_read.get(), requested);

    return Napi::External<WorldHandle>::New(env, handle.release(),
                                            [](Napi::Env, WorldHandle* data) { delete data; });
  } catch (Napi::Error&) {
    throw;
  } catch (std::exception const& e) {
    throw Napi::Error::New(env, std::string {"failed to load world: "} + e.what());
  }
}

void CountVobs(std::vector<std::shared_ptr<zenkit::VirtualObject>> const& vobs, std::size_t& count) {
  for (auto const& vob : vobs) {
    if (vob == nullptr) continue;
    ++count;
    CountVobs(vob->children, count);
  }
}

Napi::Value WorldStats(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);

  std::size_t vob_count = 0;
  CountVobs(handle->world->world_vobs, vob_count);

  std::size_t waypoint_count =
      handle->world->way_net != nullptr ? handle->world->way_net->points.size() : 0;

  auto stats = Napi::Object::New(env);
  stats.Set("vobCount", Napi::Number::New(env, static_cast<double>(vob_count)));
  stats.Set("waypointCount", Napi::Number::New(env, static_cast<double>(waypoint_count)));
  stats.Set("meshVertexCount",
            Napi::Number::New(env, static_cast<double>(handle->world->world_mesh.vertices.size())));
  return stats;
}

void CollectVobNames(Napi::Env env,
                     std::vector<std::shared_ptr<zenkit::VirtualObject>> const& vobs,
                     Napi::Array& out,
                     std::uint32_t& index) {
  for (auto const& vob : vobs) {
    if (vob == nullptr) continue;
    out.Set(index++, Napi::String::New(env, zenkit_node::Windows1252ToUtf16(vob->vob_name)));
    CollectVobNames(env, vob->children, out, index);
  }
}

Napi::Value VobNames(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);

  auto names = Napi::Array::New(env);
  std::uint32_t index = 0;
  CollectVobNames(env, handle->world->world_vobs, names, index);
  return names;
}

zenkit::ArchiveFormat ParseArchiveFormat(Napi::Env env, Napi::Value value) {
  if (!value.IsString()) {
    throw Napi::TypeError::New(env, "format must be 'binary', 'binsafe' or 'ascii'");
  }
  std::string const str = value.As<Napi::String>().Utf8Value();
  if (str == "binary") return zenkit::ArchiveFormat::BINARY;
  if (str == "binsafe") return zenkit::ArchiveFormat::BINSAFE;
  if (str == "ascii") return zenkit::ArchiveFormat::ASCII;
  throw Napi::TypeError::New(env, "format must be 'binary', 'binsafe' or 'ascii', got '" + str + "'");
}

// Internal: authors the checked-in golden fixture. Only invoked through the
// explicit `fixtures:regen` script.
Napi::Value AuthorFixtureWorld(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto path = PathFromValue(env, info[0]);
  auto format = ParseArchiveFormat(env, info[1]);
  auto version = ParseGameVersion(env, info[2]);

  try {
    zenkit_node::AuthorFixtureWorld(path, format, version);
  } catch (Napi::Error&) {
    throw;
  } catch (std::exception const& e) {
    throw Napi::Error::New(env, std::string {"failed to author fixture world: "} + e.what());
  }
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("zenkitVersion", Napi::String::New(env, ZENKIT_NODE_ZENKIT_VERSION));
  exports.Set("loadWorld", Napi::Function::New(env, LoadWorld));
  exports.Set("worldStats", Napi::Function::New(env, WorldStats));
  exports.Set("vobNames", Napi::Function::New(env, VobNames));
  exports.Set("_authorFixtureWorld", Napi::Function::New(env, AuthorFixtureWorld));
  return exports;
}

}  // namespace

NODE_API_MODULE(zenkit_node, Init)
