// Workaround for a ZenKit portability bug on Windows (vendor pin 1ff081c):
// all three archive writers stamp the header date via
// strftime(..., "%-d.%-m.%Y %H:%M:%S", ...) — the '-' (no-leading-zero) flag
// is a glibc extension. On MSVC's UCRT an unknown format specifier invokes the
// invalid-parameter handler, which fail-fasts the whole process (0xC0000409).
//
// Installing a no-op thread-local handler for the duration of a ZenKit write
// makes strftime fail benignly instead: it returns 0 with a NUL-terminated
// (empty) buffer, so the archive header simply carries an empty date — which
// the round-trip plan already treats as a varying, ignored field.
//
// Scope every WriteArchive use in this addon with this guard. Remove once the
// upstream format string is fixed (e.g. "%d.%m.%Y").
#pragma once

#ifdef _WIN32
#include <cstdlib>

namespace zenkit_node {

class ScopedCrtInvalidParameterGuard {
public:
  ScopedCrtInvalidParameterGuard()
      : previous_(_set_thread_local_invalid_parameter_handler(&Ignore)) {}

  ~ScopedCrtInvalidParameterGuard() {
    _set_thread_local_invalid_parameter_handler(previous_);
  }

  ScopedCrtInvalidParameterGuard(ScopedCrtInvalidParameterGuard const&) = delete;
  ScopedCrtInvalidParameterGuard& operator=(ScopedCrtInvalidParameterGuard const&) = delete;

private:
  static void Ignore(wchar_t const*, wchar_t const*, wchar_t const*, unsigned, uintptr_t) {}

  _invalid_parameter_handler previous_;
};

}  // namespace zenkit_node
#else
namespace zenkit_node {

class ScopedCrtInvalidParameterGuard {};

}  // namespace zenkit_node
#endif
