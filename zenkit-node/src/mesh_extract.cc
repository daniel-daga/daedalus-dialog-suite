#include "mesh_extract.hh"

#include <zenkit/Material.hh>
#include <zenkit/Mesh.hh>
#include <zenkit/World.hh>

#include <cstddef>
#include <cstdint>
#include <unordered_map>
#include <vector>

#include "napi_helpers.hh"
#include "normalize.hh"

namespace zenkit_node {

namespace {

using namespace zenkit;

// Accumulates the extent of the vertices actually emitted. zCMesh carries a
// bbox of its own, but every retail world mesh stores it as all zeros, so
// copying it hands the projection layer a world with no size.
struct Extent {
  float lo[3] {0, 0, 0};
  float hi[3] {0, 0, 0};
  bool seen {false};

  void Add(float x, float y, float z) {
    float const xyz[3] = {x, y, z};
    for (int i = 0; i < 3; ++i) {
      if (!seen || xyz[i] < lo[i]) lo[i] = xyz[i];
      if (!seen || xyz[i] > hi[i]) hi[i] = xyz[i];
    }
    seen = true;
  }

  Napi::Array Arr(Napi::Env env) const {
    auto arr = Napi::Array::New(env, 6);
    for (std::uint32_t i = 0; i < 3; ++i) {
      arr.Set(i, Napi::Number::New(env, lo[i]));
      arr.Set(i + 3, Napi::Number::New(env, hi[i]));
    }
    return arr;
  }
};

// One material's accumulating render buffers. Vertices are keyed on the
// (vertex, feature) pair: ZenGin stores position per vertex but UV, normal and
// baked light per polygon corner, so the same position reached through two
// different features is two different render vertices. Measured on retail
// NewWorld this de-duplication halves the vertex count (1,429,335 corners ->
// 713,719 vertices, 49 MB -> 30 MB).
struct Chunk {
  std::vector<float> positions;
  std::vector<float> normals;
  std::vector<float> uvs;
  std::vector<std::uint32_t> lights;
  std::vector<std::uint32_t> indices;
  std::vector<std::uint32_t> flags;
  std::unordered_map<std::uint64_t, std::uint32_t> lookup;

  std::uint32_t Corner(Mesh const& mesh, std::uint32_t vertex, std::uint32_t feature) {
    std::uint64_t const key = (static_cast<std::uint64_t>(vertex) << 32) | feature;
    auto const found = lookup.find(key);
    if (found != lookup.end()) return found->second;

    auto const index = static_cast<std::uint32_t>(lights.size());
    auto const& position = mesh.vertices[vertex];
    auto const& attributes = mesh.features[feature];

    positions.insert(positions.end(), {position.x, position.y, position.z});
    normals.insert(normals.end(),
                   {attributes.normal.x, attributes.normal.y, attributes.normal.z});
    uvs.insert(uvs.end(), {attributes.texture.x, attributes.texture.y});
    lights.push_back(attributes.light);

    lookup.emplace(key, index);
    return index;
  }
};

// The material fields a chunk carries, identical for a world-mesh chunk and a
// VOB-visual chunk so the projection layer can apply one rule to both.
//
// Chunks are per material, but the retail worlds share 330 textures between
// 1400 materials and one draw call per material would exceed the whole viewport
// budget (../docs/plans/level-editor.md §3), so the renderer merges chunks that
// share a texture. Everything here is part of that merge key: two materials on
// one texture may only merge if they agree on all of it, and a field left out
// is an additive-blend flame silently merged into an opaque wall.
//
// Deliberately absent: fields that the asset compiler has already resolved into
// the geometry (smooth_angle, texture_scale, default_mapping) and fields that
// describe gameplay rather than pixels (disable_collision, dont_collapse,
// force_occluder, detail_object). `group` is emitted, but as the surface's
// material class — an editor fact, not a render one.
void SetMaterialFields(Napi::Env env, Napi::Object entry, Material const& material) {
  entry.Set("name", Str(env, material.name));
  entry.Set("texture", Str(env, material.texture));
  entry.Set("group", Napi::Number::New(env, static_cast<double>(material.group)));

  auto color = Napi::Array::New(env, 4);
  color.Set(0u, Napi::Number::New(env, material.color.r));
  color.Set(1u, Napi::Number::New(env, material.color.g));
  color.Set(2u, Napi::Number::New(env, material.color.b));
  color.Set(3u, Napi::Number::New(env, material.color.a));
  entry.Set("color", color);

  entry.Set("alphaFunc", Napi::Number::New(env, static_cast<double>(material.alpha_func)));
  entry.Set("texAniMapMode",
            Napi::Number::New(env, static_cast<double>(material.texture_anim_map_mode)));
  entry.Set("texAniFps", Napi::Number::New(env, material.texture_anim_fps));

  auto dir = Napi::Array::New(env, 2);
  dir.Set(0u, Napi::Number::New(env, material.texture_anim_map_dir.x));
  dir.Set(1u, Napi::Number::New(env, material.texture_anim_map_dir.y));
  entry.Set("texAniMapDir", dir);

  entry.Set("envMapping", Napi::Boolean::New(env, material.environment_mapping));
  entry.Set("envMappingStrength",
            Napi::Number::New(env, material.environment_mapping_strength));
  entry.Set("waveMode", Napi::Number::New(env, static_cast<double>(material.wave_mode)));
  entry.Set("waveSpeed", Napi::Number::New(env, static_cast<double>(material.wave_speed)));
  entry.Set("waveMaxAmplitude", Napi::Number::New(env, material.wave_max_amplitude));
  entry.Set("waveGridSize", Napi::Number::New(env, material.wave_grid_size));
  entry.Set("ignoreSun", Napi::Boolean::New(env, material.ignore_sun));
  entry.Set("disableLightmap", Napi::Boolean::New(env, material.disable_lightmap));
}

}  // namespace

Napi::Object ExtractMesh(Napi::Env env, Mesh const& mesh, bool is_g2) {

  // Indexed by material; a material no polygon references stays empty and is
  // skipped below. The retail world meshes declare 1400 materials and use all
  // of them, but the fixture proves the unused case is handled.
  std::vector<Chunk> chunks(mesh.materials.size());

  for (auto const& polygon : mesh.geometry) {
    if (polygon.index_count < 3) continue;
    if (polygon.material >= chunks.size()) continue;

    auto& chunk = chunks[polygon.material];
    auto const bits = PackPolygonFlags(polygon.flags, is_g2);
    auto const root = polygon.index_offset;

    // Fan-triangulate in place rather than reading mesh.polygons: ZenKit's own
    // Mesh::triangulate is filtered to the BSP leaf set and silently drops
    // is_portal, is_ghost_occluder and is_outdoor polygons. A level editor
    // needs the complete polygon list — it wants to *show* portals and
    // sectors — so the filtering decision belongs to the projection layer,
    // which is what the per-triangle flags buffer is for.
    auto a = std::size_t {1};
    for (auto b = std::size_t {2}; b < polygon.index_count; ++b) {
      for (auto corner : {root, root + a, root + b}) {
        chunk.indices.push_back(chunk.Corner(mesh,
                                             mesh.polygon_vertex_indices[corner],
                                             mesh.polygon_feature_indices[corner]));
      }
      chunk.flags.push_back(bits);
      a = b;
    }
  }

  auto result = Napi::Object::New(env);
  auto out = Napi::Array::New(env);
  std::uint32_t out_index = 0;
  std::size_t total_vertices = 0;
  std::size_t total_triangles = 0;
  Extent extent;

  for (std::size_t i = 0; i < chunks.size(); ++i) {
    auto& chunk = chunks[i];
    if (chunk.flags.empty()) continue;

    for (std::size_t p = 0; p + 2 < chunk.positions.size(); p += 3) {
      extent.Add(chunk.positions[p], chunk.positions[p + 1], chunk.positions[p + 2]);
    }

    auto entry = Napi::Object::New(env);
    entry.Set("materialIndex", Napi::Number::New(env, static_cast<double>(i)));
    SetMaterialFields(env, entry, mesh.materials[i]);

    entry.Set("vertexCount", Napi::Number::New(env, static_cast<double>(chunk.lights.size())));
    entry.Set("triangleCount", Napi::Number::New(env, static_cast<double>(chunk.flags.size())));
    entry.Set("positions", Buffer(env, chunk.positions));
    entry.Set("normals", Buffer(env, chunk.normals));
    entry.Set("uvs", Buffer(env, chunk.uvs));
    entry.Set("lights", Buffer(env, chunk.lights));
    entry.Set("indices", Buffer(env, chunk.indices));
    entry.Set("flags", Buffer(env, chunk.flags));

    total_vertices += chunk.lights.size();
    total_triangles += chunk.flags.size();
    out.Set(out_index++, entry);
  }

  result.Set("bbox", extent.Arr(env));
  result.Set("vertexCount", Napi::Number::New(env, static_cast<double>(total_vertices)));
  result.Set("triangleCount", Napi::Number::New(env, static_cast<double>(total_triangles)));
  result.Set("chunks", out);
  return result;
}

Napi::Object ExtractWorldMesh(Napi::Env env, WorldHandle const& handle) {
  return ExtractMesh(env, handle.world->world_mesh, handle.version == GameVersion::GOTHIC_2);
}

Napi::Object ExtractProtoMesh(Napi::Env env, MultiResolutionMesh const& mesh) {
  auto out = Napi::Array::New(env);
  std::uint32_t out_index = 0;
  std::size_t total_vertices = 0;
  std::size_t total_triangles = 0;

  // A wedge is already a de-duplicated render vertex — position index plus its
  // own normal and UV — so unlike zCMesh there is nothing to collapse here.
  Extent extent;

  for (std::size_t i = 0; i < mesh.sub_meshes.size(); ++i) {
    auto const& sub = mesh.sub_meshes[i];
    if (sub.triangles.empty() || sub.wedges.empty()) continue;

    std::vector<float> positions;
    std::vector<float> normals;
    std::vector<float> uvs;
    std::vector<std::uint32_t> indices;
    positions.reserve(sub.wedges.size() * 3);
    normals.reserve(sub.wedges.size() * 3);
    uvs.reserve(sub.wedges.size() * 2);
    indices.reserve(sub.triangles.size() * 3);

    for (auto const& wedge : sub.wedges) {
      if (wedge.index >= mesh.positions.size()) {
        throw Napi::Error::New(env, "visual mesh wedge points outside the position list");
      }
      auto const& position = mesh.positions[wedge.index];
      extent.Add(position.x, position.y, position.z);

      positions.insert(positions.end(), {position.x, position.y, position.z});
      normals.insert(normals.end(), {wedge.normal.x, wedge.normal.y, wedge.normal.z});
      uvs.insert(uvs.end(), {wedge.texture.x, wedge.texture.y});
    }

    for (auto const& triangle : sub.triangles) {
      // Stored order, unreversed. Winding is a rendering question, and the
      // answer is now measured rather than assumed: across the retail corpus
      // (p1-p0)x(p2-p0) read right-handed points *against* the stored normals
      // — 230,395 of 230,395 proto-mesh triangles and 475,146 of 475,184
      // decidable NewWorld world-mesh triangles (scripts/check-visual-winding.js).
      // So the flip is one decision for the whole projection layer, not a
      // per-mesh one, and it is not made here.
      indices.push_back(triangle.wedges[0]);
      indices.push_back(triangle.wedges[1]);
      indices.push_back(triangle.wedges[2]);
    }

    auto entry = Napi::Object::New(env);
    // The sub-mesh's own index, so the field means the same here as it does on
    // an ExtractMesh chunk: an index into the mesh's material list. A sub-mesh
    // skipped for having no triangles must not renumber the ones after it.
    entry.Set("materialIndex", Napi::Number::New(env, static_cast<double>(i)));
    SetMaterialFields(env, entry, sub.mat);

    entry.Set("vertexCount", Napi::Number::New(env, static_cast<double>(sub.wedges.size())));
    entry.Set("triangleCount", Napi::Number::New(env, static_cast<double>(sub.triangles.size())));
    entry.Set("positions", Buffer(env, positions));
    entry.Set("normals", Buffer(env, normals));
    entry.Set("uvs", Buffer(env, uvs));
    entry.Set("indices", Buffer(env, indices));

    total_vertices += sub.wedges.size();
    total_triangles += sub.triangles.size();
    out.Set(out_index++, entry);
  }

  auto result = Napi::Object::New(env);
  result.Set("bbox", extent.Arr(env));
  result.Set("vertexCount", Napi::Number::New(env, static_cast<double>(total_vertices)));
  result.Set("triangleCount", Napi::Number::New(env, static_cast<double>(total_triangles)));
  result.Set("chunks", out);
  return result;
}

}  // namespace zenkit_node
