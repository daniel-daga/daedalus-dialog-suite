# Code Generator Migration Guide

The old AST-based `daedalus-code-generator.js` has been **removed** and replaced with the new semantic model-based generator.

## What Changed?

### ❌ Old API (REMOVED)
```javascript
const DaedalusCodeGenerator = require('./src/daedalus-code-generator');

const generator = new DaedalusCodeGenerator();
const code = generator.generateDaedalus(dialogData);
```

**Issues with old approach:**
- Required complex dialog data structures with `dialogNpcs`, nested arrays
- Mixed AST manipulation with string generation
- Tight coupling to specific data formats
- Hard to extend and maintain

### ✅ New API (CURRENT)

```typescript
import { SemanticCodeGenerator } from './src/semantic-visitor-index';

const generator = new SemanticCodeGenerator();
const code = generator.generateSemanticModel(semanticModel);
```

**Benefits:**
- Works directly with semantic model objects
- Simple string-based generation
- Clean, typed API
- Easy to extend
- Well tested (15 tests)

## Migration Steps

### Step 1: Get a Semantic Model

**Option A: Parse existing code**
```typescript
import { SemanticModelBuilderVisitor } from './src/semantic-visitor-index';

const Parser = require('tree-sitter');
const Daedalus = require('./bindings/node');
const parser = new Parser();
parser.setLanguage(Daedalus);

const tree = parser.parse(sourceCode);
const visitor = new SemanticModelBuilderVisitor();
visitor.pass1_createObjects(tree.rootNode);
visitor.pass2_analyzeAndLink(tree.rootNode);

// Use visitor.semanticModel
```

**Option B: Create manually**
```typescript
import { Dialog, DialogFunction, SemanticModel } from './src/semantic-visitor-index';

const model: SemanticModel = { dialogs: {}, functions: {} };

const dialog = new Dialog('DIA_Test', 'C_INFO');
dialog.properties.npc = 'TEST_NPC';
// ... set other properties

model.dialogs[dialog.name] = dialog;
```

### Step 2: Generate Code

```typescript
import { SemanticCodeGenerator } from './src/semantic-visitor-index';

const generator = new SemanticCodeGenerator({
  indentChar: '\t',  // or ' '
  indentSize: 1,
  includeComments: true,
  sectionHeaders: true,
  uppercaseKeywords: false
});

const code = generator.generateSemanticModel(model);
```

## Mapping Old Data Structures

If you have old `dialogData` objects, you need to convert them to semantic models:

### Old Structure
```javascript
const dialogData = {
  dialogNpcs: {
    'NPC_NAME': {
      dialogs: [
        { name: 'DIA_X', npc: 'NPC_NAME', condition: 'Func1', ... }
      ]
    }
  },
  dialogs: [...]
};
```

### New Structure
```typescript
const model: SemanticModel = {
  dialogs: {
    'DIA_X': Dialog {
      name: 'DIA_X',
      properties: { npc: 'NPC_NAME', condition: DialogFunction {...} },
      actions: [...]
    }
  },
  functions: {
    'Func1': DialogFunction { name: 'Func1', returnType: 'int', ... }
  }
};
```

## CLI Tool Remains the Same

If you were using the CLI, it still works (but now uses the new generator internally):

```bash
npm run generate examples/DIA_Szmyk.d --verbose
```

## Questions?

See [SEMANTIC_CODE_GENERATOR.md](SEMANTIC_CODE_GENERATOR.md) for full API documentation and examples.

The semantic model is the **universal interface** for all code generation now. It's simpler, cleaner, and more maintainable!