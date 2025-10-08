# Semantic Visitor Architecture

This document defines the modular architecture for the Daedalus semantic visitor system.

## Overview

The semantic visitor analyzes Daedalus dialog scripts and builds a structured semantic model. The system is separated into focused modules with clear responsibilities.

## Module Structure

```
src/
├── semantic-model.ts          # Data model classes and types
├── action-parsers.ts          # Action parsing logic
├── semantic-visitor.ts        # Core visitor algorithm
├── semantic-visitor-index.ts  # Public API exports
└── visitor-example.ts         # Demo and testing
```

## Module Responsibilities

### 1. `semantic-model.ts` - Data Model
**Purpose**: Define all data classes, interfaces, and types for the semantic model.

**Contains**:
- `Dialog` class - Dialog instance representation
- `DialogFunction` class - Function representation with call tracking
- Action classes: `DialogLine`, `CreateTopic`, `LogEntry`, `LogSetTopicStatus`, `Action`
- Type definitions: `DialogAction`, `DialogProperties`, `SemanticModel`, `TreeSitterNode`

**Rules**:
- Only pure data classes with constructors
- No parsing or processing logic
- All public properties with clear types
- Exported types for external use

### 2. `action-parsers.ts` - Parsing Logic
**Purpose**: Handle parsing of different function call types into semantic actions.

**Contains**:
- `ActionParsers` class with static methods
- Parsers for: AI_Output, Log_CreateTopic, B_LogEntry, Log_SetTopicStatus, generic actions
- Utility methods: argument parsing, comment extraction

**Rules**:
- All methods are static (stateless parsing)
- Each parser method handles one function type
- Returns semantic model objects or null
- No visitor state or traversal logic

### 3. `semantic-visitor.ts` - Core Visitor
**Purpose**: Implement the two-pass AST traversal algorithm and orchestrate the semantic analysis.

**Contains**:
- `SemanticModelBuilderVisitor` class
- Two-pass algorithm: object creation, then linking/analysis
- Context tracking: current instance/function
- Dialog-function relationship mapping

**Rules**:
- Uses ActionParsers for all parsing operations
- Manages traversal state and context
- No parsing logic (delegates to ActionParsers)
- Clean separation between passes

### 4. `semantic-visitor-index.ts` - Public API
**Purpose**: Provide a single entry point for external consumers.

**Contains**:
- Re-exports from all modules
- Clean public API surface

**Rules**:
- Only re-exports, no implementation
- Single source of truth for public API
- Export everything that external consumers need

### 5. `visitor-example.ts` - Demo/Testing
**Purpose**: Demonstrate usage and provide test cases.

**Contains**:
- Example Daedalus source code
- Demo execution with output
- Helper functions (tree printing, JSON formatting)

**Rules**:
- Self-contained with test data
- Only runs when executed directly
- No core logic, only demonstration

## Design Principles

### Single Responsibility
Each module has one clear purpose:
- `semantic-model.ts`: Data definitions
- `action-parsers.ts`: Parsing logic
- `semantic-visitor.ts`: Traversal algorithm
- `semantic-visitor-index.ts`: API exports
- `visitor-example.ts`: Demonstration

### Clear Dependencies
```
semantic-visitor.ts → action-parsers.ts → semantic-model.ts
semantic-visitor-index.ts → all modules
visitor-example.ts → semantic-visitor-index.ts
```

### Separation of Concerns
- **Data model** is separate from **parsing logic**
- **Parsing logic** is separate from **traversal algorithm**
- **Core functionality** is separate from **examples/demos**
- **Implementation** is separate from **public API**

## Usage Patterns

### For Library Consumers
```typescript
import { SemanticModelBuilderVisitor, Dialog, DialogLine } from './semantic-visitor-index';
```

### For Internal Development
```typescript
// In semantic-visitor.ts
import { ActionParsers } from './action-parsers';
import { Dialog, DialogFunction } from './semantic-model';

// In action-parsers.ts
import { DialogLine, CreateTopic } from './semantic-model';
```

### For Testing/Examples
```typescript
// In visitor-example.ts
import { SemanticModelBuilderVisitor } from './semantic-visitor-index';
```

## Extension Guidelines

### Adding New Action Types
1. Add class definition to `semantic-model.ts`
2. Update `DialogAction` type union
3. Add parser method to `ActionParsers` class
4. Update switch statement in `parseSemanticAction`
5. Export new class from `semantic-visitor-index.ts`

### Adding New Features
1. Determine which module the feature belongs to
2. Follow the single responsibility principle
3. Update exports if needed for public API
4. Add examples to `visitor-example.ts`

## Maintenance Rules

1. **No logic in data models** - Keep classes pure
2. **No state in parsers** - Use static methods only
3. **No parsing in visitor** - Delegate to ActionParsers
4. **Clean imports** - Only import what you need
5. **Update exports** - Keep public API complete
6. **Follow this architecture** - Maintain separation of concerns