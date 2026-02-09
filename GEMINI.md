# Daedalus Dialog Suite - Gemini Context

## Project Overview
This repository contains tools for the Daedalus scripting language used in Gothic 2 modding. It is a monorepo managed with npm workspaces, consisting of a high-performance parser library and a visual dialog editor.

## Repository Structure
*   `daedalus-parser/`: Tree-sitter based parser, semantic model, and code generator.
*   `daedalus-dialog-editor/`: Electron/React-based visual editor utilizing the parser.

---

## 1. Daedalus Parser (`daedalus-parser/`)

### Architecture
*   **Core:** Tree-sitter parser (C/C++) for fast syntax analysis.
*   **Semantic Layer:** TypeScript-based visitor pattern that builds a structured `SemanticModel` (Dialogs, Functions, Actions) from the raw syntax tree.
*   **Code Generation:** String-based template generation that converts a `SemanticModel` back into valid Daedalus code. This is preferred over AST manipulation.

### Key Workflows
*   **Parsing:** `Source Code` -> `Tree-sitter Tree` -> `SemanticModel`.
*   **Generation:** `SemanticModel` -> `String Templates` -> `Source Code`.
*   **Round-Trip:** The architecture ensures that `Parse -> Generate` preserves semantics.

### Build & Test
*   **Install:** `npm install` (runs `node-gyp-build` automatically).
*   **Build Parser:** `npm run build` (runs `tree-sitter generate`).
*   **Build TypeScript:** `npm run build:ts`.
*   **Test:** `npm test` (Builds + runs all tests). **Mandatory before changes.**
*   **Lint:** `npm run lint`.

---

## 2. Daedalus Dialog Editor (`daedalus-dialog-editor/`)

### Tech Stack
*   **Runtime:** Electron
*   **Frontend:** React, Vite, TypeScript
*   **State Management:** Zustand
*   **UI Components:** Material UI (MUI), Reactflow (node-based editing)
*   **Testing:** Jest, Playwright

### Build & Run
*   **Dev (Main + Renderer):** `npm run dev`
*   **Build:** `npm run build` (builds both main and renderer processes).
*   **Test (Unit):** `npm run test` or `npm run test:watch`.
*   **Test (E2E):** `npm run test:e2e`.

---

## Development Guidelines

### Core Mandates
1.  **TDD (Test-Driven Development):** Write failing tests *before* implementing features or fixing bugs.
    *   Parser tests: `daedalus-parser/test/*.test.js`
    *   Editor Logic tests: `daedalus-dialog-editor/tests/*.test.ts(x)`
    *   **UI Component tests:** Always create **Playwright** E2E tests for new UI features or bug fixes in `daedalus-dialog-editor/tests/e2e/*.spec.ts`.
2.  **Semantic Model First:** When working on language features, manipulate the `SemanticModel`, not the AST directly.
3.  **No Temporary Files:** Do not create temp test files. Add meaningful cases to the existing test suite (`test/` or `tests/`).

### Agent Rules
*   **Documentation:** Do not create extra markdown files. Code should be self-documenting.
*   **Conventions:** Follow the patterns in `CLAUDE.md` files found in each package.
*   **Verification:** Run `npm test` in the relevant workspace after every change.

### Root Commands
*   **Build All:** `npm run build --workspaces`
*   **Test All:** `npm run test --workspaces`
