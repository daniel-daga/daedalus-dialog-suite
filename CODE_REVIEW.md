# Code Review: Daedalus Dialog Editor & Parser

## Overview

This review focuses on the coupling between `daedalus-parser` and `daedalus-dialog-editor`, as well as performance and security considerations for the project.

## 1. Coupling and Architecture

**Status: Good**

The project maintains a clean separation of concerns:

*   **Monorepo Structure:** The project is correctly structured as a monorepo with `daedalus-parser` (library) and `daedalus-dialog-editor` (application).
*   **Semantic Abstraction:** The `daedalus-parser` exports a "Semantic Model" (via `SemanticModelBuilderVisitor`) rather than just a raw Tree-sitter AST.
    *   This is a strong architectural choice. It decouples the editor from the implementation details of the grammar. If the grammar changes but the semantic concepts remain the same, the editor likely won't need changes.
*   **IPC Isolation:** The editor uses Electron's `contextBridge` to expose a limited API to the renderer process. The renderer does not import the parser directly; it communicates via IPC to the main process where the parsing logic resides.

## 2. Performance

**Status: Moderate (with room for improvement)**

*   **Main Thread Parsing:** `ParserService.parseSource` runs synchronously on the Electron Main Process.
    *   *Impact:* Parsing large files blocks the main thread, which freezes the entire application (including window management and IPC).
    *   *Recommendation:* Offload parsing to a Worker Thread or a separate child process.
*   **Re-parsing:** The current implementation re-parses the entire file on every change (or save/validate action).
    *   *Optimization:* Tree-sitter supports incremental parsing. Storing the previous tree and applying edits could significantly improve responsiveness for large files.
*   **Project Indexing:** `ProjectService` uses Regex for lightweight indexing, which is much faster than full parsing. This is a good optimization for scanning the whole project.
    *   *Detail:* Parallel I/O (`fs.readFile`) with serialized parsing logic ensures the event loop isn't completely starved, though `setImmediate` is used to yield.

## 3. Security

**Status: Strong**

*   **Path Validation:** The `PathValidationService` is robust.
    *   It protects against Directory Traversal (`..`), Null Byte Injection, and URL-encoded attacks.
    *   It enforces an "Allowlist" model where paths are only trusted if the user explicitly selected them (or a parent folder) via a native dialog.
*   **Symlink Handling:** `ProjectService` ignores symbolic links to directories.
    *   *Benefit:* This implicitly prevents infinite loops and escaping the allowed directory via symlinks.
*   **IPC Surface:** The exposed API in `preload.ts` is specific and limited.
    *   `readFile` and `writeFile` are exposed but guarded by `PathValidationService` in the main process.
*   **Dependencies:**
    *   `daedalus-parser` uses `node-gyp-build` for native bindings. This is standard but carries inherent risk. Ensure dependencies are regularly audited.

## 4. Bug Fixes

**Case Insensitivity in Semantic Linking**

*   **Issue:** Daedalus is a case-insensitive language, but the `SemanticModelBuilderVisitor` was performing case-sensitive lookups for function names during linking.
    *   *Example:* Defining `func void MyFunc()` and calling it as `myfunc` resulted in a linking failure.
*   **Fix:** Implemented a case-insensitive lookup mechanism in `SemanticModelBuilderVisitor` using a mapping from lowercase names to canonical names.
*   **Verification:** Added a regression test (`daedalus-parser/test/case-sensitivity.test.js`) which now passes.

## Summary

The codebase is well-structured and secure. The primary area for future improvement is the performance of the parsing logic in the editor, specifically moving it off the main thread. The security architecture regarding file access is commendable.
