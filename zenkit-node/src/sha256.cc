#include "sha256.hh"

#include <algorithm>
#include <cstring>

namespace zenkit_node {

namespace {

constexpr std::uint32_t kInit[8] = {0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
                                    0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u};

constexpr std::uint32_t kRound[64] = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u,
    0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu,
    0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu,
    0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau, 0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
    0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu,
    0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu,
    0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u, 0x19a4c116u,
    0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u,
    0xc67178f2u};

constexpr std::uint32_t Rotr(std::uint32_t value, unsigned bits) {
  return (value >> bits) | (value << (32 - bits));
}

}  // namespace

Sha256::Sha256() {
  std::memcpy(state_, kInit, sizeof(state_));
}

void Sha256::ProcessBlock(std::uint8_t const* block) {
  std::uint32_t w[64];
  for (int i = 0; i < 16; ++i) {
    w[i] = (static_cast<std::uint32_t>(block[i * 4]) << 24) |
           (static_cast<std::uint32_t>(block[i * 4 + 1]) << 16) |
           (static_cast<std::uint32_t>(block[i * 4 + 2]) << 8) |
           static_cast<std::uint32_t>(block[i * 4 + 3]);
  }
  for (int i = 16; i < 64; ++i) {
    std::uint32_t const s0 = Rotr(w[i - 15], 7) ^ Rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    std::uint32_t const s1 = Rotr(w[i - 2], 17) ^ Rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }

  std::uint32_t a = state_[0], b = state_[1], c = state_[2], d = state_[3];
  std::uint32_t e = state_[4], f = state_[5], g = state_[6], h = state_[7];

  for (int i = 0; i < 64; ++i) {
    std::uint32_t const s1 = Rotr(e, 6) ^ Rotr(e, 11) ^ Rotr(e, 25);
    std::uint32_t const ch = (e & f) ^ (~e & g);
    std::uint32_t const temp1 = h + s1 + ch + kRound[i] + w[i];
    std::uint32_t const s0 = Rotr(a, 2) ^ Rotr(a, 13) ^ Rotr(a, 22);
    std::uint32_t const maj = (a & b) ^ (a & c) ^ (b & c);
    std::uint32_t const temp2 = s0 + maj;

    h = g;
    g = f;
    f = e;
    e = d + temp1;
    d = c;
    c = b;
    b = a;
    a = temp1 + temp2;
  }

  state_[0] += a;
  state_[1] += b;
  state_[2] += c;
  state_[3] += d;
  state_[4] += e;
  state_[5] += f;
  state_[6] += g;
  state_[7] += h;
}

void Sha256::Update(void const* data, std::size_t size) {
  auto const* bytes = static_cast<std::uint8_t const*>(data);
  total_bytes_ += size;

  if (buffer_size_ > 0) {
    std::size_t const take = std::min(size, sizeof(buffer_) - buffer_size_);
    std::memcpy(buffer_ + buffer_size_, bytes, take);
    buffer_size_ += take;
    bytes += take;
    size -= take;
    if (buffer_size_ == sizeof(buffer_)) {
      ProcessBlock(buffer_);
      buffer_size_ = 0;
    }
  }

  while (size >= sizeof(buffer_)) {
    ProcessBlock(bytes);
    bytes += sizeof(buffer_);
    size -= sizeof(buffer_);
  }

  if (size > 0) {
    std::memcpy(buffer_, bytes, size);
    buffer_size_ = size;
  }
}

std::string Sha256::HexDigest() {
  std::uint64_t const bit_length = total_bytes_ * 8;

  std::uint8_t const pad_byte = 0x80;
  Update(&pad_byte, 1);
  std::uint8_t const zero = 0x00;
  while (buffer_size_ != 56) {
    Update(&zero, 1);
  }

  std::uint8_t length_be[8];
  for (int i = 0; i < 8; ++i) {
    length_be[i] = static_cast<std::uint8_t>(bit_length >> (56 - i * 8));
  }
  Update(length_be, sizeof(length_be));

  static char const kHex[] = "0123456789abcdef";
  std::string hex;
  hex.reserve(64);
  for (std::uint32_t const word : state_) {
    for (int shift = 28; shift >= 0; shift -= 4) {
      hex.push_back(kHex[(word >> shift) & 0xF]);
    }
  }
  return hex;
}

std::string Sha256Prefixed(std::vector<std::uint8_t> const& bytes) {
  Sha256 hasher;
  if (!bytes.empty()) hasher.Update(bytes.data(), bytes.size());
  return "sha256:" + hasher.HexDigest();
}

}  // namespace zenkit_node
