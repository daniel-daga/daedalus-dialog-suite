// N-API binding around ZenKit (docs/plans/level-editor.md §4).
#include <napi.h>

#include <zenkit/Archive.hh>
#include <zenkit/Misc.hh>
#include <zenkit/Stream.hh>
#include <zenkit/World.hh>
#include <zenkit/vobs/Misc.hh>
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
  exports.Set("insertItemVob", Napi::Function::New(env, InsertItemVob));
  exports.Set("_authorFixtureWorld", Napi::Function::New(env, AuthorFixtureWorld));
  exports.Set("_authorFixtureAssets", Napi::Function::New(env, AuthorFixtureAssets));
  return exports;
}

}  // namespace

NODE_API_MODULE(zenkit_node, Init)
