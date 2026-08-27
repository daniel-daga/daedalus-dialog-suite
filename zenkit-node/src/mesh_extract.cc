#include "mesh_extract.hh"

#include <zenkit/Material.hh>
#include <zenkit/Mesh.hh>
#include <zenkit/ModelHierarchy.hh>
#include <zenkit/ModelMesh.hh>
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

namespace {

// Multiplies two column-stored matrices: result = a * b, so applying `result`
// applies `b` first and then `a` — the order a child's transform composes with
// its parent's.
Mat4 Multiply(Mat4 const& a, Mat4 const& b) {
  Mat4 out {};
  for (unsigned col = 0; col < 4; ++col) {
    for (unsigned row = 0; row < 4; ++row) {
      float sum = 0.0f;
      for (unsigned k = 0; k < 4; ++k) sum += a.columns[k][row] * b.columns[col][k];
      out.columns[col][row] = sum;
    }
  }
  return out;
}

// Appends one chunk per sub-mesh of `mesh` to `out`. A model contributes
// several meshes to one payload — a soft-skin mesh per body, an attachment per
// hierarchy node — so the per-sub-mesh work is shared rather than duplicated.
// `node` and `transform` are set only when the mesh came from an attachment:
// nothing else in a payload is positioned by a hierarchy.
void AppendSubMeshChunks(Napi::Env env,
                         MultiResolutionMesh const& mesh,
                         char const* node,
                         Mat4 const* transform,
                         Napi::Array& out,
                         std::uint32_t& out_index,
                         Extent& extent,
                         std::size_t& total_vertices,
                         std::size_t& total_triangles) {
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
    if (node != nullptr) {
      entry.Set("node", Napi::String::New(env, node));
      // Row-major, like every other matrix the binding emits. Emitted rather
      // than baked into the positions, for the same reason the coordinate
      // convention is not applied here: it is the model's own fact, and the
      // projection layer is where facts become pixels.
      auto matrix = Napi::Array::New(env, 16);
      std::uint32_t at = 0;
      for (unsigned row = 0; row < 4; ++row) {
        for (unsigned col = 0; col < 4; ++col) {
          matrix.Set(at++, Napi::Number::New(env, transform->columns[col][row]));
        }
      }
      entry.Set("transform", matrix);
    }

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
}

Napi::Object FinishPayload(Napi::Env env,
                           Napi::Array const& out,
                           Extent const& extent,
                           std::size_t total_vertices,
                           std::size_t total_triangles) {
  auto result = Napi::Object::New(env);
  result.Set("bbox", extent.Arr(env));
  result.Set("vertexCount", Napi::Number::New(env, static_cast<double>(total_vertices)));
  result.Set("triangleCount", Napi::Number::New(env, static_cast<double>(total_triangles)));
  result.Set("chunks", out);
  return result;
}

}  // namespace

Napi::Object ExtractProtoMesh(Napi::Env env, MultiResolutionMesh const& mesh) {
  auto out = Napi::Array::New(env);
  std::uint32_t out_index = 0;
  std::size_t total_vertices = 0;
  std::size_t total_triangles = 0;
  // A wedge is already a de-duplicated render vertex — position index plus its
  // own normal and UV — so unlike zCMesh there is nothing to collapse here.
  Extent extent;

  AppendSubMeshChunks(env, mesh, nullptr, nullptr, out, out_index, extent,
                      total_vertices, total_triangles);
  return FinishPayload(env, out, extent, total_vertices, total_triangles);
}

// A model's geometry is in two places and static props are entirely in the
// second: `meshes` holds soft-skin bodies, `attachments` holds rigid sub-meshes
// hung on hierarchy nodes. Reading only the first is why 53 of NewWorld's 63
// MODEL visuals — chests, stoves, bookshelves — extracted as nothing at all.
//
// Attachments are stored in an unordered_map, so emitting them in map order
// would put the chunks in a different order on a different run. The hierarchy
// supplies the order, and it is also the only thing that can place them: each
// node's transform is relative to its parent, so the emitted matrix is the
// product down the chain from the root.
Napi::Object ExtractModelMesh(Napi::Env env,
                              ModelMesh const& model,
                              ModelHierarchy const& hierarchy) {
  auto out = Napi::Array::New(env);
  std::uint32_t out_index = 0;
  std::size_t total_vertices = 0;
  std::size_t total_triangles = 0;
  Extent extent;

  for (auto const& skin : model.meshes) {
    AppendSubMeshChunks(env, skin.mesh, nullptr, nullptr, out, out_index, extent,
                        total_vertices, total_triangles);
  }

  std::vector<Mat4> world(hierarchy.nodes.size(), Mat4::identity());
  for (std::size_t i = 0; i < hierarchy.nodes.size(); ++i) {
    auto const& node = hierarchy.nodes[i];
    // A parent always precedes its children in a ZenGin hierarchy, so one pass
    // in order is enough; a forward or self reference would be a broken file.
    world[i] = node.parent_index >= 0 && static_cast<std::size_t>(node.parent_index) < i
        ? Multiply(world[node.parent_index], node.transform)
        : node.transform;
  }

  for (std::size_t i = 0; i < hierarchy.nodes.size(); ++i) {
    auto const found = model.attachments.find(hierarchy.nodes[i].name);
    if (found == model.attachments.end()) continue;
    AppendSubMeshChunks(env, found->second, hierarchy.nodes[i].name.c_str(), &world[i],
                        out, out_index, extent, total_vertices, total_triangles);
  }

  return FinishPayload(env, out, extent, total_vertices, total_triangles);
}

}  // namespace zenkit_node
