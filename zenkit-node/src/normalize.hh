// normalizeWorld(handle) — the phase-0 §3 dump schema, the measuring
// instrument of the round-trip fidelity gate.
#pragma once

#include <napi.h>

#include "world_handle.hh"

namespace zenkit_node {

// Builds the canonical dump of a loaded world. Reads exclusively from the
// structs ZenKit's *load* path populated — never through any save()/
// WriteArchive machinery, which is the code under test.
Napi::Object NormalizeWorld(Napi::Env env, WorldHandle const& handle);

}  // namespace zenkit_node
