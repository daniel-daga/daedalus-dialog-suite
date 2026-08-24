// N-API binding around ZenKit (docs/plans/level-editor.md §4).
#include <napi.h>

#include "zenkit-version.h"

namespace {

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("zenkitVersion", Napi::String::New(env, ZENKIT_NODE_ZENKIT_VERSION));
  return exports;
}

}  // namespace

NODE_API_MODULE(zenkit_node, Init)
