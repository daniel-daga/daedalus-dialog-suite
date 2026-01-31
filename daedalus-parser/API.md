# Daedalus Parser API Reference

Complete API reference for the Daedalus Parser library, featuring semantic model extraction and code generation.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Semantic Model API](#semantic-model-api)
- [Code Generation API](#code-generation-api)
- [Type Definitions](#type-definitions)
- [Examples](#examples)

## Installation

```bash
npm install daedalus-parser
```

Or for development:

```bash
git clone <repository>
cd daedalus-parser
npm install
npm run build
```

## Quick Start

### Parse and Generate Code

```typescript
import * as Parser from 'tree-sitter';
import {
  SemanticModelBuilderVisitor,
  SemanticCodeGenerator
} from './src/semantic-visitor-index';

// Parse Daedalus source
const Daedalus = require('./bindings/node');
const parser = new Parser();
parser.setLanguage(Daedalus);

const tree = parser.parse(sourceCode);

// Build semantic model
const visitor = new SemanticModelBuilderVisitor();
visitor.pass1_createObjects(tree.rootNode);
visitor.pass2_analyzeAndLink(tree.rootNode);

// Access structured data
console.log('Dialogs:', visitor.semanticModel.dialogs);
console.log('Functions:', visitor.semanticModel.functions);

// Generate code
const generator = new SemanticCodeGenerator();
const newCode = generator.generateSemanticModel(visitor.semanticModel);
```

## Semantic Model API

### SemanticModelBuilderVisitor

Builds a structured semantic model from Tree-sitter AST using a two-pass visitor pattern.

#### Constructor

```typescript
const visitor = new SemanticModelBuilderVisitor();
```

#### Methods

##### `pass1_createObjects(node: TreeSitterNode): void`

First pass: Creates skeleton objects for all dialogs and functions.

- **Parameters:**
  - `node` - Root node of the Tree-sitter AST
- **Side Effects:** Populates `visitor.semanticModel.dialogs` and `visitor.semanticModel.functions`

**Example:**
```typescript
visitor.pass1_createObjects(tree.rootNode);
```

##### `pass2_analyzeAndLink(node: TreeSitterNode): void`

Second pass: Links properties and analyzes function bodies to extract actions.

- **Parameters:**
  - `node` - Root node of the Tree-sitter AST
- **Side Effects:**
  - Links dialog properties to function objects
  - Extracts semantic actions from function bodies
  - Populates action arrays

**Example:**
```typescript
visitor.pass2_analyzeAndLink(tree.rootNode);
```

#### Properties

##### `semanticModel: SemanticModel`

The constructed semantic model containing dialogs and functions.

```typescript
interface SemanticModel {
  dialogs: { [name: string]: Dialog };
  functions: { [name: string]: DialogFunction };
}
```

**Access Example:**
```typescript
// After running both passes
const helloDialog = visitor.semanticModel.dialogs['DIA_Hero_Hello'];
const conditionFunc = visitor.semanticModel.functions['DIA_Hero_Hello_Condition'];

console.log('Dialog NPC:', helloDialog.properties.npc);
console.log('Dialog actions:', helloDialog.actions.length);
```

### Dialog Class

Represents a dialog instance (C_INFO).

#### Properties

```typescript
class Dialog {
  name: string;                    // Dialog instance name
  parent: string | null;           // Parent class (usually C_INFO)
  properties: DialogProperties;    // Dialog properties
  actions: DialogAction[];         // Extracted semantic actions
}

interface DialogProperties {
  npc?: string;                    // NPC identifier
  nr?: number;                     // Dialog priority number
  condition?: DialogFunction;      // Condition function (linked object)
  information?: DialogFunction;    // Information function (linked object)
  permanent?: boolean;             // Permanent flag
  important?: boolean;             // Important flag
  description?: string;            // Dialog text shown to player
  // ... other custom properties
}
```

**Example:**
```typescript
const dialog = new Dialog('DIA_Merchant_Trade', 'C_INFO');
dialog.properties.npc = 'TownMerchant';
dialog.properties.nr = 10;
dialog.properties.permanent = true;
dialog.properties.description = 'Trade';
```

### DialogFunction Class

Represents a function declaration.

#### Properties

```typescript
class DialogFunction {
  name: string;              // Function name
  returnType: string;        // Return type (int, void, etc.)
  calls: string[];           // List of function calls made
  actions: DialogAction[];   // Semantic actions extracted
}
```

**Example:**
```typescript
const func = new DialogFunction('DIA_Hero_Greeting_Info', 'void');
console.log('Return type:', func.returnType);
console.log('Actions:', func.actions);
```

### Action Classes

Semantic actions extracted from function bodies:

#### DialogLine

AI_Output call.

```typescript
class DialogLine {
  speaker: string;    // Speaker identifier (self, other, etc.)
  text: string;       // Dialog text (from comment or ID)
  id: string;         // Dialog ID
}
```

#### Choice

Info_AddChoice call.

```typescript
class Choice {
  dialogRef: string;      // Dialog instance reference
  text: string;           // Choice text
  targetFunction: string; // Target function name
}
```

#### CreateTopic

Log_CreateTopic call.

```typescript
class CreateTopic {
  topic: string;           // Topic identifier
  topicType: string | null; // Topic type (LOG_MISSION, LOG_NOTE, etc.)
}
```

#### LogEntry

B_LogEntry call.

```typescript
class LogEntry {
  topic: string;  // Topic identifier
  text: string;   // Entry text
}
```

#### Other Action Types

- `LogSetTopicStatus` - Log_SetTopicStatus calls
- `CreateInventoryItems` - CreateInvItems calls
- `GiveInventoryItems` - B_GiveInvItems calls
- `AttackAction` - B_Attack calls
- `SetAttitudeAction` - B_SetAttitude calls
- `ExchangeRoutineAction` - Npc_ExchangeRoutine calls
- `ChapterTransitionAction` - B_Kapitelwechsel calls
- `Action` - Generic action (any other function call)

## Code Generation API

### SemanticCodeGenerator

Generates Daedalus source code from semantic models using string templates.

#### Constructor

```typescript
const generator = new SemanticCodeGenerator(options?: CodeGeneratorOptions);
```

**Options:**
```typescript
interface CodeGeneratorOptions {
  indentSize?: number;        // Default: 1
  indentChar?: '\t' | ' ';   // Default: '\t'
  includeComments?: boolean;  // Default: true
  sectionHeaders?: boolean;   // Default: true
  uppercaseKeywords?: boolean; // Default: false
}
```

**Example:**
```typescript
const generator = new SemanticCodeGenerator({
  indentChar: ' ',
  indentSize: 4,
  includeComments: true,
  sectionHeaders: true,
  uppercaseKeywords: false
});
```

#### Methods

##### `generateSemanticModel(model: SemanticModel): string`

Generate complete Daedalus source file from semantic model.

- **Parameters:**
  - `model` - Semantic model with dialogs and functions
- **Returns:** Generated Daedalus source code (string)

**Example:**
```typescript
const code = generator.generateSemanticModel(visitor.semanticModel);
console.log(code);
```

##### `generateDialog(dialog: Dialog): string`

Generate a single dialog instance declaration.

- **Parameters:**
  - `dialog` - Dialog object
- **Returns:** Dialog instance code (string)

**Example:**
```typescript
const dialog = new Dialog('DIA_Test', 'C_INFO');
dialog.properties.npc = 'TEST_NPC';
const code = generator.generateDialog(dialog);
```

##### `generateFunction(func: DialogFunction, preservedBody?: string): string`

Generate a single function declaration.

- **Parameters:**
  - `func` - DialogFunction object
  - `preservedBody` - Optional preserved function body as string
- **Returns:** Function declaration code (string)

**Example:**
```typescript
const func = new DialogFunction('TestFunc', 'int');
const code = generator.generateFunction(func);
// Or with preserved body:
const code2 = generator.generateFunction(func, 'return TRUE;');
```

##### `generateAction(action: DialogAction): string`

Generate code for a single semantic action.

- **Parameters:**
  - `action` - Any DialogAction type
- **Returns:** Action code (string)

**Example:**
```typescript
const action = new DialogLine('self', 'Hello!', 'GREETING_01');
const code = generator.generateAction(action);
// Output: AI_Output(self, other, "GREETING_01"); //Hello!
```

## Type Definitions

### TreeSitterNode

Interface for Tree-sitter AST nodes (provided by tree-sitter library).

```typescript
interface TreeSitterNode {
  type: string;
  text: string;
  children: TreeSitterNode[];
  namedChildren: TreeSitterNode[];
  childForFieldName(fieldName: string): TreeSitterNode | null;
  // ... other tree-sitter properties
}
```

### SemanticModel

Top-level semantic model structure.

```typescript
interface SemanticModel {
  dialogs: { [name: string]: Dialog };
  functions: { [name: string]: DialogFunction };
}
```

### DialogAction

Union type of all action types.

```typescript
type DialogAction =
  | DialogLine
  | Choice
  | CreateTopic
  | LogEntry
  | LogSetTopicStatus
  | CreateInventoryItems
  | GiveInventoryItems
  | AttackAction
  | SetAttitudeAction
  | ExchangeRoutineAction
  | ChapterTransitionAction
  | Action;
```

## Examples

### Example 1: Parse and Modify

```typescript
import * as Parser from 'tree-sitter';
import { SemanticModelBuilderVisitor, SemanticCodeGenerator } from './src/semantic-visitor-index';

const Daedalus = require('./bindings/node');
const parser = new Parser();
parser.setLanguage(Daedalus);

// Parse
const tree = parser.parse(sourceCode);
const visitor = new SemanticModelBuilderVisitor();
visitor.pass1_createObjects(tree.rootNode);
visitor.pass2_analyzeAndLink(tree.rootNode);

// Modify
const dialog = visitor.semanticModel.dialogs['DIA_Hero_Trade'];
dialog.properties.description = '"Buy items"';
dialog.properties.nr = 5;

// Generate
const generator = new SemanticCodeGenerator();
const newCode = generator.generateSemanticModel(visitor.semanticModel);
```

### Example 2: Create from Scratch

```typescript
import {
  SemanticModel,
  Dialog,
  DialogFunction,
  DialogLine,
  SemanticCodeGenerator
} from './src/semantic-visitor-index';

// Create model
const model: SemanticModel = { dialogs: {}, functions: {} };

// Create dialog
const dialog = new Dialog('DIA_Guard_Stop', 'C_INFO');
dialog.properties.npc = 'CityGuard';
dialog.properties.nr = 1;
dialog.properties.important = true;

// Create functions
const conditionFunc = new DialogFunction('DIA_Guard_Stop_Condition', 'int');
const infoFunc = new DialogFunction('DIA_Guard_Stop_Info', 'void');

// Add action
infoFunc.actions.push(
  new DialogLine('self', 'Halt! Where do you think you\'re going?', 'GUARD_STOP_01')
);

// Link
dialog.properties.condition = conditionFunc;
dialog.properties.information = infoFunc;

model.dialogs[dialog.name] = dialog;
model.functions[conditionFunc.name] = conditionFunc;
model.functions[infoFunc.name] = infoFunc;

// Generate
const generator = new SemanticCodeGenerator();
const code = generator.generateSemanticModel(model);
console.log(code);
```

### Example 3: Round-Trip

```typescript
// Parse original
const tree1 = parser.parse(originalCode);
const visitor1 = new SemanticModelBuilderVisitor();
visitor1.pass1_createObjects(tree1.rootNode);
visitor1.pass2_analyzeAndLink(tree1.rootNode);

// Generate code
const generator = new SemanticCodeGenerator();
const generatedCode = generator.generateSemanticModel(visitor1.semanticModel);

// Parse generated to verify
const tree2 = parser.parse(generatedCode);
const visitor2 = new SemanticModelBuilderVisitor();
visitor2.pass1_createObjects(tree2.rootNode);
visitor2.pass2_analyzeAndLink(tree2.rootNode);

// Verify semantics preserved
console.log('Dialog count matches:',
  Object.keys(visitor1.semanticModel.dialogs).length ===
  Object.keys(visitor2.semanticModel.dialogs).length
);
```

## CLI Tools

The package also includes CLI tools:

### Semantic Analyzer
```bash
npm run semantic examples/DIA_Szmyk.d
```

### Code Generator
```bash
npm run generate examples/DIA_Szmyk.d --verbose
npm run generate examples/DIA_Szmyk.d -o output.d
```

### Formatter
```bash
npm run format examples/DIA_Szmyk.d
```

### Parser
```bash
npm run parse examples/DIA_Szmyk.d
```

## Further Documentation

- **[README.md](README.md)** - Project overview and quick start
- **[SEMANTIC_CODE_GENERATOR.md](SEMANTIC_CODE_GENERATOR.md)** - Detailed code generation guide
- **[SEMANTIC_VISITOR_ARCHITECTURE.md](SEMANTIC_VISITOR_ARCHITECTURE.md)** - Visitor pattern details
- **[MIGRATION_CODE_GENERATOR.md](MIGRATION_CODE_GENERATOR.md)** - Migration from old API

## License

MIT License - see LICENSE file for details.