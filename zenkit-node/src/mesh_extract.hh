// extractWorldMesh(handle) — the world mesh as render-ready buffers, chunked
// by material (level-editor.md §3, §4). A read-only projection: it touches no
// save()/WriteArchive machinery and makes no fidelity claim.
#pragma once

#include <napi.h>

#include <zenkit/Mesh.hh>
#include <zenkit/MultiResolutionMesh.hh>

#include "world_handle.hh"

namespace zenkit_node {

// Emits one chunk per material that at least one polygon references, each
// carrying transferable ArrayBuffers ready for a Three.js BufferGeometry.
// Positions stay in ZenGin space; the single conversion to renderer space is
// zen-world/coords (§7).
Napi::Object ExtractWorldMesh(Napi::Env env, WorldHandle const& handle);

// The same projection over any zCMesh — the world mesh or a compiled .MSH
// visual. Chunks carry the per-vertex `lights` and per-triangle `flags`
// buffers, which only this mesh class has.
Napi::Object ExtractMesh(Napi::Env env, zenkit::Mesh const& mesh, bool is_g2);

// The same projection over a zCProgMeshProto (.MRM) and everything that
// embeds one (.MSH attachments, .MDM/.MDL soft-skin bind poses, .MMB). Its
// wedges are already de-duplicated render vertices, so no lights/flags
// buffers: a VOB visual carries no baked ZenGin light word.
Napi::Object ExtractProtoMesh(Napi::Env env, zenkit::MultiResolutionMesh const& mesh);

}  // namespace zenkit_node
