#include "fixture.hh"

#include "msvc_crt_guard.hh"

#include <zenkit/Material.hh>
#include <zenkit/Mesh.hh>
#include <zenkit/Stream.hh>
#include <zenkit/World.hh>
#include <zenkit/vobs/Misc.hh>
#include <zenkit/vobs/MovableObject.hh>
#include <zenkit/vobs/VirtualObject.hh>
#include <zenkit/world/BspTree.hh>
#include <zenkit/world/WayNet.hh>

#include <memory>

namespace zenkit_node {

namespace {

using namespace zenkit;

void BuildMesh(Mesh& mesh) {
  // Deterministic creation date; the archive header's own date/user stamp is
  // written by ZenKit's archive writer and is expected to vary.
  mesh.date = Date {2024, 1, 1, 0, 0, 0};
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
}

void BuildBspTree(BspTree& bsp, AxisAlignedBoundingBox const& bbox) {
  bsp.mode = BspTreeType::OUTDOOR;
  bsp.polygon_indices = {0, 1};

  // A single leaf node covering all polygons. BspTree::load treats a
  // one-node tree as a leaf, so leaf_node_indices must be exactly {0}.
  BspNode node {};
  node.bbox = bbox;
  node.polygon_index = 0;
  node.polygon_count = 2;
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

  root->children = {spot, item, container};
  return root;
}

std::shared_ptr<WayNet> BuildWayNet() {
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
  return waynet;
}

}  // namespace

void AuthorFixtureWorld(std::filesystem::path const& path,
                        zenkit::ArchiveFormat format,
                        zenkit::GameVersion version) {
  auto world = std::make_shared<World>();

  BuildMesh(world->world_mesh);
  BuildBspTree(world->world_bsp_tree, world->world_mesh.bbox);
  world->world_vobs.push_back(BuildVobTree());
  world->way_net = BuildWayNet();

  // See msvc_crt_guard.hh: keeps ZenKit's glibc-only strftime format from
  // fail-fasting the process on Windows while the archive header is stamped.
  ScopedCrtInvalidParameterGuard crt_guard;

  auto w = Write::to(path);
  auto archive = WriteArchive::to(w.get(), format);
  // Same top-level flow as loading expects: a single "[% oCWorld:zCWorld ...]"
  // wrapper object (write_object derives class name and version identifier
  // from the World object itself), then a final write_header() to patch the
  // object count and emit the binsafe hash table.
  archive->write_object("%", std::static_pointer_cast<Object>(world), version);
  archive->write_header();
}

}  // namespace zenkit_node
