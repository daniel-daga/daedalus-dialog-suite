// normalizeWorld(handle) — the phase-0 §3 dump schema, the measuring
// instrument of the round-trip fidelity gate.
#pragma once

#include <napi.h>
#include <zenkit/Mesh.hh>

#include <cstdint>

#include "world_handle.hh"

namespace zenkit_node {

// The packed on-disk polygon flag byte(s), version-appropriate (see Mesh.cc
// load). G1 packs normal_axis across two bytes; returned here as one integer.
// Shared so _drillMesh and extractWorldMesh cannot drift apart.
std::uint32_t PackPolygonFlags(zenkit::PolygonFlagSet const& flags, bool is_g2);

// Builds the canonical dump of a loaded world. Reads exclusively from the
// structs ZenKit's *load* path populated — never through any save()/
// WriteArchive machinery, which is the code under test.
Napi::Object NormalizeWorld(Napi::Env env, WorldHandle const& handle);

// vobIndex(handle) — the VOB enumeration the renderer actually needs, as
// columnar transferables with the repeated strings interned. NormalizeWorld is
// the diagnostic dump and costs 933 ms on retail NewWorld (23,288 VOBs, every
// per-class property, plus the archive-byte container section); this is the
// same enumeration in the same order, reduced to identity, placement, visual
// and the flags that decide whether a VOB is drawn.
Napi::Object VobIndex(Napi::Env env, WorldHandle const& handle);

// The waynet as a drawable graph: stored order, edges as index pairs. The
// diff-oriented waynet section of normalizeWorld is a different thing.
Napi::Object WayNetGraph(Napi::Env env, WorldHandle const& handle);

// _drillMesh(handle, {offset, limit}?) — per-polygon world-mesh geometry for
// locating the first differing polygon between two worlds (T7 harness). Reads
// the same load-path structs as NormalizeWorld; the optional window keeps the
// JS object count bounded on 200k-polygon meshes.
Napi::Object DrillMesh(Napi::Env env,
                       WorldHandle const& handle,
                       std::size_t offset,
                       std::size_t limit);

}  // namespace zenkit_node
