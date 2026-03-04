# Daedalus Dialog Suite

[![All Tests](https://github.com/daniel-daga/daedalus-dialog-suite/actions/workflows/all-tests.yml/badge.svg)](https://github.com/daniel-daga/daedalus-dialog-suite/actions/workflows/all-tests.yml)
[![Build Windows](https://github.com/daniel-daga/daedalus-dialog-suite/actions/workflows/build-windows.yml/badge.svg)](https://github.com/daniel-daga/daedalus-dialog-suite/actions/workflows/build-windows.yml)
[![Deploy GitHub Pages](https://github.com/daniel-daga/daedalus-dialog-suite/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/daniel-daga/daedalus-dialog-suite/actions/workflows/deploy-pages.yml)

Daedalus Dialog Suite is a monorepo for creating, validating, and generating Gothic Daedalus dialog content. It combines a parser/codegen library with a desktop editor workflow.

## Repository

- GitHub: https://github.com/daniel-daga/daedalus-dialog-suite
- Download page (latest Windows installer): https://daniel-daga.github.io/daedalus-dialog-suite/

## Packages

- `daedalus-dialog-editor`
  - Electron-based dialog and quest editor UI
  - Project indexing, validation, and code generation integration
- `daedalus-parser`
  - Tree-sitter based parser for Daedalus
  - Semantic model extraction and code generation utilities

## Monorepo Structure

```text
daedalus-dialog-suite/
  daedalus-dialog-editor/   Desktop editor package
  daedalus-parser/          Parser and semantic tooling
  gh-pages/                 GitHub Pages landing page
  .github/workflows/        CI/CD workflows
```

## Getting Started

### Prerequisites

- Node.js 20+
- npm or pnpm

### Install Dependencies

```bash
npm install
```

### Build All Workspaces

```bash
npm run build
```

### Run Tests

```bash
npm run test
```

## Useful Root Scripts

- `npm run build` - builds all workspaces
- `npm run test` - runs tests across workspaces
- `npm run test:roundtrip-corpus` - runs parser corpus roundtrip validation

## CI Workflows

- `all-tests.yml` - automated test pipeline
- `build-windows.yml` - builds and publishes rolling Windows installer artifacts
- `deploy-pages.yml` - publishes the GitHub Pages download site
