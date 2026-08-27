# Documentation Index

This directory is the canonical home for repository-level documentation.

## Structure

- `BOARD.md` - what is in flight, who owns it, and the state of the tree. Read it
  first; update it last. It holds only what nothing else holds.
- `architecture/` - durable architecture and boundary decisions.
- `reference/` - durable implementation references and behavior mappings.
- `plans/` - active implementation plans that are still in progress.

## Lifecycle Policy

- `active`: keep only currently executed plans in `plans/`.
- `reference`: keep long-lived technical references in `reference/` and architecture decisions in `architecture/`.
- `superseded/completed`: extract durable conclusions into canonical docs, then delete the obsolete plan/investigation file.

## Current Canonical Docs

- [architecture/dialog-editor.md](architecture/dialog-editor.md)
- [architecture/quest-editor.md](architecture/quest-editor.md)
- [architecture/parser-fidelity.md](architecture/parser-fidelity.md)
- [architecture/save-pipeline.md](architecture/save-pipeline.md)
- [architecture/worker-reliability.md](architecture/worker-reliability.md)
- [architecture/render-performance.md](architecture/render-performance.md)
- [architecture/security-model.md](architecture/security-model.md)
- [reference/autocomplete-fields.md](reference/autocomplete-fields.md)
- [reference/dialog-authoring-automations.md](reference/dialog-authoring-automations.md)
- [reference/parser-roundtrip-scope.md](reference/parser-roundtrip-scope.md)
- [reference/environment-hazards.md](reference/environment-hazards.md)

## Active Plans

- [plans/production-readiness-review-findings.md](plans/production-readiness-review-findings.md) — production-readiness, performance and UI/UX review findings; quest Flow-view deprecation decision and remaining work.

## Release

- [release-checklist.md](release-checklist.md) — release/QA work (code signing, update verifier, desktop passes) parked until the first release

## Workspace Entry Points

- Parser usage: [../daedalus-parser/README.md](../daedalus-parser/README.md)
- Parser API: [../daedalus-parser/API.md](../daedalus-parser/API.md)
- Editor agent guidance: [../daedalus-dialog-editor/AGENTS.md](../daedalus-dialog-editor/AGENTS.md)
