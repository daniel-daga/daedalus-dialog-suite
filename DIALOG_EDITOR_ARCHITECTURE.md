# Daedalus Dialog Editor Architecture

## Overview

This document outlines the architecture for a visual dialog editor for the Daedalus scripting language used in Gothic 2 modding. The editor will provide a modern, user-friendly interface for creating and editing NPC dialogs, leveraging our semantic model infrastructure.

## Technology Stack

### Core Framework
- **Electron** - Desktop application framework
- **React 18** with TypeScript - Frontend framework with type safety
- **Node.js** - Backend runtime (main process)
- **Daedalus Parser** - Our semantic model-based parser library

### UI Components
- **Material-UI (MUI)** or **Ant Design** - Professional component library
- **Monaco Editor** - Advanced code editor with Daedalus syntax highlighting
- **React Flow** - Visual dialog flow editor for choice trees
- **React Router** - Navigation and routing

### State Management
- **Zustand** - Lightweight state management
- **React Query** - Server state management and caching

### Data Persistence
- **SQLite** (via better-sqlite3) - Local database for projects and cache
- **File System** - Direct manipulation of .d files as source of truth

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                    │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐ │
│  │ Semantic Parser │  │ Code Generator   │  │ IPC Bridge  │ │
│  │ (Visitor)       │  │                  │  │             │ │
│  └─────────────────┘  └──────────────────┘  └─────────────┘ │
│  ┌─────────────────┐  ┌──────────────────┐                  │
│  │ File Management │  │ Reference Index  │                  │
│  │                 │  │                  │                  │
│  └─────────────────┘  └──────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
                                │
                        IPC Communication
                                │
┌─────────────────────────────────────────────────────────────┐
│                   Electron Renderer Process                 │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    React Application                    │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │ │
│  │  │ File        │  │ Dialog      │  │ Visual Flow     │  │ │
│  │  │ Explorer    │  │ Properties  │  │ Editor          │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │ │
│  │  │ Action      │  │ Reference   │  │ Code Preview    │  │ │
│  │  │ Editor      │  │ Panel       │  │                 │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Data Models

### Semantic Model (Core)

The editor uses our existing semantic model as the primary data structure:

```typescript
// From daedalus-parser/src/semantic-model.ts
interface SemanticModel {
  dialogs: { [name: string]: Dialog };
  functions: { [name: string]: DialogFunction };
}

class Dialog {
  name: string;
  parent: string | null;
  properties: DialogProperties;
  actions: DialogAction[];
}

interface DialogProperties {
  npc?: string;
  nr?: number;
  condition?: DialogFunction;    // Direct object reference!
  information?: DialogFunction;  // Direct object reference!
  permanent?: boolean;
  important?: boolean;
  description?: string;
}

class DialogFunction {
  name: string;
  returnType: string;
  calls: string[];
  actions: DialogAction[];
}

// Action types (all supported):
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

**Key Benefits:**
- ✅ Direct object references (no string lookups needed)
- ✅ Type-safe with TypeScript
- ✅ All semantic information extracted
- ✅ Round-trip code generation works perfectly

### Project Structure

```typescript
interface EditorProject {
  id: string;
  name: string;
  rootPath: string;
  settings: ProjectSettings;
  lastOpened: Date;
  recentFiles: string[];

  // Cached semantic models for open files
  openFiles: Map<string, FileState>;
}

interface FileState {
  filePath: string;
  semanticModel: SemanticModel;
  isDirty: boolean;
  lastSaved: Date;
  originalCode?: string;  // For change detection
}

interface ProjectSettings {
  autoSave: boolean;
  syntaxValidation: boolean;
  codeGeneration: CodeGenerationSettings;
  indentSize: number;
}

interface CodeGenerationSettings {
  indentChar: '\t' | ' ';
  includeComments: boolean;
  sectionHeaders: boolean;
  uppercaseKeywords: boolean;
}
```

### UI State Models

```typescript
// Editor-specific view state
interface DialogEditorState {
  selectedDialog: string | null;
  selectedAction: number | null;
  viewMode: 'properties' | 'actions' | 'flow' | 'code';
  expandedSections: Set<string>;
}

// Visual flow representation
interface FlowNode {
  id: string;
  type: 'dialog' | 'line' | 'choice' | 'action';
  data: FlowNodeData;
  position: { x: number; y: number };
}

interface FlowNodeData {
  dialog?: Dialog;
  action?: DialogAction;
  label: string;
  icon?: string;
}
```

## Core Components

### 1. Main Process Services

#### Semantic Parser Service

```typescript
class SemanticParserService {
  private Parser = require('tree-sitter');
  private Daedalus = require('daedalus-parser/bindings/node');

  parseFile(filePath: string): SemanticModel {
    const sourceCode = fs.readFileSync(filePath, 'utf8');
    return this.parseSource(sourceCode);
  }

  parseSource(sourceCode: string): SemanticModel {
    const parser = new this.Parser();
    parser.setLanguage(this.Daedalus);
    const tree = parser.parse(sourceCode);

    const visitor = new SemanticModelBuilderVisitor();
    visitor.pass1_createObjects(tree.rootNode);
    visitor.pass2_analyzeAndLink(tree.rootNode);

    return visitor.semanticModel;
  }

  validateSyntax(sourceCode: string): ValidationResult {
    const tree = this.parser.parse(sourceCode);
    return {
      isValid: !tree.rootNode.hasError,
      errors: this.extractErrors(tree.rootNode)
    };
  }
}
```

#### Code Generator Service

```typescript
class CodeGeneratorService {
  private generator: SemanticCodeGenerator;

  constructor(settings: CodeGenerationSettings) {
    this.generator = new SemanticCodeGenerator({
      indentChar: settings.indentChar,
      indentSize: 1,
      includeComments: settings.includeComments,
      sectionHeaders: settings.sectionHeaders,
      uppercaseKeywords: settings.uppercaseKeywords
    });
  }

  generate(model: SemanticModel): string {
    return this.generator.generateSemanticModel(model);
  }

  generateDialog(dialog: Dialog): string {
    return this.generator.generateDialog(dialog);
  }

  generateFunction(func: DialogFunction): string {
    return this.generator.generateFunction(func);
  }
}
```

### 2. Renderer Components

#### Dialog Properties Editor

```typescript
interface DialogPropertiesEditorProps {
  dialog: Dialog;
  onUpdate: (dialog: Dialog) => void;
  npcSuggestions: string[];
  functionSuggestions: DialogFunction[];
}

const DialogPropertiesEditor: React.FC<DialogPropertiesEditorProps> = ({
  dialog,
  onUpdate,
  npcSuggestions,
  functionSuggestions
}) => {
  const handlePropertyChange = (key: string, value: any) => {
    const updated = { ...dialog };
    updated.properties[key] = value;
    onUpdate(updated);
  };

  return (
    <Form>
      <TextField label="Name" value={dialog.name} disabled />
      <Autocomplete
        label="NPC"
        value={dialog.properties.npc}
        options={npcSuggestions}
        onChange={(npc) => handlePropertyChange('npc', npc)}
      />
      <NumberField
        label="Priority (nr)"
        value={dialog.properties.nr}
        onChange={(nr) => handlePropertyChange('nr', nr)}
      />
      <Autocomplete
        label="Condition Function"
        value={dialog.properties.condition?.name}
        options={functionSuggestions.filter(f => f.returnType === 'int')}
        onChange={(func) => handlePropertyChange('condition', func)}
      />
      <Autocomplete
        label="Information Function"
        value={dialog.properties.information?.name}
        options={functionSuggestions.filter(f => f.returnType === 'void')}
        onChange={(func) => handlePropertyChange('information', func)}
      />
      <Checkbox
        label="Permanent"
        checked={dialog.properties.permanent}
        onChange={(perm) => handlePropertyChange('permanent', perm)}
      />
      <TextField
        label="Description"
        value={dialog.properties.description}
        onChange={(desc) => handlePropertyChange('description', desc)}
      />
    </Form>
  );
};
```

#### Action List Editor

```typescript
interface ActionListEditorProps {
  func: DialogFunction;
  onUpdate: (func: DialogFunction) => void;
}

const ActionListEditor: React.FC<ActionListEditorProps> = ({
  func,
  onUpdate
}) => {
  const handleAddAction = (actionType: string) => {
    const updated = { ...func };
    const newAction = createDefaultAction(actionType);
    updated.actions.push(newAction);
    onUpdate(updated);
  };

  const handleUpdateAction = (index: number, action: DialogAction) => {
    const updated = { ...func };
    updated.actions[index] = action;
    onUpdate(updated);
  };

  const handleDeleteAction = (index: number) => {
    const updated = { ...func };
    updated.actions.splice(index, 1);
    onUpdate(updated);
  };

  return (
    <div>
      <ActionTypeSelector onSelect={handleAddAction} />
      <DragDropContext onDragEnd={handleReorder}>
        <Droppable droppableId="actions">
          {(provided) => (
            <div {...provided.droppableProps} ref={provided.innerRef}>
              {func.actions.map((action, index) => (
                <Draggable key={index} draggableId={`action-${index}`} index={index}>
                  {(provided) => (
                    <ActionCard
                      action={action}
                      onUpdate={(a) => handleUpdateAction(index, a)}
                      onDelete={() => handleDeleteAction(index)}
                      innerRef={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                    />
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
};
```

#### Action Card (Type-Specific)

```typescript
const ActionCard: React.FC<{ action: DialogAction, onUpdate, onDelete }> = ({
  action,
  onUpdate,
  onDelete
}) => {
  if (action instanceof DialogLine) {
    return (
      <Card>
        <CardHeader title="Dialog Line" action={<DeleteButton onClick={onDelete} />} />
        <CardContent>
          <Select label="Speaker" value={action.speaker} onChange={...} />
          <TextField label="Text" value={action.text} onChange={...} />
          <TextField label="Dialog ID" value={action.id} onChange={...} />
        </CardContent>
      </Card>
    );
  }

  if (action instanceof Choice) {
    return (
      <Card>
        <CardHeader title="Choice" action={<DeleteButton onClick={onDelete} />} />
        <CardContent>
          <TextField label="Text" value={action.text} onChange={...} />
          <Autocomplete label="Target Function" value={action.targetFunction} ... />
        </CardContent>
      </Card>
    );
  }

  // ... similar for other action types
};
```

#### Visual Flow Editor

```typescript
const VisualFlowEditor: React.FC<{ dialog: Dialog, model: SemanticModel }> = ({
  dialog,
  model
}) => {
  const nodes = useMemo(() => buildFlowNodes(dialog, model), [dialog, model]);
  const edges = useMemo(() => buildFlowEdges(dialog, model), [dialog, model]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={customNodeTypes}
      fitView
    >
      <Background />
      <Controls />
      <MiniMap />
    </ReactFlow>
  );
};

function buildFlowNodes(dialog: Dialog, model: SemanticModel): FlowNode[] {
  const nodes: FlowNode[] = [];

  // Dialog node
  nodes.push({
    id: dialog.name,
    type: 'dialog',
    data: { label: dialog.properties.description || dialog.name },
    position: { x: 250, y: 0 }
  });

  // Information function actions
  const infoFunc = dialog.properties.information;
  if (infoFunc && infoFunc.actions) {
    infoFunc.actions.forEach((action, index) => {
      nodes.push({
        id: `${dialog.name}-action-${index}`,
        type: getActionNodeType(action),
        data: { action, label: getActionLabel(action) },
        position: { x: 250, y: 100 + index * 80 }
      });

      // If it's a choice, add nodes for choice branches
      if (action instanceof Choice) {
        const targetFunc = model.functions[action.targetFunction];
        if (targetFunc) {
          // Add target function node
          nodes.push({
            id: action.targetFunction,
            type: 'function',
            data: { label: action.text },
            position: { x: 450, y: 100 + index * 80 }
          });
        }
      }
    });
  }

  return nodes;
}
```

### 3. Code Preview Component

```typescript
const CodePreview: React.FC<{ model: SemanticModel, settings: CodeGenerationSettings }> = ({
  model,
  settings
}) => {
  const [code, setCode] = useState('');

  useEffect(() => {
    const generator = new SemanticCodeGenerator({
      indentChar: settings.indentChar,
      includeComments: settings.includeComments,
      sectionHeaders: settings.sectionHeaders,
      uppercaseKeywords: settings.uppercaseKeywords
    });

    const generated = generator.generateSemanticModel(model);
    setCode(generated);
  }, [model, settings]);

  return (
    <MonacoEditor
      language="daedalus"
      value={code}
      options={{ readOnly: true, minimap: { enabled: false } }}
      height="100%"
    />
  );
};
```

## IPC Communication Layer

### Main Process Handlers

```typescript
// Parse file to semantic model
ipcMain.handle('parser:parseFile', async (event, filePath: string) => {
  return parserService.parseFile(filePath);
});

// Generate code from semantic model
ipcMain.handle('generator:generate', async (event, model: SemanticModel, settings: CodeGenerationSettings) => {
  const generator = new CodeGeneratorService(settings);
  return generator.generate(model);
});

// Save file
ipcMain.handle('file:save', async (event, filePath: string, model: SemanticModel, settings: CodeGenerationSettings) => {
  const generator = new CodeGeneratorService(settings);
  const code = generator.generate(model);
  fs.writeFileSync(filePath, code, 'utf8');
  return { success: true };
});

// Validate syntax
ipcMain.handle('parser:validate', async (event, sourceCode: string) => {
  return parserService.validateSyntax(sourceCode);
});

// Build reference index
ipcMain.handle('references:buildIndex', async (event, projectPath: string) => {
  return referenceService.indexProject(projectPath);
});
```

### Renderer API

```typescript
export class EditorAPI {
  async parseFile(filePath: string): Promise<SemanticModel> {
    return ipcRenderer.invoke('parser:parseFile', filePath);
  }

  async generateCode(model: SemanticModel, settings: CodeGenerationSettings): Promise<string> {
    return ipcRenderer.invoke('generator:generate', model, settings);
  }

  async saveFile(filePath: string, model: SemanticModel, settings: CodeGenerationSettings): Promise<{ success: boolean }> {
    return ipcRenderer.invoke('file:save', filePath, model, settings);
  }

  async validateSyntax(sourceCode: string): Promise<ValidationResult> {
    return ipcRenderer.invoke('parser:validate', sourceCode);
  }
}
```

## Data Flow

### Opening a File

```
1. User selects file
2. Main: Read file → Parse to SemanticModel
3. Main → Renderer: Send SemanticModel via IPC
4. Renderer: Store in Zustand state
5. Renderer: Display in UI (properties, actions, flow)
```

### Editing a Dialog

```
1. User modifies property in UI
2. Renderer: Update SemanticModel in state
3. Renderer: Mark file as dirty
4. Renderer: Regenerate code preview
5. (Auto-save): Renderer → Main: Save request
6. Main: Generate code → Write file
```

### Adding an Action

```
1. User clicks "Add Action" → Selects type (DialogLine)
2. Renderer: Create new DialogLine instance
3. Renderer: Add to DialogFunction.actions array
4. Renderer: Update state
5. UI re-renders with new action card
6. Code preview updates automatically
```

## State Management

### Zustand Store

```typescript
interface EditorStore {
  // Current project
  project: EditorProject | null;

  // Open files (keyed by path)
  openFiles: Map<string, FileState>;

  // Current active file
  activeFile: string | null;

  // UI state
  selectedDialog: string | null;
  selectedAction: number | null;

  // Actions
  openFile: (filePath: string) => Promise<void>;
  closeFile: (filePath: string) => void;
  updateDialog: (filePath: string, dialogName: string, dialog: Dialog) => void;
  updateFunction: (filePath: string, funcName: string, func: DialogFunction) => void;
  saveFile: (filePath: string) => Promise<void>;
  generateCode: (filePath: string) => Promise<string>;
}

const useEditorStore = create<EditorStore>((set, get) => ({
  project: null,
  openFiles: new Map(),
  activeFile: null,
  selectedDialog: null,
  selectedAction: null,

  openFile: async (filePath) => {
    const model = await editorAPI.parseFile(filePath);
    const fileState: FileState = {
      filePath,
      semanticModel: model,
      isDirty: false,
      lastSaved: new Date()
    };

    set((state) => {
      state.openFiles.set(filePath, fileState);
      return { openFiles: state.openFiles, activeFile: filePath };
    });
  },

  updateDialog: (filePath, dialogName, dialog) => {
    set((state) => {
      const fileState = state.openFiles.get(filePath);
      if (fileState) {
        fileState.semanticModel.dialogs[dialogName] = dialog;
        fileState.isDirty = true;
        state.openFiles.set(filePath, fileState);
      }
      return { openFiles: state.openFiles };
    });
  },

  // ... similar for other actions
}));
```

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
- [x] Semantic parser implemented ✅
- [x] Code generator implemented ✅
- [ ] Electron + React TypeScript setup
- [ ] IPC bridge for parser and generator
- [ ] Basic file operations

### Phase 2: Core Editor (Weeks 3-4)
- [ ] File explorer component
- [ ] Dialog list view
- [ ] Dialog properties editor
- [ ] Basic action editor (list view)
- [ ] Code preview panel

### Phase 3: Advanced Editing (Weeks 5-6)
- [ ] Type-specific action cards
- [ ] Drag-and-drop action reordering
- [ ] Visual flow editor (React Flow)
- [ ] Function editor with action list
- [ ] Auto-complete for NPCs and functions

### Phase 4: Polish & Features (Weeks 7-8)
- [ ] Reference indexing system
- [ ] Search and navigation
- [ ] Project management
- [ ] Settings and preferences
- [ ] Export/import functionality

## Key Advantages of Semantic Model Approach

✅ **Type Safety** - Full TypeScript support with semantic model classes
✅ **Direct References** - No string lookups, dialog.properties.condition is the actual function object
✅ **Round-Trip** - Parse → Modify → Generate → Parse preserves semantics perfectly
✅ **Extensible** - Easy to add new action types by extending DialogAction
✅ **Tested** - 72 passing tests covering all functionality
✅ **Simple** - No complex AST manipulation, just modify objects
✅ **Flexible** - Can preserve or regenerate function bodies as needed

## Repository Structure

Located in parent directory:

```
gothic-modding-suite/
├── daedalus-parser/              # Parser library (current)
│   ├── src/
│   │   ├── semantic-model.ts
│   │   ├── semantic-visitor.ts
│   │   ├── semantic-code-generator.ts
│   │   └── action-parsers.ts
│   └── test/
└── daedalus-dialog-editor/      # Editor application (to be created)
    ├── src/
    │   ├── main/                # Electron main process
    │   └── renderer/            # React application
    ├── package.json
    └── README.md
```

### Package Integration

```json
{
  "name": "daedalus-dialog-editor",
  "dependencies": {
    "daedalus-parser": "file:../daedalus-parser",
    "electron": "^latest",
    "react": "^18.0.0",
    "@mui/material": "^5.0.0",
    "reactflow": "^11.0.0",
    "zustand": "^4.0.0"
  }
}
```

## Future Enhancements

### Dialog Testing
- Simulate dialog flow
- Test condition logic
- Preview player choices

### Localization
- Multi-language support
- Translation management
- Subtitle export

### Advanced Actions
- Custom action types
- Macro/template system
- Script snippets

### Quest Integration
- Quest objective tracking
- NPC relationship mapping
- World state visualization

This architecture leverages our robust semantic model infrastructure to provide a clean, type-safe foundation for the dialog editor with straightforward data flow and excellent round-trip code generation.