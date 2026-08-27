#include "normalize.hh"

#include <zenkit/Material.hh>
#include <zenkit/Mesh.hh>
#include <zenkit/vobs/Camera.hh>
#include <zenkit/vobs/Light.hh>
#include <zenkit/vobs/Misc.hh>
#include <zenkit/vobs/MovableObject.hh>
#include <zenkit/vobs/Sound.hh>
#include <zenkit/vobs/Trigger.hh>
#include <zenkit/vobs/VirtualObject.hh>
#include <zenkit/vobs/Zone.hh>
#include <zenkit/world/BspTree.hh>
#include <zenkit/world/WayNet.hh>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

#include "encoding.hh"
#include "napi_helpers.hh"
#include "sha256.hh"

namespace zenkit_node {

namespace {

using namespace zenkit;

// ---------------------------------------------------------------------------
// JS value helpers. Every string crossing to JS goes through the cp1252 layer
// — `Str` is the shared one in napi_helpers.hh.

// Floats become JS numbers as-is (the classifier owns epsilon logic). -0.0 is
// normalized to +0.0 because JSON round-trips lose the sign of zero and
// assert.deepStrictEqual distinguishes the two.
Napi::Number NumF(Napi::Env env, float value) {
  return Napi::Number::New(env, value == 0.0f ? 0.0 : static_cast<double>(value));
}

template <typename T>
Napi::Number NumI(Napi::Env env, T value) {
  return Napi::Number::New(env, static_cast<double>(value));
}

template <typename E>
Napi::Number EnumI(Napi::Env env, E value) {
  return Napi::Number::New(env, static_cast<double>(static_cast<std::int64_t>(value)));
}

Napi::Array Vec2Arr(Napi::Env env, Vec2 const& v) {
  auto arr = Napi::Array::New(env, 2);
  arr.Set(0u, NumF(env, v.x));
  arr.Set(1u, NumF(env, v.y));
  return arr;
}

Napi::Array Vec3Arr(Napi::Env env, Vec3 const& v) {
  auto arr = Napi::Array::New(env, 3);
  arr.Set(0u, NumF(env, v.x));
  arr.Set(1u, NumF(env, v.y));
  arr.Set(2u, NumF(env, v.z));
  return arr;
}

Napi::Array ColorArr(Napi::Env env, Color const& c) {
  auto arr = Napi::Array::New(env, 4);
  arr.Set(0u, NumI(env, c.r));
  arr.Set(1u, NumI(env, c.g));
  arr.Set(2u, NumI(env, c.b));
  arr.Set(3u, NumI(env, c.a));
  return arr;
}

Napi::Array QuatArr(Napi::Env env, Quat const& q) {
  auto arr = Napi::Array::New(env, 4);
  arr.Set(0u, NumF(env, q.w));
  arr.Set(1u, NumF(env, q.x));
  arr.Set(2u, NumF(env, q.y));
  arr.Set(3u, NumF(env, q.z));
  return arr;
}

// zenkit::Mat3 stores columns; element(row, col) == columns[col][row]. This
// emits row-major order, which is also the order the 9 floats appear in the
// archive (Read::read_mat3 transposes on load).
Napi::Array Mat3RowMajor(Napi::Env env, Mat3 const& m) {
  auto arr = Napi::Array::New(env, 9);
  std::uint32_t index = 0;
  for (unsigned row = 0; row < 3; ++row) {
    for (unsigned col = 0; col < 3; ++col) {
      arr.Set(index++, NumF(env, m.columns[col][row]));
    }
  }
  return arr;
}

Napi::Array Mat4RowMajor(Napi::Env env, Mat4 const& m) {
  auto arr = Napi::Array::New(env, 16);
  std::uint32_t index = 0;
  for (unsigned row = 0; row < 4; ++row) {
    for (unsigned col = 0; col < 4; ++col) {
      arr.Set(index++, NumF(env, m.columns[col][row]));
    }
  }
  return arr;
}

Napi::Array BboxArr(Napi::Env env, AxisAlignedBoundingBox const& bbox) {
  auto arr = Napi::Array::New(env, 6);
  arr.Set(0u, NumF(env, bbox.min.x));
  arr.Set(1u, NumF(env, bbox.min.y));
  arr.Set(2u, NumF(env, bbox.min.z));
  arr.Set(3u, NumF(env, bbox.max.x));
  arr.Set(4u, NumF(env, bbox.max.y));
  arr.Set(5u, NumF(env, bbox.max.z));
  return arr;
}

// ---------------------------------------------------------------------------
// Canonical little-endian byte serialization for the bulk-data hashes.

struct ByteSink {
  std::vector<std::uint8_t> bytes;

  void U8(std::uint8_t v) { bytes.push_back(v); }
  void U16(std::uint16_t v) {
    bytes.push_back(static_cast<std::uint8_t>(v));
    bytes.push_back(static_cast<std::uint8_t>(v >> 8));
  }
  void U32(std::uint32_t v) {
    for (int shift = 0; shift < 32; shift += 8) {
      bytes.push_back(static_cast<std::uint8_t>(v >> shift));
    }
  }
  void U64(std::uint64_t v) {
    for (int shift = 0; shift < 64; shift += 8) {
      bytes.push_back(static_cast<std::uint8_t>(v >> shift));
    }
  }
  void I16(std::int16_t v) { U16(static_cast<std::uint16_t>(v)); }
  void I32(std::int32_t v) { U32(static_cast<std::uint32_t>(v)); }
  // Raw IEEE-754 LE bytes — no quantization, bit-exact.
  void F32(float v) {
    std::uint32_t raw;
    std::memcpy(&raw, &v, sizeof(raw));
    U32(raw);
  }
  void V2(Vec2 const& v) {
    F32(v.x);
    F32(v.y);
  }
  void V3(Vec3 const& v) {
    F32(v.x);
    F32(v.y);
    F32(v.z);
  }
  void Rgba(Color const& c) {
    U8(c.r);
    U8(c.g);
    U8(c.b);
    U8(c.a);
  }
  // Strings as raw cp1252 bytes, u32-length-prefixed.
  void Str(std::string const& s) {
    U32(static_cast<std::uint32_t>(s.size()));
    bytes.insert(bytes.end(), s.begin(), s.end());
  }

  std::string Digest() const { return Sha256Prefixed(bytes); }
};

std::string HashVertices(Mesh const& mesh) {
  ByteSink sink;
  for (auto const& v : mesh.vertices) sink.V3(v);
  return sink.Digest();
}

std::string HashFeatures(Mesh const& mesh) {
  ByteSink sink;
  for (auto const& f : mesh.features) {
    sink.V2(f.texture);
    sink.U32(f.light);
    sink.V3(f.normal);
  }
  return sink.Digest();
}

// Hashes the loader's source-of-truth polygon representation: `geometry` plus
// the flat per-polygon `polygon_vertex_indices` / `polygon_feature_indices`
// arrays, which Mesh::load fills directly from the file. The triangulated
// PolygonList (`mesh.polygons`) is *derived* from these by triangulate() and
// is deliberately not hashed.
std::string HashPolygons(Mesh const& mesh) {
  ByteSink sink;
  for (auto const& poly : mesh.geometry) {
    sink.U32(poly.material);
    sink.I32(poly.lightmap);
    sink.U8(poly.flags.is_portal);
    sink.U8(poly.flags.is_occluder);
    sink.U8(poly.flags.is_sector);
    sink.U8(poly.flags.should_relight);
    sink.U8(poly.flags.is_outdoor);
    sink.U8(poly.flags.is_ghost_occluder);
    sink.U8(poly.flags.is_dynamically_lit);
    sink.I16(poly.flags.sector_index);
    sink.U8(poly.flags.is_lod);
    sink.U8(poly.flags.normal_axis);
    sink.F32(poly.plane_distance);
    sink.V3(poly.plane_normal);
    sink.U32(static_cast<std::uint32_t>(poly.index_count));
    for (std::size_t i = 0; i < poly.index_count; ++i) {
      sink.U32(mesh.polygon_vertex_indices[poly.index_offset + i]);
      sink.U32(mesh.polygon_feature_indices[poly.index_offset + i]);
    }
  }
  return sink.Digest();
}

// Every Material field in Material.hh declaration order.
std::string HashMaterials(Mesh const& mesh) {
  ByteSink sink;
  for (auto const& mat : mesh.materials) {
    sink.Str(mat.name);
    sink.U8(static_cast<std::uint8_t>(mat.group));
    sink.Rgba(mat.color);
    sink.F32(mat.smooth_angle);
    sink.Str(mat.texture);
    sink.V2(mat.texture_scale);
    sink.F32(mat.texture_anim_fps);
    sink.I32(static_cast<std::int32_t>(mat.texture_anim_map_mode));
    sink.V2(mat.texture_anim_map_dir);
    sink.U8(mat.disable_collision ? 1 : 0);
    sink.U8(mat.disable_lightmap ? 1 : 0);
    sink.U8(mat.dont_collapse ? 1 : 0);
    sink.Str(mat.detail_object);
    sink.F32(mat.detail_object_scale);
    sink.U8(mat.force_occluder ? 1 : 0);
    sink.U8(mat.environment_mapping ? 1 : 0);
    sink.F32(mat.environment_mapping_strength);
    sink.U8(static_cast<std::uint8_t>(mat.wave_mode));
    sink.U8(static_cast<std::uint8_t>(mat.wave_speed));
    sink.F32(mat.wave_max_amplitude);
    sink.F32(mat.wave_grid_size);
    sink.U8(mat.ignore_sun ? 1 : 0);
    sink.I32(static_cast<std::int32_t>(mat.alpha_func));
    sink.V2(mat.default_mapping);
  }
  return sink.Digest();
}

std::string HashIndexArray(std::vector<std::uint32_t> const& indices) {
  ByteSink sink;
  for (auto const index : indices) sink.U32(index);
  return sink.Digest();
}

std::string HashBspNodes(BspTree const& bsp) {
  ByteSink sink;
  for (auto const& node : bsp.nodes) {
    sink.F32(node.plane.x);
    sink.F32(node.plane.y);
    sink.F32(node.plane.z);
    sink.F32(node.plane.w);
    sink.V3(node.bbox.min);
    sink.V3(node.bbox.max);
    sink.U32(node.polygon_index);
    sink.U32(node.polygon_count);
    sink.I32(node.front_index);
    sink.I32(node.back_index);
    sink.I32(node.parent_index);
    sink.U8(node.lod);
  }
  return sink.Digest();
}

// Depth of the tree, walking front/back links from the root (node 0). A
// single-node tree has depth 1; an empty tree has depth 0.
std::uint32_t BspTreeDepth(BspTree const& bsp) {
  if (bsp.nodes.empty()) return 0;
  std::uint32_t max_depth = 0;
  std::vector<std::pair<std::int32_t, std::uint32_t>> stack {{0, 1}};
  while (!stack.empty()) {
    auto const [index, depth] = stack.back();
    stack.pop_back();
    if (index < 0 || static_cast<std::size_t>(index) >= bsp.nodes.size()) continue;
    max_depth = std::max(max_depth, depth);
    auto const& node = bsp.nodes[static_cast<std::size_t>(index)];
    if (node.front_index >= 0) stack.emplace_back(node.front_index, depth + 1);
    if (node.back_index >= 0) stack.emplace_back(node.back_index, depth + 1);
  }
  return max_depth;
}

// ---------------------------------------------------------------------------
// VOB class names, exactly the ZenGin class identifiers. Declared in the header
// and therefore lifted out of the anonymous namespace — the mutation path names
// the class in every refusal it makes, and a second switch would answer with a
// different vocabulary the moment either side gained a class.

}  // namespace

char const* VobClassName(zenkit::VirtualObjectType type) {
  using namespace zenkit;

  switch (type) {
    case VirtualObjectType::zCVob: return "zCVob";
    case VirtualObjectType::zCVobLevelCompo: return "zCVobLevelCompo";
    case VirtualObjectType::oCItem: return "oCItem";
    case VirtualObjectType::oCNpc: return "oCNpc";
    case VirtualObjectType::zCMoverController: return "zCMoverController";
    case VirtualObjectType::zCVobScreenFX: return "zCVobScreenFX";
    case VirtualObjectType::zCVobStair: return "zCVobStair";
    case VirtualObjectType::zCPFXController: return "zCPFXController";
    case VirtualObjectType::zCVobAnimate: return "zCVobAnimate";
    case VirtualObjectType::zCVobLensFlare: return "zCVobLensFlare";
    case VirtualObjectType::zCVobLight: return "zCVobLight";
    case VirtualObjectType::zCVobSpot: return "zCVobSpot";
    case VirtualObjectType::zCVobStartpoint: return "zCVobStartpoint";
    case VirtualObjectType::zCMessageFilter: return "zCMessageFilter";
    case VirtualObjectType::zCCodeMaster: return "zCCodeMaster";
    case VirtualObjectType::zCTriggerWorldStart: return "zCTriggerWorldStart";
    case VirtualObjectType::zCCSCamera: return "zCCSCamera";
    case VirtualObjectType::zCCamTrj_KeyFrame: return "zCCamTrj_KeyFrame";
    case VirtualObjectType::oCTouchDamage: return "oCTouchDamage";
    case VirtualObjectType::zCTriggerUntouch: return "zCTriggerUntouch";
    case VirtualObjectType::zCEarthquake: return "zCEarthquake";
    case VirtualObjectType::oCMOB: return "oCMOB";
    case VirtualObjectType::oCMobInter: return "oCMobInter";
    case VirtualObjectType::oCMobBed: return "oCMobBed";
    case VirtualObjectType::oCMobFire: return "oCMobFire";
    case VirtualObjectType::oCMobLadder: return "oCMobLadder";
    case VirtualObjectType::oCMobSwitch: return "oCMobSwitch";
    case VirtualObjectType::oCMobWheel: return "oCMobWheel";
    case VirtualObjectType::oCMobContainer: return "oCMobContainer";
    case VirtualObjectType::oCMobDoor: return "oCMobDoor";
    case VirtualObjectType::zCTrigger: return "zCTrigger";
    case VirtualObjectType::zCTriggerList: return "zCTriggerList";
    case VirtualObjectType::oCTriggerScript: return "oCTriggerScript";
    case VirtualObjectType::oCTriggerChangeLevel: return "oCTriggerChangeLevel";
    case VirtualObjectType::oCCSTrigger: return "oCCSTrigger";
    case VirtualObjectType::zCMover: return "zCMover";
    case VirtualObjectType::zCVobSound: return "zCVobSound";
    case VirtualObjectType::zCVobSoundDaytime: return "zCVobSoundDaytime";
    case VirtualObjectType::oCZoneMusic: return "oCZoneMusic";
    case VirtualObjectType::oCZoneMusicDefault: return "oCZoneMusicDefault";
    case VirtualObjectType::zCZoneZFog: return "zCZoneZFog";
    case VirtualObjectType::zCZoneZFogDefault: return "zCZoneZFogDefault";
    case VirtualObjectType::zCZoneVobFarPlane: return "zCZoneVobFarPlane";
    case VirtualObjectType::zCZoneVobFarPlaneDefault: return "zCZoneVobFarPlaneDefault";
    default: return "unknown";
  }
}

namespace {

using namespace zenkit;

char const* VisualTypeName(VisualType type) {
  switch (type) {
    case VisualType::DECAL: return "DECAL";
    case VisualType::MESH: return "MESH";
    case VisualType::MULTI_RESOLUTION_MESH: return "MULTI_RESOLUTION_MESH";
    case VisualType::PARTICLE_EFFECT: return "PARTICLE_EFFECT";
    case VisualType::AI_CAMERA: return "AI_CAMERA";
    case VisualType::MODEL: return "MODEL";
    case VisualType::MORPH_MESH: return "MORPH_MESH";
    default: return "UNKNOWN";
  }
}

// ---------------------------------------------------------------------------
// props — every class-specific field, mechanically mirroring the headers in
// vendor/ZenKit/include/zenkit/vobs/*.hh. Deprecated ZKREM duplicates
// (visual_name, VTrigger::flags/filter_flags, VirtualObject::id, ...) and
// fields under a "Save-game only variables" comment are skipped: loadWorld
// rejects save-games, so those fields are never present (VNpc, which only
// exists in save-games, is still covered in full for later phases).
// shared_ptr cross-references are emitted as the referenced VOB's name, never
// as the object.

void PutMovableObjectProps(Napi::Env env, Napi::Object props, VMovableObject const& vob) {
  props.Set("focusName", Str(env, vob.name));
  props.Set("hp", NumI(env, vob.hp));
  props.Set("damage", NumI(env, vob.damage));
  props.Set("movable", Napi::Boolean::New(env, vob.movable));
  props.Set("takable", Napi::Boolean::New(env, vob.takable));
  props.Set("focusOverride", Napi::Boolean::New(env, vob.focus_override));
  props.Set("soundMaterial", EnumI(env, vob.material));
  props.Set("visualDestroyed", Str(env, vob.visual_destroyed));
  props.Set("owner", Str(env, vob.owner));
  props.Set("ownerGuild", Str(env, vob.owner_guild));
  props.Set("destroyed", Napi::Boolean::New(env, vob.destroyed));
}

void PutInteractiveObjectProps(Napi::Env env, Napi::Object props, VInteractiveObject const& vob) {
  props.Set("stateCount", NumI(env, vob.state_count));
  props.Set("target", Str(env, vob.target));
  props.Set("item", Str(env, vob.item));
  props.Set("conditionFunction", Str(env, vob.condition_function));
  props.Set("onStateChangeFunction", Str(env, vob.on_state_change_function));
  props.Set("rewind", Napi::Boolean::New(env, vob.rewind));
}

void PutTriggerProps(Napi::Env env, Napi::Object props, VTrigger const& vob) {
  props.Set("target", Str(env, vob.target));
  props.Set("startEnabled", Napi::Boolean::New(env, vob.start_enabled));
  props.Set("sendUntrigger", Napi::Boolean::New(env, vob.send_untrigger));
  props.Set("reactToOnTrigger", Napi::Boolean::New(env, vob.react_to_on_trigger));
  props.Set("reactToOnTouch", Napi::Boolean::New(env, vob.react_to_on_touch));
  props.Set("reactToOnDamage", Napi::Boolean::New(env, vob.react_to_on_damage));
  props.Set("respondToObject", Napi::Boolean::New(env, vob.respond_to_object));
  props.Set("respondToPc", Napi::Boolean::New(env, vob.respond_to_pc));
  props.Set("respondToNpc", Napi::Boolean::New(env, vob.respond_to_npc));
  props.Set("vobTarget", Str(env, vob.vob_target));
  props.Set("maxActivationCount", NumI(env, vob.max_activation_count));
  props.Set("retriggerDelaySec", NumF(env, vob.retrigger_delay_sec));
  props.Set("damageThreshold", NumF(env, vob.damage_threshold));
  props.Set("fireDelaySec", NumF(env, vob.fire_delay_sec));
}

void PutLightPresetProps(Napi::Env env, Napi::Object props, LightPreset const& light) {
  props.Set("preset", Str(env, light.preset));
  props.Set("lightType", EnumI(env, light.light_type));
  props.Set("range", NumF(env, light.range));
  props.Set("color", ColorArr(env, light.color));
  props.Set("coneAngle", NumF(env, light.cone_angle));
  props.Set("isStatic", Napi::Boolean::New(env, light.is_static));
  props.Set("quality", EnumI(env, light.quality));
  props.Set("lensflareFx", Str(env, light.lensflare_fx));
  props.Set("on", Napi::Boolean::New(env, light.on));
  auto range_anim = Napi::Array::New(env, light.range_animation_scale.size());
  for (std::uint32_t i = 0; i < light.range_animation_scale.size(); ++i) {
    range_anim.Set(i, NumF(env, light.range_animation_scale[i]));
  }
  props.Set("rangeAnimationScale", range_anim);
  props.Set("rangeAnimationFps", NumF(env, light.range_animation_fps));
  props.Set("rangeAnimationSmooth", Napi::Boolean::New(env, light.range_animation_smooth));
  auto color_anim = Napi::Array::New(env, light.color_animation_list.size());
  for (std::uint32_t i = 0; i < light.color_animation_list.size(); ++i) {
    color_anim.Set(i, ColorArr(env, light.color_animation_list[i]));
  }
  props.Set("colorAnimationList", color_anim);
  props.Set("colorAnimationFps", NumF(env, light.color_animation_fps));
  props.Set("colorAnimationSmooth", Napi::Boolean::New(env, light.color_animation_smooth));
  props.Set("canMove", Napi::Boolean::New(env, light.can_move));
}

void PutSoundProps(Napi::Env env, Napi::Object props, VSound const& vob) {
  props.Set("volume", NumF(env, vob.volume));
  props.Set("mode", EnumI(env, vob.mode));
  props.Set("randomDelay", NumF(env, vob.random_delay));
  props.Set("randomDelayVar", NumF(env, vob.random_delay_var));
  props.Set("initiallyPlaying", Napi::Boolean::New(env, vob.initially_playing));
  props.Set("ambient3d", Napi::Boolean::New(env, vob.ambient3d));
  props.Set("obstruction", Napi::Boolean::New(env, vob.obstruction));
  props.Set("coneAngle", NumF(env, vob.cone_angle));
  props.Set("volumeType", EnumI(env, vob.volume_type));
  props.Set("radius", NumF(env, vob.radius));
  props.Set("soundName", Str(env, vob.sound_name));
}

void PutZoneMusicProps(Napi::Env env, Napi::Object props, VZoneMusic const& vob) {
  props.Set("enabled", Napi::Boolean::New(env, vob.enabled));
  props.Set("priority", NumI(env, vob.priority));
  props.Set("ellipsoid", Napi::Boolean::New(env, vob.ellipsoid));
  props.Set("reverb", NumF(env, vob.reverb));
  props.Set("volume", NumF(env, vob.volume));
  props.Set("loop", Napi::Boolean::New(env, vob.loop));
}

Napi::Object TrajectoryFrameProps(Napi::Env env, VCameraTrajectoryFrame const& frame) {
  auto obj = Napi::Object::New(env);
  obj.Set("name", Str(env, frame.vob_name));
  obj.Set("position", Vec3Arr(env, frame.position));
  obj.Set("time", NumF(env, frame.time));
  obj.Set("rollAngle", NumF(env, frame.roll_angle));
  obj.Set("fovScale", NumF(env, frame.fov_scale));
  obj.Set("motionType", EnumI(env, frame.motion_type));
  obj.Set("motionTypeFov", EnumI(env, frame.motion_type_fov));
  obj.Set("motionTypeRoll", EnumI(env, frame.motion_type_roll));
  obj.Set("motionTypeTimeScale", EnumI(env, frame.motion_type_time_scale));
  obj.Set("tension", NumF(env, frame.tension));
  obj.Set("camBias", NumF(env, frame.cam_bias));
  obj.Set("continuity", NumF(env, frame.continuity));
  obj.Set("timeScale", NumF(env, frame.time_scale));
  obj.Set("timeFixed", Napi::Boolean::New(env, frame.time_fixed));
  obj.Set("originalPose", Mat4RowMajor(env, frame.original_pose));
  return obj;
}

Napi::Array TrajectoryFrameList(Napi::Env env,
                                std::vector<std::shared_ptr<VCameraTrajectoryFrame>> const& frames) {
  auto arr = Napi::Array::New(env, frames.size());
  for (std::uint32_t i = 0; i < frames.size(); ++i) {
    arr.Set(i, frames[i] != nullptr ? Napi::Value(TrajectoryFrameProps(env, *frames[i]))
                                    : Napi::Value(env.Null()));
  }
  return arr;
}

Napi::Value VobRefName(Napi::Env env, std::shared_ptr<VirtualObject> const& ref) {
  // Cross-references are emitted by name only — never the object itself.
  if (ref == nullptr) return env.Null();
  return Str(env, ref->vob_name);
}

void PutNpcProps(Napi::Env env, Napi::Object props, VNpc const& npc) {
  props.Set("npcInstance", Str(env, npc.npc_instance));
  props.Set("modelScale", Vec3Arr(env, npc.model_scale));
  props.Set("modelFatness", NumF(env, npc.model_fatness));
  auto overlays = Napi::Array::New(env, npc.overlays.size());
  for (std::uint32_t i = 0; i < npc.overlays.size(); ++i) overlays.Set(i, Str(env, npc.overlays[i]));
  props.Set("overlays", overlays);
  props.Set("flags", NumI(env, npc.flags));
  props.Set("guild", NumI(env, npc.guild));
  props.Set("guildTrue", NumI(env, npc.guild_true));
  props.Set("level", NumI(env, npc.level));
  props.Set("xp", NumI(env, npc.xp));
  props.Set("xpNextLevel", NumI(env, npc.xp_next_level));
  props.Set("lp", NumI(env, npc.lp));
  auto talents = Napi::Array::New(env, npc.talents.size());
  for (std::uint32_t i = 0; i < npc.talents.size(); ++i) {
    if (npc.talents[i] == nullptr) {
      talents.Set(i, env.Null());
      continue;
    }
    auto talent = Napi::Object::New(env);
    talent.Set("talent", NumI(env, npc.talents[i]->talent));
    talent.Set("value", NumI(env, npc.talents[i]->value));
    talent.Set("skill", NumI(env, npc.talents[i]->skill));
    talents.Set(i, talent);
  }
  props.Set("talents", talents);
  props.Set("fightTactic", NumI(env, npc.fight_tactic));
  props.Set("fightMode", NumI(env, npc.fight_mode));
  props.Set("wounded", Napi::Boolean::New(env, npc.wounded));
  props.Set("mad", Napi::Boolean::New(env, npc.mad));
  props.Set("madTime", NumI(env, npc.mad_time));
  props.Set("player", Napi::Boolean::New(env, npc.player));
  auto int_array = [&env](int const* values, std::uint32_t count) {
    auto arr = Napi::Array::New(env, count);
    for (std::uint32_t i = 0; i < count; ++i) arr.Set(i, NumI(env, values[i]));
    return arr;
  };
  props.Set("attributes", int_array(npc.attributes, VNpc::attribute_count));
  props.Set("hitChance", int_array(npc.hit_chance, VNpc::hcs_count));
  props.Set("missions", int_array(npc.missions, VNpc::missions_count));
  props.Set("startAiState", Str(env, npc.start_ai_state));
  props.Set("aivar", int_array(npc.aivar, VNpc::aivar_count));
  props.Set("scriptWaypoint", Str(env, npc.script_waypoint));
  props.Set("attitude", NumI(env, npc.attitude));
  props.Set("attitudeTemp", NumI(env, npc.attitude_temp));
  props.Set("nameNr", NumI(env, npc.name_nr));
  props.Set("moveLock", Napi::Boolean::New(env, npc.move_lock));
  auto packed = Napi::Array::New(env, VNpc::packed_count);
  for (std::uint32_t i = 0; i < VNpc::packed_count; ++i) packed.Set(i, Str(env, npc.packed[i]));
  props.Set("packed", packed);
  auto news = Napi::Array::New(env, npc.news.size());
  for (std::uint32_t i = 0; i < npc.news.size(); ++i) {
    if (npc.news[i] == nullptr) {
      news.Set(i, env.Null());
      continue;
    }
    auto entry = Napi::Object::New(env);
    entry.Set("told", Napi::Boolean::New(env, npc.news[i]->told));
    entry.Set("spreadTime", NumF(env, npc.news[i]->spread_time));
    entry.Set("spreadType", EnumI(env, npc.news[i]->spread_type));
    entry.Set("newsId", EnumI(env, npc.news[i]->news_id));
    entry.Set("gossip", Napi::Boolean::New(env, npc.news[i]->gossip));
    entry.Set("guildVictim", Napi::Boolean::New(env, npc.news[i]->guild_victim));
    entry.Set("witnessName", Str(env, npc.news[i]->witness_name));
    entry.Set("offenderName", Str(env, npc.news[i]->offender_name));
    entry.Set("victimName", Str(env, npc.news[i]->victim_name));
    news.Set(i, entry);
  }
  props.Set("news", news);
  auto items = Napi::Array::New(env, npc.items.size());
  for (std::uint32_t i = 0; i < npc.items.size(); ++i) {
    items.Set(i, VobRefName(env, npc.items[i]));
  }
  props.Set("items", items);
  auto slots = Napi::Array::New(env, npc.slots.size());
  for (std::uint32_t i = 0; i < npc.slots.size(); ++i) {
    if (npc.slots[i] == nullptr) {
      slots.Set(i, env.Null());
      continue;
    }
    auto slot = Napi::Object::New(env);
    slot.Set("used", Napi::Boolean::New(env, npc.slots[i]->used));
    slot.Set("name", Str(env, npc.slots[i]->name));
    slot.Set("itemName", VobRefName(env, npc.slots[i]->item));
    slot.Set("inInventory", Napi::Boolean::New(env, npc.slots[i]->in_inventory));
    slots.Set(i, slot);
  }
  props.Set("slots", slots);
  props.Set("currentStateValid", Napi::Boolean::New(env, npc.current_state_valid));
  props.Set("currentStateName", Str(env, npc.current_state_name));
  props.Set("currentStateIndex", NumI(env, npc.current_state_index));
  props.Set("currentStateIsRoutine", Napi::Boolean::New(env, npc.current_state_is_routine));
  props.Set("nextStateValid", Napi::Boolean::New(env, npc.next_state_valid));
  props.Set("nextStateName", Str(env, npc.next_state_name));
  props.Set("nextStateIndex", NumI(env, npc.next_state_index));
  props.Set("nextStateIsRoutine", Napi::Boolean::New(env, npc.next_state_is_routine));
  props.Set("lastAiState", NumI(env, npc.last_ai_state));
  props.Set("hasRoutine", Napi::Boolean::New(env, npc.has_routine));
  props.Set("routineChanged", Napi::Boolean::New(env, npc.routine_changed));
  props.Set("routineOverlay", Napi::Boolean::New(env, npc.routine_overlay));
  props.Set("routineOverlayCount", NumI(env, npc.routine_overlay_count));
  props.Set("walkmodeRoutine", NumI(env, npc.walkmode_routine));
  props.Set("weaponmodeRoutine", Napi::Boolean::New(env, npc.weaponmode_routine));
  props.Set("startNewRoutine", Napi::Boolean::New(env, npc.start_new_routine));
  props.Set("aiStateDriven", NumI(env, npc.ai_state_driven));
  props.Set("aiStatePos", Vec3Arr(env, npc.ai_state_pos));
  props.Set("currentRoutine", Str(env, npc.current_routine));
  props.Set("respawn", Napi::Boolean::New(env, npc.respawn));
  props.Set("respawnTime", NumI(env, npc.respawn_time));
  props.Set("protection", int_array(npc.protection, VNpc::protection_count));
  props.Set("bsInterruptableOverride", NumI(env, npc.bs_interruptable_override));
  props.Set("npcType", NumI(env, npc.npc_type));
  props.Set("spellMana", NumI(env, npc.spell_mana));
  props.Set("carryVob", VobRefName(env, npc.carry_vob));
  props.Set("enemy", VobRefName(env, npc.enemy));
}

// Base-class extras every VOB carries beyond the top-level dump fields.
void PutBaseProps(Napi::Env env, Napi::Object props, VirtualObject const& vob) {
  props.Set("presetName", Str(env, vob.preset_name));
  props.Set("bias", NumI(env, vob.bias));
  props.Set("animStrength", NumF(env, vob.anim_strength));
  props.Set("farClipScale", NumF(env, vob.far_clip_scale));
  props.Set("sleepMode", NumI(env, vob.sleep_mode));
  props.Set("nextOnTimer", NumF(env, vob.next_on_timer));

  if (vob.rigid_body.has_value()) {
    auto body = Napi::Object::New(env);
    body.Set("vel", Vec3Arr(env, vob.rigid_body->vel));
    body.Set("mode", NumI(env, vob.rigid_body->mode));
    body.Set("gravityEnabled", Napi::Boolean::New(env, vob.rigid_body->gravity_enabled));
    body.Set("gravityScale", NumF(env, vob.rigid_body->gravity_scale));
    body.Set("slideDirection", Vec3Arr(env, vob.rigid_body->slide_direction));
    props.Set("rigidBody", body);
  } else {
    props.Set("rigidBody", env.Null());
  }

  if (vob.event_manager != nullptr) {
    auto em = Napi::Object::New(env);
    em.Set("cleared", Napi::Boolean::New(env, vob.event_manager->cleared));
    em.Set("active", Napi::Boolean::New(env, vob.event_manager->active));
    props.Set("eventManager", em);
  } else {
    props.Set("eventManager", env.Null());
  }

  // Ai is save-game only: presence + type, nothing more.
  if (vob.ai != nullptr) {
    auto ai = Napi::Object::New(env);
    ai.Set("type", NumI(env, static_cast<std::int64_t>(vob.ai->get_object_type())));
    props.Set("ai", ai);
  } else {
    props.Set("ai", env.Null());
  }

  // Decal visuals carry data of their own; all other visual types are fully
  // described by the top-level visual/visualType fields. Dispatched via
  // get_object_type() (a plain virtual), not dynamic_cast: node-gyp builds
  // with RTTI disabled on some platforms.
  if (vob.visual != nullptr && vob.visual->get_object_type() == ObjectType::zCDecal) {
    auto const* decal = static_cast<VisualDecal const*>(vob.visual.get());
    auto obj = Napi::Object::New(env);
    obj.Set("dimension", Vec2Arr(env, decal->dimension));
    obj.Set("offset", Vec2Arr(env, decal->offset));
    obj.Set("twoSided", Napi::Boolean::New(env, decal->two_sided));
    obj.Set("alphaFunc", EnumI(env, decal->alpha_func));
    obj.Set("textureAnimFps", NumF(env, decal->texture_anim_fps));
    obj.Set("alphaWeight", NumI(env, decal->alpha_weight));
    obj.Set("ignoreDaylight", Napi::Boolean::New(env, decal->ignore_daylight));
    props.Set("decal", obj);
  } else {
    props.Set("decal", env.Null());
  }
}

// Per-layer helpers used by the type switch below.

void PutFireProps(Napi::Env env, Napi::Object props, VFire const& vob) {
  props.Set("slot", Str(env, vob.slot));
  props.Set("vobTree", Str(env, vob.vob_tree));
}

void PutContainerProps(Napi::Env env, Napi::Object props, VContainer const& vob) {
  props.Set("locked", Napi::Boolean::New(env, vob.locked));
  props.Set("key", Str(env, vob.key));
  props.Set("pickString", Str(env, vob.pick_string));
  props.Set("contents", Str(env, vob.contents));
}

void PutDoorProps(Napi::Env env, Napi::Object props, VDoor const& vob) {
  props.Set("locked", Napi::Boolean::New(env, vob.locked));
  props.Set("key", Str(env, vob.key));
  props.Set("pickString", Str(env, vob.pick_string));
}

void PutMoverProps(Napi::Env env, Napi::Object props, VMover const& vob) {
  props.Set("behavior", EnumI(env, vob.behavior));
  props.Set("touchBlockerDamage", NumF(env, vob.touch_blocker_damage));
  props.Set("stayOpenTimeSec", NumF(env, vob.stay_open_time_sec));
  props.Set("locked", Napi::Boolean::New(env, vob.locked));
  props.Set("autoLink", Napi::Boolean::New(env, vob.auto_link));
  props.Set("autoRotate", Napi::Boolean::New(env, vob.auto_rotate));
  props.Set("speed", NumF(env, vob.speed));
  props.Set("lerpMode", EnumI(env, vob.lerp_mode));
  props.Set("speedMode", EnumI(env, vob.speed_mode));
  auto keyframes = Napi::Array::New(env, vob.keyframes.size());
  for (std::uint32_t i = 0; i < vob.keyframes.size(); ++i) {
    auto frame = Napi::Object::New(env);
    frame.Set("position", Vec3Arr(env, vob.keyframes[i].position));
    frame.Set("rotation", QuatArr(env, vob.keyframes[i].rotation));
    keyframes.Set(i, frame);
  }
  props.Set("keyframes", keyframes);
  props.Set("sfxOpenStart", Str(env, vob.sfx_open_start));
  props.Set("sfxOpenEnd", Str(env, vob.sfx_open_end));
  props.Set("sfxTransitioning", Str(env, vob.sfx_transitioning));
  props.Set("sfxCloseStart", Str(env, vob.sfx_close_start));
  props.Set("sfxCloseEnd", Str(env, vob.sfx_close_end));
  props.Set("sfxLock", Str(env, vob.sfx_lock));
  props.Set("sfxUnlock", Str(env, vob.sfx_unlock));
  props.Set("sfxUseLocked", Str(env, vob.sfx_use_locked));
}

void PutTriggerListProps(Napi::Env env, Napi::Object props, VTriggerList const& vob) {
  props.Set("mode", EnumI(env, vob.mode));
  auto targets = Napi::Array::New(env, vob.targets.size());
  for (std::uint32_t i = 0; i < vob.targets.size(); ++i) {
    auto target = Napi::Object::New(env);
    target.Set("name", Str(env, vob.targets[i].name));
    target.Set("delay", NumF(env, vob.targets[i].delay));
    targets.Set(i, target);
  }
  props.Set("targets", targets);
}

void PutTrajectoryFrameVobProps(Napi::Env env,
                                Napi::Object props,
                                VCameraTrajectoryFrame const& vob) {
  props.Set("time", NumF(env, vob.time));
  props.Set("rollAngle", NumF(env, vob.roll_angle));
  props.Set("fovScale", NumF(env, vob.fov_scale));
  props.Set("motionType", EnumI(env, vob.motion_type));
  props.Set("motionTypeFov", EnumI(env, vob.motion_type_fov));
  props.Set("motionTypeRoll", EnumI(env, vob.motion_type_roll));
  props.Set("motionTypeTimeScale", EnumI(env, vob.motion_type_time_scale));
  props.Set("tension", NumF(env, vob.tension));
  props.Set("camBias", NumF(env, vob.cam_bias));
  props.Set("continuity", NumF(env, vob.continuity));
  props.Set("timeScale", NumF(env, vob.time_scale));
  props.Set("timeFixed", Napi::Boolean::New(env, vob.time_fixed));
  props.Set("originalPose", Mat4RowMajor(env, vob.original_pose));
}

void PutCutsceneCameraProps(Napi::Env env, Napi::Object props, VCutsceneCamera const& vob) {
  props.Set("trajectoryFor", EnumI(env, vob.trajectory_for));
  props.Set("targetTrajectoryFor", EnumI(env, vob.target_trajectory_for));
  props.Set("loopMode", EnumI(env, vob.loop_mode));
  props.Set("lerpMode", EnumI(env, vob.lerp_mode));
  props.Set("ignoreForVobRotation", Napi::Boolean::New(env, vob.ignore_for_vob_rotation));
  props.Set("ignoreForVobRotationTarget",
            Napi::Boolean::New(env, vob.ignore_for_vob_rotation_target));
  props.Set("adapt", Napi::Boolean::New(env, vob.adapt));
  props.Set("easeFirst", Napi::Boolean::New(env, vob.ease_first));
  props.Set("easeLast", Napi::Boolean::New(env, vob.ease_last));
  props.Set("totalDuration", NumF(env, vob.total_duration));
  props.Set("autoFocusVob", Str(env, vob.auto_focus_vob));
  props.Set("autoPlayerMovable", Napi::Boolean::New(env, vob.auto_player_movable));
  props.Set("autoUntriggerLast", Napi::Boolean::New(env, vob.auto_untrigger_last));
  props.Set("autoUntriggerLastDelay", NumF(env, vob.auto_untrigger_last_delay));
  props.Set("positionCount", NumI(env, vob.position_count));
  props.Set("targetCount", NumI(env, vob.target_count));
  props.Set("trajectoryFrames", TrajectoryFrameList(env, vob.trajectory_frames));
  props.Set("targetFrames", TrajectoryFrameList(env, vob.target_frames));
}

// Dispatch on VirtualObjectType with static_cast instead of dynamic_cast:
// node-gyp compiles with RTTI disabled on Windows (/GR-), and the load path
// guarantees `type` matches the concrete class it constructed.
//
// Declared in the header, so it too leaves the anonymous namespace: the
// per-VOB read the editor asks for is this function and nothing else. The
// `Put*Props` helpers below it stay private — they are the arms of this switch,
// not an API. It still calls them by unqualified name because they are members
// of the same translation unit's anonymous namespace.

}  // namespace

Napi::Object VobProps(Napi::Env env, zenkit::VirtualObject const& vob) {
  using namespace zenkit;
  auto props = Napi::Object::New(env);
  PutBaseProps(env, props, vob);

  switch (vob.type) {
    // Marker classes without data fields of their own.
    case VirtualObjectType::zCVob:
    case VirtualObjectType::zCVobLevelCompo:
    case VirtualObjectType::zCVobSpot:
    case VirtualObjectType::zCVobStartpoint:
    case VirtualObjectType::zCVobStair:
    case VirtualObjectType::zCVobScreenFX:
      break;

    // Misc.hh
    case VirtualObjectType::zCVobAnimate:
      props.Set("startOn",
                Napi::Boolean::New(env, static_cast<VAnimate const&>(vob).start_on));
      break;
    case VirtualObjectType::oCItem:
      props.Set("instance", Str(env, static_cast<VItem const&>(vob).instance));
      break;
    case VirtualObjectType::zCVobLensFlare:
      props.Set("fx", Str(env, static_cast<VLensFlare const&>(vob).fx));
      break;
    case VirtualObjectType::zCPFXController: {
      auto const& p = static_cast<VParticleEffectController const&>(vob);
      props.Set("pfxName", Str(env, p.pfx_name));
      props.Set("killWhenDone", Napi::Boolean::New(env, p.kill_when_done));
      props.Set("initiallyRunning", Napi::Boolean::New(env, p.initially_running));
      break;
    }
    case VirtualObjectType::zCMessageFilter: {
      auto const& p = static_cast<VMessageFilter const&>(vob);
      props.Set("target", Str(env, p.target));
      props.Set("onTrigger", EnumI(env, p.on_trigger));
      props.Set("onUntrigger", EnumI(env, p.on_untrigger));
      break;
    }
    case VirtualObjectType::zCCodeMaster: {
      auto const& p = static_cast<VCodeMaster const&>(vob);
      props.Set("target", Str(env, p.target));
      props.Set("ordered", Napi::Boolean::New(env, p.ordered));
      props.Set("firstFalseIsFailure", Napi::Boolean::New(env, p.first_false_is_failure));
      props.Set("failureTarget", Str(env, p.failure_target));
      props.Set("untriggeredCancels", Napi::Boolean::New(env, p.untriggered_cancels));
      auto slaves = Napi::Array::New(env, p.slaves.size());
      for (std::uint32_t i = 0; i < p.slaves.size(); ++i) slaves.Set(i, Str(env, p.slaves[i]));
      props.Set("slaves", slaves);
      break;
    }
    case VirtualObjectType::zCMoverController: {
      auto const& p = static_cast<VMoverController const&>(vob);
      props.Set("target", Str(env, p.target));
      props.Set("message", EnumI(env, p.message));
      props.Set("key", NumI(env, p.key));
      break;
    }
    case VirtualObjectType::oCTouchDamage: {
      auto const& p = static_cast<VTouchDamage const&>(vob);
      props.Set("damage", NumF(env, p.damage));
      props.Set("barrier", Napi::Boolean::New(env, p.barrier));
      props.Set("blunt", Napi::Boolean::New(env, p.blunt));
      props.Set("edge", Napi::Boolean::New(env, p.edge));
      props.Set("fire", Napi::Boolean::New(env, p.fire));
      props.Set("fly", Napi::Boolean::New(env, p.fly));
      props.Set("magic", Napi::Boolean::New(env, p.magic));
      props.Set("point", Napi::Boolean::New(env, p.point));
      props.Set("fall", Napi::Boolean::New(env, p.fall));
      props.Set("repeatDelaySec", NumF(env, p.repeat_delay_sec));
      props.Set("volumeScale", NumF(env, p.volume_scale));
      props.Set("collision", EnumI(env, p.collision));
      break;
    }
    case VirtualObjectType::zCEarthquake: {
      auto const& p = static_cast<VEarthquake const&>(vob);
      props.Set("radius", NumF(env, p.radius));
      props.Set("duration", NumF(env, p.duration));
      props.Set("amplitude", Vec3Arr(env, p.amplitude));
      break;
    }
    case VirtualObjectType::oCNpc:
      PutNpcProps(env, props, static_cast<VNpc const&>(vob));
      break;

    // MovableObject.hh — the oCMOB chain, base layers first.
    case VirtualObjectType::oCMOB:
      PutMovableObjectProps(env, props, static_cast<VMovableObject const&>(vob));
      break;
    case VirtualObjectType::oCMobInter:
    case VirtualObjectType::oCMobLadder:
    case VirtualObjectType::oCMobSwitch:
    case VirtualObjectType::oCMobWheel:
    case VirtualObjectType::oCMobBed: {
      auto const& p = static_cast<VInteractiveObject const&>(vob);
      PutMovableObjectProps(env, props, p);
      PutInteractiveObjectProps(env, props, p);
      break;
    }
    case VirtualObjectType::oCMobFire: {
      auto const& p = static_cast<VFire const&>(vob);
      PutMovableObjectProps(env, props, p);
      PutInteractiveObjectProps(env, props, p);
      PutFireProps(env, props, p);
      break;
    }
    case VirtualObjectType::oCMobContainer: {
      auto const& p = static_cast<VContainer const&>(vob);
      PutMovableObjectProps(env, props, p);
      PutInteractiveObjectProps(env, props, p);
      PutContainerProps(env, props, p);
      break;
    }
    case VirtualObjectType::oCMobDoor: {
      auto const& p = static_cast<VDoor const&>(vob);
      PutMovableObjectProps(env, props, p);
      PutInteractiveObjectProps(env, props, p);
      PutDoorProps(env, props, p);
      break;
    }

    // Light.hh
    case VirtualObjectType::zCVobLight:
      PutLightPresetProps(env, props, static_cast<VLight const&>(vob));
      break;

    // Sound.hh
    case VirtualObjectType::zCVobSound:
      PutSoundProps(env, props, static_cast<VSound const&>(vob));
      break;
    case VirtualObjectType::zCVobSoundDaytime: {
      auto const& p = static_cast<VSoundDaytime const&>(vob);
      PutSoundProps(env, props, p);
      props.Set("startTime", NumF(env, p.start_time));
      props.Set("endTime", NumF(env, p.end_time));
      props.Set("soundName2", Str(env, p.sound_name2));
      break;
    }

    // Trigger.hh
    case VirtualObjectType::zCTrigger:
    case VirtualObjectType::oCCSTrigger:
      PutTriggerProps(env, props, static_cast<VTrigger const&>(vob));
      break;
    case VirtualObjectType::zCMover: {
      auto const& p = static_cast<VMover const&>(vob);
      PutTriggerProps(env, props, p);
      PutMoverProps(env, props, p);
      break;
    }
    case VirtualObjectType::zCTriggerList: {
      auto const& p = static_cast<VTriggerList const&>(vob);
      PutTriggerProps(env, props, p);
      PutTriggerListProps(env, props, p);
      break;
    }
    case VirtualObjectType::oCTriggerScript: {
      auto const& p = static_cast<VTriggerScript const&>(vob);
      PutTriggerProps(env, props, p);
      props.Set("function", Str(env, p.function));
      break;
    }
    case VirtualObjectType::oCTriggerChangeLevel: {
      auto const& p = static_cast<VTriggerChangeLevel const&>(vob);
      PutTriggerProps(env, props, p);
      props.Set("levelName", Str(env, p.level_name));
      props.Set("startVob", Str(env, p.start_vob));
      break;
    }
    case VirtualObjectType::zCTriggerWorldStart: {
      auto const& p = static_cast<VTriggerWorldStart const&>(vob);
      props.Set("target", Str(env, p.target));
      props.Set("fireOnce", Napi::Boolean::New(env, p.fire_once));
      break;
    }
    case VirtualObjectType::zCTriggerUntouch:
      props.Set("target", Str(env, static_cast<VTriggerUntouch const&>(vob).target));
      break;

    // Zone.hh
    case VirtualObjectType::oCZoneMusic:
    case VirtualObjectType::oCZoneMusicDefault:
      PutZoneMusicProps(env, props, static_cast<VZoneMusic const&>(vob));
      break;
    case VirtualObjectType::zCZoneVobFarPlane:
    case VirtualObjectType::zCZoneVobFarPlaneDefault: {
      auto const& p = static_cast<VZoneFarPlane const&>(vob);
      props.Set("vobFarPlaneZ", NumF(env, p.vob_far_plane_z));
      props.Set("innerRangePercentage", NumF(env, p.inner_range_percentage));
      break;
    }
    case VirtualObjectType::zCZoneZFog:
    case VirtualObjectType::zCZoneZFogDefault: {
      auto const& p = static_cast<VZoneFog const&>(vob);
      props.Set("rangeCenter", NumF(env, p.range_center));
      props.Set("innerRangePercentage", NumF(env, p.inner_range_percentage));
      props.Set("color", ColorArr(env, p.color));
      props.Set("fadeOutSky", Napi::Boolean::New(env, p.fade_out_sky));
      props.Set("overrideColor", Napi::Boolean::New(env, p.override_color));
      break;
    }

    // Camera.hh
    case VirtualObjectType::zCCamTrj_KeyFrame:
      PutTrajectoryFrameVobProps(env, props, static_cast<VCameraTrajectoryFrame const&>(vob));
      break;
    case VirtualObjectType::zCCSCamera:
      PutCutsceneCameraProps(env, props, static_cast<VCutsceneCamera const&>(vob));
      break;

    default:
      // UNKNOWN — nothing beyond the base fields is available.
      break;
  }

  return props;
}

namespace {

using namespace zenkit;

// ---------------------------------------------------------------------------
// Section builders.

void CollectVobs(Napi::Env env,
                 std::vector<std::shared_ptr<VirtualObject>> const& vobs,
                 std::string const& parent_path,
                 Napi::Array& out,
                 std::uint32_t& out_index) {
  for (std::size_t i = 0; i < vobs.size(); ++i) {
    auto const& vob = vobs[i];
    if (vob == nullptr) continue;

    std::string const path =
        parent_path.empty() ? std::to_string(i) : parent_path + "/" + std::to_string(i);

    auto entry = Napi::Object::New(env);
    entry.Set("path", Napi::String::New(env, path));
    entry.Set("class", Napi::String::New(env, VobClassName(vob->type)));
    entry.Set("name", Str(env, vob->vob_name));
    entry.Set("position", Vec3Arr(env, vob->position));
    entry.Set("rotation", Mat3RowMajor(env, vob->rotation));
    entry.Set("bbox", BboxArr(env, vob->bbox));
    entry.Set("visual", vob->visual != nullptr ? Napi::Value(Str(env, vob->visual->name))
                                               : Napi::Value(env.Null()));
    entry.Set("visualType",
              vob->visual != nullptr
                  ? Napi::Value(Napi::String::New(env, VisualTypeName(vob->visual->type)))
                  : Napi::Value(env.Null()));

    auto flags = Napi::Object::New(env);
    flags.Set("showVisual", Napi::Boolean::New(env, vob->show_visual));
    flags.Set("cdStatic", Napi::Boolean::New(env, vob->cd_static));
    flags.Set("cdDynamic", Napi::Boolean::New(env, vob->cd_dynamic));
    flags.Set("vobStatic", Napi::Boolean::New(env, vob->vob_static));
    flags.Set("ambient", Napi::Boolean::New(env, vob->ambient));
    flags.Set("physicsEnabled", Napi::Boolean::New(env, vob->physics_enabled));
    flags.Set("spriteAlignment", EnumI(env, vob->sprite_camera_facing_mode));
    flags.Set("shadowType", EnumI(env, vob->dynamic_shadows));
    flags.Set("animMode", EnumI(env, vob->anim_mode));
    entry.Set("flags", flags);

    entry.Set("props", VobProps(env, *vob));
    entry.Set("childCount", NumI(env, vob->children.size()));

    out.Set(out_index++, entry);
    CollectVobs(env, vob->children, path, out, out_index);
  }
}

// The columnar counterpart to CollectVobs: same traversal, same order, but it
// writes into flat arrays and interns every string instead of building one JS
// object per VOB. A dictionary is what makes this affordable — 23,288 retail
// VOBs name only 444 distinct visuals and a handful of classes.
struct VobColumns {
  std::vector<std::int32_t> parent;
  std::vector<std::uint32_t> child_index;
  std::vector<float> positions;
  std::vector<float> rotations;
  std::vector<std::uint32_t> flags;
  std::vector<std::uint32_t> class_index;
  std::vector<std::uint32_t> name_index;
  std::vector<std::uint32_t> visual_index;
  std::vector<std::uint32_t> visual_type_index;

  std::vector<std::string> classes;
  std::vector<std::string> names;
  std::vector<std::string> visuals;
  std::vector<std::string> visual_types;
  std::unordered_map<std::string, std::uint32_t> class_lookup;
  std::unordered_map<std::string, std::uint32_t> name_lookup;
  std::unordered_map<std::string, std::uint32_t> visual_lookup;
  std::unordered_map<std::string, std::uint32_t> visual_type_lookup;

  static std::uint32_t Intern(std::vector<std::string>& table,
                              std::unordered_map<std::string, std::uint32_t>& lookup,
                              std::string const& value) {
    auto const found = lookup.find(value);
    if (found != lookup.end()) return found->second;
    auto const index = static_cast<std::uint32_t>(table.size());
    table.push_back(value);
    lookup.emplace(value, index);
    return index;
  }
};

void CollectVobColumns(std::vector<std::shared_ptr<VirtualObject>> const& vobs,
                       std::int32_t parent,
                       VobColumns& out) {
  for (std::size_t i = 0; i < vobs.size(); ++i) {
    auto const& vob = vobs[i];
    if (vob == nullptr) continue;

    auto const self = static_cast<std::int32_t>(out.parent.size());
    out.parent.push_back(parent);
    // The VOB's position among its siblings — the last element of the index
    // path setVobPosition and friends address it by. Rebuilding the whole path
    // is the consumer's job, and it only ever does it for a VOB it is editing.
    out.child_index.push_back(static_cast<std::uint32_t>(i));

    out.positions.insert(out.positions.end(),
                         {vob->position.x, vob->position.y, vob->position.z});
    for (unsigned row = 0; row < 3; ++row) {
      for (unsigned col = 0; col < 3; ++col) {
        out.rotations.push_back(vob->rotation.columns[col][row]);
      }
    }

    std::uint32_t bits = 0;
    if (vob->show_visual) bits |= 1u << 0;
    if (vob->vob_static) bits |= 1u << 1;
    if (vob->ambient) bits |= 1u << 2;
    if (vob->cd_static) bits |= 1u << 3;
    if (vob->cd_dynamic) bits |= 1u << 4;
    if (vob->physics_enabled) bits |= 1u << 5;
    out.flags.push_back(bits);

    out.class_index.push_back(
        VobColumns::Intern(out.classes, out.class_lookup, VobClassName(vob->type)));
    out.name_index.push_back(
        VobColumns::Intern(out.names, out.name_lookup, vob->vob_name));
    // A VOB with no visual at all interns as the empty string. NormalizeWorld
    // reports null there; a dictionary column has no null, and "no visual" and
    // "a visual with an empty name" mean the same thing to a renderer.
    out.visual_index.push_back(VobColumns::Intern(
        out.visuals, out.visual_lookup,
        vob->visual != nullptr ? vob->visual->name : std::string {}));
    out.visual_type_index.push_back(VobColumns::Intern(
        out.visual_types, out.visual_type_lookup,
        vob->visual != nullptr ? std::string {VisualTypeName(vob->visual->type)}
                               : std::string {"UNKNOWN"}));

    CollectVobColumns(vob->children, self, out);
  }
}

Napi::Object BuildMeshSection(Napi::Env env, Mesh const& mesh) {
  auto obj = Napi::Object::New(env);
  obj.Set("vertexCount", NumI(env, mesh.vertices.size()));
  obj.Set("polyCount", NumI(env, mesh.geometry.size()));
  // ORDER-SENSITIVE: polygons reference materials by index.
  auto materials = Napi::Array::New(env, mesh.materials.size());
  for (std::uint32_t i = 0; i < mesh.materials.size(); ++i) {
    materials.Set(i, Str(env, mesh.materials[i].name));
  }
  obj.Set("materials", materials);
  obj.Set("vertexHash", Napi::String::New(env, HashVertices(mesh)));
  obj.Set("polyHash", Napi::String::New(env, HashPolygons(mesh)));
  obj.Set("featureHash", Napi::String::New(env, HashFeatures(mesh)));
  obj.Set("materialHash", Napi::String::New(env, HashMaterials(mesh)));
  obj.Set("bbox", BboxArr(env, mesh.bbox));
  return obj;
}

Napi::Object BuildBspSection(Napi::Env env, BspTree const& bsp, Mesh const& mesh) {
  auto obj = Napi::Object::New(env);
  obj.Set("nodeCount", NumI(env, bsp.nodes.size()));
  obj.Set("leafCount", NumI(env, bsp.leaf_node_indices.size()));
  obj.Set("treeDepth", NumI(env, BspTreeDepth(bsp)));

  // Sorted set: sector order is not referenced by index anywhere.
  std::vector<std::string> sector_names;
  sector_names.reserve(bsp.sectors.size());
  for (auto const& sector : bsp.sectors) sector_names.push_back(sector.name);
  std::sort(sector_names.begin(), sector_names.end());
  auto names = Napi::Array::New(env, sector_names.size());
  for (std::uint32_t i = 0; i < sector_names.size(); ++i) names.Set(i, Str(env, sector_names[i]));
  obj.Set("sectorNames", names);

  obj.Set("portalPolyHash", Napi::String::New(env, HashIndexArray(bsp.portal_polygon_indices)));
  obj.Set("leafPolyHash", Napi::String::New(env, HashIndexArray(bsp.leaf_polygons)));
  obj.Set("nodeHash", Napi::String::New(env, HashBspNodes(bsp)));
  obj.Set("lightMapCount", NumI(env, mesh.lightmaps.size()));
  return obj;
}

Napi::Object BuildWayNetSection(Napi::Env env, WayNet const* way_net) {
  auto obj = Napi::Object::New(env);

  // Waypoints sorted by name (raw cp1252 bytes, decoded after sorting).
  std::vector<std::shared_ptr<WayPoint>> points;
  if (way_net != nullptr) {
    for (auto const& point : way_net->points) {
      if (point != nullptr) points.push_back(point);
    }
  }
  std::sort(points.begin(), points.end(),
            [](auto const& a, auto const& b) { return a->name < b->name; });

  auto waypoints = Napi::Array::New(env, points.size());
  for (std::uint32_t i = 0; i < points.size(); ++i) {
    auto wp = Napi::Object::New(env);
    wp.Set("name", Str(env, points[i]->name));
    wp.Set("position", Vec3Arr(env, points[i]->position));
    wp.Set("direction", Vec3Arr(env, points[i]->direction));
    wp.Set("freePoint", Napi::Boolean::New(env, points[i]->free_point));
    wp.Set("underWater", Napi::Boolean::New(env, points[i]->under_water));
    wp.Set("waterDepth", NumI(env, points[i]->water_depth));
    waypoints.Set(i, wp);
  }
  obj.Set("waypoints", waypoints);

  // ORDER-INSENSITIVE: each pair sorted, then the pair list sorted.
  std::vector<std::pair<std::string, std::string>> edge_names;
  if (way_net != nullptr) {
    for (auto const& edge : way_net->edges) {
      if (edge.first == nullptr || edge.second == nullptr) continue;
      std::string a = edge.first->name;
      std::string b = edge.second->name;
      if (b < a) std::swap(a, b);
      edge_names.emplace_back(std::move(a), std::move(b));
    }
  }
  std::sort(edge_names.begin(), edge_names.end());

  auto edges = Napi::Array::New(env, edge_names.size());
  for (std::uint32_t i = 0; i < edge_names.size(); ++i) {
    auto pair = Napi::Array::New(env, 2);
    pair.Set(0u, Str(env, edge_names[i].first));
    pair.Set(1u, Str(env, edge_names[i].second));
    edges.Set(i, pair);
  }
  obj.Set("edges", edges);
  return obj;
}

char const* ArchiveFormatName(ArchiveFormat format) {
  switch (format) {
    case ArchiveFormat::BINARY: return "binary";
    case ArchiveFormat::BINSAFE: return "binsafe";
    case ArchiveFormat::ASCII: return "ascii";
    default: return "unknown";
  }
}

}  // namespace

std::uint32_t PackPolygonFlags(PolygonFlagSet const& flags, bool is_g2) {
  if (is_g2) {
    return static_cast<std::uint32_t>((flags.is_portal & 3) | ((flags.is_occluder & 1) << 2) |
                                      ((flags.is_sector & 1) << 3) |
                                      ((flags.should_relight & 1) << 4) |
                                      ((flags.is_outdoor & 1) << 5) |
                                      ((flags.is_ghost_occluder & 1) << 6) |
                                      ((flags.is_dynamically_lit & 1) << 7));
  }
  return static_cast<std::uint32_t>((flags.is_portal & 3) | ((flags.is_occluder & 1) << 2) |
                                    ((flags.is_sector & 1) << 3) | ((flags.is_lod & 1) << 4) |
                                    ((flags.is_outdoor & 1) << 5) |
                                    ((flags.is_ghost_occluder & 1) << 6) |
                                    ((flags.normal_axis & 1) << 7) |
                                    ((flags.normal_axis & 2) << 8));
}

Napi::Object NormalizeWorld(Napi::Env env, WorldHandle const& handle) {
  auto dump = Napi::Object::New(env);

  // meta — deliberately excludes the archive header's date/user stamp: the
  // writer stamps them fresh, they are not world data.
  auto meta = Napi::Object::New(env);
  meta.Set("gameVersion", Napi::String::New(
                              env, handle.version == GameVersion::GOTHIC_1 ? "g1" : "g2"));
  meta.Set("archiveFormat", Napi::String::New(env, ArchiveFormatName(handle.format)));
  meta.Set("archiveVersion", NumI(env, handle.root_version));
  dump.Set("meta", meta);

  // vobs — ORDER-SENSITIVE, depth-first, one entry per VOB.
  auto vobs = Napi::Array::New(env);
  std::uint32_t vob_index = 0;
  CollectVobs(env, handle.world->world_vobs, std::string {}, vobs, vob_index);
  dump.Set("vobs", vobs);

  dump.Set("mesh", BuildMeshSection(env, handle.world->world_mesh));
  dump.Set("bsp", BuildBspSection(env, handle.world->world_bsp_tree, handle.world->world_mesh));
  dump.Set("waynet", BuildWayNetSection(env, handle.world->way_net.get()));

  return dump;
}

Napi::Object VobIndex(Napi::Env env, WorldHandle const& handle) {
  VobColumns columns;
  CollectVobColumns(handle.world->world_vobs, -1, columns);

  auto dictionary = [&env](std::vector<std::string> const& values) {
    auto arr = Napi::Array::New(env, values.size());
    for (std::uint32_t i = 0; i < values.size(); ++i) arr.Set(i, Str(env, values[i]));
    return arr;
  };

  auto out = Napi::Object::New(env);
  out.Set("count", NumI(env, columns.parent.size()));
  out.Set("parent", Buffer(env, columns.parent));
  out.Set("childIndex", Buffer(env, columns.child_index));
  out.Set("positions", Buffer(env, columns.positions));
  out.Set("rotations", Buffer(env, columns.rotations));
  out.Set("flags", Buffer(env, columns.flags));
  out.Set("classes", dictionary(columns.classes));
  out.Set("classIndex", Buffer(env, columns.class_index));
  out.Set("names", dictionary(columns.names));
  out.Set("nameIndex", Buffer(env, columns.name_index));
  out.Set("visuals", dictionary(columns.visuals));
  out.Set("visualIndex", Buffer(env, columns.visual_index));
  out.Set("visualTypes", dictionary(columns.visual_types));
  out.Set("visualTypeIndex", Buffer(env, columns.visual_type_index));
  return out;
}

// The waynet the render path uses, as against `normalizeWorld`'s waynet
// section. The dump sorts waypoints by name and sorts each edge pair, because
// it is a diff instrument and order is noise there. This is the opposite: it
// keeps the stored order and emits edges as **index pairs into that order**,
// because an overlay draws a line buffer and a name lookup per edge would be
// 8,000 string comparisons for a picture.
//
// Names are not interned, unlike `vobIndex`'s. Waypoint names are effectively
// unique — that is what they are for — so a dictionary would be 1:1 and cost a
// second array to say so.
std::vector<std::shared_ptr<WayPoint>> CollectWaypoints(WorldHandle const& handle) {
  auto const* way_net = handle.world->way_net.get();

  std::vector<std::shared_ptr<WayPoint>> points;
  if (way_net != nullptr) {
    for (auto const& point : way_net->points) {
      if (point != nullptr) points.push_back(point);
    }
  }
  return points;
}

Napi::Object WayNetGraph(Napi::Env env, WorldHandle const& handle) {
  auto const* way_net = handle.world->way_net.get();

  // The one definition of what a waypoint's index *means*. A mutation that
  // filtered the null entries a second time would agree with this list only for
  // as long as both authors remembered to — and an index that means something
  // slightly different moves the wrong waypoint rather than failing.
  std::vector<std::shared_ptr<WayPoint>> points = CollectWaypoints(handle);

  std::vector<float> positions;
  std::vector<float> directions;
  std::vector<std::int32_t> water_depths;
  std::vector<std::uint32_t> flags;
  positions.reserve(points.size() * 3);
  directions.reserve(points.size() * 3);
  water_depths.reserve(points.size());
  flags.reserve(points.size());

  // Pointer identity, not name: the edge list holds the same shared_ptrs the
  // point list does, and two waypoints may not share a name but nothing in the
  // format enforces it either.
  std::unordered_map<WayPoint const*, std::uint32_t> index_of;
  index_of.reserve(points.size());

  auto names = Napi::Array::New(env, points.size());
  for (std::uint32_t i = 0; i < points.size(); ++i) {
    auto const& point = points[i];
    index_of.emplace(point.get(), i);

    names.Set(i, Str(env, point->name));
    positions.push_back(point->position.x);
    positions.push_back(point->position.y);
    positions.push_back(point->position.z);
    directions.push_back(point->direction.x);
    directions.push_back(point->direction.y);
    directions.push_back(point->direction.z);
    water_depths.push_back(point->water_depth);
    flags.push_back(static_cast<std::uint32_t>(point->free_point ? 1u : 0u)
                    | static_cast<std::uint32_t>(point->under_water ? 2u : 0u));
  }

  std::vector<std::uint32_t> edges;
  if (way_net != nullptr) {
    edges.reserve(way_net->edges.size() * 2);
    for (auto const& edge : way_net->edges) {
      if (edge.first == nullptr || edge.second == nullptr) continue;
      auto const from = index_of.find(edge.first.get());
      auto const to = index_of.find(edge.second.get());
      // An endpoint that is not in the point list cannot be drawn and cannot be
      // named; dropping it is the only honest option, and it is counted below.
      if (from == index_of.end() || to == index_of.end()) continue;
      edges.push_back(from->second);
      edges.push_back(to->second);
    }
  }

  auto out = Napi::Object::New(env);
  out.Set("count", NumI(env, points.size()));
  out.Set("names", names);
  out.Set("positions", Buffer(env, positions));
  out.Set("directions", Buffer(env, directions));
  out.Set("waterDepths", Buffer(env, water_depths));
  // bit 0 freePoint, bit 1 underWater.
  out.Set("flags", Buffer(env, flags));
  out.Set("edgeCount", NumI(env, edges.size() / 2));
  out.Set("edges", Buffer(env, edges));
  // Edges whose endpoints were not in the point list, so the caller can tell an
  // empty overlay from a dropped one.
  out.Set("danglingEdges",
          NumI(env, way_net == nullptr ? 0 : way_net->edges.size() - edges.size() / 2));
  return out;
}

Napi::Object DrillMesh(Napi::Env env,
                       WorldHandle const& handle,
                       std::size_t offset,
                       std::size_t limit) {
  auto const& mesh = handle.world->world_mesh;
  bool const is_g2 = handle.version == GameVersion::GOTHIC_2;

  auto result = Napi::Object::New(env);
  result.Set("polyCount", NumI(env, mesh.geometry.size()));
  result.Set("offset", NumI(env, offset));

  std::size_t const end =
      offset >= mesh.geometry.size() ? offset : std::min(mesh.geometry.size(), offset + limit);
  auto geometry = Napi::Array::New(env, offset < end ? end - offset : 0);

  for (std::size_t index = offset; index < end; ++index) {
    auto const& poly = mesh.geometry[index];
    auto entry = Napi::Object::New(env);
    entry.Set("material", NumI(env, poly.material));
    entry.Set("lightmap", NumI(env, poly.lightmap));

    auto const& flags = poly.flags;
    entry.Set("flagsBits", NumI(env, PackPolygonFlags(flags, is_g2)));
    entry.Set("sectorIndex", NumI(env, flags.sector_index));

    auto vertex_indices = Napi::Array::New(env, poly.index_count);
    auto feature_indices = Napi::Array::New(env, poly.index_count);
    for (std::uint32_t i = 0; i < poly.index_count; ++i) {
      vertex_indices.Set(i, NumI(env, mesh.polygon_vertex_indices[poly.index_offset + i]));
      feature_indices.Set(i, NumI(env, mesh.polygon_feature_indices[poly.index_offset + i]));
    }
    entry.Set("vertexIndices", vertex_indices);
    entry.Set("featureIndices", feature_indices);

    // [planeDistance, normalX, normalY, normalZ] — on-disk field order.
    auto plane = Napi::Array::New(env, 4);
    plane.Set(0u, NumF(env, poly.plane_distance));
    plane.Set(1u, NumF(env, poly.plane_normal.x));
    plane.Set(2u, NumF(env, poly.plane_normal.y));
    plane.Set(3u, NumF(env, poly.plane_normal.z));
    entry.Set("plane", plane);

    geometry.Set(static_cast<std::uint32_t>(index - offset), entry);
  }

  result.Set("geometry", geometry);
  return result;
}

}  // namespace zenkit_node
