// Minimal self-contained SHA-256 (FIPS 180-4) for hashing bulk world data in
// normalizeWorld (docs/plans/level-editor-phase-0.md §3). No dependency added
// on purpose: the hashes must be identical across platforms and Node versions.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace zenkit_node {

class Sha256 {
public:
  Sha256();

  void Update(void const* data, std::size_t size);

  // Finalizes and returns the digest as lowercase hex. The instance must not
  // be used afterwards.
  std::string HexDigest();

private:
  void ProcessBlock(std::uint8_t const* block);

  std::uint32_t state_[8];
  std::uint64_t total_bytes_ = 0;
  std::uint8_t buffer_[64];
  std::size_t buffer_size_ = 0;
};

// Convenience: SHA-256 over a byte vector, formatted as "sha256:<hex>".
std::string Sha256Prefixed(std::vector<std::uint8_t> const& bytes);

}  // namespace zenkit_node
