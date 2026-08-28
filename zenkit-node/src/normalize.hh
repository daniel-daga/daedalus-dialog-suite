// normalizeWorld(handle) — the phase-0 §3 dump schema, the measuring
// instrument of the round-trip fidelity gate.
#pragma once

#include <napi.h>
#include <zenkit/Mesh.hh>
#include <zenkit/vobs/VirtualObject.hh>
#include <zenkit/world/WayNet.hh>

#include <cstdint>
#include <memory>
#include <vector>

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

// The ZenGin class identifier for a VOB's type — the `class` field of the dump,
// and the name a per-class refusal in the binding has to say out loud. Shared so
// the mutation path and the dump cannot disagree about what a VOB is.
char const* VobClassName(zenkit::VirtualObjectType type);

// Every property of one VOB: the base `zCVob` fields plus whatever its concrete
// class adds, with the same camelCase keys the dump's per-VOB `props` object
// carries — because it *is* that object. Exported rather than reimplemented: a
// second field mapping would be a second hand-maintained mirror of the vendor
// headers, and the two would agree only for as long as both were remembered.
Napi::Object VobProps(Napi::Env env, zenkit::VirtualObject const& vob);

// vobIndex(handle) — the VOB enumeration the renderer actually needs, as
// columnar transferables with the repeated strings interned. NormalizeWorld is
// the diagnostic dump and costs 933 ms on retail NewWorld (23,288 VOBs, every
// per-class property, plus the archive-byte container section); this is the
// same enumeration in the same order, reduced to identity, placement, visual
// and the flags that decide whether a VOB is drawn.
Napi::Object VobIndex(Napi::Env env, WorldHandle const& handle);

// The waynet's points in stored order, with the null slots dropped — and so
// the definition of what a waypoint *index* means everywhere. Shared, because
// a mutation that re-derived the same filter would agree with getWaynet only
// for as long as both stayed in step, and a stale waypoint index always
// resolves to some waypoint rather than to nothing.
std::vector<std::shared_ptr<zenkit::WayPoint>> CollectWaypoints(WorldHandle const& handle);

// The waynet as a drawable graph: stored order, edges as index pairs. The
// diff-oriented waynet section of normalizeWorld is a different thing.
Napi::Object WayNetGraph(Napi::Env env, WorldHandle const& handle);

// getPortals(handle) — the portal metadata as data (level-editor.md §16.18,
// slice 2). `is_portal`, `is_sector` and `sector_index` reached the payload
// only through `polyHash`, and `portal_polygon_indices` only through
// `portalPolyHash`; a hash answers "did it change" and no portal check past
// the material names can be written on that. Columnar, one row per polygon
// carrying portal metadata.
Napi::Object GetPortals(Napi::Env env, WorldHandle const& handle);

// _drillMesh(handle, {offset, limit}?) — per-polygon world-mesh geometry for
// locating the first differing polygon between two worlds (T7 harness). Reads
// the same load-path structs as NormalizeWorld; the optional window keeps the
// JS object count bounded on 200k-polygon meshes.
Napi::Object DrillMesh(Napi::Env env,
                       WorldHandle const& handle,
                       std::size_t offset,
                       std::size_t limit);

}  // namespace zenkit_node
