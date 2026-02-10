# Editor Guardrails Plan

## Goal
Prevent the dialog editor from introducing semantic regressions when round-tripping Daedalus files.

## Identified Bugs
- AI_Output speaker/target corruption ("other, self" -> "other, other")
- Control-flow flattened (if/else lost)
- Invalid condition regeneration (side effects inside condition)
- Spurious action injection (generated action IDs)
- Function body shuffling/re-association
- Top-level declaration order churn (helper functions moved to file end)

## Planned Fixes
1. Preserve unsupported statements using existing arbitrary-text action field.
   - Detect control flow or unknown statements during semantic visiting.
   - Store each unsupported statement as a raw Action.
   - Skip descending into those statements to avoid flattening.

2. Preserve AI_Output listener/target.
   - Extend DialogLine with listener/target field.
   - Parse listener arg; generate AI_Output(speaker, listener, ...).

3. Avoid regenerating condition functions with side effects.
   - If a condition function contains non-boolean logic or side effects, preserve raw body.

4. Preserve original top-level declaration order during generation.
   - Record declaration order during pass 1 (instances/functions).
   - Emit source in that exact order when metadata is present.
   - Keep legacy fallback for models without order metadata.

## Status
- [x] 1. Preserve unsupported statements using existing arbitrary-text action field.
- [x] 2. Preserve AI_Output listener/target.
- [x] 3. Avoid regenerating condition functions with side effects.
- [x] 4. Preserve original top-level declaration order during generation.
