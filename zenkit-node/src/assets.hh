// The asset layer: a ZenGin VFS and the visual/texture payloads read out of it
// (level-editor.md §4). All read-only projections — no writer path is touched
// and no fidelity claim is made.
#pragma once

#include <napi.h>

#include <zenkit/Vfs.hh>

#include <memory>
#include <string>

namespace zenkit_node {

// Owns a mounted VFS for the lifetime of the JS handle.
struct VfsHandle {
  zenkit::Vfs vfs;
};

// openVfs(paths) — mounts VDF/MOD archives and loose directories into one
// namespace, later paths winning. Returns a handle.
Napi::Value OpenVfs(Napi::CallbackInfo const& info);

// vfsResolve(handle, name) — the compiled asset name a visual or texture name
// maps to, or null when nothing matches. Exposed because the mapping is a
// guess-free lookup the asset browser and the tests both need to see.
Napi::Value VfsResolve(Napi::CallbackInfo const& info);

// vfsList(handle, path) — the children of one directory in the mounted
// namespace, as { name, type }, or null when the path is absent or is a file.
// One level, never a recursive walk: a Gothic install is tens of thousands of
// entries and an asset browser shows one directory at a time.
Napi::Value VfsList(Napi::CallbackInfo const& info);

// extractVisual(handle, name) — a VOB visual as render-ready buffers in the
// same chunk shape extractWorldMesh emits. Null when the asset is absent or
// its type carries no static geometry.
Napi::Value ExtractVisual(Napi::CallbackInfo const& info);

// decodeTexture(handle, name) — a ZTEX decoded to RGBA8. Null when absent.
Napi::Value DecodeTexture(Napi::CallbackInfo const& info);

}  // namespace zenkit_node
