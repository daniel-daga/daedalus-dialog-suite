#include "mesh_extract.hh"

#include <zenkit/Material.hh>
#include <zenkit/Mesh.hh>
#include <zenkit/World.hh>

#include <cstdint>
#include <unordered_map>
#include <vector>

#include "napi_helpers.hh"
#include "normalize.hh"

namespace zenkit_node {

namespace {

using namespace zenkit;

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

Napi::Array BboxArr(Napi::Env env, AxisAlignedBoundingBox const& bbox) {
  auto arr = Napi::Array::New(env, 6);
  arr.Set(0u, Napi::Number::New(env, bbox.min.x));
  arr.Set(1u, Napi::Number::New(env, bbox.min.y));
  arr.Set(2u, Napi::Number::New(env, bbox.min.z));
  arr.Set(3u, Napi::Number::New(env, bbox.max.x));
  arr.Set(4u, Napi::Number::New(env, bbox.max.y));
  arr.Set(5u, Napi::Number::New(env, bbox.max.z));
  return arr;
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

  for (std::size_t i = 0; i < chunks.size(); ++i) {
    auto& chunk = chunks[i];
    if (chunk.flags.empty()) continue;

    auto const& material = mesh.materials[i];
    auto entry = Napi::Object::New(env);
    entry.Set("materialIndex", Napi::Number::New(env, static_cast<double>(i)));
    entry.Set("name", Str(env, material.name));
    entry.Set("texture", Str(env, material.texture));
    entry.Set("group", Napi::Number::New(env, static_cast<double>(material.group)));

    auto color = Napi::Array::New(env, 4);
    color.Set(0u, Napi::Number::New(env, material.color.r));
    color.Set(1u, Napi::Number::New(env, material.color.g));
    color.Set(2u, Napi::Number::New(env, material.color.b));
    color.Set(3u, Napi::Number::New(env, material.color.a));
    entry.Set("color", color);

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

  result.Set("bbox", BboxArr(env, mesh.bbox));
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
  float lo[3] = {0, 0, 0};
  float hi[3] = {0, 0, 0};
  bool seen = false;

  for (auto const& sub : mesh.sub_meshes) {
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
      float const xyz[3] = {position.x, position.y, position.z};
      for (int i = 0; i < 3; ++i) {
        if (!seen || xyz[i] < lo[i]) lo[i] = xyz[i];
        if (!seen || xyz[i] > hi[i]) hi[i] = xyz[i];
      }
      seen = true;

      positions.insert(positions.end(), {xyz[0], xyz[1], xyz[2]});
      normals.insert(normals.end(), {wedge.normal.x, wedge.normal.y, wedge.normal.z});
      uvs.insert(uvs.end(), {wedge.texture.x, wedge.texture.y});
    }

    for (auto const& triangle : sub.triangles) {
      // Stored order, unreversed. Winding is a rendering question: it is
      // settled by comparing the geometric normal against the stored wedge
      // normals (scripts/check-visual-winding.js), not asserted here.
      indices.push_back(triangle.wedges[0]);
      indices.push_back(triangle.wedges[1]);
      indices.push_back(triangle.wedges[2]);
    }

    auto entry = Napi::Object::New(env);
    entry.Set("materialIndex", Napi::Number::New(env, static_cast<double>(out_index)));
    entry.Set("name", Str(env, sub.mat.name));
    entry.Set("texture", Str(env, sub.mat.texture));
    entry.Set("group", Napi::Number::New(env, static_cast<double>(sub.mat.group)));

    auto color = Napi::Array::New(env, 4);
    color.Set(0u, Napi::Number::New(env, sub.mat.color.r));
    color.Set(1u, Napi::Number::New(env, sub.mat.color.g));
    color.Set(2u, Napi::Number::New(env, sub.mat.color.b));
    color.Set(3u, Napi::Number::New(env, sub.mat.color.a));
    entry.Set("color", color);

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

  auto bbox = Napi::Array::New(env, 6);
  for (std::uint32_t i = 0; i < 3; ++i) {
    bbox.Set(i, Napi::Number::New(env, lo[i]));
    bbox.Set(i + 3, Napi::Number::New(env, hi[i]));
  }

  auto result = Napi::Object::New(env);
  result.Set("bbox", bbox);
  result.Set("vertexCount", Napi::Number::New(env, static_cast<double>(total_vertices)));
  result.Set("triangleCount", Napi::Number::New(env, static_cast<double>(total_triangles)));
  result.Set("chunks", out);
  return result;
}

}  // namespace zenkit_node
