// windows-1252 <-> UTF-16 conversion at the binding edge (docs/plans/level-editor-phase-0.md T3).
#pragma once

#include <stdexcept>
#include <string>
#include <string_view>

namespace zenkit_node {

// Thrown when a UTF-16 string contains a code point windows-1252 cannot represent.
class EncodingError : public std::runtime_error {
public:
  using std::runtime_error::runtime_error;
};

// Decode raw windows-1252 bytes (as stored by ZenKit) into UTF-16.
std::u16string Windows1252ToUtf16(std::string_view input);

// Encode UTF-16 into windows-1252 bytes. Throws EncodingError on unmappable
// characters (including any code point outside the BMP, which arrives as a
// surrogate pair).
std::string Utf16ToWindows1252(std::u16string_view input);

}  // namespace zenkit_node
