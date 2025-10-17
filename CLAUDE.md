# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Tree-sitter parser for the Daedalus scripting language used in Gothic 2 modding, featuring semantic model extraction and code generation capabilities.

## Architecture

The project follows a multi-stage architecture:

1. **Tree-sitter Parsing** - Native C parser for syntax analysis
2. **Semantic Visitor** - Two-pass visitor builds structured semantic model
3. **Code Generation** - String-based template generation from semantic model

### Key Components

- **`grammar.js`** - Tree-sitter grammar definition
- **`src/semantic-model.ts`** - Type definitions for Dialog, DialogFunction, Actions
- **`src/semantic-visitor.ts`** - Two-pass visitor building semantic model
- **`src/action-parsers.ts`** - Parsers for semantic actions (AI_Output, Log_CreateTopic, etc.)
- **`src/semantic-code-generator.ts`** - String-based code generation from semantic model
- **`src/formatter.js`** - Code formatter (operates on AST)

## Development Methodology

### Test-Driven Development (TDD)

All new feature development and bug fixes follow TDD:

1. **Write a Failing Test**: Create test case describing desired feature/bug fix
2. **Modify the Code**: Make minimal changes to make test pass
3. **Run Tests**: Execute `npm test` to compile grammar and run tests
4. **Refactor**: Improve code structure while ensuring tests pass
5. **Repeat**: Continue this cycle for all new functionality

Current test suite: **85 tests, all passing** ✅

### Grammar Compilation

After modifying `grammar.js`:

```bash
npm run build          # Regenerate parser from grammar.js
npm run prebuildify    # Compile Node.js native module
npm test              # Verify changes work
```

**IMPORTANT**: Parser won't recognize grammar changes until both steps complete.

### Code Quality and Type Safety

Before submitting changes:

```bash
npm test              # Run all tests
npm run lint          # Check code quality with ESLint
npm run typecheck     # Validate TypeScript definitions
```

All commands must pass without errors.

#### TypeScript Files

The semantic model and code generator are TypeScript:

```bash
# Compile TypeScript to dist/
npx tsc src/semantic-*.ts src/action-parsers.ts --outDir dist \
  --declaration --esModuleInterop --moduleResolution node \
  --module commonjs --target es2020 --skipLibCheck
```

## API Usage

### Semantic Model Workflow (Recommended)

```typescript
import * as Parser from 'tree-sitter';
import {
  SemanticModelBuilderVisitor,
  SemanticCodeGenerator,
  Dialog,
  DialogFunction
} from './src/semantic-visitor-index';

// Parse
const Daedalus = require('./bindings/node');
const parser = new Parser();
parser.setLanguage(Daedalus);
const tree = parser.parse(sourceCode);

// Build semantic model
const visitor = new SemanticModelBuilderVisitor();
visitor.pass1_createObjects(tree.rootNode);
visitor.pass2_analyzeAndLink(tree.rootNode);

// Access/modify semantic model
const dialog = visitor.semanticModel.dialogs['DIA_Test'];
dialog.properties.description = 'Updated';

// Generate code
const generator = new SemanticCodeGenerator();
const code = generator.generateSemanticModel(visitor.semanticModel);
```

### CLI Tools

```bash
# Semantic analysis
npm run semantic examples/DIA_Szmyk.d

# Code generation (round-trip)
npm run generate examples/DIA_Szmyk.d --verbose
npm run generate examples/DIA_Szmyk.d -o output.d

# Formatting
npm run format examples/DIA_Szmyk.d

# Parsing
npm run parse examples/DIA_Szmyk.d
```

## Semantic Model Structure

```typescript
interface SemanticModel {
  dialogs: { [name: string]: Dialog };
  functions: { [name: string]: DialogFunction };
}

class Dialog {
  name: string;
  parent: string | null;
  properties: DialogProperties;  // npc, nr, condition, information, etc.
  actions: DialogAction[];       // Extracted from information function
}

class DialogFunction {
  name: string;
  returnType: string;
  calls: string[];              // Function calls made
  actions: DialogAction[];      // Semantic actions
}
```

### Supported Actions

The semantic model captures high-level actions:

- **DialogLine** - AI_Output calls
- **Choice** - Info_AddChoice calls
- **CreateTopic** - Log_CreateTopic calls
- **LogEntry** - B_LogEntry calls
- **LogSetTopicStatus** - Log_SetTopicStatus calls
- **CreateInventoryItems** - CreateInvItems calls
- **GiveInventoryItems** - B_GiveInvItems calls
- **AttackAction** - B_Attack calls
- **SetAttitudeAction** - B_SetAttitude calls
- **ExchangeRoutineAction** - Npc_ExchangeRoutine calls
- **ChapterTransitionAction** - B_Kapitelwechsel calls
- **Action** (generic) - Any other function call

## Code Generation

The code generator uses simple string templates (not AST manipulation):

```typescript
const generator = new SemanticCodeGenerator({
  indentSize: 1,
  indentChar: '\t',          // or ' '
  includeComments: true,
  sectionHeaders: true,
  uppercaseKeywords: false
});

const code = generator.generateSemanticModel(model);
```

### Why String-Based Generation?

1. **Simple** - Easy to read, write, and maintain
2. **Semantic Focus** - Model contains 90% of needed info
3. **Control** - Precise formatting control
4. **Round-trip** - Parse → Generate → Parse preserves semantics

## Important Files

### Source Files
- `src/semantic-model.ts` - Type definitions
- `src/semantic-visitor.ts` - Visitor implementation
- `src/action-parsers.ts` - Action parsing logic
- `src/semantic-code-generator.ts` - Code generation
- `src/semantic-visitor-index.ts` - Export entry point

### Tests
- `test/semantic-code-generator.test.js` - 15 code generation tests
- `test/parser.test.js` - Core parsing tests
- `test/formatter.test.js` - Formatter tests

### Documentation
- `README.md` - Main documentation
- `SEMANTIC_CODE_GENERATOR.md` - Code generation API
- `SEMANTIC_VISITOR_ARCHITECTURE.md` - Visitor pattern details
- `MIGRATION_CODE_GENERATOR.md` - Migration from old API
- `DIALOG_EDITOR_ARCHITECTURE.md` - Planned Electron editor

### Examples
- `examples/simple-api-demo.ts` - Clean API usage
- `examples/code-generator-usage.ts` - Comprehensive examples
- `examples/*.d` - Real Gothic 2 dialog files

## Deleted Components

These files were removed (old AST-based approach):

- ❌ `src/daedalus-code-generator.js` - Old generator
- ❌ `src/ast-builder.js` - AST construction
- ❌ `src/dialog-edit-operations.js` - Dialog operations
- ❌ `src/edit-transaction.js` - Transaction management
- ❌ `src/tree-sitter-wrapper.js` - AST wrapper
- ❌ `src/node-field-mappings.js` - Field mappings

**Do not reference these files.** Use the semantic model approach instead.

## Testing Strategy

### Test Files
- 85 tests total, all passing
- Tests cover: parsing, semantic model, code generation, formatting
- Round-trip tests verify: Parse → Generate → Parse

### Running Tests

```bash
npm test                    # All tests
node --test test/semantic-code-generator.test.js  # Specific test
```

### Adding Tests

Follow TDD - write failing test first:

```javascript
test('SemanticCodeGenerator should handle X', () => {
  const model = createTestModel();
  const generator = new SemanticCodeGenerator();
  const result = generator.generateSemanticModel(model);
  assert.ok(result.includes('expected output'));
});
```

## References

- [Daedalus EBNF Documentation](https://wiki.worldofgothic.de/doku.php?id=daedalus:ebnf)
- [Gothic Scripting Tutorial](https://wiki.worldofgothic.de/doku.php?id=quickstart:skripte)
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/)
- [Example Files](https://github.com/Szmyk/gmbt-example-mod/tree/master/G2NoTR/mod/Scripts/Content)

## Best Practices

1. **Always use semantic model** for dialog editing workflows
2. **Test round-trip** - Parse → Modify → Generate → Parse should preserve semantics
3. **Keep it simple** - Prefer string generation over AST manipulation
4. **Type everything** - Use TypeScript for new components
5. **Document examples** - Add examples for new features
6. **Follow TDD** - Write tests first, then implement

## Notes for Claude

- The semantic model is the **universal interface** for all code generation
- Function bodies can be preserved as raw strings or regenerated from actions
- The visitor pattern uses **two passes**: Pass 1 creates objects, Pass 2 links and analyzes
- Code generator input is **always** a `SemanticModel`, never file paths
- When adding new action types, update: `semantic-model.ts`, `action-parsers.ts`, and `semantic-code-generator.ts`

### Agent Rules

1. **Do NOT over-document** - This is a working codebase, not a documentation repository
   - Do NOT create markdown documentation files unless explicitly requested
   - Do NOT create example files unless explicitly requested
   - Code should be self-documenting with clear names and concise comments
   - Tests serve as usage examples

2. **Do NOT create temporary test files** - Use proper test infrastructure
   - All tests go in `test/*.test.js` files
   - Do NOT create `/tmp/test_*.js` files or similar
   - Use `node --test` to run specific test files
   - Clean up any temporary files immediately after debugging