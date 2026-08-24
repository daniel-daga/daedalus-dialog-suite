{
  "targets": [
    {
      "target_name": "zenkit_node",
      "sources": ["src/binding.cc"],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")",
        "vendor/ZenKit/include",
        "vendor/ZenKit/vendor/glm",
        "vendor-build/zenkit"
      ],
      "defines": ["NAPI_CPP_EXCEPTIONS", "ZK_FUTURE=1"],
      "cflags_cc": ["-std=c++17", "-fexceptions"],
      "conditions": [
        ["OS=='win'", {
          "libraries": [
            "<(module_root_dir)/vendor-build/zenkit/out/zenkit.lib",
            "<(module_root_dir)/vendor-build/zenkit/out/squish.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/utf-8"]
            }
          }
        }],
        ["OS=='linux'", {
          "libraries": [
            "<(module_root_dir)/vendor-build/zenkit/out/libzenkit.a",
            "<(module_root_dir)/vendor-build/zenkit/out/libsquish.a"
          ]
        }],
        ["OS=='mac'", {
          "libraries": [
            "<(module_root_dir)/vendor-build/zenkit/out/libzenkit.a",
            "<(module_root_dir)/vendor-build/zenkit/out/libsquish.a"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "MACOSX_DEPLOYMENT_TARGET": "11.0"
          }
        }]
      ]
    }
  ]
}
