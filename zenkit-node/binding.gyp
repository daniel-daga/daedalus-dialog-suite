{
  "targets": [
    {
      "target_name": "zenkit_node",
      "sources": ["src/assets.cc", "src/binding.cc", "src/encoding.cc", "src/fixture.cc", "src/mesh_extract.cc", "src/normalize.cc", "src/sha256.cc"],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")",
        "vendor/ZenKit/include",
        "vendor-build/zenkit"
      ],
      "defines": ["NAPI_CPP_EXCEPTIONS", "<!@(node scripts/zenkit-defines.js)"],
      "cflags_cc": ["-std=c++20", "-fexceptions"],
      "conditions": [
        ["OS=='win'", {
          "libraries": [
            "<(module_root_dir)/vendor-build/zenkit/out/zenkit.lib",
            "<(module_root_dir)/vendor-build/zenkit/out/squish.lib",
            "<(module_root_dir)/vendor-build/zenkit/out/miniz.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/utf-8", "/std:c++20"]
            }
          }
        }],
        ["OS=='linux'", {
          "libraries": [
            "<(module_root_dir)/vendor-build/zenkit/out/libzenkit.a",
            "<(module_root_dir)/vendor-build/zenkit/out/libsquish.a",
            "<(module_root_dir)/vendor-build/zenkit/out/libminiz.a"
          ]
        }],
        ["OS=='mac'", {
          "libraries": [
            "<(module_root_dir)/vendor-build/zenkit/out/libzenkit.a",
            "<(module_root_dir)/vendor-build/zenkit/out/libsquish.a",
            "<(module_root_dir)/vendor-build/zenkit/out/libminiz.a"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
            "MACOSX_DEPLOYMENT_TARGET": "11.0"
          }
        }]
      ]
    }
  ]
}
