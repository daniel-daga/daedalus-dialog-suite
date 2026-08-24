#include "encoding.hh"

#include <cstdint>

namespace zenkit_node {

namespace {

// windows-1252 bytes 0x80-0x9F; 0 marks an undefined byte (0x81, 0x8D, 0x8F, 0x90, 0x9D).
constexpr char16_t kCp1252High[32] = {
    0x20AC, 0,      0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,  // 0x80-0x87
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0,      0x017D, 0,       // 0x88-0x8F
    0,      0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,  // 0x90-0x97
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0,      0x017E, 0x0178,  // 0x98-0x9F
};

}  // namespace

std::u16string Windows1252ToUtf16(std::string_view input) {
  std::u16string out;
  out.reserve(input.size());
  for (char c : input) {
    auto byte = static_cast<std::uint8_t>(c);
    if (byte >= 0x80 && byte <= 0x9F) {
      char16_t mapped = kCp1252High[byte - 0x80];
      // Undefined windows-1252 bytes pass through as their Latin-1 code point,
      // matching what the original engine's fonts would show.
      out.push_back(mapped != 0 ? mapped : static_cast<char16_t>(byte));
    } else {
      out.push_back(static_cast<char16_t>(byte));  // identity (Latin-1)
    }
  }
  return out;
}

std::string Utf16ToWindows1252(std::u16string_view input) {
  std::string out;
  out.reserve(input.size());
  for (char16_t unit : input) {
    auto cp = static_cast<std::uint32_t>(unit);
    if (cp >= 0xD800 && cp <= 0xDFFF) {
      throw EncodingError("string contains a character outside the Basic Multilingual Plane, "
                          "which cannot be encoded as windows-1252");
    }
    if (cp < 0x80 || (cp >= 0xA0 && cp <= 0xFF)) {
      out.push_back(static_cast<char>(cp));
      continue;
    }
    bool mapped = false;
    for (int i = 0; i < 32; ++i) {
      if (kCp1252High[i] != 0 && kCp1252High[i] == unit) {
        out.push_back(static_cast<char>(0x80 + i));
        mapped = true;
        break;
      }
    }
    if (!mapped) {
      throw EncodingError("string contains U+" + std::to_string(cp) +
                          " which cannot be encoded as windows-1252");
    }
  }
  return out;
}

}  // namespace zenkit_node
