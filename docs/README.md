# Documentation Index

This directory is the canonical home for repository-level documentation.

## Structure

- `architecture/` - durable architecture and boundary decisions.
- `reference/` - durable implementation references and behavior mappings.
- `plans/` - active implementation plans that are still in progress.

## Lifecycle Policy

- `active`: keep only currently executed plans in `plans/`.
- `reference`: keep long-lived technical references in `reference/` and architecture decisions in `architecture/`.
- `superseded/completed`: extract durable conclusions into canonical docs, then delete the obsolete plan/investigation file.

## Current Canonical Docs

- [architecture/quest-editor.md](architecture/quest-editor.md)
- [reference/autocomplete-fields.md](reference/autocomplete-fields.md)
- [plans/daedalus-parser-stabilization.md](plans/daedalus-parser-stabilization.md)

## Workspace Entry Points

- Parser usage: [../daedalus-parser/README.md](../daedalus-parser/README.md)
- Parser API: [../daedalus-parser/API.md](../daedalus-parser/API.md)
- Editor agent guidance: [../daedalus-dialog-editor/AGENTS.md](../daedalus-dialog-editor/AGENTS.md)
