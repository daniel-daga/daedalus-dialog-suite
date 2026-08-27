// N-API binding around ZenKit (docs/plans/level-editor.md §4).
#include <napi.h>

#include <zenkit/Archive.hh>
#include <zenkit/Misc.hh>
#include <zenkit/Stream.hh>
#include <zenkit/World.hh>
#include <zenkit/vobs/Light.hh>
#include <zenkit/vobs/Misc.hh>
#include <zenkit/vobs/Sound.hh>
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

Napi::Value SetVobProp(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);
  auto indices = ParseIndexPath(env, info[1], "indexPath");

  if (!info[2].IsObject() || info[2].IsArray()) {
    throw Napi::TypeError::New(env, "props must be an object");
  }
  auto props = info[2].As<Napi::Object>();

  static constexpr std::array<char const*, 9> kKnownKeys {
      "name",     "visual",   "bbox",    "showVisual",     "cdStatic",
      "cdDynamic", "vobStatic", "ambient", "physicsEnabled"};
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

  auto const show_visual = OptionalBool(env, props, "showVisual");
  auto const cd_static = OptionalBool(env, props, "cdStatic");
  auto const cd_dynamic = OptionalBool(env, props, "cdDynamic");
  auto const vob_static = OptionalBool(env, props, "vobStatic");
  auto const ambient = OptionalBool(env, props, "ambient");
  auto const physics_enabled = OptionalBool(env, props, "physicsEnabled");

  auto vob = ResolveVob(env, *handle, indices, "indexPath");

  if (has_visual && (vob->visual == nullptr || vob->visual->type == zenkit::VisualType::UNKNOWN)) {
    throw Napi::Error::New(
        env, "props.visual: this vob has no visual object to rename — giving it one replaces "
             "the object and has to decide its class");
  }

  if (has_name) vob->vob_name = std::move(name);
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
    // `volumeType` are enums; `initiallyPlaying`, `ambient3d` and `obstruction`
    // are booleans and the catalogue has no boolean kind; and `randomDelay` /
    // `randomDelayVar` are read by the engine only when `mode` is RANDOM, which
    // is a mode this op cannot set.
    case zenkit::VirtualObjectType::zCVobSound:
    case zenkit::VirtualObjectType::zCVobSoundDaytime: {
      bool const daytime = vob->type == zenkit::VirtualObjectType::zCVobSoundDaytime;
      if (daytime) {
        RequireClassKeys(env, props,
                         {"soundName", "volume", "radius", "coneAngle", "startTime", "endTime",
                          "soundName2"},
                         class_name);
      } else {
        RequireClassKeys(env, props, {"soundName", "volume", "radius", "coneAngle"}, class_name);
      }
      // Everything read and bounded before anything is assigned, so a refused
      // `endTime` cannot leave a written `soundName` behind it.
      auto sound_name = OptionalCp1252String(env, props, "soundName");
      auto const volume = OptionalFloatIn(env, props, "volume", 0, 100);
      auto const radius = OptionalFloatIn(env, props, "radius", 0, std::nullopt);
      auto const cone_angle = OptionalFloatIn(env, props, "coneAngle", 0, 360);
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
      // Not bounded above at 1 or at 100: nothing measured says which of the two
      // conventions ZenGin stores here, and a bound guessed wrong refuses a
      // retail value the world already contains.
      auto const inner = OptionalFloatIn(env, props, "innerRangePercentage", 0, std::nullopt);

      auto& zone = static_cast<zenkit::VZoneFarPlane&>(*vob);
      if (far_plane_z) zone.vob_far_plane_z = *far_plane_z;
      if (inner) zone.inner_range_percentage = *inner;
      break;
    }
    case zenkit::VirtualObjectType::zCZoneZFog: {
      RequireClassKeys(env, props, {"rangeCenter", "innerRangePercentage", "color"}, class_name);
      auto const range_center = OptionalFloatIn(env, props, "rangeCenter", 0, std::nullopt);
      auto const inner = OptionalFloatIn(env, props, "innerRangePercentage", 0, std::nullopt);
      auto const color = OptionalColor(env, props, "color");

      // `overrideColor` decides whether the engine reads that colour at all, and
      // it is a boolean this op cannot set — so writing a fog colour on a zone
      // that does not override is a legal write with no visible effect, not a
      // refusal.
      auto& fog = static_cast<zenkit::VZoneFog&>(*vob);
      if (range_center) fog.range_center = *range_center;
      if (inner) fog.inner_range_percentage = *inner;
      if (color) fog.color = *color;
      break;
    }
    case zenkit::VirtualObjectType::oCZoneMusic: {
      // Two floats out of six fields. `enabled`, `ellipsoid` and `loop` are
      // booleans and `priority` is an `int32_t`; the catalogue has neither kind,
      // and writing an integer field through a float would truncate silently.
      RequireClassKeys(env, props, {"reverb", "volume"}, class_name);
      // Unbounded, both of them: ZenKit documents each as "unclear", ZenGin's
      // reverb level is negative decibels, and a bound invented here is a
      // refusal of data the world already holds.
      auto const reverb = OptionalFloat(env, props, "reverb");
      auto const volume = OptionalFloat(env, props, "volume");

      auto& music = static_cast<zenkit::VZoneMusic&>(*vob);
      if (reverb) music.reverb = *reverb;
      if (volume) music.volume = *volume;
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

// insertVob(handle, parentPath | null, opts) — appends a zCVob to a parent's
// children, or to the roots when the parent is null, and returns its index path.
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

  static constexpr std::array<char const*, 10> kKnownKeys {
      "name",      "visual",   "position", "rotation", "bbox",
      "showVisual", "cdStatic", "cdDynamic", "vobStatic", "ambient"};
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

  // A box around the position, the same shape insertItemVob uses, unless the
  // caller has one — and it will, because it owns the asset layer and the box is
  // a pure function of (visual, rotation, position).
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

  // Every field ZenKit does not default-initialize is set here, as
  // insertItemVob's construction is.
  auto vob = std::make_shared<zenkit::VirtualObject>();
  vob->type = zenkit::VirtualObjectType::zCVob;
  vob->vob_name = std::move(name);
  vob->position = position;
  vob->rotation = zenkit::Mat3 {rotation[0], rotation[3], rotation[6],
                                rotation[1], rotation[4], rotation[7],
                                rotation[2], rotation[5], rotation[8]};
  vob->bbox = zenkit::AxisAlignedBoundingBox {zenkit::Vec3 {bbox[0], bbox[1], bbox[2]},
                                              zenkit::Vec3 {bbox[3], bbox[4], bbox[5]}};
  vob->visual = visual;
  // A VOB with nothing to draw does not claim otherwise.
  vob->show_visual = show_visual ? *show_visual : (visual != nullptr);
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

// insertItemVob(handle, parentPath | null, {name, instance, position}) —
// appends a new oCItem vob and returns its index path. The visual is left
// empty: the engine derives item visuals from the script instance.
Napi::Value InsertItemVob(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapHandle(env, info[0]);

  std::vector<std::size_t> parent_indices;
  bool const has_parent = !(info[1].IsNull() || info[1].IsUndefined());
  if (has_parent) {
    parent_indices = ParseIndexPath(env, info[1], "parentPath");
  }

  if (!info[2].IsObject()) {
    throw Napi::TypeError::New(env, "opts must be an object with name, instance and position");
  }
  auto opts = info[2].As<Napi::Object>();
  auto name = RequiredCp1252String(env, opts, "name");
  auto instance = RequiredCp1252String(env, opts, "instance");
  auto position = Vec3FromValue(env, opts.Get("position"), "opts.position");

  // Mirrors the fixture's VItem construction (src/fixture.cc): every field it
  // initializes is initialized here; ZenKit structs have uninitialized fields.
  auto item = std::make_shared<zenkit::VItem>();
  item->type = zenkit::VirtualObjectType::oCItem;
  item->vob_name = std::move(name);
  item->instance = std::move(instance);
  item->position = position;
  item->rotation = zenkit::Mat3::identity();
  item->show_visual = true;
  constexpr float kItemBboxHalfExtent = 10.0f;  // engine units (cm)
  item->bbox = zenkit::AxisAlignedBoundingBox {
      zenkit::Vec3 {position.x - kItemBboxHalfExtent, position.y - kItemBboxHalfExtent,
                    position.z - kItemBboxHalfExtent},
      zenkit::Vec3 {position.x + kItemBboxHalfExtent, position.y + kItemBboxHalfExtent,
                    position.z + kItemBboxHalfExtent}};
  // Save-game only fields, not default-initialized in ZenKit.
  item->s_amount = 0;
  item->s_flags = 0;

  std::string child_path;
  if (has_parent) {
    auto parent = ResolveVob(env, *handle, parent_indices, "parentPath");
    parent->children.push_back(item);
    child_path = info[1].As<Napi::String>().Utf8Value() + "/" +
                 std::to_string(parent->children.size() - 1);
  } else {
    handle->world->world_vobs.push_back(item);
    child_path = std::to_string(handle->world->world_vobs.size() - 1);
  }
  return Napi::String::New(env, child_path);
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
    throw Napi::TypeError::New(env, "variant must be 'minimal' or 'mesh-extraction'");
  }
  std::string const str = value.As<Napi::String>().Utf8Value();
  if (str == "minimal") return zenkit_node::FixtureVariant::kMinimal;
  if (str == "mesh-extraction") return zenkit_node::FixtureVariant::kMeshExtraction;
  throw Napi::TypeError::New(
      env, "variant must be 'minimal' or 'mesh-extraction', got '" + str + "'");
}

// Internal: authors a fixture world. The 'minimal' variant is the checked-in
// golden and is only invoked through the explicit `fixtures:regen` script;
// 'mesh-extraction' is authored into a temp directory by the tests.
Napi::Value AuthorFixtureWorld(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto path = PathFromValue(env, info[0]);
  auto format = ParseArchiveFormat(env, info[1]);
  auto version = ParseGameVersion(env, info[2]);
  auto variant = ParseFixtureVariant(env, info[3]);

  try {
    zenkit_node::AuthorFixtureWorld(path, format, version, variant);
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
  exports.Set("insertItemVob", Napi::Function::New(env, InsertItemVob));
  exports.Set("_authorFixtureWorld", Napi::Function::New(env, AuthorFixtureWorld));
  exports.Set("_authorFixtureAssets", Napi::Function::New(env, AuthorFixtureAssets));
  return exports;
}

}  // namespace

NODE_API_MODULE(zenkit_node, Init)
