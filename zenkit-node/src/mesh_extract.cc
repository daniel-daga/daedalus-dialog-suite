#include "mesh_extract.hh"

#include <zenkit/Material.hh>
#include <zenkit/Mesh.hh>
#include <zenkit/World.hh>

#include <cstdint>
#include <cstring>
#include <unordered_map>
#include <vector>

#include "encoding.hh"
#include "normalize.hh"

namespace zenkit_node {

namespace {

using namespace zenkit;

Napi::String Str(Napi::Env env, std::string const& raw) {
  auto utf16 = Windows1252ToUtf16(raw);
  return Napi::String::New(env, reinterpret_cast<char16_t const*>(utf16.c_str()), utf16.size());
}

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

// Copies a vector into a fresh ArrayBuffer. N-API owns the memory, so the
// buffer survives the vector going out of scope and can be transferred to the
// renderer without a further copy on the JS side.
template <typename T>
Napi::ArrayBuffer Buffer(Napi::Env env, std::vector<T> const& values) {
  auto const bytes = values.size() * sizeof(T);
  auto buffer = Napi::ArrayBuffer::New(env, bytes);
  if (bytes != 0) std::memcpy(buffer.Data(), values.data(), bytes);
  return buffer;
}

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

Napi::Object ExtractWorldMesh(Napi::Env env, WorldHandle const& handle) {
  auto const& mesh = handle.world->world_mesh;
  bool const is_g2 = handle.version == GameVersion::GOTHIC_2;

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

}  // namespace zenkit_node
