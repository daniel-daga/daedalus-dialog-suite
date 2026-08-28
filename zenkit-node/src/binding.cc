// N-API binding around ZenKit (docs/plans/level-editor.md §4).
#include <napi.h>

#include <zenkit/Archive.hh>
#include <zenkit/Misc.hh>
#include <zenkit/Stream.hh>
#include <zenkit/World.hh>
#include <zenkit/vobs/Light.hh>
#include <zenkit/vobs/Misc.hh>
#include <zenkit/vobs/MovableObject.hh>
#include <zenkit/vobs/Sound.hh>
#include <zenkit/vobs/Trigger.hh>
#include <zenkit/vobs/VirtualObject.hh>
#include <zenkit/vobs/Zone.hh>
#include <zenkit/world/WayNet.hh>

#include <algorithm>
#include <array>
#include <cstddef>
#include <cmath>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "assets.hh"
#include "encoding.hh"
#include "fixture.hh"
#include "mesh_extract.hh"
#include "normalize.hh"
#include "world_handle.hh"
#include "zenkit-version.h"

namespace {

using zenkit_node::WorldHandle;

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

// A cursor into one `children` vector, for the iterative walks below. A VOb
// tree's depth is the file's own `childs<N>` counts, so a walk that recurses
// once per nesting level overflows the stack on a world the reader itself now
// parses and destroys fine (patches 0038 and 0039, for the same reason).
// Measured against a chain fixture: 10,000 levels are enough to kill a walk
// that builds a JS object per VOB, 40,000 to kill the cheapest one.
struct VobCursor {
  std::vector<std::shared_ptr<zenkit::VirtualObject>> const* list;
  std::size_t index;
};

void CountVobs(std::vector<std::shared_ptr<zenkit::VirtualObject>> const& vobs, std::size_t& count) {
  std::vector<VobCursor> stack {{&vobs, 0}};
  while (!stack.empty()) {
    auto& top = stack.back();
    if (top.index >= top.list->size()) {
      stack.pop_back();
      continue;
    }
    auto const& vob = (*top.list)[top.index++];
    if (vob == nullptr) continue;
    ++count;
    stack.push_back({&vob->children, 0});  // invalidates `top`
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
  std::vector<VobCursor> stack {{&vobs, 0}};
  while (!stack.empty()) {
    auto& top = stack.back();
    if (top.index >= top.list->size()) {
      stack.pop_back();
      continue;
    }
    auto const& vob = (*top.list)[top.index++];
    if (vob == nullptr) continue;
    out.Set(index++, Napi::String::New(env, zenkit_node::Windows1252ToUtf16(vob->vob_name)));
    stack.push_back({&vob->children, 0});  // invalidates `top`
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

// The waynet as a drawable graph; see src/normalize.cc.
Napi::Value GetWaynet(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  try {
    return zenkit_node::WayNetGraph(env, *handle);
  } catch (Napi::Error&) {
    throw;
  } catch (std::exception const& e) {
    throw Napi::Error::New(env, std::string {"failed to read the waynet: "} + e.what());
  }
}

// The VOB enumeration the render path uses instead of the dump; see
// src/normalize.cc.
Napi::Value VobIndex(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  try {
    return zenkit_node::VobIndex(env, *handle);
  } catch (Napi::Error&) {
    throw;
  } catch (std::exception const& e) {
    throw Napi::Error::New(env, std::string {"failed to index vobs: "} + e.what());
  }
}

// The phase-0 §3 dump. Reads only from ZenKit's parsed load-path structs;
// see src/normalize.cc.
Napi::Value NormalizeWorld(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  try {
    return zenkit_node::NormalizeWorld(env, *handle);
  } catch (Napi::Error&) {
    throw;
  } catch (std::exception const& e) {
    throw Napi::Error::New(env, std::string {"failed to normalize world: "} + e.what());
  }
}

// extractWorldMesh(handle) — render-ready world-mesh buffers chunked by
// material; see src/mesh_extract.cc.
Napi::Value ExtractWorldMesh(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  try {
    return zenkit_node::ExtractWorldMesh(env, *handle);
  } catch (Napi::Error&) {
    throw;
  } catch (std::exception const& e) {
    throw Napi::Error::New(env, std::string {"failed to extract world mesh: "} + e.what());
  }
}

// T7 drill — _drillMesh(handle, {offset, limit}?). Windowed per-polygon mesh
// geometry; see src/normalize.cc DrillMesh.
Napi::Value DrillMesh(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);

  std::size_t offset = 0;
  std::size_t limit = handle->world->world_mesh.geometry.size();
  if (!(info[1].IsUndefined() || info[1].IsNull())) {
    if (!info[1].IsObject()) {
      throw Napi::TypeError::New(env, "window must be an object like {offset, limit}");
    }
    auto window = info[1].As<Napi::Object>();
    auto read_size = [&env, &window](char const* key, std::size_t fallback) {
      Napi::Value const value = window.Get(key);
      if (value.IsUndefined() || value.IsNull()) return fallback;
      if (!value.IsNumber()) {
        throw Napi::TypeError::New(env, std::string {"window."} + key +
                                            " must be a non-negative number");
      }
      double const number = value.As<Napi::Number>().DoubleValue();
      if (number < 0) {
        throw Napi::TypeError::New(env, std::string {"window."} + key +
                                            " must be a non-negative number");
      }
      return static_cast<std::size_t>(number);
    };
    offset = read_size("offset", offset);
    limit = read_size("limit", limit);
  }

  try {
    return zenkit_node::DrillMesh(env, *handle, offset, limit);
  } catch (Napi::Error&) {
    throw;
  } catch (std::exception const& e) {
    throw Napi::Error::New(env, std::string {"failed to drill mesh: "} + e.what());
  }
}

char const* ArchiveFormatName(zenkit::ArchiveFormat format) {
  switch (format) {
    case zenkit::ArchiveFormat::BINARY:
      return "binary";
    case zenkit::ArchiveFormat::BINSAFE:
      return "binsafe";
    case zenkit::ArchiveFormat::ASCII:
      return "ascii";
  }
  return "unknown";
}

// Only the BinSafe writer path is verified — byte-for-byte against the retail
// corpus and in the original engine (docs/engine-acceptance-2026-08-25.md §3,
// §10.1). The ASCII writer corrupts every raw entry it emits and ZenKit cannot
// re-load its own ASCII output at all (§10.2), and the BINARY path has had no
// fidelity work either. A save that produces a file nothing can re-open is
// worse than no save, so refuse by default (§10.3). The diagnostic harness
// measures those paths deliberately and opts out per call.
bool AllowNonBinSafe(Napi::Env env, Napi::Value options) {
  if (options.IsUndefined() || options.IsNull()) return false;
  if (!options.IsObject()) {
    throw Napi::TypeError::New(env, "options must be an object");
  }
  Napi::Value const value = options.As<Napi::Object>().Get("allowNonBinSafe");
  return value.ToBoolean().Value();
}

// T6 — saveWorld(handle, path[, options]). Serializes with the same archive
// format, game version and wrapper object name captured at load, writes to a
// temp file in the destination directory and renames it into place.
Napi::Value SaveWorld(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  auto path = PathFromValue(env, info[1]);

  if (handle->format != zenkit::ArchiveFormat::BINSAFE && !AllowNonBinSafe(env, info[2])) {
    throw Napi::Error::New(
        env, std::string {"refusing to save a world loaded from a '"} +
                 ArchiveFormatName(handle->format) +
                 "' archive: only the binsafe writer path is verified. Pass "
                 "{ allowNonBinSafe: true } to save it anyway (diagnostics only).");
  }

  try {
    // Serialize to memory first: zenkit::Write::to(path) never reports I/O
    // failures (writes to a failed ofstream succeed silently), so the file
    // write below is done by hand with explicit error checks.
    std::vector<std::byte> bytes;
    {
      auto w = zenkit::Write::to(&bytes);
      auto archive = zenkit::WriteArchive::to(w.get(), handle->format);
      archive->write_object(handle->root_object_name,
                            std::static_pointer_cast<zenkit::Object>(handle->world),
                            handle->version);
      archive->write_header();
    }

    auto tmp = path;
    tmp += ".tmp";
    {
      std::ofstream out {tmp, std::ios::binary | std::ios::trunc};
      if (out) {
        out.write(reinterpret_cast<char const*>(bytes.data()),
                  static_cast<std::streamsize>(bytes.size()));
        out.flush();
      }
      if (!out) {
        std::error_code ignored;
        std::filesystem::remove(tmp, ignored);
        throw Napi::Error::New(env, "failed to write world file: " + path.string());
      }
    }

    std::error_code ec;
    std::filesystem::rename(tmp, path, ec);
    if (ec) {
      std::error_code ignored;
      std::filesystem::remove(tmp, ignored);
      throw Napi::Error::New(env,
                             "failed to move saved world into place: " + path.string() + " (" +
                                 ec.message() + ")");
    }
  } catch (Napi::Error&) {
    throw;
  } catch (std::exception const& e) {
    throw Napi::Error::New(env, std::string {"failed to save world: "} + e.what());
  }
  return env.Undefined();
}

// ---------------------------------------------------------------------------
// §1 minimal mutations — index paths use the same '0/2' convention as
// normalizeWorld's `path` field.

std::vector<std::size_t> ParseIndexPath(Napi::Env env, Napi::Value value, char const* label) {
  if (!value.IsString()) {
    throw Napi::TypeError::New(env, std::string {label} + " must be a string like '0/2'");
  }
  std::string const str = value.As<Napi::String>().Utf8Value();
  std::vector<std::size_t> indices;
  std::size_t start = 0;
  while (true) {
    std::size_t const end = str.find('/', start);
    std::string const segment = str.substr(start, end - start);
    if (segment.empty() || segment.find_first_not_of("0123456789") != std::string::npos) {
      throw Napi::Error::New(env, std::string {"invalid "} + label + ": '" + str + "'");
    }
    indices.push_back(static_cast<std::size_t>(std::stoull(segment)));
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return indices;
}

std::shared_ptr<zenkit::VirtualObject> ResolveVob(Napi::Env env,
                                                  WorldHandle const& handle,
                                                  std::vector<std::size_t> const& indices,
                                                  char const* label) {
  auto const* list = &handle.world->world_vobs;
  std::shared_ptr<zenkit::VirtualObject> vob;
  for (std::size_t const index : indices) {
    if (index >= list->size() || (*list)[index] == nullptr) {
      throw Napi::Error::New(env, std::string {"no vob at "} + label);
    }
    vob = (*list)[index];
    list = &vob->children;
  }
  return vob;
}

// getVobProps(handle, indexPath) — every property of one VOB: the base `zCVob`
// fields and whatever its concrete class adds, plus the class name under
// `class`. It lives down here among the mutations only because it is addressed
// the way they are, by the index path they all resolve.
//
// It is literally the reader `normalizeWorld` uses (src/normalize.cc). The dump
// as a whole is 933 ms on retail NewWorld and unusable per selection, but the
// per-VOB half of it is cheap, and a second field mapping would be a second
// hand-maintained mirror of the vendor headers that agreed with the first only
// for as long as both were remembered.
Napi::Value GetVobProps(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  auto indices = ParseIndexPath(env, info[1], "indexPath");

  auto vob = ResolveVob(env, *handle, indices, "indexPath");
  auto props = zenkit_node::VobProps(env, *vob);
  props.Set("class", Napi::String::New(env, zenkit_node::VobClassName(vob->type)));
  return props;
}

zenkit::Vec3 Vec3FromValue(Napi::Env env, Napi::Value value, char const* label) {
  if (!value.IsArray()) {
    throw Napi::TypeError::New(env, std::string {label} + " must be an array of 3 numbers");
  }
  auto arr = value.As<Napi::Array>();
  if (arr.Length() != 3) {
    throw Napi::TypeError::New(env, std::string {label} + " must have exactly 3 elements");
  }
  float components[3];
  for (std::uint32_t i = 0; i < 3; ++i) {
    Napi::Value const element = arr.Get(i);
    if (!element.IsNumber()) {
      throw Napi::TypeError::New(env, std::string {label} + " elements must be numbers");
    }
    components[i] = static_cast<float>(element.As<Napi::Number>().DoubleValue());
  }
  return zenkit::Vec3 {components[0], components[1], components[2]};
}

// setVobPosition(handle, indexPath, [x, y, z]) — sets the position and
// translates the bbox by the same delta (the engine culls by bbox; a moved
// vob with a stale bbox may vanish).
Napi::Value SetVobPosition(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  auto indices = ParseIndexPath(env, info[1], "indexPath");
  auto position = Vec3FromValue(env, info[2], "position");

  auto vob = ResolveVob(env, *handle, indices, "indexPath");
  // zenkit::Vec3 has no +/- operators; translate componentwise.
  zenkit::Vec3 const delta {position.x - vob->position.x, position.y - vob->position.y,
                            position.z - vob->position.z};
  vob->position = position;
  vob->bbox.min = zenkit::Vec3 {vob->bbox.min.x + delta.x, vob->bbox.min.y + delta.y,
                                vob->bbox.min.z + delta.z};
  vob->bbox.max = zenkit::Vec3 {vob->bbox.max.x + delta.x, vob->bbox.max.y + delta.y,
                                vob->bbox.max.z + delta.z};
  return env.Undefined();
}

// setWaypointPosition(handle, waypoint, name, [x, y, z]) — moves one waypoint.
//
// `waypoint` is an index into the same filtered, stored-order point list
// `getWaynet` emits (`CollectWaypoints` is the one definition of it), and
// `name` is a guard rather than an address. The two failure modes are not the
// same as a VOB's: a stale index path usually resolves to nothing and this
// binding says so, but a stale waypoint index always resolves to *a* waypoint
// and would move it in silence. Names are not unique by the format's rules,
// which is why the name cannot be the address either — so it is checked and
// never resolved.
//
// No bbox counterpart to SetVobPosition's: a WayPoint is a name, a position, a
// direction, a water depth and two flags, and has no bounding box at all.
// `direction` is left alone deliberately — a move is a move.
Napi::Value SetWaypointPosition(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  if (!info[1].IsNumber()) {
    throw Napi::TypeError::New(env, "waypoint must be a number");
  }
  auto const requested = info[1].As<Napi::Number>().Int64Value();
  if (!info[2].IsString()) {
    throw Napi::TypeError::New(env, "name must be a string");
  }
  auto const name = info[2].As<Napi::String>().Utf8Value();
  auto position = Vec3FromValue(env, info[3], "position");

  auto points = CollectWaypoints(*handle);
  if (requested < 0 || static_cast<std::size_t>(requested) >= points.size()) {
    throw Napi::Error::New(env, "no waypoint at " + std::to_string(requested));
  }

  auto const& point = points[static_cast<std::size_t>(requested)];
  if (point->name != name) {
    throw Napi::Error::New(env, "waypoint " + std::to_string(requested) + " is " + point->name
                                  + ", not " + name + " — the waynet has changed under this op");
  }

  point->position = position;
  return env.Undefined();
}

// setWaypointName(handle, waypoint, name, newName) — renames one waypoint.
//
// The same address as SetWaypointPosition's and for the same reason: a rename
// inserts, deletes and reorders nothing, so the enumeration the caller read is
// the one this writes into, and `name` is the guard rather than the address.
//
// The edges need no rewriting. `WayNet::save` writes edge endpoints and
// `WriteArchive::write_object` de-duplicates by pointer, so an edge into a
// renamed waypoint is an edge into the same object under its new name.
//
// Two names are refused where a move refuses none. An empty one cannot be
// addressed by the index+name pair at all, and one another waypoint already
// carries makes every by-name lookup ambiguous — the script index the waypoint
// panel shows above all. Neither is forbidden by the format; both are absent
// from all 24 retail worlds, and this is the op that could first author one.
Napi::Value SetWaypointName(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  if (!info[1].IsNumber()) {
    throw Napi::TypeError::New(env, "waypoint must be a number");
  }
  auto const requested = info[1].As<Napi::Number>().Int64Value();
  if (!info[2].IsString() || !info[3].IsString()) {
    throw Napi::TypeError::New(env, "name and newName must be strings");
  }
  auto const name = info[2].As<Napi::String>().Utf8Value();
  auto const renamed = info[3].As<Napi::String>().Utf8Value();

  auto points = CollectWaypoints(*handle);
  if (requested < 0 || static_cast<std::size_t>(requested) >= points.size()) {
    throw Napi::Error::New(env, "no waypoint at " + std::to_string(requested));
  }

  auto const at = static_cast<std::size_t>(requested);
  if (points[at]->name != name) {
    throw Napi::Error::New(env, "waypoint " + std::to_string(requested) + " is "
                                  + points[at]->name + ", not " + name
                                  + " — the waynet has changed under this op");
  }
  if (renamed.empty()) {
    throw Napi::Error::New(env, "a waypoint name cannot be empty");
  }
  for (std::size_t other = 0; other < points.size(); ++other) {
    if (other != at && points[other]->name == renamed) {
      throw Napi::Error::New(
          env, "waypoint " + std::to_string(other) + " is already named " + renamed);
    }
  }

  points[at]->name = renamed;
  return env.Undefined();
}

// addWaypoint(handle, name, [x, y, z]) — appends a free waypoint and answers
// with the index it landed at.
//
// **Appending is the whole reason this needs no new addressing scheme.** A
// waypoint's address is its index into the list `getWaynet` emits, and an
// append leaves every existing index naming the waypoint it named before — so
// the enumeration a pending op was made against is still the one it will be
// applied against. Anything that inserted in the middle would not be.
//
// **`free_point` is not cosmetic.** `WayNet::save` writes free points plus edge
// endpoints and nothing else, so a new waypoint that is neither is dropped at
// save and the add would silently do nothing. A waypoint authored here is in no
// edge — the edge ops are §16.7's W3 — so it has to be free, and it is the
// same flag `WayNet::load` gives every waypoint in the points section.
//
// The other four fields are fixed rather than taken: a waypoint is a name, a
// position, a direction, a water depth and two flags, and only the first two
// are things a placement chooses. The direction is the fixture's and retail's
// resting one, (0, 0, 1); the depth is 0 and neither flag beyond `free_point`
// is set. Fixed, so that an op carrying a name and a position describes the
// waypoint completely — which is what makes redo reproduce it exactly.
//
// The two refusals are `SetWaypointName`'s, for the same reason: an empty name
// cannot be addressed by the index+name pair at all, and a duplicate makes
// every by-name lookup ambiguous.
Napi::Value AddWaypoint(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  if (!info[1].IsString()) {
    throw Napi::TypeError::New(env, "name must be a string");
  }
  auto const name = info[1].As<Napi::String>().Utf8Value();
  auto position = Vec3FromValue(env, info[2], "position");

  if (name.empty()) {
    throw Napi::Error::New(env, "a waypoint name cannot be empty");
  }
  auto points = CollectWaypoints(*handle);
  for (std::size_t other = 0; other < points.size(); ++other) {
    if (points[other]->name == name) {
      throw Napi::Error::New(
          env, "waypoint " + std::to_string(other) + " is already named " + name);
    }
  }

  // A world with no waynet at all gets one rather than a refusal: the section
  // is optional in the format, and "there is nowhere to put it" is not a thing
  // a user placing a point can act on.
  if (handle->world->way_net == nullptr) {
    handle->world->way_net = std::make_shared<zenkit::WayNet>();
  }

  auto point = std::make_shared<zenkit::WayPoint>();
  point->name = name;
  point->water_depth = 0;
  point->under_water = false;
  point->position = position;
  point->direction = zenkit::Vec3 {0.0f, 0.0f, 1.0f};
  point->free_point = true;
  handle->world->way_net->points.push_back(point);

  // Recomputed rather than assumed to be `points.size()`: `CollectWaypoints`
  // drops the null slots of the stored list, so the index the caller will see
  // is the one that list gives — and the caller checks it against the index its
  // op claims.
  return Napi::Number::New(env, static_cast<double>(CollectWaypoints(*handle).size() - 1));
}

// removeWaypoint(handle, waypoint, name, barrier) — the append's inverse, and
// the arbitrary delete (§16.7, W2 and W4).
//
// One call rather than two, with `barrier` naming the *reason* the second may
// do more rather than one of the two things it does. A removal is either the
// inverse of an append — which renumbers nothing and is replayed by undo — or
// an edit with §15's undo barrier behind it, and that one difference decides
// both of the ones below:
//
//   - **Where.** The append's inverse takes the tail and nothing else: removing
//     a waypoint in the middle takes every index after it down by one, and the
//     ops already on the undo stack carry those indices. A barrier removal may
//     take any index, because the stack it invalidates is cleared.
//   - **The edges.** An edge holds its endpoints by pointer, so a waypoint the
//     edge list still names cannot simply leave the point list —
//     `WayNet::save` writes edge endpoints, and the removal would be undone by
//     the writer without a word. The append's inverse refuses (the waypoint it
//     authored was in no edge, so an edge means the world moved under it); a
//     barrier removal takes the edges with it, which is the one thing the op
//     cannot describe well enough to put back.
//
// Never defaulted. Which of the two removals this is decides whether the call
// may renumber the waynet, and a caller that did not say must not get either.
//
// An endpoint the removal leaves in no edge is promoted to a free point, for
// `RemoveWaypointEdge`'s reason and by the same rule: a waypoint that is
// neither free nor an endpoint is not written at all, so a delete would take a
// neighbour with it.
Napi::Value RemoveWaypoint(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  if (!info[1].IsNumber()) {
    throw Napi::TypeError::New(env, "waypoint must be a number");
  }
  auto const requested = info[1].As<Napi::Number>().Int64Value();
  if (!info[2].IsString()) {
    throw Napi::TypeError::New(env, "name must be a string");
  }
  auto const name = info[2].As<Napi::String>().Utf8Value();
  if (!info[3].IsBoolean()) {
    throw Napi::TypeError::New(env, "barrier must be a boolean: true deletes an arbitrary "
                                    "waypoint with its edges, false undoes an append");
  }
  auto const barrier = info[3].As<Napi::Boolean>().Value();

  auto points = CollectWaypoints(*handle);
  if (requested < 0 || static_cast<std::size_t>(requested) >= points.size()) {
    throw Napi::Error::New(env, "no waypoint at " + std::to_string(requested));
  }

  auto const at = static_cast<std::size_t>(requested);
  if (points[at]->name != name) {
    throw Napi::Error::New(env, "waypoint " + std::to_string(requested) + " is "
                                  + points[at]->name + ", not " + name
                                  + " — the waynet has changed under this op");
  }
  if (!barrier && at + 1 != points.size()) {
    throw Napi::Error::New(env, "only the last waypoint can be removed; " + name + " is "
                                  + std::to_string(requested) + " of "
                                  + std::to_string(points.size()));
  }

  auto const* target = points[at].get();
  auto& edges = handle->world->way_net->edges;
  if (!barrier) {
    for (auto const& edge : edges) {
      if (edge.first.get() == target || edge.second.get() == target) {
        throw Napi::Error::New(env, name + " is an edge endpoint and cannot be removed");
      }
    }
  }

  // The neighbours are collected before the edges go, because afterwards there
  // is nothing left to say who they were — and each of them may be left in no
  // edge at all by this delete.
  std::vector<std::shared_ptr<zenkit::WayPoint>> neighbours;
  for (auto it = edges.begin(); it != edges.end();) {
    if (it->first.get() == target || it->second.get() == target) {
      neighbours.push_back(it->first.get() == target ? it->second : it->first);
      it = edges.erase(it);
    } else {
      ++it;
    }
  }

  auto& stored = handle->world->way_net->points;
  for (auto it = stored.end(); it != stored.begin();) {
    --it;
    if (it->get() == target) {
      stored.erase(it);
      break;
    }
  }

  for (auto const& endpoint : neighbours) {
    if (endpoint->free_point) continue;
    bool still_named = false;
    for (auto const& edge : edges) {
      if (edge.first.get() == endpoint.get() || edge.second.get() == endpoint.get()) {
        still_named = true;
        break;
      }
    }
    if (!still_named) endpoint->free_point = true;
  }
  return env.Undefined();
}

// The two endpoints of an edge op, each resolved by the index+name pair every
// waynet op is addressed by (see SetWaypointPosition). Shared by the add and
// the remove so the two cannot drift into checking different things — a pair
// one accepted and the other refused would be an edge nothing could undo.
//
// `argument` is the index of the first of the four arguments (a, aName, b,
// bName), which both callers pass as 1.
static std::pair<std::shared_ptr<zenkit::WayPoint>, std::shared_ptr<zenkit::WayPoint>>
ResolveWaypointPair(Napi::Env env, WorldHandle& handle, Napi::CallbackInfo const& info) {
  auto points = CollectWaypoints(handle);
  std::shared_ptr<zenkit::WayPoint> resolved[2];

  for (std::size_t end = 0; end < 2; ++end) {
    auto const index_argument = 1 + end * 2;
    if (!info[index_argument].IsNumber()) {
      throw Napi::TypeError::New(env, "waypoint must be a number");
    }
    if (!info[index_argument + 1].IsString()) {
      throw Napi::TypeError::New(env, "name must be a string");
    }
    auto const requested = info[index_argument].As<Napi::Number>().Int64Value();
    auto const name = info[index_argument + 1].As<Napi::String>().Utf8Value();

    if (requested < 0 || static_cast<std::size_t>(requested) >= points.size()) {
      throw Napi::Error::New(env, "no waypoint at " + std::to_string(requested));
    }
    auto const at = static_cast<std::size_t>(requested);
    if (points[at]->name != name) {
      throw Napi::Error::New(env, "waypoint " + std::to_string(requested) + " is "
                                    + points[at]->name + ", not " + name
                                    + " — the waynet has changed under this op");
    }
    resolved[end] = points[at];
  }

  // Pointer identity, not the index: two indices are the same waypoint exactly
  // when they resolve to the same object, and an edge from a waypoint to itself
  // is a line of zero length the overlay cannot draw and the engine cannot walk.
  if (resolved[0].get() == resolved[1].get()) {
    throw Napi::Error::New(env, resolved[0]->name + " cannot be joined to itself");
  }
  return {resolved[0], resolved[1]};
}

// Is `edge` the edge between these two, in either orientation? An edge is
// undirected — `WayNet` stores an ordered pair only because a file has to store
// something — so the caller may name it from whichever end the user selected.
static bool IsEdgeBetween(std::pair<std::shared_ptr<zenkit::WayPoint>,
                                    std::shared_ptr<zenkit::WayPoint>> const& edge,
                          zenkit::WayPoint const* a,
                          zenkit::WayPoint const* b) {
  return (edge.first.get() == a && edge.second.get() == b)
      || (edge.first.get() == b && edge.second.get() == a);
}

// addWaypointEdge(handle, a, aName, b, bName) — joins two waypoints (§16.7, W3).
//
// Both endpoints carry the same index+name pair every other waynet op does, and
// this op earns that address the way a move and a rename do: it inserts,
// deletes and reorders no *waypoint*, so the enumeration the caller read is the
// one this writes into.
//
// The two refusals are the ones the edge list is the only layer that can see: a
// waypoint joined to itself, and an edge that is already there in either
// orientation — a second copy would be written twice by `WayNet::save` and
// drawn twice by the overlay, and the removal of one would leave the other.
Napi::Value AddWaypointEdge(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  auto const [a, b] = ResolveWaypointPair(env, *handle, info);

  // Non-null wherever the pair resolved: a waypoint came out of the point list,
  // and there is no point list without a waynet.
  auto& way_net = *handle->world->way_net;
  for (auto const& edge : way_net.edges) {
    if (IsEdgeBetween(edge, a.get(), b.get())) {
      throw Napi::Error::New(env, a->name + " and " + b->name + " are already joined");
    }
  }

  way_net.edges.emplace_back(a, b);
  return env.Undefined();
}

// removeWaypointEdge(handle, a, aName, b, bName) — the exact inverse, with one
// thing it has to do that the add does not.
//
// **An edge removal must not become a waypoint removal.** `WayNet::save` writes
// free points plus edge endpoints and nothing else, so a waypoint that is not a
// free point and is in no edge is not written at all — taking its last edge
// would delete it at the next save, silently, and renumber every waypoint after
// it on the reload. So an endpoint left in no edge is promoted to a free point,
// which is the shape a waypoint has in every world ZenGin itself wrote:
// `WayNet::load` marks every point in the points section free, so all 12,341
// retail waypoints already are one and none of them can reach this path.
//
// The promotion is not undone by `AddWaypointEdge`, and deliberately: an add
// cannot know which of its endpoints a removal had to rescue, and a waypoint
// wrongly left free is written where it was written before, while one wrongly
// demoted is gone (§16.7).
Napi::Value RemoveWaypointEdge(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  auto const [a, b] = ResolveWaypointPair(env, *handle, info);

  auto& edges = handle->world->way_net->edges;
  auto found = edges.end();
  for (auto it = edges.begin(); it != edges.end(); ++it) {
    if (IsEdgeBetween(*it, a.get(), b.get())) {
      found = it;
      break;
    }
  }
  if (found == edges.end()) {
    throw Napi::Error::New(env, "no edge between " + a->name + " and " + b->name);
  }
  edges.erase(found);

  for (auto const& endpoint : {a, b}) {
    if (endpoint->free_point) continue;
    bool still_named = false;
    for (auto const& edge : edges) {
      if (edge.first.get() == endpoint.get() || edge.second.get() == endpoint.get()) {
        still_named = true;
        break;
      }
    }
    if (!still_named) endpoint->free_point = true;
  }
  return env.Undefined();
}

// Reads `count` numbers out of a JS array. The matrix and the box are both
// read positionally by native code, so a wrong length is refused rather than
// padded — a short matrix would leave uninitialized rows in a struct ZenKit
// does not zero.
std::vector<float> FloatsFromValue(Napi::Env env,
                                   Napi::Value value,
                                   std::uint32_t count,
                                   char const* label) {
  if (!value.IsArray()) {
    throw Napi::TypeError::New(env, std::string {label} + " must be an array of numbers");
  }
  auto arr = value.As<Napi::Array>();
  if (arr.Length() != count) {
    throw Napi::TypeError::New(
        env, std::string {label} + " must have exactly " + std::to_string(count) + " elements");
  }
  std::vector<float> out;
  out.reserve(count);
  for (std::uint32_t i = 0; i < count; ++i) {
    Napi::Value const element = arr.Get(i);
    if (!element.IsNumber()) {
      throw Napi::TypeError::New(env, std::string {label} + " elements must be numbers");
    }
    out.push_back(static_cast<float>(element.As<Napi::Number>().DoubleValue()));
  }
  return out;
}

// setVobRotation(handle, indexPath, rotation[9], bbox[6]?) — sets the rotation
// and, when given one, the bounding box.
//
// The matrix is **row-major**, which is the order `vobIndex` emits and the
// order `normalizeWorld` dumps; zenkit::Mat3 stores columns, so it is
// transposed here rather than at each of the three call sites that would
// otherwise each have to remember.
//
// It does not derive the box. Measured across the three retail worlds
// (scripts/check-vob-bbox.js), a VOB's stored box is the tight world AABB of
// its own visual placed by its own transform — 20,472 of 20,502, mean slack
// ~0.1 cm — so the box is a pure function of (visual, rotation, position) and
// the caller that owns the asset layer recomputes it. Re-fitting the box that
// is already there would grow it on every rotation and make the op
// non-invertible; a VOB whose visual does not resolve is given no box at all
// and keeps the stale one, which at least bounded the visual in some pose.
Napi::Value SetVobRotation(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  auto indices = ParseIndexPath(env, info[1], "indexPath");
  auto rotation = FloatsFromValue(env, info[2], 9, "rotation");

  bool const has_bbox = !(info[3].IsNull() || info[3].IsUndefined());
  std::vector<float> bbox;
  if (has_bbox) bbox = FloatsFromValue(env, info[3], 6, "bbox");

  auto vob = ResolveVob(env, *handle, indices, "indexPath");
  vob->rotation = zenkit::Mat3 {rotation[0], rotation[3], rotation[6],
                                rotation[1], rotation[4], rotation[7],
                                rotation[2], rotation[5], rotation[8]};
  if (has_bbox) {
    vob->bbox.min = zenkit::Vec3 {bbox[0], bbox[1], bbox[2]};
    vob->bbox.max = zenkit::Vec3 {bbox[3], bbox[4], bbox[5]};
  }
  return env.Undefined();
}

std::string RequiredCp1252String(Napi::Env env, Napi::Object opts, char const* key) {
  Napi::Value const value = opts.Get(key);
  if (!value.IsString()) {
    throw Napi::TypeError::New(env, std::string {"opts."} + key + " must be a string");
  }
  try {
    return zenkit_node::Utf16ToWindows1252(value.As<Napi::String>().Utf16Value());
  } catch (zenkit_node::EncodingError const& e) {
    throw Napi::Error::New(env, std::string {"opts."} + key + ": " + e.what());
  }
}

// setVobProp(handle, indexPath, props) — the scalar fields of `zCVob` itself:
// the name, the six boolean flags `vobIndex` emits, and the visual's name.
//
// Every key is optional and only the ones present are written, so a caller that
// means to set one flag does not have to know the other five. A key that is not
// one of these is **refused** rather than ignored: every field here is invisible
// in the viewport, so a misspelled key that silently did nothing is exactly the
// failure this op would otherwise have.
//
// The visual is a rename and nothing more. A visual is its own object frame in
// the archive with its own class, and the class is not implied by the file
// name — measured over the three retail worlds, `.3DS` carries
// `zCProgMeshProto` 20,716 times and `zCMesh` 31 times. So the object found on
// the VOB is kept and only its name changes; a VOB whose visual is UNKNOWN has
// no object to rename (15,749 of the 41,393 retail VOBs are in that state) and
// is refused, because giving a VOB a visual means replacing that object and
// deciding its class, which is a different operation.
//
// `bbox` follows setVobRotation's contract: a swapped visual changes the box the
// engine culls by, the box is a pure function of (visual, rotation, position)
// (scripts/check-vob-bbox.js), and the caller that owns the asset layer is the
// one that can compute it. It is accepted only alongside `visual`, since nothing
// else here can change the box.
std::optional<bool> OptionalBool(Napi::Env env, Napi::Object props, char const* key) {
  Napi::Value const value = props.Get(key);
  if (value.IsUndefined()) return std::nullopt;
  if (!value.IsBoolean()) {
    throw Napi::TypeError::New(env, std::string {"props."} + key + " must be a boolean");
  }
  return value.As<Napi::Boolean>().Value();
}

// The OptionalBool idiom for a bounded whole number, and `why` is the half that
// is not shared: the three base fields live in a *bit field* rather than in a
// word of their own — ZenGin writes a VObject either packed, every scalar in one
// `dataRaw` blob, or unpacked, and the packed layout gives `visualCamAlign` and
// `dynamicShadows` 2 bits each and `bias` 5 (`VirtualObject.cc`) — while a
// decal's alpha weight is bounded by being the byte `write_byte` puts in the
// archive and its alpha function by `AlphaFunction`'s seven values. Every one of
// them is silently truncated rather than refused if it goes through: a `bias` of
// 32 is an `int32_t` ZenKit accepts and `& 0b11111` writes as 0, in a field that
// is invisible in the viewport. Whole numbers only, for setVobClassProp's `int`
// reason — a fraction truncates on the cast and reports success.
std::optional<std::int32_t> OptionalWholeInt(
    Napi::Env env, Napi::Object props, char const* key, std::int32_t max, char const* why) {
  Napi::Value const value = props.Get(key);
  if (value.IsUndefined()) return std::nullopt;
  if (!value.IsNumber()) {
    throw Napi::TypeError::New(env, std::string {"props."} + key + " must be a number");
  }
  double const number = value.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(number) || number != std::floor(number) || number < 0 || number > max) {
    throw Napi::Error::New(env, std::string {"props."} + key + " must be a whole number 0-" +
                                    std::to_string(max) + " — " + why);
  }
  return static_cast<std::int32_t>(number);
}

/// The packed layout's bit fields, by far the commonest reason for a bound here.
constexpr char const* kPackedReason = "the packed vob layout has no room for more";

// A decal's size or offset: exactly two finite floats. `floor` is applied to
// neither — these are float32 members and a fractional dimension is a legal
// decal. `min` is 0 for a size (a negative one is not a size) and absent for an
// offset, which retail only ever holds at [0, 0] but which means a direction.
std::optional<zenkit::Vec2> OptionalVec2(
    Napi::Env env, Napi::Object props, char const* key, bool non_negative) {
  Napi::Value const value = props.Get(key);
  if (value.IsUndefined()) return std::nullopt;
  if (!value.IsArray() || value.As<Napi::Array>().Length() != 2) {
    throw Napi::TypeError::New(env, std::string {"props."} + key + " must be two numbers");
  }
  auto arr = value.As<Napi::Array>();
  float parts[2];
  for (std::uint32_t i = 0; i < 2; ++i) {
    Napi::Value const element = arr.Get(i);
    if (!element.IsNumber()) {
      throw Napi::TypeError::New(env, std::string {"props."} + key + " must be two numbers");
    }
    double const number = element.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || (non_negative && number < 0)) {
      throw Napi::Error::New(env, std::string {"props."} + key + " must be two finite numbers" +
                                      (non_negative ? ", neither negative" : ""));
    }
    parts[i] = static_cast<float>(number);
  }
  return zenkit::Vec2 {parts[0], parts[1]};
}

// A decal's texture animation rate — frames per minute, so a finite float that is
// not negative. Its own helper rather than `OptionalFloat` below because that one
// has no bound and is declared for `setVobClassProp`, further down the file.
std::optional<float> OptionalNonNegativeFloat(
    Napi::Env env, Napi::Object props, char const* key) {
  Napi::Value const value = props.Get(key);
  if (value.IsUndefined()) return std::nullopt;
  if (!value.IsNumber()) {
    throw Napi::TypeError::New(env, std::string {"props."} + key + " must be a number");
  }
  double const number = value.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(number) || number < 0) {
    throw Napi::Error::New(env,
                           std::string {"props."} + key + " must be a finite number, not negative");
  }
  return static_cast<float>(number);
}

Napi::Value SetVobProp(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  auto indices = ParseIndexPath(env, info[1], "indexPath");

  if (!info[2].IsObject() || info[2].IsArray()) {
    throw Napi::TypeError::New(env, "props must be an object");
  }
  auto props = info[2].As<Napi::Object>();

  static constexpr std::array<char const*, 20> kKnownKeys {
      "name",         "visual",         "bbox",           "showVisual",
      "cdStatic",     "cdDynamic",      "vobStatic",      "ambient",
      "physicsEnabled", "presetName",   "visualCamAlign", "bias",
      "dynamicShadows",
      // The decal visual's own seven, flat and prefixed. They are legal only on
      // a VOB whose visual *is* a decal, which is a per-VOB condition and so is
      // checked below rather than here.
      "decalDimension", "decalOffset",  "decalTwoSided",  "decalAlphaFunc",
      "decalTextureAnimFps", "decalAlphaWeight", "decalIgnoreDaylight"};
  auto names = props.GetPropertyNames();
  if (names.Length() == 0) {
    throw Napi::Error::New(env, "props must set at least one property");
  }
  for (std::uint32_t i = 0; i < names.Length(); ++i) {
    std::string const key = names.Get(i).As<Napi::String>().Utf8Value();
    if (std::find_if(kKnownKeys.begin(), kKnownKeys.end(),
                     [&key](char const* known) { return key == known; }) == kKnownKeys.end()) {
      throw Napi::Error::New(env, "props: unknown property '" + key + "'");
    }
  }

  bool const has_name = props.Has("name") && !props.Get("name").IsUndefined();
  bool const has_visual = props.Has("visual") && !props.Get("visual").IsUndefined();
  bool const has_bbox = props.Has("bbox") && !props.Get("bbox").IsUndefined();
  if (has_bbox && !has_visual) {
    throw Napi::Error::New(env, "props.bbox is only meaningful with props.visual");
  }

  // Everything is validated before anything is written: a half-applied props
  // object is a state no op describes, and undo would not restore it.
  std::string name;
  if (has_name) name = RequiredCp1252String(env, props, "name");
  std::string visual;
  if (has_visual) visual = RequiredCp1252String(env, props, "visual");
  std::vector<float> bbox;
  if (has_bbox) bbox = FloatsFromValue(env, props.Get("bbox"), 6, "props.bbox");
  // The Spacer template a VOB was made from. An empty string is a value rather
  // than an absence — it is how the packed layout says "no preset" — so this is
  // read like `name` and not like an optional.
  bool const has_preset =
      props.Has("presetName") && !props.Get("presetName").IsUndefined();
  std::string preset_name;
  if (has_preset) preset_name = RequiredCp1252String(env, props, "presetName");

  auto const show_visual = OptionalBool(env, props, "showVisual");
  auto const cd_static = OptionalBool(env, props, "cdStatic");
  auto const cd_dynamic = OptionalBool(env, props, "cdDynamic");
  auto const vob_static = OptionalBool(env, props, "vobStatic");
  auto const ambient = OptionalBool(env, props, "ambient");
  auto const physics_enabled = OptionalBool(env, props, "physicsEnabled");
  // 0-3 and 0-31: the two bit fields. The alignment's bound is the layout's two
  // bits rather than `SpriteAlignment`'s three named values, because retail
  // carries the fourth — 7 VOBs over the three worlds' 41,393 hold 3 — and a
  // bound that refused it would make an edit on one of them un-undoable: the
  // inverse writes the value that was there.
  auto const cam_align = OptionalWholeInt(env, props, "visualCamAlign", 3, kPackedReason);
  auto const bias = OptionalWholeInt(env, props, "bias", 31, kPackedReason);
  // The same two bits `visualCamAlign` has — `(bit0 & 0b11000000) >> 6` — so the
  // bound is the layout's and not `ShadowType`'s two named values. Retail holds
  // only 0 and 1 (41,260 and 133 of 41,393, measured 2026-08-28), so nothing in
  // the corpus needs the wider bound; the layout is what truncates in silence.
  auto const dynamic_shadows = OptionalWholeInt(env, props, "dynamicShadows", 3, kPackedReason);

  // The decal's own fields. `decalAlphaWeight` is the byte `write_byte` puts in
  // the archive and `decalAlphaFunc` is an `AlphaFunction`, whose seven values
  // retail stays inside — unlike `zCMover.lerpMode`, which is why an enum is
  // otherwise not something this editor writes.
  auto const decal_dimension = OptionalVec2(env, props, "decalDimension", true);
  auto const decal_offset = OptionalVec2(env, props, "decalOffset", false);
  auto const decal_two_sided = OptionalBool(env, props, "decalTwoSided");
  auto const decal_alpha_func =
      OptionalWholeInt(env, props, "decalAlphaFunc", 6, "AlphaFunction has seven values");
  auto const decal_fps = OptionalNonNegativeFloat(env, props, "decalTextureAnimFps");
  auto const decal_alpha_weight =
      OptionalWholeInt(env, props, "decalAlphaWeight", 255, "the archive holds one byte");
  auto const decal_ignore_daylight = OptionalBool(env, props, "decalIgnoreDaylight");
  bool const has_decal_field = decal_dimension || decal_offset || decal_two_sided
      || decal_alpha_func || decal_fps || decal_alpha_weight || decal_ignore_daylight;

  auto vob = ResolveVob(env, *handle, indices, "indexPath");

  // Dispatched via get_object_type() rather than dynamic_cast, for the reason
  // `normalizeWorld`'s reader gives: node-gyp builds with RTTI disabled on some
  // platforms. Defaulting a decal onto a VOB that has none would replace its
  // visual, which is `props.visual`'s refusal and the same one.
  zenkit::VisualDecal* decal = nullptr;
  if (has_decal_field) {
    if (vob->visual == nullptr
        || vob->visual->get_object_type() != zenkit::ObjectType::zCDecal) {
      throw Napi::Error::New(
          env, "props: a decal field needs a vob whose visual is a decal — this one's is not");
    }
    decal = static_cast<zenkit::VisualDecal*>(vob->visual.get());
  }

  if (has_visual && (vob->visual == nullptr || vob->visual->type == zenkit::VisualType::UNKNOWN)) {
    throw Napi::Error::New(
        env, "props.visual: this vob has no visual object to rename — giving it one replaces "
             "the object and has to decide its class");
  }

  if (has_name) vob->vob_name = std::move(name);
  if (has_preset) vob->preset_name = std::move(preset_name);
  if (has_visual) vob->visual->name = std::move(visual);
  if (has_bbox) {
    vob->bbox.min = zenkit::Vec3 {bbox[0], bbox[1], bbox[2]};
    vob->bbox.max = zenkit::Vec3 {bbox[3], bbox[4], bbox[5]};
  }
  if (show_visual) vob->show_visual = *show_visual;
  if (cd_static) vob->cd_static = *cd_static;
  if (cd_dynamic) vob->cd_dynamic = *cd_dynamic;
  if (vob_static) vob->vob_static = *vob_static;
  if (ambient) vob->ambient = *ambient;
  if (physics_enabled) vob->physics_enabled = *physics_enabled;
  if (cam_align) {
    vob->sprite_camera_facing_mode = static_cast<zenkit::SpriteAlignment>(*cam_align);
  }
  if (bias) vob->bias = *bias;
  if (dynamic_shadows) {
    vob->dynamic_shadows = static_cast<zenkit::ShadowType>(*dynamic_shadows);
  }

  if (decal_dimension) decal->dimension = *decal_dimension;
  if (decal_offset) decal->offset = *decal_offset;
  if (decal_two_sided) decal->two_sided = *decal_two_sided;
  if (decal_alpha_func) {
    decal->alpha_func = static_cast<zenkit::AlphaFunction>(*decal_alpha_func);
  }
  if (decal_fps) decal->texture_anim_fps = *decal_fps;
  if (decal_alpha_weight) {
    decal->alpha_weight = static_cast<std::uint8_t>(*decal_alpha_weight);
  }
  if (decal_ignore_daylight) decal->ignore_daylight = *decal_ignore_daylight;

  return env.Undefined();
}

// The per-class key check, in setVobProp's shape but with the class in the
// message: the mistake this op invites is not a misspelling but a key that is
// real and legal on some *other* class, and "unknown property 'range'" does not
// say why it was refused. The empty-props refusal lives here too, so a class
// with no case at all is still refused for being that class.
void RequireClassKeys(Napi::Env env,
                      Napi::Object props,
                      std::initializer_list<char const*> known,
                      char const* class_name) {
  auto names = props.GetPropertyNames();
  if (names.Length() == 0) {
    throw Napi::Error::New(env, "props must set at least one property");
  }
  for (std::uint32_t i = 0; i < names.Length(); ++i) {
    std::string const key = names.Get(i).As<Napi::String>().Utf8Value();
    if (std::find_if(known.begin(), known.end(),
                     [&key](char const* candidate) { return key == candidate; }) == known.end()) {
      throw Napi::Error::New(env, "props: a " + std::string {class_name} + " has no property '" +
                                      key + "'");
    }
  }
}

// The OptionalBool idiom for a scalar. Non-finite is refused here rather than
// per field: an infinity or a NaN written into the archive is a number the
// engine reads back and computes with, and no field in this op has a use for
// either.
std::optional<float> OptionalFloat(Napi::Env env, Napi::Object props, char const* key) {
  Napi::Value const value = props.Get(key);
  if (value.IsUndefined()) return std::nullopt;
  if (!value.IsNumber()) {
    throw Napi::TypeError::New(env, std::string {"props."} + key + " must be a number");
  }
  double const number = value.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(number)) {
    throw Napi::Error::New(env, std::string {"props."} + key + " must be a finite number");
  }
  return static_cast<float>(number);
}

// A zCOLOR is four bytes and normalizeWorld emits them as `[r, g, b, a]`; this
// reads back exactly that, because the read and the write have to name the same
// thing the same way or the grid cannot round-trip its own value. The channels
// are bounded and required integral rather than truncated on the cast: 255.5 and
// 256 are both a caller meaning something this cannot store.
std::optional<zenkit::Color> OptionalColor(Napi::Env env, Napi::Object props, char const* key) {
  Napi::Value const value = props.Get(key);
  if (value.IsUndefined()) return std::nullopt;
  if (!value.IsArray()) {
    throw Napi::TypeError::New(env,
                               std::string {"props."} + key + " must be an array of 4 numbers");
  }
  auto arr = value.As<Napi::Array>();
  if (arr.Length() != 4) {
    throw Napi::TypeError::New(env, std::string {"props."} + key + " must have exactly 4 elements");
  }
  unsigned char channels[4];
  for (std::uint32_t i = 0; i < 4; ++i) {
    Napi::Value const element = arr.Get(i);
    if (!element.IsNumber()) {
      throw Napi::TypeError::New(env, std::string {"props."} + key + " channels must be numbers");
    }
    double const channel = element.As<Napi::Number>().DoubleValue();
    if (!(channel >= 0 && channel <= 255) || channel != std::floor(channel)) {
      throw Napi::Error::New(env,
                             std::string {"props."} + key + " channels must be integers 0-255");
    }
    channels[i] = static_cast<unsigned char>(channel);
  }
  return zenkit::Color {channels[0], channels[1], channels[2], channels[3]};
}

// A number as an error message should spell it: std::to_string(0.0f) is
// "0.000000", and a refusal that reads "must be between 0.000000 and 360.000000"
// is a worse message than the bound deserves.
std::string NumberText(float value) {
  std::string text = std::to_string(value);
  if (text.find('.') == std::string::npos) return text;
  text.erase(text.find_last_not_of('0') + 1);
  if (!text.empty() && text.back() == '.') text.pop_back();
  return text;
}

// OptionalFloat with the catalogue's bounds applied. The bounds are duplicated
// in `zen-world`'s CLASS_FIELDS on purpose — the grid needs them to refuse a
// typed value before it commits one — and this is the copy that is load-bearing:
// the IPC validator can be bypassed by anything that reaches the binding
// directly, and every one of these fields is invisible in the viewport.
std::optional<float> OptionalFloatIn(Napi::Env env,
                                     Napi::Object props,
                                     char const* key,
                                     std::optional<float> min,
                                     std::optional<float> max) {
  auto const value = OptionalFloat(env, props, key);
  if (!value) return std::nullopt;
  if (min && *value < *min) {
    throw Napi::Error::New(env, std::string {"props."} + key + " must be " + NumberText(*min)
                                    + " or greater");
  }
  if (max && *value > *max) {
    throw Napi::Error::New(env, std::string {"props."} + key + " must be " + NumberText(*max)
                                    + " or less");
  }
  return value;
}

// OptionalFloat's sibling for a member the struct stores as an `int32_t`.
//
// It exists rather than reusing OptionalFloat with a rounding step because the
// truncation is the whole hazard: `priority: 2.5` through a float lands as 2 and
// reports success, and the caller never learns which of the two numbers the
// world now holds. `Napi::Number` is a double, so the check is integrality plus
// the int32 range — a value past 2^31 is not a large priority, it is a wrap.
std::optional<std::int32_t> OptionalInt32(Napi::Env env,
                                          Napi::Object props,
                                          char const* key,
                                          std::optional<std::int32_t> min,
                                          std::optional<std::int32_t> max) {
  Napi::Value const value = props.Get(key);
  if (value.IsUndefined()) return std::nullopt;
  if (!value.IsNumber()) {
    throw Napi::TypeError::New(env, std::string {"props."} + key + " must be a number");
  }
  double const number = value.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(number) || number != std::floor(number)) {
    throw Napi::Error::New(env, std::string {"props."} + key + " must be a whole number");
  }
  if (number < -2147483648.0 || number > 2147483647.0) {
    throw Napi::Error::New(env, std::string {"props."} + key + " is outside the 32-bit range");
  }
  auto const result = static_cast<std::int32_t>(number);
  if (min && result < *min) {
    throw Napi::Error::New(env, std::string {"props."} + key + " must be "
                                    + std::to_string(*min) + " or greater");
  }
  if (max && result > *max) {
    throw Napi::Error::New(env, std::string {"props."} + key + " must be "
                                    + std::to_string(*max) + " or less");
  }
  return result;
}

// RequiredCp1252String for a key that may simply be absent. Every string field
// past `oCItem.instance` is one of several on its class, so "set the sound name
// and leave the radius alone" has to be expressible.
std::optional<std::string> OptionalCp1252String(Napi::Env env,
                                                Napi::Object props,
                                                char const* key) {
  if (props.Get(key).IsUndefined()) return std::nullopt;
  return RequiredCp1252String(env, props, key);
}

// setVobClassProp(handle, indexPath, props) — the fields a VOB has because of
// the class it is, rather than because it is a `zCVob`.
//
// It resolves the VOB **before** it looks at a single key, which is the one
// structural difference from setVobProp: the legal key set is a function of
// `vob->type`, so there is no allowlist to check the props against until the
// class is known. Everything is still validated before anything is written, for
// the reason setVobProp gives — a half-applied props object is a state no op
// describes, and undo would not restore it.
//
// Classes arrive here one at a time, and `default:` refuses by name rather than
// accepting and ignoring: a class whose fields nothing here can write is one
// whose edit would report success and then not be in the file. The `static_cast`
// down to the concrete class is the same one normalize.cc makes and rests on the
// same two facts — RTTI is off (/GR-), and the load path guarantees `type`
// matches the class it constructed.
Napi::Value SetVobClassProp(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  auto indices = ParseIndexPath(env, info[1], "indexPath");

  if (!info[2].IsObject() || info[2].IsArray()) {
    throw Napi::TypeError::New(env, "props must be an object");
  }
  auto props = info[2].As<Napi::Object>();

  auto vob = ResolveVob(env, *handle, indices, "indexPath");
  char const* const class_name = zenkit_node::VobClassName(vob->type);

  switch (vob->type) {
    case zenkit::VirtualObjectType::oCItem: {
      RequireClassKeys(env, props, {"instance"}, class_name);
      // The instance is a Daedalus symbol name and is written with the same
      // trust level as a VOB name: an instance the scripts do not define
      // crashes the engine, and checking that means knowing the parsed script
      // symbols, which the binding does not and should not.
      std::string instance = RequiredCp1252String(env, props, "instance");
      static_cast<zenkit::VItem&>(*vob).instance = std::move(instance);
      break;
    }
    case zenkit::VirtualObjectType::zCVobLight: {
      RequireClassKeys(env, props, {"range", "color"}, class_name);
      auto const range = OptionalFloat(env, props, "range");
      // A negative range is not a light that reaches nothing; it is a light the
      // engine derives an attenuation from and draws as garbage.
      if (range && *range < 0) {
        throw Napi::Error::New(env, "props.range must be zero or greater");
      }
      auto const color = OptionalColor(env, props, "color");

      // Assigned member by member, never by rebuilding the LightPreset: the
      // preset carries seventeen other fields, three of them the animation
      // vectors that only exist on a dynamic light, and none of them is this
      // op's to reset.
      auto& light = static_cast<zenkit::VLight&>(*vob);
      if (range) light.range = *range;
      if (color) light.color = *color;
      break;
    }
    // The sound family, in one case because `zCVobSoundDaytime` **is** a
    // `zCVobSound`: it derives from it, so its case inherits every base field
    // and adds three, rather than restating a second key list that would agree
    // with the first only for as long as both were remembered. An editor that
    // offered a radius on one and not the other would be describing the class
    // hierarchy wrongly.
    //
    // What is deliberately not here, by the catalogue's own rules: `mode` and
    // `volumeType` are enums; and `randomDelay` / `randomDelayVar` are read by
    // the engine only when `mode` is RANDOM, which is a mode this op cannot set,
    // so both would be legal writes with no effect.
    case zenkit::VirtualObjectType::zCVobSound:
    case zenkit::VirtualObjectType::zCVobSoundDaytime: {
      bool const daytime = vob->type == zenkit::VirtualObjectType::zCVobSoundDaytime;
      if (daytime) {
        RequireClassKeys(env, props,
                         {"soundName", "volume", "radius", "coneAngle", "initiallyPlaying",
                          "ambient3d", "obstruction", "startTime", "endTime", "soundName2"},
                         class_name);
      } else {
        RequireClassKeys(env, props,
                         {"soundName", "volume", "radius", "coneAngle", "initiallyPlaying",
                          "ambient3d", "obstruction"},
                         class_name);
      }
      // Everything read and bounded before anything is assigned, so a refused
      // `endTime` cannot leave a written `soundName` behind it.
      auto sound_name = OptionalCp1252String(env, props, "soundName");
      // No maximum, against ZenKit's "percent (0-100)" doc comment: retail
      // NewWorld holds 130 on two sounds and 150 on four (measured 2026-08-27),
      // so a max of 100 refuses values the game itself ships.
      auto const volume = OptionalFloatIn(env, props, "volume", 0, std::nullopt);
      auto const radius = OptionalFloatIn(env, props, "radius", 0, std::nullopt);
      auto const cone_angle = OptionalFloatIn(env, props, "coneAngle", 0, 360);
      auto const initially_playing = OptionalBool(env, props, "initiallyPlaying");
      auto const ambient3d = OptionalBool(env, props, "ambient3d");
      auto const obstruction = OptionalBool(env, props, "obstruction");
      std::optional<float> start_time;
      std::optional<float> end_time;
      std::optional<std::string> sound_name2;
      if (daytime) {
        // Hours of the day, `13.5` being 13:30. 24 is a bound and not a
        // modulus: a caller meaning midnight means 0.
        start_time = OptionalFloatIn(env, props, "startTime", 0, 24);
        end_time = OptionalFloatIn(env, props, "endTime", 0, 24);
        sound_name2 = OptionalCp1252String(env, props, "soundName2");
      }

      auto& sound = static_cast<zenkit::VSound&>(*vob);
      if (sound_name) sound.sound_name = std::move(*sound_name);
      if (volume) sound.volume = *volume;
      if (radius) sound.radius = *radius;
      if (cone_angle) sound.cone_angle = *cone_angle;
      // `.has_value()` and not `if (initially_playing)`: on a
      // `std::optional<bool>` the two read alike and mean the same thing, but
      // only one of them says so — the condition is "was this key present", not
      // "was it true".
      if (initially_playing.has_value()) sound.initially_playing = *initially_playing;
      if (ambient3d.has_value()) sound.ambient3d = *ambient3d;
      if (obstruction.has_value()) sound.obstruction = *obstruction;
      if (daytime) {
        auto& at_time = static_cast<zenkit::VSoundDaytime&>(*vob);
        if (start_time) at_time.start_time = *start_time;
        if (end_time) at_time.end_time = *end_time;
        if (sound_name2) at_time.sound_name2 = std::move(*sound_name2);
      }
      break;
    }
    // The zones. Only the `Default` variants' base classes are here — a
    // `zCZoneZFogDefault` is the world's fallback fog rather than a placed zone,
    // and giving it a case here without an entry in the catalogue next door
    // would be a class the grid cannot draw and the IPC validator refuses.
    case zenkit::VirtualObjectType::zCZoneVobFarPlane: {
      RequireClassKeys(env, props, {"vobFarPlaneZ", "innerRangePercentage"}, class_name);
      auto const far_plane_z = OptionalFloatIn(env, props, "vobFarPlaneZ", 0, std::nullopt);
      // 0..1, not 0..100 — measured 2026-08-27 over the three retail worlds:
      // every stored value is in [0.1, 1.0] and the `…Default` zones hold
      // exactly 1.0 (100% stored as 1.0). ZenKit's docs say "Unknown", so the
      // measurement is the whole evidence.
      auto const inner = OptionalFloatIn(env, props, "innerRangePercentage", 0, 1);

      auto& zone = static_cast<zenkit::VZoneFarPlane&>(*vob);
      if (far_plane_z) zone.vob_far_plane_z = *far_plane_z;
      if (inner) zone.inner_range_percentage = *inner;
      break;
    }
    case zenkit::VirtualObjectType::zCZoneZFog: {
      RequireClassKeys(
          env, props,
          {"rangeCenter", "innerRangePercentage", "fadeOutSky", "overrideColor", "color"},
          class_name);
      auto const range_center = OptionalFloatIn(env, props, "rangeCenter", 0, std::nullopt);
      // 0..1 by the same measurement as the far-plane case above.
      auto const inner = OptionalFloatIn(env, props, "innerRangePercentage", 0, 1);
      auto const fade_out_sky = OptionalBool(env, props, "fadeOutSky");
      auto const override_color = OptionalBool(env, props, "overrideColor");
      auto const color = OptionalColor(env, props, "color");

      // `overrideColor` decides whether the engine reads that colour at all, and
      // it is now settable beside it — which is what turns a fog colour from a
      // legal write with no visible effect into an edit that can be made to
      // mean something. The two are still independent keys: writing one does not
      // imply the other, because an op that set a flag nobody asked for would
      // build an inverse restoring a value nobody edited.
      auto& fog = static_cast<zenkit::VZoneFog&>(*vob);
      if (range_center) fog.range_center = *range_center;
      if (inner) fog.inner_range_percentage = *inner;
      if (fade_out_sky.has_value()) fog.fade_out_sky = *fade_out_sky;
      if (override_color.has_value()) fog.override_color = *override_color;
      if (color) fog.color = *color;
      break;
    }
    case zenkit::VirtualObjectType::oCZoneMusic: {
      // All six fields now: three booleans, the `int32_t` priority, and the two
      // floats. `priority` goes through OptionalInt32 and not OptionalFloat
      // precisely because the cast is the hazard — `2.5` through a float lands
      // as 2 and reports success.
      RequireClassKeys(env, props,
                       {"enabled", "priority", "ellipsoid", "reverb", "volume", "loop"},
                       class_name);
      auto const enabled = OptionalBool(env, props, "enabled");
      // ZenKit documents `0` as the lowest possible priority, and the floor is
      // now also measured (2026-08-27): across the three retail worlds the
      // observed priorities run 0 (the `oCZoneMusicDefault`s) to 30
      // (AddonWorld), with no negative anywhere.
      auto const priority = OptionalInt32(env, props, "priority", 0, std::nullopt);
      auto const ellipsoid = OptionalBool(env, props, "ellipsoid");
      // Unbounded, both floats: ZenKit documents each as "unclear", ZenGin's
      // reverb level is negative decibels, and a bound invented here is a
      // refusal of data the world already holds.
      auto const reverb = OptionalFloat(env, props, "reverb");
      auto const volume = OptionalFloat(env, props, "volume");
      auto const loop = OptionalBool(env, props, "loop");

      auto& music = static_cast<zenkit::VZoneMusic&>(*vob);
      if (enabled.has_value()) music.enabled = *enabled;
      if (priority) music.priority = *priority;
      if (ellipsoid.has_value()) music.ellipsoid = *ellipsoid;
      if (reverb) music.reverb = *reverb;
      if (volume) music.volume = *volume;
      if (loop.has_value()) music.loop = *loop;
      break;
    }
    // The one field this class has: whether the animation starts running when
    // the level loads. `s_is_running` is save-game only, exactly as the header
    // marks it, so this op has nothing else on the class to write.
    case zenkit::VirtualObjectType::zCVobAnimate: {
      RequireClassKeys(env, props, {"startOn"}, class_name);
      auto const start_on = OptionalBool(env, props, "startOn");
      auto& animate = static_cast<zenkit::VAnimate&>(*vob);
      if (start_on.has_value()) animate.start_on = *start_on;
      break;
    }
    // All three fields now: two plain scalars alongside the boolean that
    // landed first. None is an enum, so nothing on this class is held out by
    // decision.
    case zenkit::VirtualObjectType::zCPFXController: {
      RequireClassKeys(env, props, {"pfxName", "killWhenDone", "initiallyRunning"}, class_name);
      auto pfx_name = OptionalCp1252String(env, props, "pfxName");
      auto const kill_when_done = OptionalBool(env, props, "killWhenDone");
      auto const initially_running = OptionalBool(env, props, "initiallyRunning");
      auto& pfx = static_cast<zenkit::VParticleEffectController&>(*vob);
      if (pfx_name) pfx.pfx_name = std::move(*pfx_name);
      if (kill_when_done.has_value()) pfx.kill_when_done = *kill_when_done;
      if (initially_running.has_value()) pfx.initially_running = *initially_running;
      break;
    }
    // The eight bools and four numerics VTrigger itself declares — this
    // class's entire non-string surface. `target` and `vobTarget` are held
    // out with the rest of the trigger family's target strings.
    case zenkit::VirtualObjectType::zCTrigger: {
      RequireClassKeys(env, props,
                       {"startEnabled", "sendUntrigger", "reactToOnTrigger", "reactToOnTouch",
                        "reactToOnDamage", "respondToObject", "respondToPc", "respondToNpc",
                        "maxActivationCount", "retriggerDelaySec", "damageThreshold",
                        "fireDelaySec"},
                       class_name);
      auto const start_enabled = OptionalBool(env, props, "startEnabled");
      auto const send_untrigger = OptionalBool(env, props, "sendUntrigger");
      auto const react_to_on_trigger = OptionalBool(env, props, "reactToOnTrigger");
      auto const react_to_on_touch = OptionalBool(env, props, "reactToOnTouch");
      auto const react_to_on_damage = OptionalBool(env, props, "reactToOnDamage");
      auto const respond_to_object = OptionalBool(env, props, "respondToObject");
      auto const respond_to_pc = OptionalBool(env, props, "respondToPc");
      auto const respond_to_npc = OptionalBool(env, props, "respondToNpc");
      auto const max_activation_count =
          OptionalInt32(env, props, "maxActivationCount", std::nullopt, std::nullopt);
      auto const retrigger_delay_sec =
          OptionalFloatIn(env, props, "retriggerDelaySec", 0, std::nullopt);
      auto const damage_threshold = OptionalFloatIn(env, props, "damageThreshold", 0, std::nullopt);
      auto const fire_delay_sec = OptionalFloatIn(env, props, "fireDelaySec", 0, std::nullopt);
      auto& trigger = static_cast<zenkit::VTrigger&>(*vob);
      if (start_enabled.has_value()) trigger.start_enabled = *start_enabled;
      if (send_untrigger.has_value()) trigger.send_untrigger = *send_untrigger;
      if (react_to_on_trigger.has_value()) trigger.react_to_on_trigger = *react_to_on_trigger;
      if (react_to_on_touch.has_value()) trigger.react_to_on_touch = *react_to_on_touch;
      if (react_to_on_damage.has_value()) trigger.react_to_on_damage = *react_to_on_damage;
      if (respond_to_object.has_value()) trigger.respond_to_object = *respond_to_object;
      if (respond_to_pc.has_value()) trigger.respond_to_pc = *respond_to_pc;
      if (respond_to_npc.has_value()) trigger.respond_to_npc = *respond_to_npc;
      if (max_activation_count.has_value()) trigger.max_activation_count = *max_activation_count;
      if (retrigger_delay_sec.has_value()) trigger.retrigger_delay_sec = *retrigger_delay_sec;
      if (damage_threshold.has_value()) trigger.damage_threshold = *damage_threshold;
      if (fire_delay_sec.has_value()) trigger.fire_delay_sec = *fire_delay_sec;
      break;
    }
    // The one field this op writes: whether the `OnTrigger` this class fires
    // at level load fires only the first time the level loads. `target` is
    // held out with the rest of the trigger family's target strings, and
    // `s_has_fired` is save-game only, exactly as the header marks it — the
    // same shape as `zCVobAnimate`'s one field.
    case zenkit::VirtualObjectType::zCTriggerWorldStart: {
      RequireClassKeys(env, props, {"fireOnce"}, class_name);
      auto const fire_once = OptionalBool(env, props, "fireOnce");
      auto& world_start = static_cast<zenkit::VTriggerWorldStart&>(*vob);
      if (fire_once.has_value()) world_start.fire_once = *fire_once;
      break;
    }
    // The one field this op writes: the script function it calls when it is
    // about to fire an `OnTrigger`. `target` and the rest of the base
    // `VTrigger` fields are held out with the rest of the trigger family —
    // the same "one field, nothing else to hold out yet" shape as
    // `zCTriggerWorldStart`'s.
    case zenkit::VirtualObjectType::oCTriggerScript: {
      RequireClassKeys(env, props, {"function"}, class_name);
      auto function = OptionalCp1252String(env, props, "function");
      auto& trigger_script = static_cast<zenkit::VTriggerScript&>(*vob);
      if (function) trigger_script.function = std::move(*function);
      break;
    }
    // The base `VTrigger` twelve, plus this class's own two: the level to
    // load and the VObject to place the player at in it. Both are plain
    // config, not cross-references the way `target`/`vobTarget` are — nothing
    // in the world names them back — so they join rather than stay held out
    // with the rest of the family's target strings.
    case zenkit::VirtualObjectType::oCTriggerChangeLevel: {
      RequireClassKeys(env, props,
                       {"startEnabled", "sendUntrigger", "reactToOnTrigger", "reactToOnTouch",
                        "reactToOnDamage", "respondToObject", "respondToPc", "respondToNpc",
                        "maxActivationCount", "retriggerDelaySec", "damageThreshold",
                        "fireDelaySec", "levelName", "startVob"},
                       class_name);
      auto const start_enabled = OptionalBool(env, props, "startEnabled");
      auto const send_untrigger = OptionalBool(env, props, "sendUntrigger");
      auto const react_to_on_trigger = OptionalBool(env, props, "reactToOnTrigger");
      auto const react_to_on_touch = OptionalBool(env, props, "reactToOnTouch");
      auto const react_to_on_damage = OptionalBool(env, props, "reactToOnDamage");
      auto const respond_to_object = OptionalBool(env, props, "respondToObject");
      auto const respond_to_pc = OptionalBool(env, props, "respondToPc");
      auto const respond_to_npc = OptionalBool(env, props, "respondToNpc");
      auto const max_activation_count =
          OptionalInt32(env, props, "maxActivationCount", std::nullopt, std::nullopt);
      auto const retrigger_delay_sec =
          OptionalFloatIn(env, props, "retriggerDelaySec", 0, std::nullopt);
      auto const damage_threshold = OptionalFloatIn(env, props, "damageThreshold", 0, std::nullopt);
      auto const fire_delay_sec = OptionalFloatIn(env, props, "fireDelaySec", 0, std::nullopt);
      auto level_name = OptionalCp1252String(env, props, "levelName");
      auto start_vob = OptionalCp1252String(env, props, "startVob");
      auto& change_level = static_cast<zenkit::VTriggerChangeLevel&>(*vob);
      if (start_enabled.has_value()) change_level.start_enabled = *start_enabled;
      if (send_untrigger.has_value()) change_level.send_untrigger = *send_untrigger;
      if (react_to_on_trigger.has_value()) change_level.react_to_on_trigger = *react_to_on_trigger;
      if (react_to_on_touch.has_value()) change_level.react_to_on_touch = *react_to_on_touch;
      if (react_to_on_damage.has_value()) change_level.react_to_on_damage = *react_to_on_damage;
      if (respond_to_object.has_value()) change_level.respond_to_object = *respond_to_object;
      if (respond_to_pc.has_value()) change_level.respond_to_pc = *respond_to_pc;
      if (respond_to_npc.has_value()) change_level.respond_to_npc = *respond_to_npc;
      if (max_activation_count.has_value()) change_level.max_activation_count = *max_activation_count;
      if (retrigger_delay_sec.has_value()) change_level.retrigger_delay_sec = *retrigger_delay_sec;
      if (damage_threshold.has_value()) change_level.damage_threshold = *damage_threshold;
      if (fire_delay_sec.has_value()) change_level.fire_delay_sec = *fire_delay_sec;
      if (level_name) change_level.level_name = std::move(*level_name);
      if (start_vob) change_level.start_vob = std::move(*start_vob);
      break;
    }
    // The base `VTrigger` twelve, plus thirteen of the fourteen fields
    // `VMover` declares beyond them: two delay/damage floats, three bools,
    // and eight sound names. `behavior`, `lerp_mode` and `speed_mode` are
    // enums and stay out with the rest of the catalogue's enums; `keyframes`
    // is an unbounded list and stays out with the rest of those; the `s_*`
    // fields are save-game only. `speed` is held out for a reason none of the
    // rest of the family has: `VMover::save` writes `moveSpeed` only when
    // `keyframes` is non-empty, which this op cannot author — see
    // zen-world's `vobClasses.ts` for the full "legal write the engine
    // ignores" note.
    case zenkit::VirtualObjectType::zCMover: {
      RequireClassKeys(env, props,
                       {"startEnabled", "sendUntrigger", "reactToOnTrigger", "reactToOnTouch",
                        "reactToOnDamage", "respondToObject", "respondToPc", "respondToNpc",
                        "maxActivationCount", "retriggerDelaySec", "damageThreshold",
                        "fireDelaySec", "touchBlockerDamage", "stayOpenTimeSec", "locked",
                        "autoLink", "autoRotate", "sfxOpenStart", "sfxOpenEnd",
                        "sfxTransitioning", "sfxCloseStart", "sfxCloseEnd", "sfxLock",
                        "sfxUnlock", "sfxUseLocked"},
                       class_name);
      auto const start_enabled = OptionalBool(env, props, "startEnabled");
      auto const send_untrigger = OptionalBool(env, props, "sendUntrigger");
      auto const react_to_on_trigger = OptionalBool(env, props, "reactToOnTrigger");
      auto const react_to_on_touch = OptionalBool(env, props, "reactToOnTouch");
      auto const react_to_on_damage = OptionalBool(env, props, "reactToOnDamage");
      auto const respond_to_object = OptionalBool(env, props, "respondToObject");
      auto const respond_to_pc = OptionalBool(env, props, "respondToPc");
      auto const respond_to_npc = OptionalBool(env, props, "respondToNpc");
      auto const max_activation_count =
          OptionalInt32(env, props, "maxActivationCount", std::nullopt, std::nullopt);
      auto const retrigger_delay_sec =
          OptionalFloatIn(env, props, "retriggerDelaySec", 0, std::nullopt);
      auto const damage_threshold = OptionalFloatIn(env, props, "damageThreshold", 0, std::nullopt);
      auto const fire_delay_sec = OptionalFloatIn(env, props, "fireDelaySec", 0, std::nullopt);
      auto const touch_blocker_damage =
          OptionalFloatIn(env, props, "touchBlockerDamage", 0, std::nullopt);
      auto const stay_open_time_sec =
          OptionalFloatIn(env, props, "stayOpenTimeSec", 0, std::nullopt);
      auto const locked = OptionalBool(env, props, "locked");
      auto const auto_link = OptionalBool(env, props, "autoLink");
      auto const auto_rotate = OptionalBool(env, props, "autoRotate");
      auto sfx_open_start = OptionalCp1252String(env, props, "sfxOpenStart");
      auto sfx_open_end = OptionalCp1252String(env, props, "sfxOpenEnd");
      auto sfx_transitioning = OptionalCp1252String(env, props, "sfxTransitioning");
      auto sfx_close_start = OptionalCp1252String(env, props, "sfxCloseStart");
      auto sfx_close_end = OptionalCp1252String(env, props, "sfxCloseEnd");
      auto sfx_lock = OptionalCp1252String(env, props, "sfxLock");
      auto sfx_unlock = OptionalCp1252String(env, props, "sfxUnlock");
      auto sfx_use_locked = OptionalCp1252String(env, props, "sfxUseLocked");
      auto& mover = static_cast<zenkit::VMover&>(*vob);
      if (start_enabled.has_value()) mover.start_enabled = *start_enabled;
      if (send_untrigger.has_value()) mover.send_untrigger = *send_untrigger;
      if (react_to_on_trigger.has_value()) mover.react_to_on_trigger = *react_to_on_trigger;
      if (react_to_on_touch.has_value()) mover.react_to_on_touch = *react_to_on_touch;
      if (react_to_on_damage.has_value()) mover.react_to_on_damage = *react_to_on_damage;
      if (respond_to_object.has_value()) mover.respond_to_object = *respond_to_object;
      if (respond_to_pc.has_value()) mover.respond_to_pc = *respond_to_pc;
      if (respond_to_npc.has_value()) mover.respond_to_npc = *respond_to_npc;
      if (max_activation_count.has_value()) mover.max_activation_count = *max_activation_count;
      if (retrigger_delay_sec.has_value()) mover.retrigger_delay_sec = *retrigger_delay_sec;
      if (damage_threshold.has_value()) mover.damage_threshold = *damage_threshold;
      if (fire_delay_sec.has_value()) mover.fire_delay_sec = *fire_delay_sec;
      if (touch_blocker_damage.has_value()) mover.touch_blocker_damage = *touch_blocker_damage;
      if (stay_open_time_sec.has_value()) mover.stay_open_time_sec = *stay_open_time_sec;
      if (locked.has_value()) mover.locked = *locked;
      if (auto_link.has_value()) mover.auto_link = *auto_link;
      if (auto_rotate.has_value()) mover.auto_rotate = *auto_rotate;
      if (sfx_open_start) mover.sfx_open_start = std::move(*sfx_open_start);
      if (sfx_open_end) mover.sfx_open_end = std::move(*sfx_open_end);
      if (sfx_transitioning) mover.sfx_transitioning = std::move(*sfx_transitioning);
      if (sfx_close_start) mover.sfx_close_start = std::move(*sfx_close_start);
      if (sfx_close_end) mover.sfx_close_end = std::move(*sfx_close_end);
      if (sfx_lock) mover.sfx_lock = std::move(*sfx_lock);
      if (sfx_unlock) mover.sfx_unlock = std::move(*sfx_unlock);
      if (sfx_use_locked) mover.sfx_use_locked = std::move(*sfx_use_locked);
      break;
    }
    case zenkit::VirtualObjectType::oCMOB: {
      RequireClassKeys(env, props,
                       {"focusName", "hp", "damage", "movable", "takable", "focusOverride",
                        "visualDestroyed", "owner", "ownerGuild", "destroyed"},
                       class_name);
      auto focus_name = OptionalCp1252String(env, props, "focusName");
      auto const hp = OptionalInt32(env, props, "hp", std::nullopt, std::nullopt);
      auto const damage = OptionalInt32(env, props, "damage", std::nullopt, std::nullopt);
      auto const movable = OptionalBool(env, props, "movable");
      auto const takable = OptionalBool(env, props, "takable");
      auto const focus_override = OptionalBool(env, props, "focusOverride");
      auto visual_destroyed = OptionalCp1252String(env, props, "visualDestroyed");
      auto owner = OptionalCp1252String(env, props, "owner");
      auto owner_guild = OptionalCp1252String(env, props, "ownerGuild");
      auto const destroyed = OptionalBool(env, props, "destroyed");
      auto& mob = static_cast<zenkit::VMovableObject&>(*vob);
      if (focus_name) mob.name = std::move(*focus_name);
      if (hp.has_value()) mob.hp = *hp;
      if (damage.has_value()) mob.damage = *damage;
      if (movable.has_value()) mob.movable = *movable;
      if (takable.has_value()) mob.takable = *takable;
      if (focus_override.has_value()) mob.focus_override = *focus_override;
      if (visual_destroyed) mob.visual_destroyed = std::move(*visual_destroyed);
      if (owner) mob.owner = std::move(*owner);
      if (owner_guild) mob.owner_guild = std::move(*owner_guild);
      if (destroyed.has_value()) mob.destroyed = *destroyed;
      break;
    }
    case zenkit::VirtualObjectType::oCMobInter:
    case zenkit::VirtualObjectType::oCMobLadder:
    case zenkit::VirtualObjectType::oCMobSwitch:
    case zenkit::VirtualObjectType::oCMobWheel: {
      RequireClassKeys(env, props,
                       {"focusName", "hp", "damage", "movable", "takable", "focusOverride",
                        "visualDestroyed", "owner", "ownerGuild", "destroyed", "stateCount",
                        "conditionFunction", "onStateChangeFunction", "rewind"},
                       class_name);
      auto focus_name = OptionalCp1252String(env, props, "focusName");
      auto const hp = OptionalInt32(env, props, "hp", std::nullopt, std::nullopt);
      auto const damage = OptionalInt32(env, props, "damage", std::nullopt, std::nullopt);
      auto const movable = OptionalBool(env, props, "movable");
      auto const takable = OptionalBool(env, props, "takable");
      auto const focus_override = OptionalBool(env, props, "focusOverride");
      auto visual_destroyed = OptionalCp1252String(env, props, "visualDestroyed");
      auto owner = OptionalCp1252String(env, props, "owner");
      auto owner_guild = OptionalCp1252String(env, props, "ownerGuild");
      auto const destroyed = OptionalBool(env, props, "destroyed");
      auto const state_count = OptionalInt32(env, props, "stateCount", std::nullopt, std::nullopt);
      auto condition_function = OptionalCp1252String(env, props, "conditionFunction");
      auto on_state_change_function = OptionalCp1252String(env, props, "onStateChangeFunction");
      auto const rewind = OptionalBool(env, props, "rewind");
      auto& mob = static_cast<zenkit::VInteractiveObject&>(*vob);
      if (focus_name) mob.name = std::move(*focus_name);
      if (hp.has_value()) mob.hp = *hp;
      if (damage.has_value()) mob.damage = *damage;
      if (movable.has_value()) mob.movable = *movable;
      if (takable.has_value()) mob.takable = *takable;
      if (focus_override.has_value()) mob.focus_override = *focus_override;
      if (visual_destroyed) mob.visual_destroyed = std::move(*visual_destroyed);
      if (owner) mob.owner = std::move(*owner);
      if (owner_guild) mob.owner_guild = std::move(*owner_guild);
      if (destroyed.has_value()) mob.destroyed = *destroyed;
      if (state_count.has_value()) mob.state_count = *state_count;
      if (condition_function) mob.condition_function = std::move(*condition_function);
      if (on_state_change_function) mob.on_state_change_function = std::move(*on_state_change_function);
      if (rewind.has_value()) mob.rewind = *rewind;
      break;
    }
    case zenkit::VirtualObjectType::oCMobFire: {
      RequireClassKeys(env, props,
                       {"focusName", "hp", "damage", "movable", "takable", "focusOverride",
                        "visualDestroyed", "owner", "ownerGuild", "destroyed", "stateCount",
                        "conditionFunction", "onStateChangeFunction", "rewind", "slot", "vobTree"},
                       class_name);
      auto focus_name = OptionalCp1252String(env, props, "focusName");
      auto const hp = OptionalInt32(env, props, "hp", std::nullopt, std::nullopt);
      auto const damage = OptionalInt32(env, props, "damage", std::nullopt, std::nullopt);
      auto const movable = OptionalBool(env, props, "movable");
      auto const takable = OptionalBool(env, props, "takable");
      auto const focus_override = OptionalBool(env, props, "focusOverride");
      auto visual_destroyed = OptionalCp1252String(env, props, "visualDestroyed");
      auto owner = OptionalCp1252String(env, props, "owner");
      auto owner_guild = OptionalCp1252String(env, props, "ownerGuild");
      auto const destroyed = OptionalBool(env, props, "destroyed");
      auto const state_count = OptionalInt32(env, props, "stateCount", std::nullopt, std::nullopt);
      auto condition_function = OptionalCp1252String(env, props, "conditionFunction");
      auto on_state_change_function = OptionalCp1252String(env, props, "onStateChangeFunction");
      auto const rewind = OptionalBool(env, props, "rewind");
      auto slot = OptionalCp1252String(env, props, "slot");
      auto vob_tree = OptionalCp1252String(env, props, "vobTree");
      auto& mob = static_cast<zenkit::VFire&>(*vob);
      if (focus_name) mob.name = std::move(*focus_name);
      if (hp.has_value()) mob.hp = *hp;
      if (damage.has_value()) mob.damage = *damage;
      if (movable.has_value()) mob.movable = *movable;
      if (takable.has_value()) mob.takable = *takable;
      if (focus_override.has_value()) mob.focus_override = *focus_override;
      if (visual_destroyed) mob.visual_destroyed = std::move(*visual_destroyed);
      if (owner) mob.owner = std::move(*owner);
      if (owner_guild) mob.owner_guild = std::move(*owner_guild);
      if (destroyed.has_value()) mob.destroyed = *destroyed;
      if (state_count.has_value()) mob.state_count = *state_count;
      if (condition_function) mob.condition_function = std::move(*condition_function);
      if (on_state_change_function) mob.on_state_change_function = std::move(*on_state_change_function);
      if (rewind.has_value()) mob.rewind = *rewind;
      if (slot) mob.slot = std::move(*slot);
      if (vob_tree) mob.vob_tree = std::move(*vob_tree);
      break;
    }
    case zenkit::VirtualObjectType::oCMobContainer: {
      RequireClassKeys(env, props,
                       {"focusName", "hp", "damage", "movable", "takable", "focusOverride",
                        "visualDestroyed", "owner", "ownerGuild", "destroyed", "stateCount",
                        "conditionFunction", "onStateChangeFunction", "rewind", "locked",
                        "pickString"},
                       class_name);
      auto focus_name = OptionalCp1252String(env, props, "focusName");
      auto const hp = OptionalInt32(env, props, "hp", std::nullopt, std::nullopt);
      auto const damage = OptionalInt32(env, props, "damage", std::nullopt, std::nullopt);
      auto const movable = OptionalBool(env, props, "movable");
      auto const takable = OptionalBool(env, props, "takable");
      auto const focus_override = OptionalBool(env, props, "focusOverride");
      auto visual_destroyed = OptionalCp1252String(env, props, "visualDestroyed");
      auto owner = OptionalCp1252String(env, props, "owner");
      auto owner_guild = OptionalCp1252String(env, props, "ownerGuild");
      auto const destroyed = OptionalBool(env, props, "destroyed");
      auto const state_count = OptionalInt32(env, props, "stateCount", std::nullopt, std::nullopt);
      auto condition_function = OptionalCp1252String(env, props, "conditionFunction");
      auto on_state_change_function = OptionalCp1252String(env, props, "onStateChangeFunction");
      auto const rewind = OptionalBool(env, props, "rewind");
      auto const locked = OptionalBool(env, props, "locked");
      auto pick_string = OptionalCp1252String(env, props, "pickString");
      auto& mob = static_cast<zenkit::VContainer&>(*vob);
      if (focus_name) mob.name = std::move(*focus_name);
      if (hp.has_value()) mob.hp = *hp;
      if (damage.has_value()) mob.damage = *damage;
      if (movable.has_value()) mob.movable = *movable;
      if (takable.has_value()) mob.takable = *takable;
      if (focus_override.has_value()) mob.focus_override = *focus_override;
      if (visual_destroyed) mob.visual_destroyed = std::move(*visual_destroyed);
      if (owner) mob.owner = std::move(*owner);
      if (owner_guild) mob.owner_guild = std::move(*owner_guild);
      if (destroyed.has_value()) mob.destroyed = *destroyed;
      if (state_count.has_value()) mob.state_count = *state_count;
      if (condition_function) mob.condition_function = std::move(*condition_function);
      if (on_state_change_function) mob.on_state_change_function = std::move(*on_state_change_function);
      if (rewind.has_value()) mob.rewind = *rewind;
      if (locked.has_value()) mob.locked = *locked;
      if (pick_string) mob.pick_string = std::move(*pick_string);
      break;
    }
    case zenkit::VirtualObjectType::oCMobDoor: {
      RequireClassKeys(env, props,
                       {"focusName", "hp", "damage", "movable", "takable", "focusOverride",
                        "visualDestroyed", "owner", "ownerGuild", "destroyed", "stateCount",
                        "conditionFunction", "onStateChangeFunction", "rewind", "locked",
                        "pickString"},
                       class_name);
      auto focus_name = OptionalCp1252String(env, props, "focusName");
      auto const hp = OptionalInt32(env, props, "hp", std::nullopt, std::nullopt);
      auto const damage = OptionalInt32(env, props, "damage", std::nullopt, std::nullopt);
      auto const movable = OptionalBool(env, props, "movable");
      auto const takable = OptionalBool(env, props, "takable");
      auto const focus_override = OptionalBool(env, props, "focusOverride");
      auto visual_destroyed = OptionalCp1252String(env, props, "visualDestroyed");
      auto owner = OptionalCp1252String(env, props, "owner");
      auto owner_guild = OptionalCp1252String(env, props, "ownerGuild");
      auto const destroyed = OptionalBool(env, props, "destroyed");
      auto const state_count = OptionalInt32(env, props, "stateCount", std::nullopt, std::nullopt);
      auto condition_function = OptionalCp1252String(env, props, "conditionFunction");
      auto on_state_change_function = OptionalCp1252String(env, props, "onStateChangeFunction");
      auto const rewind = OptionalBool(env, props, "rewind");
      auto const locked = OptionalBool(env, props, "locked");
      auto pick_string = OptionalCp1252String(env, props, "pickString");
      auto& mob = static_cast<zenkit::VDoor&>(*vob);
      if (focus_name) mob.name = std::move(*focus_name);
      if (hp.has_value()) mob.hp = *hp;
      if (damage.has_value()) mob.damage = *damage;
      if (movable.has_value()) mob.movable = *movable;
      if (takable.has_value()) mob.takable = *takable;
      if (focus_override.has_value()) mob.focus_override = *focus_override;
      if (visual_destroyed) mob.visual_destroyed = std::move(*visual_destroyed);
      if (owner) mob.owner = std::move(*owner);
      if (owner_guild) mob.owner_guild = std::move(*owner_guild);
      if (destroyed.has_value()) mob.destroyed = *destroyed;
      if (state_count.has_value()) mob.state_count = *state_count;
      if (condition_function) mob.condition_function = std::move(*condition_function);
      if (on_state_change_function) mob.on_state_change_function = std::move(*on_state_change_function);
      if (rewind.has_value()) mob.rewind = *rewind;
      if (locked.has_value()) mob.locked = *locked;
      if (pick_string) mob.pick_string = std::move(*pick_string);
      break;
    }
    default:
      throw Napi::Error::New(env,
                             "no class properties are known for a " + std::string {class_name});
  }

  return env.Undefined();
}

// The visual object for a name a caller is **authoring**.
//
// This derives the class from the extension, which is exactly what setVobProp
// refuses to do — and for the opposite reason. Renaming an existing visual has a
// fact to preserve: `.3DS` is `zCProgMeshProto` 20,716 times and `zCMesh` 31
// times across the retail corpus, and nothing in the name says which, so the
// object found on the VOB is kept. A *new* visual has no such fact, and the
// majority reading is the only defensible choice.
//
// The class must be a concrete one, never the `Visual` base: the writer derives
// the object's class name from its type, and a base-class visual produces a
// world that cannot be re-loaded at all — a 0xC0000409 fail-fast with no
// diagnostic (see src/fixture.cc).
std::shared_ptr<zenkit::Visual> AuthorVisual(Napi::Env env, std::string const& name) {
  auto const dot = name.rfind('.');
  if (dot == std::string::npos || dot + 1 >= name.size()) {
    throw Napi::Error::New(env, "opts.visual: '" + name + "' has no extension to author from");
  }
  std::string ext = name.substr(dot + 1);
  for (char& c : ext) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));

  if (ext == "3DS") {
    auto v = std::make_shared<zenkit::VisualMultiResolutionMesh>();
    v->name = name;
    v->type = zenkit::VisualType::MULTI_RESOLUTION_MESH;
    return v;
  }
  if (ext == "ASC" || ext == "MDS") {
    auto v = std::make_shared<zenkit::VisualModel>();
    v->name = name;
    v->type = zenkit::VisualType::MODEL;
    return v;
  }
  if (ext == "MMS") {
    auto v = std::make_shared<zenkit::VisualMorphMesh>();
    v->name = name;
    v->type = zenkit::VisualType::MORPH_MESH;
    return v;
  }
  if (ext == "PFX") {
    auto v = std::make_shared<zenkit::VisualParticleEffect>();
    v->name = name;
    v->type = zenkit::VisualType::PARTICLE_EFFECT;
    return v;
  }
  if (ext == "TGA") {
    // A zCDecal carries its own dimension, offset, alpha function and weight. One
    // authored without them is a visual ZenGin never wrote, so this refuses
    // rather than inventing them.
    throw Napi::Error::New(
        env, "opts.visual: a decal (.TGA) carries its own dimensions and alpha settings, "
             "which this call does not take");
  }
  throw Napi::Error::New(env, "opts.visual: no visual class is known for '" + ext + "'");
}

// The classes `insertVob` can author (level-editor.md §16.15, I1).
//
// A closed set, and it has to be: **the class is the object's C++ type**, not a
// field, so nothing can turn a `zCVob` into an `oCItem` afterwards —
// `setVobClassProp` resolves the VOB and switches on the type it really has.
// And ZenKit's structs have uninitialized fields, so each class needs its own
// field-complete construction rather than a type tag. A class with no
// construction here is refused rather than authored as a bare `zCVob` wearing
// its name.
enum class NewVobClass {
  kZCVob,
  kOCItem,
  kZCVobLight,
  kZCVobSound,
  kZCVobSoundDaytime,
  // The trigger family (I3). Two of these names are the trap: everyday speech
  // says `zCTriggerScript` and `zCTriggerChangeLevel`, and a world spells both
  // with the `oC` prefix -- which is the spelling `zen-world`'s
  // `AUTHORABLE_VOB_CLASSES` carries, so the two lists agree.
  kZCTrigger,
  kZCTriggerList,
  kOCTriggerScript,
  kOCTriggerChangeLevel,
  kZCMover,
  kZCCodeMaster,
  kZCMessageFilter,
};

NewVobClass ParseNewVobClass(Napi::Env env, Napi::Value value) {
  if (value.IsUndefined()) return NewVobClass::kZCVob;
  if (!value.IsString()) {
    throw Napi::TypeError::New(env, "opts.class must be the name of a class this can author");
  }
  std::string const str = value.As<Napi::String>().Utf8Value();
  if (str == "zCVob") return NewVobClass::kZCVob;
  if (str == "oCItem") return NewVobClass::kOCItem;
  if (str == "zCVobLight") return NewVobClass::kZCVobLight;
  if (str == "zCVobSound") return NewVobClass::kZCVobSound;
  if (str == "zCVobSoundDaytime") return NewVobClass::kZCVobSoundDaytime;
  if (str == "zCTrigger") return NewVobClass::kZCTrigger;
  if (str == "zCTriggerList") return NewVobClass::kZCTriggerList;
  if (str == "oCTriggerScript") return NewVobClass::kOCTriggerScript;
  if (str == "oCTriggerChangeLevel") return NewVobClass::kOCTriggerChangeLevel;
  if (str == "zCMover") return NewVobClass::kZCMover;
  if (str == "zCCodeMaster") return NewVobClass::kZCCodeMaster;
  if (str == "zCMessageFilter") return NewVobClass::kZCMessageFilter;
  throw Napi::Error::New(env, "opts.class: no construction is known for '" + str + "'");
}

// The base half of a sound, shared by `zCVobSound` and the `zCVobSoundDaytime`
// that derives from it — the same inheritance the catalogue's entry spells out,
// rather than two lists that would have to agree by hand.
//
// **Every default here is the retail majority measured over NewWorld, OldWorld
// and AddonWorld's 1,237 sounds (2026-08-28), not ZenKit's struct default**, and
// two of them differ: retail loops where ZenKit plays once, and retail leaves
// obstruction off where ZenKit turns it on. `mode` matters most because it is an
// *enum*, which the class catalogue deliberately holds no field for — so a
// placed sound keeps the mode chosen here forever, and once is not what an
// ambient sound placed in a world means.
void AuthorSoundFields(zenkit::VSound& sound) {
  sound.volume = 100.0f;  // the median, and the cap on all but six retail sounds
  sound.mode = zenkit::SoundMode::LOOP;
  // Read by the engine only in RANDOM mode, which nothing can select.
  sound.random_delay = 0.0f;
  sound.random_delay_var = 0.0f;
  sound.initially_playing = true;  // 1,207 of 1,237
  sound.ambient3d = false;
  sound.obstruction = false;
  sound.cone_angle = 0.0f;  // every retail sound; there are no directional cones
  sound.volume_type = zenkit::SoundTriggerVolumeType::SPHERICAL;
  sound.radius = 1500.0f;  // the median of NewWorld and AddonWorld alike
  // The one field only the caller can fill, and `setVobClassProp` is where —
  // there is no name to invent, and an empty one plays nothing rather than
  // resolving to something wrong.
  sound.sound_name = "";
  // Save-game only and not default-initialized in ZenKit, exactly like an
  // `oCItem`'s `s_amount`. `VAnimate` seeds the first from `start_on` at load,
  // so this does the same rather than leaving it indeterminate.
  sound.s_is_running = sound.initially_playing;
  sound.s_is_allowed_to_run = true;
}

// The half of a trigger every class in the family shares (I3) -- the eight of
// `VTrigger`'s twelve fields that retail agrees about across all 294 of its
// `zCTrigger`, `zCTriggerList`, `oCTriggerScript`, `oCTriggerChangeLevel` and
// `zCMover` VOBs (measured 2026-08-28 over NewWorld, OldWorld and AddonWorld).
//
// **The other four are set per class and not here**, because the family does
// not agree about them: a mover is fired at and never touched, a plain trigger
// is touched by almost everything, and a script trigger is for the player
// alone. One shared answer would be wrong for four of the five classes.
//
// `target` and `vob_target` are empty because there is no name to invent -- and
// the class catalogue holds no field for either, so **a placed trigger fires at
// nothing until that changes**. That is not a defect of this construction: it
// is equally true of every retail trigger the property grid can already edit,
// and it is written down in `zen-world`'s `vobClasses.ts`.
void AuthorTriggerFields(zenkit::VTrigger& trigger) {
  trigger.target = "";
  trigger.vob_target = "";
  trigger.start_enabled = true;        // 291 of 294
  trigger.react_to_on_trigger = true;  // 272 of 294
  trigger.react_to_on_damage = false;  // 257 of 294
  trigger.respond_to_pc = true;        // every one of the 294
  // ZenKit documents -1 as "process an infinite number of events", and it is
  // also retail's majority (218 of 294) -- the reason the catalogue leaves the
  // field unbounded below.
  trigger.max_activation_count = -1;
  trigger.retrigger_delay_sec = 0.0f;
  trigger.damage_threshold = 0.0f;
  trigger.fire_delay_sec = 0.0f;
  // The deprecated packed bytes. `VTrigger::save` rebuilds both from the bools
  // above and the two `reserved_*` members (which ZenKit does default), so
  // these are read by nothing -- but they are members with no initializer, and
  // the rule for a construction is that no field is left to the stack.
  trigger.flags = 0;
  trigger.filter_flags = 0;
}

// insertVob(handle, parentPath | null, opts) — appends a VOB of the class
// `opts.class` names to a parent's children, or to the roots when the parent is
// null, and returns its index path.
//
// **A null parent renumbers nothing and a parent renumbers.** Every VOB is
// enumerated depth-first and its flat index is its position in that traversal,
// so appending a root is the one insertion that shifts nothing: it is
// enumerated last and takes the index one past the end. Appended under a parent
// the new VOB is enumerated in the middle, and every VOB after that parent's
// subtree moves up one. What makes that safe is not this call but the discipline
// of the history that uses it — the same answer `reparentVob` needed: the redo
// stack is cleared on every new edit and batches replay strictly LIFO, so an op
// is only ever applied to a world in the enumeration it was recorded against.
// The caller's own guard is the narrower one: an insert with a parent has to be
// alone in its batch, because the other ops in it carry paths resolved before it
// ran.
//
// It appends rather than taking a slot. Unlike a reparent, which has to be able
// to put a VOB back exactly where it came from, an insert's inverse is a delete
// of the VOB it just made — and the end of the list is where a delete leaves no
// hole to reason about.
Napi::Value InsertVob(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);

  std::vector<std::size_t> parent_indices;
  bool const has_parent = !(info[1].IsNull() || info[1].IsUndefined());
  if (has_parent) parent_indices = ParseIndexPath(env, info[1], "parentPath");

  if (!info[2].IsObject() || info[2].IsArray()) {
    throw Napi::TypeError::New(env, "opts must be an object with at least a position");
  }
  auto opts = info[2].As<Napi::Object>();

  static constexpr std::array<char const*, 12> kKnownKeys {
      "class",     "instance", "name",      "visual",    "position", "rotation",
      "bbox",      "showVisual", "cdStatic", "cdDynamic", "vobStatic", "ambient"};
  auto names = opts.GetPropertyNames();
  for (std::uint32_t i = 0; i < names.Length(); ++i) {
    std::string const key = names.Get(i).As<Napi::String>().Utf8Value();
    if (std::find_if(kKnownKeys.begin(), kKnownKeys.end(),
                     [&key](char const* known) { return key == known; }) == kKnownKeys.end()) {
      throw Napi::Error::New(env, "opts: unknown property '" + key + "'");
    }
  }

  auto position = Vec3FromValue(env, opts.Get("position"), "opts.position");

  std::string name;
  if (!opts.Get("name").IsUndefined()) name = RequiredCp1252String(env, opts, "name");

  std::shared_ptr<zenkit::Visual> visual;
  if (!opts.Get("visual").IsUndefined()) {
    visual = AuthorVisual(env, RequiredCp1252String(env, opts, "visual"));
  }

  std::vector<float> rotation {1, 0, 0, 0, 1, 0, 0, 0, 1};
  if (!opts.Get("rotation").IsUndefined()) {
    rotation = FloatsFromValue(env, opts.Get("rotation"), 9, "opts.rotation");
  }

  // A box around the position unless the caller has one — and it will, because
  // it owns the asset layer and the box is a pure function of (visual, rotation,
  // position).
  constexpr float kDefaultHalfExtent = 10.0f;
  std::vector<float> bbox {
      position.x - kDefaultHalfExtent, position.y - kDefaultHalfExtent,
      position.z - kDefaultHalfExtent, position.x + kDefaultHalfExtent,
      position.y + kDefaultHalfExtent, position.z + kDefaultHalfExtent};
  if (!opts.Get("bbox").IsUndefined()) {
    bbox = FloatsFromValue(env, opts.Get("bbox"), 6, "opts.bbox");
  }

  auto const show_visual = OptionalBool(env, opts, "showVisual");
  auto const cd_static = OptionalBool(env, opts, "cdStatic");
  auto const cd_dynamic = OptionalBool(env, opts, "cdDynamic");
  auto const vob_static = OptionalBool(env, opts, "vobStatic");
  auto const ambient = OptionalBool(env, opts, "ambient");

  // The class first, because it decides which fields exist at all — and every
  // refusal below happens before anything is appended, so a refused call leaves
  // the world exactly as it was.
  auto const vob_class = ParseNewVobClass(env, opts.Get("class"));
  bool const has_instance = !opts.Get("instance").IsUndefined();
  // Refused rather than dropped: no class below has an instance field, so naming
  // one is a mistake about the class and not a value to ignore.
  auto RefuseInstance = [&] {
    if (has_instance) {
      throw Napi::Error::New(env, "opts.instance: only an oCItem carries an instance");
    }
  };

  std::shared_ptr<zenkit::VirtualObject> vob;
  // Whether a VOB claims to draw when the caller has not said. A `zCVob` with
  // nothing to draw does not claim otherwise; an `oCItem` does, because the
  // engine derives an item's visual from its script instance rather than from
  // this file.
  bool default_show_visual = false;

  if (vob_class == NewVobClass::kOCItem) {
    // The name of a script instance, and the field that makes an item an item:
    // without one the engine has nothing to spawn. Mirrors the fixture's VItem
    // construction (src/fixture.cc) — every field it initializes is initialized
    // here, because ZenKit structs have uninitialized fields.
    if (!has_instance) {
      throw Napi::Error::New(env, "opts.instance is required for an oCItem");
    }
    auto item = std::make_shared<zenkit::VItem>();
    item->type = zenkit::VirtualObjectType::oCItem;
    item->instance = RequiredCp1252String(env, opts, "instance");
    // Save-game only fields, not default-initialized in ZenKit.
    item->s_amount = 0;
    item->s_flags = 0;
    vob = item;
    default_show_visual = true;
  } else if (vob_class == NewVobClass::kZCVobLight) {
    RefuseInstance();
    // A light retail could have written, on the majority measured over the three
    // retail worlds (2026-08-28) — where three of ZenKit's own defaults are
    // values retail never writes at all: SPOT (every one of 4,649 lights is
    // POINT), MEDIUM quality (LOW is the majority) and `can_move` (false on
    // every one of the 1,111 dynamic lights).
    auto light = std::make_shared<zenkit::VLight>();
    light->type = zenkit::VirtualObjectType::zCVobLight;
    // **Dynamic, and it is not a preference.** A static light is baked into the
    // world when its lighting is compiled, so one added to a compiled world
    // lights nothing until somebody recompiles it; and `is_static` decides
    // *which fields the archive contains*, which is why the catalogue has no
    // field for it and why the choice made here is the one the placed VOB keeps.
    light->is_static = false;
    light->on = true;
    light->light_type = zenkit::LightType::POINT;
    light->range = 400.0f;  // the median of retail's dynamic lights
    // White, where retail's colours are as varied as its scenes: the two fields
    // a user changes first are this and the range, and both are in the
    // catalogue. A black light would read as the editor having done nothing.
    light->color = zenkit::Color {255, 255, 255, 255};
    light->cone_angle = 0.0f;  // ignored by a POINT light, and zero in retail
    light->quality = zenkit::LightQuality::LOW;
    // Self-contained: no preset template to resolve, no lensflare, no animation.
    // 105 of retail's dynamic lights name no preset either, so this is a shape
    // the engine already reads.
    light->preset = "";
    light->lensflare_fx = "";
    light->range_animation_scale = {};
    light->range_animation_fps = 0.0f;
    light->range_animation_smooth = true;
    light->color_animation_list = {};
    light->color_animation_fps = 0.0f;
    light->color_animation_smooth = true;
    light->can_move = false;
    vob = light;
  } else if (vob_class == NewVobClass::kZCVobSound) {
    RefuseInstance();
    auto sound = std::make_shared<zenkit::VSound>();
    sound->type = zenkit::VirtualObjectType::zCVobSound;
    AuthorSoundFields(*sound);
    vob = sound;
  } else if (vob_class == NewVobClass::kZCVobSoundDaytime) {
    RefuseInstance();
    auto sound = std::make_shared<zenkit::VSoundDaytime>();
    sound->type = zenkit::VirtualObjectType::zCVobSoundDaytime;
    AuthorSoundFields(*sound);
    // The medians of retail's 84 daytime sounds: awake at 6, quiet at 20. A
    // window rather than the zero-width one ZenKit's defaults would give, which
    // is a daytime sound that is never its own daytime.
    sound->start_time = 6.0f;
    sound->end_time = 20.0f;
    sound->sound_name2 = "";
    vob = sound;
  } else if (vob_class == NewVobClass::kZCTrigger) {
    RefuseInstance();
    auto trigger = std::make_shared<zenkit::VTrigger>();
    trigger->type = zenkit::VirtualObjectType::zCTrigger;
    AuthorTriggerFields(*trigger);
    // Retail's 47 plain triggers: touched (35), sending no untrigger (36), and
    // responding to objects (26) as well as to NPCs (31).
    trigger->send_untrigger = false;
    trigger->react_to_on_touch = true;
    trigger->respond_to_object = true;
    trigger->respond_to_npc = true;
    vob = trigger;
  } else if (vob_class == NewVobClass::kZCTriggerList) {
    RefuseInstance();
    auto list = std::make_shared<zenkit::VTriggerList>();
    list->type = zenkit::VirtualObjectType::zCTriggerList;
    AuthorTriggerFields(*list);
    // Retail's 44 lists: reached by an event, not by a touch (39).
    list->send_untrigger = false;
    list->react_to_on_touch = false;
    list->respond_to_object = true;
    list->respond_to_npc = true;
    // ALL on every one of the 44, and an enum -- so what is chosen here is what
    // a placed list keeps, the same permanence a sound's `mode` has. `targets`
    // is an unbounded list the catalogue cannot author either, so a placed list
    // relays to nobody yet.
    list->mode = zenkit::TriggerBatchMode::ALL;
    list->targets = {};
    vob = list;
  } else if (vob_class == NewVobClass::kOCTriggerScript) {
    RefuseInstance();
    auto script = std::make_shared<zenkit::VTriggerScript>();
    script->type = zenkit::VirtualObjectType::oCTriggerScript;
    AuthorTriggerFields(*script);
    // Retail's 46 script triggers: they send an untrigger (43) and they are for
    // the player -- not for objects (29) and not for NPCs (25).
    script->send_untrigger = true;
    script->react_to_on_touch = true;
    script->respond_to_object = false;
    script->respond_to_npc = false;
    // The one field only the caller can fill, and `setVobClassProp` is where --
    // the same shape as a sound's name. An empty one calls nothing rather than
    // naming a Daedalus function that may not exist.
    script->function = "";
    vob = script;
  } else if (vob_class == NewVobClass::kOCTriggerChangeLevel) {
    RefuseInstance();
    auto change = std::make_shared<zenkit::VTriggerChangeLevel>();
    change->type = zenkit::VirtualObjectType::oCTriggerChangeLevel;
    AuthorTriggerFields(*change);
    // All 7 retail level changers are touched by the player and by nothing
    // else, and 5 of the 7 send an untrigger.
    change->send_untrigger = true;
    change->react_to_on_touch = true;
    change->respond_to_object = false;
    change->respond_to_npc = false;
    // Both are catalogued, so the grid fills them; empty here means the level
    // changer does nothing rather than naming a level that does not exist.
    change->level_name = "";
    change->start_vob = "";
    vob = change;
  } else if (vob_class == NewVobClass::kZCMover) {
    RefuseInstance();
    auto mover = std::make_shared<zenkit::VMover>();
    mover->type = zenkit::VirtualObjectType::zCMover;
    AuthorTriggerFields(*mover);
    // Retail's 150 movers: fired at (150), never touched (148), responding to
    // objects (147) and to NPCs (144), and sending an untrigger (91).
    mover->send_untrigger = true;
    mover->react_to_on_touch = false;
    mover->respond_to_object = true;
    mover->respond_to_npc = true;
    mover->behavior = zenkit::MoverBehavior::TOGGLE;  // 126 of 150
    mover->touch_blocker_damage = 0.0f;
    mover->stay_open_time_sec = 2.0f;  // 129 of 150; ZenKit's default is 0
    // **False on every one of retail's 150, against ZenKit's `true`** -- and
    // `locked` is catalogued, so this one is the user's to change.
    mover->locked = false;
    mover->auto_link = false;
    mover->auto_rotate = false;  // 139 of 150
    // Written by `VMover::save` only when `keyframes` is non-empty, which this
    // cannot author -- so all four are the shape of a mover that takes its
    // animation from its visual.
    //
    // **`lerp_mode` is CURVE against retail's own majority** (LINEAR, 89 of
    // 150), and that is the round-trip talking rather than the sweep: with no
    // keyframes the field never reaches the archive, so `load` gives a reloaded
    // mover ZenKit's CURVE whatever was authored. LINEAR here would make the
    // VOB differ from itself across a save -- caught by the reload test, which
    // is the only instrument that can see a field the writer drops.
    mover->speed = 0.0f;
    mover->lerp_mode = zenkit::MoverLerpType::CURVE;
    mover->speed_mode = zenkit::MoverSpeedType::CONSTANT;  // 73 of 150, and
                                                           // ZenKit's default
    mover->keyframes = {};
    // Empty on the majority of retail movers for all eight, and each is a
    // catalogued field the grid can fill.
    mover->sfx_open_start = "";
    mover->sfx_open_end = "";
    mover->sfx_transitioning = "";
    mover->sfx_close_start = "";
    mover->sfx_close_end = "";
    mover->sfx_lock = "";
    mover->sfx_unlock = "";
    mover->sfx_use_locked = "";
    // Save-game only and not default-initialized, exactly like an `oCItem`'s
    // `s_amount`.
    mover->s_act_key_pos_delta = zenkit::Vec3 {0, 0, 0};
    mover->s_act_keyframe_f = 0.0f;
    mover->s_act_keyframe = 0;
    mover->s_next_keyframe = 0;
    mover->s_move_speed_unit = 0.0f;
    mover->s_advance_dir = 0.0f;
    mover->s_mover_state = 0;
    mover->s_trigger_event_count = 0;
    mover->s_stay_open_time_dest = 0.0f;
    vob = mover;
  } else if (vob_class == NewVobClass::kZCCodeMaster) {
    RefuseInstance();
    // Not a `VTrigger` -- a code master derives straight from `zCVob`, so none
    // of the twelve applies to it.
    auto master = std::make_shared<zenkit::VCodeMaster>();
    master->type = zenkit::VirtualObjectType::zCCodeMaster;
    // Retail's 7: unordered (6), never cancelled by an untrigger (7).
    master->target = "";
    master->ordered = false;
    master->first_false_is_failure = false;
    master->failure_target = "";
    master->untriggered_cancels = false;
    // The list that makes a code master do anything, and an unbounded one the
    // catalogue cannot author -- so a placed master watches nobody yet.
    master->slaves = {};
    master->s_num_triggered_slaves = 0;  // save-game only, not initialized
    vob = master;
  } else if (vob_class == NewVobClass::kZCMessageFilter) {
    RefuseInstance();
    auto filter = std::make_shared<zenkit::VMessageFilter>();
    filter->type = zenkit::VirtualObjectType::zCMessageFilter;
    filter->target = "";
    // Retail's 26 filters split four ways and TRIGGER is the plurality of both
    // fields (8 each) rather than a majority. Both are enums the catalogue
    // holds no field for, so this is what a placed filter keeps -- the same
    // permanence, and the same caveat, as a sound's `mode`.
    filter->on_trigger = zenkit::MessageFilterAction::TRIGGER;
    filter->on_untrigger = zenkit::MessageFilterAction::TRIGGER;
    vob = filter;
  } else {
    RefuseInstance();
    auto plain = std::make_shared<zenkit::VirtualObject>();
    plain->type = zenkit::VirtualObjectType::zCVob;
    vob = plain;
    default_show_visual = visual != nullptr;
  }

  // Every field ZenKit does not default-initialize is set here — the base-class
  // half, which every class above shares.
  vob->vob_name = std::move(name);
  vob->position = position;
  vob->rotation = zenkit::Mat3 {rotation[0], rotation[3], rotation[6],
                                rotation[1], rotation[4], rotation[7],
                                rotation[2], rotation[5], rotation[8]};
  vob->bbox = zenkit::AxisAlignedBoundingBox {zenkit::Vec3 {bbox[0], bbox[1], bbox[2]},
                                              zenkit::Vec3 {bbox[3], bbox[4], bbox[5]}};
  vob->visual = visual;
  vob->show_visual = show_visual ? *show_visual : default_show_visual;
  vob->cd_static = cd_static ? *cd_static : true;
  vob->cd_dynamic = cd_dynamic ? *cd_dynamic : true;
  vob->vob_static = vob_static ? *vob_static : false;
  vob->ambient = ambient ? *ambient : false;
  vob->physics_enabled = false;

  auto* list = has_parent ? &ResolveVob(env, *handle, parent_indices, "parentPath")->children
                          : &handle->world->world_vobs;
  list->push_back(vob);

  std::string landed;
  if (has_parent) {
    for (std::size_t const index : parent_indices) landed += std::to_string(index) + "/";
  }
  landed += std::to_string(list->size() - 1);
  return Napi::String::New(env, landed);
}

// deleteVob(handle, indexPath) — removes the vob and its whole subtree.
//
// The subtree goes with it because a child is reachable only through its parent:
// leaving one behind would orphan it into a tree nothing enumerates. Callers
// that mean to keep the children have to move them first, which is the reparent
// this does not yet have.
Napi::Value DeleteVob(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  auto indices = ParseIndexPath(env, info[1], "indexPath");

  // Resolve the parent's list and the slot inside it, rather than the vob: the
  // vob itself does not know where it is held.
  auto* list = &handle->world->world_vobs;
  for (std::size_t at = 0; at + 1 < indices.size(); ++at) {
    std::size_t const index = indices[at];
    if (index >= list->size() || (*list)[index] == nullptr) {
      throw Napi::Error::New(env, "no vob at indexPath");
    }
    list = &(*list)[index]->children;
  }

  std::size_t const slot = indices.back();
  if (slot >= list->size() || (*list)[slot] == nullptr) {
    throw Napi::Error::New(env, "no vob at indexPath");
  }
  list->erase(list->begin() + static_cast<std::ptrdiff_t>(slot));
  return env.Undefined();
}

// reparentVob(handle, fromPath, toParentPath | null, slot) — moves a vob and its
// whole subtree into another parent's children, at a given slot, and returns the
// index path it landed at.
//
// **It renumbers, and there is no slot that does not.** `insertVob` avoids the
// question by appending a root, which is enumerated last; a move has two ends
// and everything between them shifts. What makes that safe is not this call but
// the discipline of the history that uses it: `WorldService` clears the redo
// stack on every new edit and replays batches strictly LIFO, so an op is only
// ever applied to a world in the enumeration it was recorded against. The
// renderer's projection is the part that cannot follow, and it is re-read whole,
// exactly as an insert re-reads it.
//
// It takes the destination slot rather than appending because that is what makes
// it invertible: putting a vob back at the *end* of the list it came from is a
// different world from the one it left.
Napi::Value ReparentVob(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);

  auto from = ParseIndexPath(env, info[1], "fromPath");
  bool const to_root = info[2].IsNull() || info[2].IsUndefined();
  std::vector<std::size_t> to_parent;
  if (!to_root) to_parent = ParseIndexPath(env, info[2], "toParentPath");

  if (!info[3].IsNumber()) {
    throw Napi::TypeError::New(env, "slot must be a number");
  }
  double const slot_raw = info[3].As<Napi::Number>().DoubleValue();
  if (slot_raw < 0 || slot_raw != std::floor(slot_raw)) {
    throw Napi::Error::New(env, "slot must be a non-negative whole number");
  }
  auto slot = static_cast<std::size_t>(slot_raw);

  // A subtree moved into its own descendant is unreachable from the roots: it is
  // not enumerated, not counted and not written, so it would simply disappear at
  // the next save. Refused before anything is touched.
  if (!to_root && to_parent.size() >= from.size()
      && std::equal(from.begin(), from.end(), to_parent.begin())) {
    throw Napi::Error::New(env, "cannot reparent a vob into itself or its own descendant");
  }

  // Resolve the source's holding list and validate the whole path, including the
  // destination, before removing anything — a half-done move has no inverse.
  auto* from_list = &handle->world->world_vobs;
  for (std::size_t at = 0; at + 1 < from.size(); ++at) {
    std::size_t const index = from[at];
    if (index >= from_list->size() || (*from_list)[index] == nullptr) {
      throw Napi::Error::New(env, "no vob at fromPath");
    }
    from_list = &(*from_list)[index]->children;
  }
  std::size_t const from_slot = from.back();
  if (from_slot >= from_list->size() || (*from_list)[from_slot] == nullptr) {
    throw Napi::Error::New(env, "no vob at fromPath");
  }
  if (!to_root) ResolveVob(env, *handle, to_parent, "toParentPath");

  // The removal vacates a slot, and the destination may be numbered *after* it in
  // the same list — in which case the caller's slot means the list as it will be
  // once the vob is gone. Both the destination path and the slot have to account
  // for that, or the same move is off by one in one direction and out of range in
  // the other.
  if (!to_root && to_parent.size() >= from.size()
      && std::equal(from.begin(), from.end() - 1, to_parent.begin())
      && to_parent[from.size() - 1] > from_slot) {
    to_parent[from.size() - 1] -= 1;
  }

  auto vob = (*from_list)[from_slot];
  from_list->erase(from_list->begin() + static_cast<std::ptrdiff_t>(from_slot));

  auto* to_list = to_root ? &handle->world->world_vobs
                          : &ResolveVob(env, *handle, to_parent, "toParentPath")->children;

  // One past the end is an append; two is a gap, and a gap is what the writer
  // cannot represent. Checked after the removal because that is the list the slot
  // is an index into — and the vob is put back before throwing, so a refused call
  // changes nothing.
  if (slot > to_list->size()) {
    from_list->insert(from_list->begin() + static_cast<std::ptrdiff_t>(from_slot), vob);
    throw Napi::Error::New(env, "slot is out of range for the destination's children");
  }

  to_list->insert(to_list->begin() + static_cast<std::ptrdiff_t>(slot), vob);

  std::string landed;
  if (!to_root) {
    for (std::size_t const index : to_parent) landed += std::to_string(index) + "/";
  }
  landed += std::to_string(slot);
  return Napi::String::New(env, landed);
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

zenkit_node::FixtureVariant ParseFixtureVariant(Napi::Env env, Napi::Value value) {
  if (value.IsUndefined() || value.IsNull()) return zenkit_node::FixtureVariant::kMinimal;
  if (!value.IsString()) {
    throw Napi::TypeError::New(
        env, "variant must be 'minimal', 'mesh-extraction', 'npc' or 'camera'");
  }
  std::string const str = value.As<Napi::String>().Utf8Value();
  if (str == "minimal") return zenkit_node::FixtureVariant::kMinimal;
  if (str == "mesh-extraction") return zenkit_node::FixtureVariant::kMeshExtraction;
  if (str == "npc") return zenkit_node::FixtureVariant::kNpc;
  if (str == "camera") return zenkit_node::FixtureVariant::kCamera;
  throw Napi::TypeError::New(
      env, "variant must be 'minimal', 'mesh-extraction', 'npc' or 'camera', got '" + str + "'");
}

// Internal: authors a fixture world. The 'minimal' variant is the checked-in
// golden and is only invoked through the explicit `fixtures:regen` script;
// 'mesh-extraction', 'npc' and 'camera' are authored into a temp directory by
// the tests.
// The optional fifth argument selects the unpacked `zCVob` write path when it
// is false; it exists only so a test can reach a writer nothing else calls.
Napi::Value AuthorFixtureWorld(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto path = PathFromValue(env, info[0]);
  auto format = ParseArchiveFormat(env, info[1]);
  auto version = ParseGameVersion(env, info[2]);
  auto variant = ParseFixtureVariant(env, info[3]);
  bool packed_vobs = true;
  if (!info[4].IsUndefined() && !info[4].IsNull()) {
    if (!info[4].IsBoolean()) {
      throw Napi::TypeError::New(env, "packedVobs must be a boolean");
    }
    packed_vobs = info[4].As<Napi::Boolean>().Value();
  }

  try {
    zenkit_node::AuthorFixtureWorld(path, format, version, variant, packed_vobs);
  } catch (Napi::Error&) {
    throw;
  } catch (std::exception const& e) {
    throw Napi::Error::New(env, std::string {"failed to author fixture world: "} + e.what());
  }
  return env.Undefined();
}

// Internal: authors the Phase 1a asset fixtures into a directory. Test-only,
// like _authorFixtureWorld's 'mesh-extraction' variant — nothing here is
// checked in.
Napi::Value AuthorFixtureAssets(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto dir = PathFromValue(env, info[0]);

  try {
    zenkit_node::AuthorFixtureAssets(dir);
  } catch (Napi::Error&) {
    throw;
  } catch (std::exception const& e) {
    throw Napi::Error::New(env, std::string {"failed to author fixture assets: "} + e.what());
  }
  return env.Undefined();
}

// The ABI-affecting ZenKit definitions THIS addon was compiled with. ZenKit
// sets them as PUBLIC CMake compile definitions and `_ZK_WITH_MMAP` changes
// the layout of `zenkit::Vfs`, so an addon built without them silently
// allocates a smaller Vfs than the library initialises. Reported here so a
// test can compare it against what the vendored library was actually built
// with (scripts/zenkit-defines.js) instead of trusting the build to agree.
Napi::Array ZenkitAbi(Napi::Env env) {
  auto abi = Napi::Array::New(env);
  std::uint32_t i = 0;
#ifdef _ZK_WITH_MMAP
  abi.Set(i++, Napi::String::New(env, "_ZK_WITH_MMAP=1"));
#endif
#ifdef _ZK_WITH_ZIPPED_VDF
  abi.Set(i++, Napi::String::New(env, "_ZK_WITH_ZIPPED_VDF=1"));
#endif
  return abi;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("zenkitVersion", Napi::String::New(env, ZENKIT_NODE_ZENKIT_VERSION));
  exports.Set("zenkitAbi", ZenkitAbi(env));
  exports.Set("loadWorld", Napi::Function::New(env, LoadWorld));
  exports.Set("worldStats", Napi::Function::New(env, WorldStats));
  exports.Set("vobNames", Napi::Function::New(env, VobNames));
  exports.Set("normalizeWorld", Napi::Function::New(env, NormalizeWorld));
  exports.Set("vobIndex", Napi::Function::New(env, VobIndex));
  exports.Set("getWaynet", Napi::Function::New(env, GetWaynet));
  exports.Set("extractWorldMesh", Napi::Function::New(env, ExtractWorldMesh));
  exports.Set("openVfs", Napi::Function::New(env, zenkit_node::OpenVfs));
  exports.Set("vfsResolve", Napi::Function::New(env, zenkit_node::VfsResolve));
  exports.Set("vfsList", Napi::Function::New(env, zenkit_node::VfsList));
  exports.Set("extractVisual", Napi::Function::New(env, zenkit_node::ExtractVisual));
  exports.Set("decodeTexture", Napi::Function::New(env, zenkit_node::DecodeTexture));
  exports.Set("_drillMesh", Napi::Function::New(env, DrillMesh));
  exports.Set("saveWorld", Napi::Function::New(env, SaveWorld));
  exports.Set("setVobPosition", Napi::Function::New(env, SetVobPosition));
  exports.Set("setVobRotation", Napi::Function::New(env, SetVobRotation));
  exports.Set("setVobProp", Napi::Function::New(env, SetVobProp));
  exports.Set("getVobProps", Napi::Function::New(env, GetVobProps));
  exports.Set("setVobClassProp", Napi::Function::New(env, SetVobClassProp));
  exports.Set("insertVob", Napi::Function::New(env, InsertVob));
  exports.Set("deleteVob", Napi::Function::New(env, DeleteVob));
  exports.Set("reparentVob", Napi::Function::New(env, ReparentVob));
  exports.Set("setWaypointPosition", Napi::Function::New(env, SetWaypointPosition));
  exports.Set("setWaypointName", Napi::Function::New(env, SetWaypointName));
  exports.Set("addWaypoint", Napi::Function::New(env, AddWaypoint));
  exports.Set("removeWaypoint", Napi::Function::New(env, RemoveWaypoint));
  exports.Set("addWaypointEdge", Napi::Function::New(env, AddWaypointEdge));
  exports.Set("removeWaypointEdge", Napi::Function::New(env, RemoveWaypointEdge));
  exports.Set("_authorFixtureWorld", Napi::Function::New(env, AuthorFixtureWorld));
  exports.Set("_authorFixtureAssets", Napi::Function::New(env, AuthorFixtureAssets));
  return exports;
}

}  // namespace

NODE_API_MODULE(zenkit_node, Init)
