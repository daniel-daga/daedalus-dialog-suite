#include "fixture.hh"

#include <zenkit/Material.hh>
#include <zenkit/Mesh.hh>
#include <zenkit/Model.hh>
#include <zenkit/ModelHierarchy.hh>
#include <zenkit/ModelMesh.hh>
#include <zenkit/MultiResolutionMesh.hh>
#include <zenkit/Stream.hh>
#include <zenkit/Texture.hh>
#include <zenkit/World.hh>
#include <zenkit/vobs/Light.hh>
#include <zenkit/vobs/Misc.hh>
#include <zenkit/vobs/MovableObject.hh>
#include <zenkit/vobs/Sound.hh>
#include <zenkit/vobs/Trigger.hh>
#include <zenkit/vobs/VirtualObject.hh>
#include <zenkit/vobs/Zone.hh>
#include <zenkit/world/BspTree.hh>
#include <zenkit/world/WayNet.hh>

#include <cstdint>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

namespace zenkit_node {

namespace {

using namespace zenkit;

void BuildMesh(Mesh& mesh) {
  // Deterministic creation date; the archive header's own date/user stamp is
  // written by ZenKit's archive writer and is expected to vary. The pad word
  // is non-zero on purpose: retail world meshes carry garbage there and it
  // must survive a round-trip.
  mesh.date = Date {2024, 1, 1, 0, 0, 0, 0x4A01};
  mesh.name = "MINIMAL_FIXTURE";
  mesh.bbox = AxisAlignedBoundingBox {Vec3 {0.0f, -1.0f, 0.0f}, Vec3 {100.0f, 1.0f, 100.0f}};
  mesh.obb = OrientedBoundingBox {};
  mesh.obb.center = Vec3 {50.0f, 0.0f, 50.0f};
  mesh.obb.axes[0] = Vec3 {1.0f, 0.0f, 0.0f};
  mesh.obb.axes[1] = Vec3 {0.0f, 1.0f, 0.0f};
  mesh.obb.axes[2] = Vec3 {0.0f, 0.0f, 1.0f};
  mesh.obb.half_width = Vec3 {50.0f, 1.0f, 50.0f};

  // Two named materials; polygons reference them by index.
  for (auto const* name : {"FIXTURE_STONE", "FIXTURE_GRASS"}) {
    Material mat {};
    mat.name = name;
    mat.group = MaterialGroup::UNDEFINED;
    mat.color = Color {128, 128, 128, 255};
    mat.texture = std::string {name} + ".TGA";
    mesh.materials.push_back(std::move(mat));
  }

  // A flat 100x100 quad made of two triangles.
  mesh.vertices = {
      Vec3 {0.0f, 0.0f, 0.0f},
      Vec3 {100.0f, 0.0f, 0.0f},
      Vec3 {100.0f, 0.0f, 100.0f},
      Vec3 {0.0f, 0.0f, 100.0f},
  };

  for (auto i = 0u; i < mesh.vertices.size(); ++i) {
    VertexFeature feat {};
    feat.texture = Vec2 {static_cast<float>(i % 2), static_cast<float>(i / 2)};
    feat.light = 0xFFFFFFFF;
    feat.normal = Vec3 {0.0f, 1.0f, 0.0f};
    mesh.features.push_back(feat);
  }

  // Polygon SoA data (per Mesh.cc save/load): per-poly material, lightmap,
  // plane, flags, then triangle indices in the flat index arrays.
  auto add_triangle = [&mesh](uint32_t material, uint32_t a, uint32_t b, uint32_t c) {
    Polygon poly {};
    poly.material = material;
    poly.lightmap = -1;
    poly.flags = PolygonFlagSet {};
    poly.flags.sector_index = -1;
    poly.plane_normal = Vec3 {0.0f, 1.0f, 0.0f};
    poly.plane_distance = 0.0f;
    poly.index_count = 3;
    poly.index_offset = mesh.polygon_vertex_indices.size();
    mesh.geometry.push_back(poly);

    for (uint32_t idx : {a, b, c}) {
      mesh.polygon_vertex_indices.push_back(idx);
      mesh.polygon_feature_indices.push_back(idx);
      // Also fill the derived triangulated PolygonList, mirroring what
      // Mesh::load + triangulate() would produce (all-triangle mesh: the two
      // are identical).
      mesh.polygons.vertex_indices.push_back(idx);
      mesh.polygons.feature_indices.push_back(idx);
    }
    mesh.polygons.material_indices.push_back(material);
    mesh.polygons.lightmap_indices.push_back(-1);
    mesh.polygons.flags.push_back(poly.flags);
  };

  add_triangle(0, 0, 1, 2);
  add_triangle(1, 0, 2, 3);

  // Three 1x1 light-map textures shared by four light-maps in the order
  // A, B, A, C: the LIGHTMAPS_SHARED chunk must list the textures in
  // first-reference order, i.e. the light-maps reference indices 0, 1, 0, 2.
  std::shared_ptr<Texture> lightmap_textures[3];
  for (auto i = 0u; i < 3; ++i) {
    std::vector<std::uint8_t> pixel {static_cast<std::uint8_t>(0x10 * (i + 1)), 0x20, 0x30, 0xFF};
    lightmap_textures[i] = std::make_shared<Texture>(
        TextureBuilder {1, 1}.add_mipmap(pixel, TextureFormat::R8G8B8A8).build(TextureFormat::R8G8B8A8));
  }
  for (auto i : {0, 1, 0, 2}) {
    LightMap lightmap {};
    lightmap.image = lightmap_textures[i];
    lightmap.normals[0] = Vec3 {1.0f, 0.0f, 0.0f};
    lightmap.normals[1] = Vec3 {0.0f, 0.0f, 1.0f};
    lightmap.origin = Vec3 {static_cast<float>(i), 0.0f, 0.0f};
    mesh.lightmaps.push_back(lightmap);
  }
}

// A mesh built to exercise the three things ExtractWorldMesh does that the
// minimal fixture cannot reach: fan-triangulating an n-gon, keying vertices on
// the (vertex, feature) pair rather than the vertex alone, and skipping a
// material no polygon references.
void BuildMeshExtractionMesh(Mesh& mesh) {
  mesh.date = Date {2024, 1, 1, 0, 0, 0, 0x4A01};
  mesh.name = "MESH_EXTRACTION_FIXTURE";
  // Deliberately wrong, like the proto-mesh fixture's: the extractor computes
  // its own box from the vertices it emits, because retail zCMesh world meshes
  // store an all-zero one.
  mesh.bbox = AxisAlignedBoundingBox {Vec3 {-999.0f, -999.0f, -999.0f},
                                      Vec3 {999.0f, 999.0f, 999.0f}};
  mesh.obb = OrientedBoundingBox {};
  mesh.obb.center = Vec3 {10.0f, 0.0f, 5.0f};
  mesh.obb.axes[0] = Vec3 {1.0f, 0.0f, 0.0f};
  mesh.obb.axes[1] = Vec3 {0.0f, 1.0f, 0.0f};
  mesh.obb.axes[2] = Vec3 {0.0f, 0.0f, 1.0f};
  mesh.obb.half_width = Vec3 {10.0f, 1.0f, 5.0f};

  // EX_UNUSED is referenced by no polygon: extraction must emit no chunk for it.
  for (auto const* name : {"EX_STONE", "EX_GRASS", "EX_UNUSED"}) {
    Material mat {};
    mat.name = name;
    mat.group = MaterialGroup::UNDEFINED;
    mat.color = Color {128, 128, 128, 255};
    mat.texture = std::string {name} + ".TGA";
    mesh.materials.push_back(std::move(mat));
  }

  // Every field that changes how a material renders, each with a value nothing
  // else in the fixture carries: two chunks sharing a texture may only merge if
  // all of them agree, so a field the extractor forgets has to be visible.
  // EX_GRASS keeps the defaults, as the other half of that comparison.
  auto& stone = mesh.materials[0];
  stone.alpha_func = AlphaFunction::BLEND;
  stone.texture_anim_map_mode = AnimationMapping::LINEAR;
  stone.texture_anim_fps = 5.0f;
  stone.texture_anim_map_dir = Vec2 {0.25f, -0.5f};
  stone.environment_mapping = true;
  stone.environment_mapping_strength = 0.75f;
  stone.wave_mode = WaveMode::WIND;
  stone.wave_speed = WaveSpeed::FAST;
  stone.wave_max_amplitude = 12.5f;
  stone.wave_grid_size = 40.0f;
  stone.ignore_sun = true;
  stone.disable_lightmap = true;

  mesh.vertices = {
      Vec3 {0.0f, 0.0f, 0.0f},   Vec3 {10.0f, 0.0f, 0.0f},  Vec3 {10.0f, 0.0f, 10.0f},
      Vec3 {0.0f, 0.0f, 10.0f},  Vec3 {20.0f, 0.0f, 0.0f},  Vec3 {20.0f, 0.0f, 10.0f},
  };

  // Seven features for six vertices: feature 6 is a second set of per-corner
  // data for vertex 1, so a chunk that keys on the vertex alone would collapse
  // two genuinely different render vertices into one.
  for (auto i = 0u; i < 6; ++i) {
    VertexFeature feat {};
    feat.texture = Vec2 {static_cast<float>(i), static_cast<float>(i * 2)};
    feat.light = 0x01020300u + i;
    feat.normal = Vec3 {0.0f, 1.0f, 0.0f};
    mesh.features.push_back(feat);
  }
  VertexFeature alt {};
  alt.texture = Vec2 {9.0f, 9.0f};
  alt.light = 0x0A0B0C0Du;
  alt.normal = Vec3 {1.0f, 0.0f, 0.0f};
  mesh.features.push_back(alt);

  auto add_polygon = [&mesh](std::uint32_t material,
                             std::uint8_t portal,
                             bool sector,
                             std::vector<std::uint32_t> const& vertex_indices,
                             std::vector<std::uint32_t> const& feature_indices) {
    Polygon poly {};
    poly.material = material;
    poly.lightmap = -1;
    poly.flags = PolygonFlagSet {};
    poly.flags.is_portal = portal;
    poly.flags.is_sector = sector ? 1 : 0;
    poly.flags.sector_index = -1;
    poly.plane_normal = Vec3 {0.0f, 1.0f, 0.0f};
    poly.plane_distance = 0.0f;
    poly.index_count = vertex_indices.size();
    poly.index_offset = mesh.polygon_vertex_indices.size();
    mesh.geometry.push_back(poly);

    for (std::size_t i = 0; i < vertex_indices.size(); ++i) {
      mesh.polygon_vertex_indices.push_back(vertex_indices[i]);
      mesh.polygon_feature_indices.push_back(feature_indices[i]);
    }
  };

  // A quad — fans into two triangles sharing corners 0 and 2.
  add_polygon(0, 0, false, {0, 1, 2, 3}, {0, 1, 2, 3});
  // Same material, and vertex 1 again but with feature 6.
  add_polygon(0, 1, false, {1, 2, 4}, {6, 2, 4});
  add_polygon(1, 0, true, {4, 5, 2}, {4, 5, 2});

  // Mesh::triangulate fills the derived PolygonList on load and Mesh::save
  // never writes it, so the fixture leaves it empty.
}

// A proto mesh built to exercise what ExtractProtoMesh claims: one chunk per
// sub-mesh, wedges as ready-made render vertices, triangle indices in stored
// order, a sub-mesh with no triangles skipped entirely, and a bounding box
// computed from the wedges actually emitted rather than copied off the mesh.
void BuildAssetProtoMesh(MultiResolutionMesh& mesh) {
  // Deliberately wrong: the extractor computes its own box from the wedges it
  // emits, so copying this one would be visible immediately.
  mesh.bbox = AxisAlignedBoundingBox {Vec3 {-999.0f, -999.0f, -999.0f},
                                      Vec3 {999.0f, 999.0f, 999.0f}};
  mesh.obbox = OrientedBoundingBox {};
  mesh.obbox.axes[0] = Vec3 {1.0f, 0.0f, 0.0f};
  mesh.obbox.axes[1] = Vec3 {0.0f, 1.0f, 0.0f};
  mesh.obbox.axes[2] = Vec3 {0.0f, 0.0f, 1.0f};
  mesh.alpha_test = 1;

  mesh.positions = {
      Vec3 {0.0f, 0.0f, 0.0f},   Vec3 {10.0f, 0.0f, 0.0f},   Vec3 {10.0f, 0.0f, 10.0f},
      Vec3 {0.0f, 0.0f, 10.0f},  Vec3 {5.0f, 20.0f, 5.0f},
      // Reachable only through the triangle-less sub-mesh, so it must not
      // reach the emitted bounding box.
      Vec3 {-100.0f, -100.0f, -100.0f},
  };

  auto add_sub_mesh = [&mesh](char const* name,
                              Color color,
                              std::vector<MeshWedge> wedges,
                              std::vector<MeshTriangle> triangles) {
    SubMesh sub {};
    sub.mat.name = name;
    sub.mat.texture = std::string {name} + ".TGA";
    sub.mat.group = MaterialGroup::UNDEFINED;
    sub.mat.color = color;
    sub.wedges = std::move(wedges);
    sub.triangles = std::move(triangles);
    mesh.materials.push_back(sub.mat);
    mesh.sub_meshes.push_back(std::move(sub));
  };

  add_sub_mesh("EX_WOOD",
               Color {10, 20, 30, 255},
               {
                   MeshWedge {Vec3 {0.0f, 1.0f, 0.0f}, Vec2 {0.0f, 0.0f}, 0},
                   MeshWedge {Vec3 {0.0f, 1.0f, 0.0f}, Vec2 {1.0f, 0.0f}, 1},
                   MeshWedge {Vec3 {0.0f, 1.0f, 0.0f}, Vec2 {1.0f, 1.0f}, 2},
                   MeshWedge {Vec3 {0.0f, 1.0f, 0.0f}, Vec2 {0.0f, 1.0f}, 3},
               },
               {MeshTriangle {{0, 1, 2}}, MeshTriangle {{0, 2, 3}}});

  // The same render state a world-mesh chunk carries, with different values, so
  // a sub-mesh chunk that reads the wrong material field cannot pass by
  // borrowing the world fixture's answer. EX_IRON keeps the defaults.
  auto& wood = mesh.sub_meshes[0].mat;
  wood.alpha_func = AlphaFunction::ADD;
  wood.texture_anim_map_mode = AnimationMapping::LINEAR;
  wood.texture_anim_fps = 12.0f;
  wood.texture_anim_map_dir = Vec2 {-1.0f, 0.5f};
  wood.environment_mapping = true;
  wood.environment_mapping_strength = 0.25f;
  wood.wave_mode = WaveMode::GROUND;
  wood.wave_speed = WaveSpeed::SLOW;
  wood.wave_max_amplitude = 7.5f;
  wood.wave_grid_size = 20.0f;
  wood.ignore_sun = true;
  wood.disable_lightmap = true;
  mesh.materials[0] = wood;

  // Wedges but no triangles: contributes no chunk and no bounding box.
  add_sub_mesh("EX_EMPTY",
               Color {1, 2, 3, 4},
               {MeshWedge {Vec3 {0.0f, -1.0f, 0.0f}, Vec2 {0.5f, 0.5f}, 5}},
               {});

  // Triangle corners in descending order, so "stored order, unreversed" is a
  // claim the test can actually distinguish from a sorted or flipped emission.
  add_sub_mesh("EX_IRON",
               Color {200, 100, 50, 255},
               {
                   MeshWedge {Vec3 {1.0f, 0.0f, 0.0f}, Vec2 {0.25f, 0.75f}, 1},
                   MeshWedge {Vec3 {1.0f, 0.0f, 0.0f}, Vec2 {0.5f, 0.5f}, 2},
                   MeshWedge {Vec3 {1.0f, 0.0f, 0.0f}, Vec2 {0.75f, 0.25f}, 4},
               },
               {MeshTriangle {{2, 1, 0}}});
}

// Mat4 stores columns, so a translation lives in the fourth one.
Mat4 Translation(float x, float y, float z) {
  auto m = Mat4::identity();
  m.columns[3] = Vec4 {x, y, z, 1.0f};
  return m;
}

// Two mipmap levels so decodeTexture's `level` argument has something to
// select between, and distinguishable pixels at each level.
Texture BuildAssetTexture() {
  std::vector<std::uint8_t> const level0 {
      0xFF, 0x00, 0x00, 0xFF,  // red
      0x00, 0xFF, 0x00, 0xFF,  // green
      0x00, 0x00, 0xFF, 0xFF,  // blue
      0xFF, 0xFF, 0x00, 0x80,  // yellow, half alpha
  };
  std::vector<std::uint8_t> const level1 {0x40, 0x50, 0x60, 0x70};

  return TextureBuilder {2, 2}
      .add_mipmap(level0, TextureFormat::R8G8B8A8)
      .add_mipmap(level1, TextureFormat::R8G8B8A8)
      .build(TextureFormat::R8G8B8A8);
}

void BuildBspTree(BspTree& bsp, AxisAlignedBoundingBox const& bbox, std::uint32_t polygon_count) {
  bsp.mode = BspTreeType::OUTDOOR;
  bsp.polygon_indices.resize(polygon_count);
  for (std::uint32_t i = 0; i < polygon_count; ++i) bsp.polygon_indices[i] = i;

  // A single leaf node covering all polygons. BspTree::load treats a
  // one-node tree as a leaf, so leaf_node_indices must be exactly {0}.
  BspNode node {};
  node.bbox = bbox;
  node.polygon_index = 0;
  node.polygon_count = static_cast<std::int32_t>(polygon_count);
  bsp.nodes.push_back(node);
  bsp.leaf_node_indices = {0};

  // BspTree::load resizes light_points to the leaf count, so exactly one
  // light point must be present for the file to round-trip consistently.
  bsp.light_points = {Vec3 {50.0f, 0.0f, 50.0f}};
}

std::shared_ptr<VirtualObject> BuildVobTree() {
  auto root = std::make_shared<VirtualObject>();
  root->type = VirtualObjectType::zCVob;
  root->vob_name = "FIXTURE_ROOT";
  root->position = Vec3 {0.0f, 0.0f, 0.0f};
  root->bbox = AxisAlignedBoundingBox {Vec3 {-10.0f, -10.0f, -10.0f}, Vec3 {10.0f, 10.0f, 10.0f}};

  auto spot = std::make_shared<VSpot>();
  spot->type = VirtualObjectType::zCVobSpot;
  // windows-1252 bytes for "FP_CAMPFIRE_ÄÖÜ_01" (0xC4 0xD6 0xDC), spelled as
  // explicit escapes so the C++ source stays encoding-agnostic.
  spot->vob_name = "FP_CAMPFIRE_\xC4\xD6\xDC_01";
  spot->position = Vec3 {10.0f, 0.0f, 20.0f};
  spot->rotation = Mat3 {0.0f, 0.0f, 1.0f, 0.0f, 1.0f, 0.0f, -1.0f, 0.0f, 0.0f};
  spot->bbox = AxisAlignedBoundingBox {Vec3 {9.0f, -1.0f, 19.0f}, Vec3 {11.0f, 1.0f, 21.0f}};
  // Bit 15 of the packed G2 flag word carries engine memory garbage in retail
  // worlds; set it here so the round-trip of that bit is covered.
  spot->packed_reserved_bit = true;

  // A dynamic light hung on the campfire, carrying a `colorAniList` in BOTH
  // ZenGin forms: a bare greyscale scalar for a colour whose channels are equal
  // (`255 `, `64 `) and a parenthesized triple for one whose channels differ.
  // Retail worlds spell it exactly that way — measured over the three G2 worlds,
  // 26 of the 5,240 animation colours are written short and not one of the 5,214
  // triples has r == g == b — so a writer that emits only triples cannot
  // reproduce those files. It is a child of the spot so no existing VOB's index
  // path or sibling slot moves.
  auto light = std::make_shared<VLight>();
  light->type = VirtualObjectType::zCVobLight;
  light->vob_name = "FIXTURE_CAMPFIRE_LIGHT";
  light->position = Vec3 {10.0f, 5.0f, 20.0f};
  light->bbox = AxisAlignedBoundingBox {Vec3 {5.0f, 0.0f, 15.0f}, Vec3 {15.0f, 10.0f, 25.0f}};
  // The animation fields are only written for a dynamic light.
  light->is_static = false;
  light->preset = "";
  light->light_type = LightType::POINT;
  light->range = 500.0f;
  light->color = Color {255, 200, 120, 255};
  light->cone_angle = 0.0f;
  light->quality = LightQuality::MEDIUM;
  light->lensflare_fx = "";
  light->on = true;
  light->range_animation_scale = {1.0f, 0.5f};
  light->range_animation_fps = 4.0f;
  light->range_animation_smooth = true;
  light->color_animation_list = {
      Color {255, 255, 255, 255},  // greyscale shorthand: `255 `
      Color {10, 20, 30, 255},     // triple: `(10 20 30) `
      Color {64, 64, 64, 255},     // greyscale shorthand: `64 `
  };
  light->color_animation_fps = 10.0f;
  light->color_animation_smooth = true;
  light->can_move = false;
  spot->children = {light};

  auto item = std::make_shared<VItem>();
  item->type = VirtualObjectType::oCItem;
  item->vob_name = "ITEM_SWORD_01";
  item->instance = "ITMW_1H_SWORD_01";
  item->position = Vec3 {30.0f, 5.0f, 40.0f};
  item->rotation = Mat3 {-1.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, -1.0f};
  item->bbox = AxisAlignedBoundingBox {Vec3 {29.0f, 4.0f, 39.0f}, Vec3 {31.0f, 6.0f, 41.0f}};

  auto container = std::make_shared<VContainer>();
  container->type = VirtualObjectType::oCMobContainer;
  container->vob_name = "CHEST_01";
  container->position = Vec3 {60.0f, 0.0f, 80.0f};
  container->bbox = AxisAlignedBoundingBox {Vec3 {55.0f, 0.0f, 75.0f}, Vec3 {65.0f, 10.0f, 85.0f}};
  // oCMOB / oCMobInter / oCMobContainer fields are not default-initialized in
  // ZenKit; zero them explicitly so the fixture is deterministic.
  container->name = "CHEST";
  container->hp = 10;
  container->damage = 0;
  container->movable = false;
  container->takable = false;
  container->focus_override = false;
  container->material = SoundMaterialType::WOOD;
  container->destroyed = false;
  container->state_count = 1;
  container->rewind = false;
  container->locked = true;
  container->key = "ITKE_CHEST_01";
  container->pick_string = "LRRL";
  container->contents = "ITMI_GOLD:25";

  // A decal visual on the chest, for one reason: `decalAlphaWeight` is the only
  // field in a non-savegame world that goes through `WriteArchive::write_byte`,
  // and ZenKit's ASCII writer used to emit it with a `byte:` type token its own
  // reader — and ZenGin — spell `int:` (defect A5, patch 0026). Without a byte
  // field anywhere in the fixture that mismatch was invisible to CI while it
  // made every one of the 24 retail ASCII worlds fail to re-load. Hung on an
  // existing VOB rather than added as one, so no index path or sibling slot
  // moves.
  auto decal = std::make_shared<VisualDecal>();
  decal->name = "FIXTURE_DECAL.TGA";
  decal->type = VisualType::DECAL;
  decal->dimension = Vec2 {40.0f, 40.0f};
  decal->offset = Vec2 {0.0f, 0.0f};
  decal->two_sided = true;
  decal->alpha_func = AlphaFunction::BLEND;
  decal->texture_anim_fps = 0.0f;
  decal->alpha_weight = 200;
  decal->ignore_daylight = false;
  container->visual = decal;

  root->children = {spot, item, container};
  return root;
}

// A second root tree, authored only into the mesh-extraction variant so the
// golden fixture's VOBs stay exactly as they were. BuildVobTree's VOBs carry no
// visual and no flags at all, which is fine for a round-trip fixture and
// useless for an index: nothing there would notice a dictionary that never
// interns, a visual type read off the wrong field, or a flag word stuck at zero.
std::shared_ptr<VirtualObject> BuildVisualVobTree() {
  // Concrete visual classes, not the `Visual` base: the writer derives the
  // object's class name from its type, and a base-class visual produces a world
  // that cannot be re-loaded at all — a 0xC0000409 fail-fast with no
  // diagnostic, the same shape of failure as patch 0020's.
  auto proto_visual = [](char const* name) {
    auto v = std::make_shared<VisualMultiResolutionMesh>();
    v->name = name;
    v->type = VisualType::MULTI_RESOLUTION_MESH;
    return v;
  };
  auto mesh_visual = [](char const* name) {
    auto v = std::make_shared<VisualMesh>();
    v->name = name;
    v->type = VisualType::MESH;
    return v;
  };

  auto root = std::make_shared<VirtualObject>();
  root->type = VirtualObjectType::zCVob;
  root->vob_name = "VOB_INDEX_ROOT";
  root->position = Vec3 {100.0f, 0.0f, 100.0f};
  root->bbox = AxisAlignedBoundingBox {Vec3 {95.0f, -5.0f, 95.0f}, Vec3 {105.0f, 5.0f, 105.0f}};
  root->visual = proto_visual("EX_CRATE.3DS");
  root->show_visual = true;
  root->vob_static = true;

  // The same visual as the root: two VOBs, one dictionary entry.
  auto a = std::make_shared<VSpot>();
  a->type = VirtualObjectType::zCVobSpot;
  a->vob_name = "VOB_INDEX_A";
  a->position = Vec3 {110.0f, 1.0f, 120.0f};
  a->rotation = Mat3 {0.0f, 1.0f, 0.0f, -1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f};
  a->bbox = AxisAlignedBoundingBox {Vec3 {109.0f, 0.0f, 119.0f}, Vec3 {111.0f, 2.0f, 121.0f}};
  a->visual = proto_visual("EX_CRATE.3DS");
  a->show_visual = false;
  a->ambient = true;

  // A different visual, a different visual type, and a different flag set.
  auto b = std::make_shared<VItem>();
  b->type = VirtualObjectType::oCItem;
  b->vob_name = "VOB_INDEX_B";
  b->instance = "ITMW_1H_SWORD_02";
  b->position = Vec3 {130.0f, 2.0f, 140.0f};
  b->bbox = AxisAlignedBoundingBox {Vec3 {129.0f, 1.0f, 139.0f}, Vec3 {131.0f, 3.0f, 141.0f}};
  b->visual = mesh_visual("EX_HOUSE.3DS");
  b->show_visual = true;
  b->cd_dynamic = true;
  b->physics_enabled = true;

  // No visual object at all — normalizeWorld reports null there and the index
  // reports the empty string, which is a difference worth having a VOB for.
  auto c = std::make_shared<VirtualObject>();
  c->type = VirtualObjectType::zCVob;
  c->vob_name = "VOB_INDEX_NOVISUAL";
  c->position = Vec3 {150.0f, 3.0f, 160.0f};
  c->bbox = AxisAlignedBoundingBox {Vec3 {149.0f, 2.0f, 159.0f}, Vec3 {151.0f, 4.0f, 161.0f}};
  c->visual = nullptr;

  // The sound family and the zones — the classes `setVobClassProp` learned in
  // Phase 1b-2 increment 2. They are authored here, into the mesh-extraction
  // variant only, for exactly the reason this second tree exists at all: the
  // checked-in golden fixture's VOBs must not move, and a per-class write needs
  // a VOB of the class to write on. Every field is set explicitly, including
  // the ones this op does not write — a case that reset a neighbouring field
  // would otherwise have nothing to be caught by.
  auto sound = std::make_shared<VSound>();
  sound->type = VirtualObjectType::zCVobSound;
  sound->vob_name = "VOB_INDEX_SOUND";
  sound->position = Vec3 {170.0f, 4.0f, 180.0f};
  sound->bbox = AxisAlignedBoundingBox {Vec3 {169.0f, 3.0f, 179.0f}, Vec3 {171.0f, 5.0f, 181.0f}};
  sound->volume = 50.0f;
  sound->mode = SoundMode::LOOP;
  sound->random_delay = 5.0f;
  sound->random_delay_var = 2.0f;
  sound->initially_playing = true;
  sound->ambient3d = false;
  sound->obstruction = true;
  sound->cone_angle = 0.0f;
  sound->volume_type = SoundTriggerVolumeType::SPHERICAL;
  sound->radius = 1500.0f;
  sound->sound_name = "OW_CRICKET";

  // `zCVobSoundDaytime` derives from `zCVobSound`, so it is here to prove the
  // derived case still writes the *base* fields and not only its own three.
  auto daytime = std::make_shared<VSoundDaytime>();
  daytime->type = VirtualObjectType::zCVobSoundDaytime;
  daytime->vob_name = "VOB_INDEX_SOUND_DAYTIME";
  daytime->position = Vec3 {190.0f, 4.0f, 200.0f};
  daytime->bbox =
      AxisAlignedBoundingBox {Vec3 {189.0f, 3.0f, 199.0f}, Vec3 {191.0f, 5.0f, 201.0f}};
  daytime->volume = 80.0f;
  daytime->mode = SoundMode::RANDOM;
  daytime->random_delay = 30.0f;
  daytime->random_delay_var = 10.0f;
  daytime->initially_playing = false;
  daytime->ambient3d = true;
  daytime->obstruction = false;
  daytime->cone_angle = 90.0f;
  daytime->volume_type = SoundTriggerVolumeType::ELLIPSOIDAL;
  daytime->radius = 2500.0f;
  daytime->sound_name = "OW_BIRD_DAY";
  daytime->start_time = 6.0f;
  daytime->end_time = 20.0f;
  daytime->sound_name2 = "OW_OWL_NIGHT";

  // VZoneFarPlane's two floats have no default initializer in ZenKit at all,
  // so a fixture that left them alone would round-trip whatever was on the
  // stack.
  auto far_plane = std::make_shared<VZoneFarPlane>();
  far_plane->type = VirtualObjectType::zCZoneVobFarPlane;
  far_plane->vob_name = "VOB_INDEX_FARPLANE";
  far_plane->position = Vec3 {210.0f, 4.0f, 220.0f};
  far_plane->bbox =
      AxisAlignedBoundingBox {Vec3 {209.0f, 3.0f, 219.0f}, Vec3 {211.0f, 5.0f, 221.0f}};
  far_plane->vob_far_plane_z = 8000.0f;
  far_plane->inner_range_percentage = 0.75f;

  auto fog = std::make_shared<VZoneFog>();
  fog->type = VirtualObjectType::zCZoneZFog;
  fog->vob_name = "VOB_INDEX_FOG";
  fog->position = Vec3 {230.0f, 4.0f, 240.0f};
  fog->bbox = AxisAlignedBoundingBox {Vec3 {229.0f, 3.0f, 239.0f}, Vec3 {231.0f, 5.0f, 241.0f}};
  fog->range_center = 12000.0f;
  fog->inner_range_percentage = 0.5f;
  fog->color = Color {120, 130, 140, 255};
  fog->fade_out_sky = true;
  fog->override_color = false;

  auto music = std::make_shared<VZoneMusic>();
  music->type = VirtualObjectType::oCZoneMusic;
  music->vob_name = "VOB_INDEX_MUSIC";
  music->position = Vec3 {250.0f, 4.0f, 260.0f};
  music->bbox = AxisAlignedBoundingBox {Vec3 {249.0f, 3.0f, 259.0f}, Vec3 {251.0f, 5.0f, 261.0f}};
  music->enabled = true;
  music->priority = 2;
  music->ellipsoid = false;
  music->reverb = -30.0f;
  music->volume = 0.5f;
  music->loop = true;

  auto animate = std::make_shared<VAnimate>();
  animate->type = VirtualObjectType::zCVobAnimate;
  animate->vob_name = "VOB_INDEX_ANIMATE";
  animate->position = Vec3 {270.0f, 4.0f, 280.0f};
  animate->bbox =
      AxisAlignedBoundingBox {Vec3 {269.0f, 3.0f, 279.0f}, Vec3 {271.0f, 5.0f, 281.0f}};
  animate->start_on = true;

  auto pfx = std::make_shared<VParticleEffectController>();
  pfx->type = VirtualObjectType::zCPFXController;
  pfx->vob_name = "VOB_INDEX_PFX";
  pfx->position = Vec3 {290.0f, 4.0f, 300.0f};
  pfx->bbox = AxisAlignedBoundingBox {Vec3 {289.0f, 3.0f, 299.0f}, Vec3 {291.0f, 5.0f, 301.0f}};
  pfx->pfx_name = "PFX_TORCHFIRE";
  pfx->kill_when_done = true;
  pfx->initially_running = true;

  auto world_start = std::make_shared<VTriggerWorldStart>();
  world_start->type = VirtualObjectType::zCTriggerWorldStart;
  world_start->vob_name = "VOB_INDEX_TRIGGERWORLDSTART";
  world_start->position = Vec3 {310.0f, 4.0f, 320.0f};
  world_start->bbox =
      AxisAlignedBoundingBox {Vec3 {309.0f, 3.0f, 319.0f}, Vec3 {311.0f, 5.0f, 321.0f}};
  world_start->target = "TARGET_VOB";
  world_start->fire_once = true;

  auto trigger_script = std::make_shared<VTriggerScript>();
  trigger_script->type = VirtualObjectType::oCTriggerScript;
  trigger_script->vob_name = "VOB_INDEX_TRIGGERSCRIPT";
  trigger_script->position = Vec3 {330.0f, 4.0f, 340.0f};
  trigger_script->bbox =
      AxisAlignedBoundingBox {Vec3 {329.0f, 3.0f, 339.0f}, Vec3 {331.0f, 5.0f, 341.0f}};
  trigger_script->target = "TARGET_VOB";
  trigger_script->function = "SCRIPTFUNC_ON_TRIGGER";

  auto trigger = std::make_shared<VTrigger>();
  trigger->type = VirtualObjectType::zCTrigger;
  trigger->vob_name = "VOB_INDEX_TRIGGER";
  trigger->position = Vec3 {350.0f, 4.0f, 360.0f};
  trigger->bbox =
      AxisAlignedBoundingBox {Vec3 {349.0f, 3.0f, 359.0f}, Vec3 {351.0f, 5.0f, 361.0f}};
  trigger->target = "TARGET_VOB";
  trigger->start_enabled = true;
  trigger->send_untrigger = false;
  trigger->react_to_on_trigger = true;
  trigger->react_to_on_touch = false;
  trigger->react_to_on_damage = true;
  trigger->respond_to_object = false;
  trigger->respond_to_pc = true;
  trigger->respond_to_npc = false;
  trigger->vob_target = "VOB_TARGET_NAME";
  trigger->max_activation_count = 3;
  trigger->retrigger_delay_sec = 1.5f;
  trigger->damage_threshold = 10.0f;
  trigger->fire_delay_sec = 2.5f;

  auto change_level = std::make_shared<VTriggerChangeLevel>();
  change_level->type = VirtualObjectType::oCTriggerChangeLevel;
  change_level->vob_name = "VOB_INDEX_TRIGGERCHANGELEVEL";
  change_level->position = Vec3 {370.0f, 4.0f, 380.0f};
  change_level->bbox =
      AxisAlignedBoundingBox {Vec3 {369.0f, 3.0f, 379.0f}, Vec3 {371.0f, 5.0f, 381.0f}};
  change_level->target = "TARGET_VOB";
  change_level->start_enabled = true;
  change_level->send_untrigger = false;
  change_level->react_to_on_trigger = true;
  change_level->react_to_on_touch = false;
  change_level->react_to_on_damage = true;
  change_level->respond_to_object = false;
  change_level->respond_to_pc = true;
  change_level->respond_to_npc = false;
  change_level->vob_target = "VOB_TARGET_NAME";
  change_level->max_activation_count = 3;
  change_level->retrigger_delay_sec = 1.5f;
  change_level->damage_threshold = 10.0f;
  change_level->fire_delay_sec = 2.5f;
  change_level->level_name = "NEWWORLD.ZEN";
  change_level->start_vob = "START_VOB_ÄÖÜ";

  auto mover = std::make_shared<VMover>();
  mover->type = VirtualObjectType::zCMover;
  mover->vob_name = "VOB_INDEX_MOVER";
  mover->position = Vec3 {390.0f, 4.0f, 400.0f};
  mover->bbox = AxisAlignedBoundingBox {Vec3 {389.0f, 3.0f, 399.0f}, Vec3 {391.0f, 5.0f, 401.0f}};
  mover->target = "TARGET_VOB";
  mover->start_enabled = true;
  mover->send_untrigger = false;
  mover->react_to_on_trigger = true;
  mover->react_to_on_touch = false;
  mover->react_to_on_damage = true;
  mover->respond_to_object = false;
  mover->respond_to_pc = true;
  mover->respond_to_npc = false;
  mover->vob_target = "VOB_TARGET_NAME";
  mover->max_activation_count = 3;
  mover->retrigger_delay_sec = 1.5f;
  mover->damage_threshold = 10.0f;
  mover->fire_delay_sec = 2.5f;
  mover->touch_blocker_damage = 5.0f;
  mover->stay_open_time_sec = 3.0f;
  mover->locked = true;
  mover->auto_link = false;
  mover->auto_rotate = true;
  // `speed` is left at its default: `VMover::save` only writes it (with
  // `keyframes` empty here, as it is on any mover that animates from its
  // visual) when `keyframes` is non-empty, so a non-zero fixture value
  // would silently not round-trip and this fixture would be lying about it.
  mover->sfx_open_start = "SFX_OPEN_START_ÄÖÜ";
  mover->sfx_open_end = "SFX_OPEN_END";
  mover->sfx_transitioning = "SFX_TRANSITIONING";
  mover->sfx_close_start = "SFX_CLOSE_START";
  mover->sfx_close_end = "SFX_CLOSE_END";
  mover->sfx_lock = "SFX_LOCK";
  mover->sfx_unlock = "SFX_UNLOCK";
  mover->sfx_use_locked = "SFX_USE_LOCKED";

  auto mob = std::make_shared<VMovableObject>();
  mob->type = VirtualObjectType::oCMOB;
  mob->vob_name = "VOB_INDEX_MOB";
  mob->position = Vec3 {410.0f, 4.0f, 420.0f};
  mob->bbox = AxisAlignedBoundingBox {Vec3 {409.0f, 3.0f, 419.0f}, Vec3 {411.0f, 5.0f, 421.0f}};
  mob->name = "FOCUS_CRATE";
  mob->hp = 25;
  mob->damage = 3;
  mob->movable = true;
  mob->takable = false;
  mob->focus_override = false;
  mob->visual_destroyed = "CRATE_DESTROYED.MMS";
  mob->owner = "PC_HERO";
  mob->owner_guild = "GIL_BAU";
  mob->destroyed = false;

  auto mob_inter = std::make_shared<VInteractiveObject>();
  mob_inter->type = VirtualObjectType::oCMobInter;
  mob_inter->vob_name = "VOB_INDEX_MOB_INTER";
  mob_inter->position = Vec3 {430.0f, 4.0f, 440.0f};
  mob_inter->bbox = AxisAlignedBoundingBox {Vec3 {429.0f, 3.0f, 439.0f}, Vec3 {431.0f, 5.0f, 441.0f}};
  mob_inter->name = "FOCUS_LEVER";
  mob_inter->hp = 10;
  mob_inter->damage = 0;
  mob_inter->movable = false;
  mob_inter->takable = false;
  mob_inter->focus_override = false;
  mob_inter->visual_destroyed = "LEVER_DESTROYED.MMS";
  mob_inter->owner = "PC_HERO";
  mob_inter->owner_guild = "GIL_BAU";
  mob_inter->destroyed = false;
  mob_inter->state_count = 2;
  mob_inter->condition_function = "LEVER_CONDITION";
  mob_inter->on_state_change_function = "LEVER_ON_STATE_CHANGE";
  mob_inter->rewind = true;

  root->children = {a, b, c, sound, daytime, far_plane, fog, music, animate, pfx, world_start,
                     trigger_script, trigger, change_level, mover, mob, mob_inter};
  return root;
}

std::shared_ptr<WayNet> BuildWayNet(FixtureVariant variant) {
  auto make_point = [](std::string name, Vec3 position, bool free_point) {
    auto wp = std::make_shared<WayPoint>();
    wp->name = std::move(name);
    wp->water_depth = 0;
    wp->under_water = false;
    wp->position = position;
    wp->direction = Vec3 {0.0f, 0.0f, 1.0f};
    wp->free_point = free_point;
    return wp;
  };

  auto waynet = std::make_shared<WayNet>();
  // One free point (serialized in the waypoint list) plus three waypoints that
  // only exist as edge endpoints — matching how ZenKit re-loads a waynet.
  auto free = make_point("FP_FIXTURE_FREE", Vec3 {50.0f, 0.0f, 50.0f}, true);
  auto a = make_point("WP_FIXTURE_A", Vec3 {10.0f, 0.0f, 10.0f}, false);
  auto b = make_point("WP_FIXTURE_B", Vec3 {90.0f, 0.0f, 10.0f}, false);
  auto c = make_point("WP_FIXTURE_C", Vec3 {50.0f, 0.0f, 90.0f}, false);

  waynet->points = {free, a, b, c};
  waynet->edges = {{a, b}, {b, c}, {c, a}};

  // An underwater waypoint, authored only into the mesh-extraction variant so
  // the checked-in golden dump is untouched. Without one, nothing distinguishes
  // the underWater flag bit from the freePoint bit: a sabotage that packed both
  // into bit 0 passed every test.
  if (variant == FixtureVariant::kMeshExtraction) {
    auto deep = make_point("WP_FIXTURE_DEEP", Vec3 {50.0f, -200.0f, 10.0f}, false);
    deep->under_water = true;
    deep->water_depth = 250;
    waynet->points.push_back(deep);
    waynet->edges.push_back({c, deep});
  }
  return waynet;
}

}  // namespace

void AuthorFixtureWorld(std::filesystem::path const& path,
                        zenkit::ArchiveFormat format,
                        zenkit::GameVersion version,
                        FixtureVariant variant) {
  auto world = std::make_shared<World>();

  if (variant == FixtureVariant::kMeshExtraction) {
    BuildMeshExtractionMesh(world->world_mesh);
  } else {
    BuildMesh(world->world_mesh);
  }
  BuildBspTree(world->world_bsp_tree,
               world->world_mesh.bbox,
               static_cast<std::uint32_t>(world->world_mesh.geometry.size()));
  world->world_vobs.push_back(BuildVobTree());
  if (variant == FixtureVariant::kMeshExtraction) {
    world->world_vobs.push_back(BuildVisualVobTree());
  }
  world->way_net = BuildWayNet(variant);

  auto w = Write::to(path);
  auto archive = WriteArchive::to(w.get(), format);
  // Same top-level flow as loading expects: a single "[% oCWorld:zCWorld ...]"
  // wrapper object (write_object derives class name and version identifier
  // from the World object itself), then a final write_header() to patch the
  // object count and emit the binsafe hash table.
  archive->write_object("%", std::static_pointer_cast<Object>(world), version);
  archive->write_header();
}

void AuthorFixtureAssets(std::filesystem::path const& dir) {
  std::filesystem::create_directories(dir);

  MultiResolutionMesh proto {};
  BuildAssetProtoMesh(proto);

  Mesh compiled {};
  BuildMeshExtractionMesh(compiled);

  auto const texture = BuildAssetTexture();

  // EX_CRATE.3DS -> EX_CRATE.MRM, the primary proto-mesh mapping.
  // EX_DUAL.3DS  -> EX_DUAL.MRM, with an .MSH also present so the candidate
  //                 *order* is observable and not just the lookup.
  // EX_PLATE.3DS -> EX_PLATE.MSH, the fallback, and the only compiled-zCMesh
  //                 visual — deliberately the same mesh the world-mesh test
  //                 uses, since the .MSH branch is meant to be that same
  //                 projection.
  for (auto const* stem : {"EX_CRATE", "EX_DUAL"}) {
    auto w = Write::to(dir / (std::string {stem} + ".MRM"));
    proto.save(w.get(), GameVersion::GOTHIC_2);
  }
  for (auto const* stem : {"EX_DUAL", "EX_PLATE"}) {
    auto w = Write::to(dir / (std::string {stem} + ".MSH"));
    compiled.save(w.get(), GameVersion::GOTHIC_2);
  }
  {
    auto w = Write::to(dir / "EX_CRATE-C.TEX");
    texture.save(w.get());
  }

  // EX_PROP.ASC -> EX_PROP.MDL: a model whose geometry is entirely in its
  // *attachments*, which is what a static prop is. Two nodes deep, so a chunk
  // that ignored its parent's transform is visible; a third node carries no
  // attachment, so emission has to follow the attachments rather than the
  // hierarchy; and the attachment map is unordered, so the emission order has
  // to come from the hierarchy to be deterministic at all.
  {
    Model model {};
    model.hierarchy.nodes = {
        ModelHierarchyNode {-1, "BSPROOT", Translation(1.0f, 2.0f, 3.0f)},
        ModelHierarchyNode {0, "LID", Translation(0.0f, 10.0f, 0.0f)},
        ModelHierarchyNode {0, "SPARE", Translation(0.0f, 0.0f, 7.0f)},
    };
    model.mesh.attachments.emplace("LID", proto);
    model.mesh.attachments.emplace("BSPROOT", proto);

    auto w = Write::to(dir / "EX_PROP.MDL");
    model.save(w.get(), GameVersion::GOTHIC_2);
  }

  // EX_RIG.ASC -> EX_RIG.MDM, whose hierarchy is in the .MDH beside it. A .MDM
  // on its own has attachments but no node transforms at all.
  {
    ModelMesh mesh {};
    mesh.attachments.emplace("BASE", proto);
    auto w = Write::to(dir / "EX_RIG.MDM");
    mesh.save(w.get(), GameVersion::GOTHIC_2);

    ModelHierarchy hierarchy {};
    hierarchy.nodes = {ModelHierarchyNode {-1, "BASE", Translation(5.0f, 0.0f, 0.0f)}};
    hierarchy.source_date = Date {2024, 1, 1, 0, 0, 0, 0};
    hierarchy.source_path = "EX_RIG.ASC";
    auto wh = Write::to(dir / "EX_RIG.MDH");
    hierarchy.save(wh.get());
  }

  // Name resolution never opens the file it resolves to, so these hold no real
  // asset: they exist for vfsResolve and must never be handed to extractVisual
  // or decodeTexture. They do carry one byte, because `Vfs::mount_host` skips
  // any host file of size zero.
  //   EX_HERO.ASC/.MDS -> EX_HERO.MDL, with an .MDM present to make the order
  //                       observable; EX_GOBBO.ASC -> the .MDM fallback.
  //   EX_BLOB.MMS      -> EX_BLOB.MMB.
  //   EX_LIT.TEX       -> itself: an already-compiled name is passed through.
  for (auto const* name :
       {"EX_HERO.MDL", "EX_HERO.MDM", "EX_GOBBO.MDM", "EX_BLOB.MMB", "EX_LIT.TEX"}) {
    std::ofstream stream {dir / name, std::ios::binary | std::ios::trunc};
    stream.put('\0');
  }
}

}  // namespace zenkit_node
