#include "assets.hh"

#include <zenkit/Mesh.hh>
#include <zenkit/Model.hh>
#include <zenkit/ModelMesh.hh>
#include <zenkit/MorphMesh.hh>
#include <zenkit/MultiResolutionMesh.hh>
#include <zenkit/Stream.hh>
#include <zenkit/Texture.hh>

#include <algorithm>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <string>
#include <vector>

#include "mesh_extract.hh"
#include "napi_helpers.hh"

namespace zenkit_node {

namespace {

using namespace zenkit;

std::string Upper(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
    return static_cast<char>(std::toupper(c));
  });
  return value;
}

bool EndsWith(std::string const& value, std::string_view suffix) {
  return value.size() >= suffix.size() &&
      value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

std::string StripExtension(std::string const& name) {
  auto const dot = name.rfind('.');
  return dot == std::string::npos ? name : name.substr(0, dot);
}

// ZenGin VOBs name their *source* assets (.3DS, .ASC, .MDS, .MMS) while the VFS
// holds what the asset compiler produced. The mapping is fixed and documented,
// so it is spelled out rather than probed: guessing an asset is how the wrong
// mesh ends up on screen with nothing reporting a problem.
std::vector<std::string> VisualCandidates(std::string const& name) {
  auto const upper = Upper(name);
  auto const stem = StripExtension(upper);

  if (EndsWith(upper, ".3DS")) return {stem + ".MRM", stem + ".MSH"};
  if (EndsWith(upper, ".ASC") || EndsWith(upper, ".MDS")) return {stem + ".MDL", stem + ".MDM"};
  if (EndsWith(upper, ".MMS")) return {stem + ".MMB"};
  return {upper};
}

// A compiled ZTEX is the source name with the "-C" suffix ZenGin's texture
// compiler appends: NW_HARBOUR_01.TGA -> NW_HARBOUR_01-C.TEX.
std::vector<std::string> TextureCandidates(std::string const& name) {
  auto const upper = Upper(name);
  if (EndsWith(upper, ".TEX")) return {upper};
  return {StripExtension(upper) + "-C.TEX", upper};
}

VfsNode const* FindFirst(Vfs const& vfs,
                         std::vector<std::string> const& candidates,
                         std::string* resolved) {
  for (auto const& candidate : candidates) {
    auto const* node = vfs.find(candidate);
    if (node != nullptr && node->type() == VfsNodeType::FILE) {
      if (resolved != nullptr) *resolved = candidate;
      return node;
    }
  }
  return nullptr;
}

VfsHandle* UnwrapVfs(Napi::Env env, Napi::Value value) {
  if (!value.IsExternal()) {
    throw Napi::TypeError::New(env, "expected a VFS handle returned by openVfs()");
  }
  auto* handle = value.As<Napi::External<VfsHandle>>().Data();
  if (handle == nullptr) throw Napi::Error::New(env, "invalid VFS handle");
  return handle;
}

std::string StringArg(Napi::Env env, Napi::Value value, char const* what) {
  if (!value.IsString()) {
    throw Napi::TypeError::New(env, std::string {what} + " must be a string");
  }
  return value.As<Napi::String>().Utf8Value();
}

std::filesystem::path PathArg(Napi::Env env, Napi::Value value) {
  if (!value.IsString()) throw Napi::TypeError::New(env, "each VFS path must be a string");
  std::u16string const utf16 = value.As<Napi::String>().Utf16Value();
  return std::filesystem::path {std::wstring {utf16.begin(), utf16.end()}};
}

}  // namespace

Napi::Value OpenVfs(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  if (!info[0].IsArray()) {
    throw Napi::TypeError::New(env, "openVfs(paths) expects an array of paths");
  }
  auto paths = info[0].As<Napi::Array>();

  auto overwrite = VfsOverwriteBehavior::ALL;
  if (info[1].IsObject()) {
    auto value = info[1].As<Napi::Object>().Get("overwrite");
    if (value.IsString()) {
      auto const mode = value.As<Napi::String>().Utf8Value();
      if (mode == "all") overwrite = VfsOverwriteBehavior::ALL;
      else if (mode == "none") overwrite = VfsOverwriteBehavior::NONE;
      else if (mode == "newer") overwrite = VfsOverwriteBehavior::NEWER;
      else if (mode == "older") overwrite = VfsOverwriteBehavior::OLDER;
      else throw Napi::TypeError::New(env, "overwrite must be 'all', 'none', 'newer' or 'older'");
    }
  }

  auto handle = std::make_unique<VfsHandle>();
  for (std::uint32_t i = 0; i < paths.Length(); ++i) {
    auto path = PathArg(env, paths.Get(i));
    std::error_code ec {};
    bool const is_directory = std::filesystem::is_directory(path, ec);
    if (ec) throw Napi::Error::New(env, "cannot stat VFS path: " + path.string());

    try {
      // Later paths win, so a mod directory listed after the retail VDFs
      // overrides them — the load order ZenGin itself uses.
      if (is_directory) {
        handle->vfs.mount_host(path, "/", overwrite);
      } else {
        handle->vfs.mount_disk(path, overwrite);
      }
    } catch (std::exception const& e) {
      throw Napi::Error::New(env, "failed to mount '" + path.string() + "': " + e.what());
    }
  }

  return Napi::External<VfsHandle>::New(env, handle.release(),
                                        [](Napi::Env, VfsHandle* data) { delete data; });
}

Napi::Value VfsResolve(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapVfs(env, info[0]);
  auto name = StringArg(env, info[1], "name");

  std::string resolved;
  auto candidates = VisualCandidates(name);
  auto const& textures = TextureCandidates(name);
  candidates.insert(candidates.end(), textures.begin(), textures.end());

  if (FindFirst(handle->vfs, candidates, &resolved) == nullptr) return env.Null();
  return Napi::String::New(env, resolved);
}

Napi::Value ExtractVisual(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapVfs(env, info[0]);
  auto name = StringArg(env, info[1], "name");

  std::string resolved;
  auto const* node = FindFirst(handle->vfs, VisualCandidates(name), &resolved);
  if (node == nullptr) return env.Null();

  try {
    auto reader = node->open_read();
    Napi::Object payload;

    if (EndsWith(resolved, ".MRM")) {
      MultiResolutionMesh mesh {};
      mesh.load(reader.get());
      payload = ExtractProtoMesh(env, mesh);
    } else if (EndsWith(resolved, ".MSH")) {
      Mesh mesh {};
      // Compiled .MSH visuals are the same zCMesh class as the world mesh.
      mesh.load(reader.get(), false);
      payload = ExtractMesh(env, mesh, true);
    } else if (EndsWith(resolved, ".MMB")) {
      MorphMesh mesh {};
      mesh.load(reader.get());
      payload = ExtractProtoMesh(env, mesh.mesh);
    } else if (EndsWith(resolved, ".MDM") || EndsWith(resolved, ".MDL")) {
      ModelMesh model {};
      if (EndsWith(resolved, ".MDL")) {
        Model full {};
        full.load(reader.get());
        model = std::move(full.mesh);
      } else {
        model.load(reader.get());
      }
      // The bind pose only: the soft-skin weights and the node hierarchy are an
      // animation concern the editor has no use for yet. A model with several
      // soft-skin meshes contributes each one's geometry.
      if (model.meshes.empty()) return env.Null();
      payload = ExtractProtoMesh(env, model.meshes.front().mesh);
    } else {
      return env.Null();
    }

    payload.Set("source", Napi::String::New(env, resolved));
    return payload;
  } catch (Napi::Error&) {
    throw;
  } catch (std::exception& e) {
    throw Napi::Error::New(env,
                           "failed to extract visual '" + resolved + "': " + std::string {e.what()});
  }
}

Napi::Value DecodeTexture(Napi::CallbackInfo const& info) {
  Napi::Env env = info.Env();
  auto* handle = UnwrapVfs(env, info[0]);
  auto name = StringArg(env, info[1], "name");

  std::uint32_t level = 0;
  if (info[2].IsNumber()) {
    auto const requested = info[2].As<Napi::Number>().DoubleValue();
    if (requested < 0) throw Napi::TypeError::New(env, "mipmap level must not be negative");
    level = static_cast<std::uint32_t>(requested);
  }

  std::string resolved;
  auto const* node = FindFirst(handle->vfs, TextureCandidates(name), &resolved);
  if (node == nullptr) return env.Null();

  try {
    auto reader = node->open_read();
    Texture texture {};
    texture.load(reader.get());

    if (level >= texture.mipmaps()) {
      throw Napi::Error::New(env, "mipmap level " + std::to_string(level) + " does not exist in '" +
                                      resolved + "' (" + std::to_string(texture.mipmaps()) +
                                      " levels)");
    }

    // ZTEX ships DXT1/3/5 and palettised formats; as_rgba8 is ZenKit's decoder
    // for all of them, so the renderer never sees a compressed format it would
    // have to special-case.
    auto rgba = texture.as_rgba8(level);

    auto payload = Napi::Object::New(env);
    payload.Set("source", Napi::String::New(env, resolved));
    payload.Set("width", Napi::Number::New(env, texture.mipmap_width(level)));
    payload.Set("height", Napi::Number::New(env, texture.mipmap_height(level)));
    payload.Set("mipmaps", Napi::Number::New(env, texture.mipmaps()));
    payload.Set("rgba", Buffer(env, rgba));
    return payload;
  } catch (Napi::Error&) {
    throw;
  } catch (std::exception& e) {
    throw Napi::Error::New(env,
                           "failed to decode texture '" + resolved + "': " + std::string {e.what()});
  }
}

}  // namespace zenkit_node
