# Semantic Code Generator

String-based code generator for Daedalus semantic models. Generates clean, readable Daedalus source code from parsed semantic models.

## Architecture

```
Semantic Model (Input) → Code Generator → Daedalus Source Code (Output)
```

The generator accepts your **semantic model** directly (Dialog, DialogFunction, DialogAction objects) and produces formatted Daedalus source code.

## Programmatic Usage

### Basic Usage

```typescript
import { SemanticCodeGenerator } from './src/semantic-code-generator';
import { SemanticModel } from './src/semantic-model';

// Assuming you have a semantic model (from parsing or manual construction)
const model: SemanticModel = { dialogs: {}, functions: {} };

// Generate code
const generator = new SemanticCodeGenerator();
const code = generator.generateSemanticModel(model);

console.log(code);
```

### Parse → Modify → Generate Workflow

```typescript
import * as Parser from 'tree-sitter';
import { SemanticModelBuilderVisitor } from './src/semantic-visitor';
import { SemanticCodeGenerator } from './src/semantic-code-generator';

// Parse existing code
const parser = new Parser();
const Daedalus = require('./bindings/node');
parser.setLanguage(Daedalus);

const tree = parser.parse(sourceCode);
const visitor = new SemanticModelBuilderVisitor();
visitor.pass1_createObjects(tree.rootNode);
visitor.pass2_analyzeAndLink(tree.rootNode);

// Modify the semantic model
const dialog = visitor.semanticModel.dialogs['DIA_Merchant_Trade'];
dialog.properties.description = '"Updated description"';
dialog.properties.nr = 5;

// Generate modified code
const generator = new SemanticCodeGenerator();
const modifiedCode = generator.generateSemanticModel(visitor.semanticModel);
```

### Create Semantic Model Programmatically

```typescript
import { Dialog, DialogFunction, SemanticModel } from './src/semantic-model';
import { SemanticCodeGenerator } from './src/semantic-code-generator';

const model: SemanticModel = { dialogs: {}, functions: {} };

// Create dialog
const dialog = new Dialog('DIA_Test_Hello', 'C_INFO');
dialog.properties.npc = 'TEST_NPC';
dialog.properties.nr = 1;
dialog.properties.description = 'Hello!';

// Create functions
const conditionFunc = new DialogFunction('DIA_Test_Hello_Condition', 'int');
const infoFunc = new DialogFunction('DIA_Test_Hello_Info', 'void');

// Link them
dialog.properties.condition = conditionFunc;
dialog.properties.information = infoFunc;

// Add to model
model.dialogs[dialog.name] = dialog;
model.functions[conditionFunc.name] = conditionFunc;
model.functions[infoFunc.name] = infoFunc;

// Generate
const generator = new SemanticCodeGenerator();
const code = generator.generateSemanticModel(model);
```

## Configuration Options

```typescript
interface CodeGeneratorOptions {
  indentSize?: number;        // Default: 1
  indentChar?: '\t' | ' ';   // Default: '\t'
  includeComments?: boolean;  // Default: true
  sectionHeaders?: boolean;   // Default: true
  uppercaseKeywords?: boolean; // Default: false
}

const generator = new SemanticCodeGenerator({
  indentChar: ' ',
  indentSize: 4,
  includeComments: false,
  sectionHeaders: false,
  uppercaseKeywords: false
});
```

### Option Examples

**Space indentation:**
```typescript
new SemanticCodeGenerator({ indentChar: ' ', indentSize: 4 })
```

**Uppercase keywords (INSTANCE, FUNC, INT, VOID):**
```typescript
new SemanticCodeGenerator({ uppercaseKeywords: true })
```

**No comments or section headers:**
```typescript
new SemanticCodeGenerator({
  includeComments: false,
  sectionHeaders: false
})
```

## API Reference

### SemanticCodeGenerator

#### `generateSemanticModel(model: SemanticModel): string`
Generate complete Daedalus source file from semantic model.

**Input:** Your parsed semantic model with dialogs and functions
**Output:** Formatted Daedalus source code

#### `generateDialog(dialog: Dialog): string`
Generate a single dialog instance declaration.

#### `generateFunction(func: DialogFunction, preservedBody?: string): string`
Generate a single function declaration. Optionally provide preserved body as raw string.

#### `generateAction(action: DialogAction): string`
Generate code for a single dialog action (AI_Output, Log_CreateTopic, etc.)

## Supported Action Types

The generator supports all semantic action types:

- ✅ `DialogLine` → `AI_Output(self, other, "ID"); //Comment`
- ✅ `Choice` → `Info_AddChoice(dialog, "text", targetFunc);`
- ✅ `CreateTopic` → `Log_CreateTopic(TOPIC, LOG_MISSION);`
- ✅ `LogEntry` → `B_LogEntry(TOPIC, "text");`
- ✅ `LogSetTopicStatus` → `Log_SetTopicStatus(TOPIC, LOG_SUCCESS);`
- ✅ `CreateInventoryItems` → `CreateInvItems(self, item, 5);`
- ✅ `GiveInventoryItems` → `B_GiveInvItems(self, other, item, 3);`
- ✅ `AttackAction` → `B_Attack(self, other, AR_NONE, 1);`
- ✅ `SetAttitudeAction` → `B_SetAttitude(self, ATT_HOSTILE);`
- ✅ `ExchangeRoutineAction` → `Npc_ExchangeRoutine(self, "START");`
- ✅ `ChapterTransitionAction` → `B_Kapitelwechsel(2, NEWWORLD_ZEN);`
- ✅ `Action` (generic) → Any other function call

## CLI Usage

For quick file-based operations:

```bash
# Parse and regenerate (round-trip)
npm run generate examples/DIA_Szmyk.d

# Generate with verbose output
npm run generate examples/DIA_Szmyk.d --verbose

# Generate to file
npm run generate examples/DIA_Szmyk.d -o output.d

# Use space indentation
npm run generate examples/DIA_Szmyk.d --indent-spaces 4

# Uppercase keywords
npm run generate examples/DIA_Szmyk.d --uppercase

# No comments
npm run generate examples/DIA_Szmyk.d --no-comments
```

## Testing

Run the comprehensive test suite:

```bash
node --test test/semantic-code-generator.test.js
```

Tests include:
- Individual component generation
- All action types
- Round-trip verification (parse → generate → parse)
- Configuration options
- Edge cases

## Examples

See [examples/code-generator-usage.ts](examples/code-generator-usage.ts) for complete working examples.

## Design Philosophy

### Why String Generation?

We chose string-based generation over AST manipulation because:

1. **Simplicity:** Template strings are easy to read, write, and maintain
2. **Control:** Precise control over formatting, indentation, and style
3. **Semantic Focus:** Your semantic model contains 90% of what's needed
4. **AST Limitation:** TreeSitter is designed for parsing, not generation
5. **Use Case Match:** Dialog editor needs metadata generation, not full code synthesis

### What About Complex Function Bodies?

For complex function bodies with conditionals, loops, and expressions that aren't in the semantic model:

- **Option 1:** Store original body as raw string during parsing, regenerate it verbatim
- **Option 2:** Semantic model focuses on dialog metadata; complex logic stays in original files
- **Option 3:** For editor use case, generate stub functions with TODO comments

The semantic model captures high-level dialog flow and actions, which is perfect for visual dialog editing. Complex scripting logic can be handled separately.

## Integration with Dialog Editor

Intended workflow for the planned Electron dialog editor:

1. **Parse** existing .d files → Semantic Model (using SemanticModelBuilderVisitor)
2. **Edit** in visual UI → Modify Semantic Model (React components)
3. **Generate** updated code → Write back to .d files (using SemanticCodeGenerator)
4. **Preserve** complex logic → Store function bodies that aren't semantically parsed

This enables WYSIWYG editing of dialog structure while preserving custom scripting.