# Feature: Validate generated code before saving

## Summary
Currently there is no validation that generated code is syntactically correct before writing to disk.

## Problem
The code generator could potentially produce invalid Daedalus code due to:
- Edge cases in the generation logic
- Malformed input data
- Bugs in the generator

Writing invalid code to disk could break the user's mod and require manual fixing.

## Proposed Solution
Implement a validation step before saving:

### Validation Process
1. Generate code from semantic model
2. Parse the generated code using the existing parser
3. If parsing fails, show error and prevent save
4. If parsing succeeds, proceed with save

### Error Handling
- Show detailed error message if validation fails
- Highlight the problematic section if possible
- Offer options:
  - "Fix and retry" (if auto-fixable)
  - "Save anyway" (with warning)
  - "Cancel"

### Additional Validations
- Check for duplicate dialog names
- Validate function references exist
- Check for circular dependencies
- Validate required properties are set

## Implementation Notes
- Reuse existing `ParserService` for validation
- Validation should be fast (< 100ms for typical files)
- Consider caching validation results
- Add option to disable validation in settings (for advanced users)

## Acceptance Criteria
- [ ] Generated code is parsed before saving
- [ ] Parse errors prevent automatic save
- [ ] User sees clear error message on validation failure
- [ ] User can choose to save anyway (with warning)
- [ ] Validation doesn't noticeably slow down save operation
- [ ] Duplicate dialog names are detected
- [ ] Missing function references are detected
