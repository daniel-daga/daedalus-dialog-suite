# Daedalus Parser

A high-performance Tree-sitter parser for the Daedalus scripting language used in Gothic 2 modding. Features semantic model extraction and code generation for dialog editing workflows.

## Features

- 🚀 **High-performance parsing** with Tree-sitter (sub-millisecond for typical files)
- 📝 **Complete syntax support** for all Daedalus language constructs
- 🎭 **Semantic model** - Extract structured dialog and function information
- 🔄 **Code generation** - Generate Daedalus code from semantic models
- 🛠️ **Command-line tools** for parsing, formatting, and code generation
- ✅ **Comprehensive validation** with detailed error reporting
- 📜 **TypeScript support** - Complete type definitions included
- ⚡ **Library-first design** - Optimized for editor integration

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

### Semantic Model Workflow (Recommended)

The semantic model approach is ideal for dialog editors and tools:

```typescript
import * as Parser from 'tree-sitter';
import {
  SemanticModelBuilderVisitor,
  SemanticCodeGenerator,
  Dialog,
  DialogFunction
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
console.log('Dialogs:', Object.keys(visitor.semanticModel.dialogs));
console.log('Functions:', Object.keys(visitor.semanticModel.functions));

// Modify the semantic model
const dialog = visitor.semanticModel.dialogs['DIA_Test_Hello'];
dialog.properties.description = 'Updated description';

// Generate code from semantic model
const generator = new SemanticCodeGenerator();
const newCode = generator.generateSemanticModel(visitor.semanticModel);
```

### Create Semantic Model Programmatically

```typescript
import {
  SemanticModel,
  Dialog,
  DialogFunction,
  DialogLine,
  SemanticCodeGenerator
} from './src/semantic-visitor-index';

const model: SemanticModel = { dialogs: {}, functions: {} };

// Create a dialog
const dialog = new Dialog('DIA_Merchant_Trade', 'C_INFO');
dialog.properties.npc = 'MER_001_Merchant';
dialog.properties.nr = 10;
dialog.properties.description = 'Trade';

// Create functions
const conditionFunc = new DialogFunction('DIA_Merchant_Trade_Condition', 'int');
const infoFunc = new DialogFunction('DIA_Merchant_Trade_Info', 'void');

// Add actions to function
infoFunc.actions.push(
  new DialogLine('self', 'What do you want to buy?', 'MERCHANT_01')
);

// Link to dialog
dialog.properties.condition = conditionFunc;
dialog.properties.information = infoFunc;

model.dialogs[dialog.name] = dialog;
model.functions[conditionFunc.name] = conditionFunc;
model.functions[infoFunc.name] = infoFunc;

// Generate code
const generator = new SemanticCodeGenerator();
const code = generator.generateSemanticModel(model);
console.log(code);
```

## Command-Line Tools

### Semantic Analyzer

Analyze dialogs and extract semantic information:

```bash
npm run semantic examples/DIA_Szmyk.d
```

Shows:
- All dialogs and their properties
- All functions and their actions
- Dialog lines, choices, log entries
- Cross-references between dialogs and functions

### Code Generator

Generate Daedalus code from semantic models (round-trip):

```bash
# Parse → Semantic Model → Generate → Verify round-trip
npm run generate examples/DIA_Szmyk.d --verbose

# Generate to file
npm run generate examples/DIA_Szmyk.d -o output.d

# Custom formatting
npm run generate examples/DIA_Szmyk.d --indent-spaces 4 --no-comments
```

Options:
- `--verbose, -v` - Show detailed statistics and verification
- `--output, -o` - Write to file instead of stdout
- `--indent-spaces N` - Use N spaces instead of tabs
- `--no-comments` - Omit inline comments
- `--no-headers` - Omit section headers
- `--uppercase` - Use uppercase keywords (INSTANCE, FUNC)

### Code Formatter

Format Daedalus source code:

```bash
daedalus-format examples/script.d
daedalus-format examples/script.d --output formatted.d --indent 2
```

### Parser

Parse and analyze syntax:

```bash
daedalus-parse examples/DIA_Szmyk.d
daedalus-parse examples/script.d --tree
```

## Semantic Model

The semantic model provides a structured representation of dialogs and functions:

### Model Structure

```typescript
interface SemanticModel {
  dialogs: { [name: string]: Dialog };
  functions: { [name: string]: DialogFunction };
}

class Dialog {
  name: string;
  parent: string | null;
  properties: {
    npc?: string;
    nr?: number;
    condition?: DialogFunction;
    information?: DialogFunction;
    permanent?: boolean;
    important?: boolean;
    description?: string;
    // ... other properties
  };
  actions: DialogAction[];
}

class DialogFunction {
  name: string;
  returnType: string;
  calls: string[];
  actions: DialogAction[];
}
```

### Supported Actions

The semantic model captures high-level dialog actions:

- **DialogLine** - `AI_Output(self, other, "ID");`
- **Choice** - `Info_AddChoice(dialog, "text", func);`
- **CreateTopic** - `Log_CreateTopic(TOPIC, LOG_TYPE);`
- **LogEntry** - `B_LogEntry(TOPIC, "text");`
- **LogSetTopicStatus** - `Log_SetTopicStatus(TOPIC, STATUS);`
- **CreateInventoryItems** - `CreateInvItems(npc, item, qty);`
- **GiveInventoryItems** - `B_GiveInvItems(giver, receiver, item, qty);`
- **AttackAction** - `B_Attack(attacker, target, reason, damage);`
- **SetAttitudeAction** - `B_SetAttitude(npc, attitude);`
- **ExchangeRoutineAction** - `Npc_ExchangeRoutine(npc, routine);`
- **ChapterTransitionAction** - `B_Kapitelwechsel(chapter, world);`
- **Action** (generic) - Any other function call

## Code Generation

Generate formatted Daedalus code from semantic models:

```typescript
import { SemanticCodeGenerator } from './src/semantic-visitor-index';

const generator = new SemanticCodeGenerator({
  indentSize: 1,           // Default: 1
  indentChar: '\t',        // Default: '\t' (can be ' ')
  includeComments: true,   // Default: true
  sectionHeaders: true,    // Default: true
  uppercaseKeywords: false // Default: false
});

const code = generator.generateSemanticModel(model);
```

### Generation Features

- ✅ **String-based** - Simple template generation, no AST manipulation
- ✅ **Formatting control** - Tabs/spaces, comments, section headers
- ✅ **Round-trip tested** - Parse → Generate → Parse produces identical model
- ✅ **Action support** - Generates all semantic action types
- ✅ **Preserves semantics** - Function bodies can be preserved or regenerated

See [SEMANTIC_CODE_GENERATOR.md](SEMANTIC_CODE_GENERATOR.md) for complete documentation.

## Supported Language Features

### Declarations
- ✅ Instance declarations: `instance Name (Parent) { ... }`
- ✅ Function declarations: `func type Name() { ... }`
- ✅ Variable declarations: `const/var type name = value;`
- ✅ Class declarations: `class Name { ... }`
- ✅ Prototype declarations: `prototype Name(Parent) { ... }`

### Expressions
- ✅ Binary expressions: `+`, `-`, `*`, `/`, `%`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`
- ✅ Unary expressions: `!`, `~`, `+`, `-`
- ✅ Array access: `array[index]`
- ✅ Member access: `object.member`
- ✅ Function calls: `function(arg1, arg2)`

### Statements
- ✅ Assignment statements: `variable = value;`
- ✅ If statements: `if (condition) { ... } else { ... }`
- ✅ Return statements: `return value;`
- ✅ Expression statements: `function_call();`

### Literals
- ✅ Numbers: `42`, `3.14`
- ✅ Strings: `"text"`, with escape sequences
- ✅ Booleans: `true`, `false` (case-insensitive)

### Comments
- ✅ Single-line: `// comment`
- ✅ Multi-line: `/* comment */`

### Case Sensitivity
- ✅ Keywords: Support for mixed case (`instance`/`INSTANCE`/`Instance`)
- ✅ Types: All basic types with case variations
- ✅ Booleans: `true`/`TRUE`/`True`, `false`/`FALSE`/`False`

## Examples

See the [examples/](examples/) directory:

- **[simple-api-demo.ts](examples/simple-api-demo.ts)** - Clean semantic model API
- **[code-generator-usage.ts](examples/code-generator-usage.ts)** - Code generation examples
- **Example .d files** - Real Gothic 2 dialog files for testing

### Example Dialog

```daedalus
instance DIA_Merchant_Trade(C_INFO)
{
    npc         = TownMerchant;
    nr          = 10;
    condition   = DIA_Merchant_Trade_Condition;
    information = DIA_Merchant_Trade_Info;
    permanent   = TRUE;
    description = "I want to trade";
};

func int DIA_Merchant_Trade_Condition()
{
    return Npc_KnowsInfo(other, DIA_Merchant_Greeting);
};

func void DIA_Merchant_Trade_Info()
{
    AI_Output(other, self, "TRADE_01"); //I want to trade
    AI_Output(self, other, "TRADE_02"); //What do you need?

    Info_ClearChoices(DIA_Merchant_Trade);
    Info_AddChoice(DIA_Merchant_Trade, "Buy weapons", DIA_Merchant_BuyWeapons);
    Info_AddChoice(DIA_Merchant_Trade, "Nothing", DIA_Merchant_TradeEnd);
};
```

## Performance

- **Parse Speed**: Sub-millisecond for typical dialog files
- **Throughput**: >10,000 bytes/ms
- **Memory**: Efficient native C implementation via Tree-sitter
- **Error Recovery**: Robust error handling and recovery

## Testing

```bash
npm test
```

Test coverage:
- ✅ 85 tests pass
- ✅ Semantic model parsing and generation
- ✅ Round-trip conversion (parse → generate → parse)
- ✅ All action types
- ✅ Formatting options
- ✅ Error handling

## Documentation

- **[SEMANTIC_CODE_GENERATOR.md](SEMANTIC_CODE_GENERATOR.md)** - Complete code generation API
- **[SEMANTIC_VISITOR_ARCHITECTURE.md](SEMANTIC_VISITOR_ARCHITECTURE.md)** - Visitor pattern architecture
- **[DIALOG_EDITOR_ARCHITECTURE.md](DIALOG_EDITOR_ARCHITECTURE.md)** - Planned Electron editor
- **[MIGRATION_CODE_GENERATOR.md](MIGRATION_CODE_GENERATOR.md)** - Migration from old API
- **[API.md](API.md)** - Low-level parser API reference

## Architecture

The parser follows a multi-stage architecture:

1. **Tree-sitter Parsing** - Fast native parsing to syntax tree
2. **Semantic Visitor** - Two-pass visitor builds semantic model
3. **Code Generation** - String-based template generation

This separation allows:
- Clean API for editor integration
- Easy semantic model manipulation
- Round-trip code generation
- Simple testing and debugging

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass: `npm test`
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## References

- [Daedalus EBNF Documentation](https://wiki.worldofgothic.de/doku.php?id=daedalus:ebnf)
- [Gothic Scripting Tutorial](https://wiki.worldofgothic.de/doku.php?id=quickstart:skripte)
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/)