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
      "defines": ["NAPI_CPP_EXCEPTIONS", "_HAS_EXCEPTIONS=1", "<!@(node scripts/zenkit-defines.js)"],
      # node-gyp's common.gypi defines `_HAS_EXCEPTIONS=0` for every addon, and
      # under it MSVC's <exception> never declares the real `std::exception` —
      # it aliases the name to `stdext::exception` instead. Every
      # `catch (std::exception const&)` in binding.cc then names a type no
      # ZenKit exception derives from, so a ParserError finds no handler at all
      # and `std::terminate` kills the process with 0xC0000409 (__fastfail,
      # reported as STATUS_STACK_BUFFER_OVERRUN). ZenKit itself is built by
      # CMake with exceptions enabled, so the define also changes the base class
      # of `zenkit::Error` inside the binding's TUs only — an ODR violation on
      # top of the missed catch. Removed rather than merely overridden: two
      # conflicting definitions are a macro redefinition warning.
      "defines!": ["_HAS_EXCEPTIONS=0"],
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
