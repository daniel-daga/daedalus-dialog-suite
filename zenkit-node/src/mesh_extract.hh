// extractWorldMesh(handle) — the world mesh as render-ready buffers, chunked
// by material (level-editor.md §3, §4). A read-only projection: it touches no
// save()/WriteArchive machinery and makes no fidelity claim.
#pragma once

#include <napi.h>

#include "world_handle.hh"

namespace zenkit_node {

// Emits one chunk per material that at least one polygon references, each
// carrying transferable ArrayBuffers ready for a Three.js BufferGeometry.
// Positions stay in ZenGin space; the single conversion to renderer space is
// zen-world/coords (§7).
Napi::Object ExtractWorldMesh(Napi::Env env, WorldHandle const& handle);

}  // namespace zenkit_node
