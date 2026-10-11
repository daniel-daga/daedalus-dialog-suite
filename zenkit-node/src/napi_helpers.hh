// Small N-API helpers shared by the read-only projection paths
// (src/mesh_extract.cc, src/assets.cc).
#pragma once

#include <napi.h>

#include <cstring>
#include <string>
#include <vector>

#include "encoding.hh"

namespace zenkit_node {

// ZenKit holds strings as raw windows-1252 bytes; decode at the binding edge,
// never "probably UTF-8" (level-editor.md §4).
inline Napi::String Str(Napi::Env env, std::string const& raw) {
  auto utf16 = Windows1252ToUtf16(raw);
  return Napi::String::New(env, reinterpret_cast<char16_t const*>(utf16.c_str()), utf16.size());
}

// Copies a vector into a fresh ArrayBuffer. N-API owns the memory, so the
// buffer outlives the vector and can be transferred to the renderer without a
// further copy on the JS side.
template <typename T>
Napi::ArrayBuffer Buffer(Napi::Env env, std::vector<T> const& values) {
  auto const bytes = values.size() * sizeof(T);
  auto buffer = Napi::ArrayBuffer::New(env, bytes);
  if (bytes != 0) std::memcpy(buffer.Data(), values.data(), bytes);
  return buffer;
}

}  // namespace zenkit_node
