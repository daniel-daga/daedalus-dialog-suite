import { SemanticModelBuilderVisitor } from 'daedalus-parser/semantic-visitor';
import type { SemanticModel } from 'daedalus-parser/semantic-model';
import { extractNpcDefinition, applyNpcEdits, type NpcEdit } from 'daedalus-parser/npc-definition';

import DaedalusParser from 'daedalus-parser';
import { CodeGeneratorService } from '../services/CodeGeneratorService';
import { ValidationService } from '../services/ValidationService';
import type {
  CodeGenerationSettings,
  ParseError,
  SemanticModel as WireModel,
  ValidationOptions,
} from '../../shared/types';

// Use the parser instance from the library to ensure ABI compatibility
// between the Language object and the Parser implementation.
// This avoids "Invalid argument" errors caused by mismatched tree-sitter versions.
const daedalusWrapper = new DaedalusParser();

// This runs as a forked child process, not a worker thread: a SIGSEGV inside
// tree-sitter must not be able to reach the Electron main process. See
// `ForkedWorker`.
const send = process.send?.bind(process);

/** A parse, or the NPC reader and writer, which parse too and so run here
 *  for the same reason (docs/plans/npc-editor.md, Phase 2). */
export interface SourceRequest {
  id: string;
  sourceCode: string;
  /** Absent for a plain parse. */
  npc?: 'extract' | 'apply';
  edits?: NpcEdit[];
  op?: undefined;
}

/**
 * Validate and generate (#546). They used to run on Electron's main thread —
 * about 0.6 s frozen for a 15,000-constant file — and only the parse-back of
 * the generated text came here. Running all of it here means the model
 * crosses once and the parse-back's model never crosses at all.
 */
export type CodegenRequest =
  | { id: string; op: 'validate'; model: WireModel; settings: CodeGenerationSettings; options?: ValidationOptions }
  | { id: string; op: 'generate'; model: WireModel; settings: CodeGenerationSettings; allowPartialModel?: boolean }
  | { id: string; op: 'generateDialog'; model: WireModel; dialogName: string; settings: CodeGenerationSettings }
  | { id: string; op: 'generateChecked'; model: WireModel; settings: CodeGenerationSettings; allowPartialModel?: boolean };

export type ParserRequest = SourceRequest | CodegenRequest;

/** `generateChecked`'s answer: the code and the parse-back's verdict, not its model. */
export interface CheckedCode {
  code: string;
  hasErrors: boolean;
  errors: ParseError[];
}

/** A model as it crosses this worker's IPC: the forked channel uses the V8
 *  structured-clone serializer, which ignores `toJSON`, so the plain form is
 *  what makes `Dialog.toJSON` the single owner of a dialog's body (#443). */
const plainModel = (model: SemanticModel): SemanticModel => JSON.parse(JSON.stringify(model));

/** Parse to the parser's own model, in this process. */
function parseModel(sourceCode: string): SemanticModel {
  // Perform parsing using the wrapper's high-level parse method
  // This ensures that options like bufferSize are correctly applied for large files
  const parseResult = daedalusWrapper.parse(sourceCode);
  const tree = parseResult.tree;
  const visitor = new SemanticModelBuilderVisitor();

  // Check for syntax errors first
  visitor.checkForSyntaxErrors(tree.rootNode as any, sourceCode);

  // If there are syntax errors, return the model with errors immediately
  if (visitor.semanticModel.hasErrors) {
    return visitor.semanticModel;
  }

  // Otherwise, proceed with semantic analysis
  visitor.pass1_createObjects(tree.rootNode as any);
  visitor.pass2_analyzeAndLink(tree.rootNode as any);

  return visitor.semanticModel;
}

const codeGenerator = new CodeGeneratorService();
// The parse-back reads only `hasErrors` and `errors`, so it takes the model
// as built, without the wire's JSON round trip.
const validator = new ValidationService(
  { parseSource: async (code: string) => parseModel(code) },
  codeGenerator,
);

function handleCodegenRequest(message: CodegenRequest): unknown {
  switch (message.op) {
    case 'validate':
      return validator.validate(message.model, message.settings, message.options ?? {});
    case 'generate':
      return codeGenerator.generateCode(message.model, message.settings, {
        allowPartialModel: message.allowPartialModel === true,
      });
    case 'generateDialog':
      return codeGenerator.generateDialogCode(message.model, message.dialogName, message.settings);
    case 'generateChecked': {
      const code = codeGenerator.generateCode(message.model, message.settings, {
        allowPartialModel: message.allowPartialModel === true,
      });
      const back = parseModel(code);
      const checked: CheckedCode = {
        code,
        hasErrors: back.hasErrors === true,
        errors: (back.errors ?? []).map((e: { message?: string; position?: ParseError['position']; type?: string }) => ({
          type: e.type ?? 'syntax_error',
          message: e.message ?? 'Syntax error',
          ...(e.position ? { position: e.position } : {}),
        })) as ParseError[],
      };
      return checked;
    }
    default:
      throw new Error(`Unknown parser worker op: ${String((message as { op?: unknown }).op)}`);
  }
}

/** The answer to one request — a promise for `validate`; throws to report an error. */
export function handleParserRequest(message: ParserRequest): unknown {
  if (message.op !== undefined) {
    return handleCodegenRequest(message);
  }

  const { sourceCode } = message;

  if (typeof sourceCode !== 'string') {
    throw new Error(`Invalid sourceCode type: ${typeof sourceCode}`);
  }

  if (message.npc === 'extract') {
    return extractNpcDefinition(sourceCode);
  }
  if (message.npc === 'apply') {
    return applyNpcEdits(sourceCode, message.edits ?? []);
  }

  return plainModel(parseModel(sourceCode));
}

if (send) {
  process.on('message', (message: ParserRequest) => {
    // One request per worker at a time (ParserService dispatches to idle
    // workers only), so awaiting `validate` here cannot interleave answers.
    Promise.resolve()
      .then(() => handleParserRequest(message))
      .then(
        (result) => send({ id: message.id, result }),
        (error: unknown) => {
          console.error('[Worker] Error during request:', error);
          send({
            id: message.id,
            error: error instanceof Error ? error.message : 'Unknown worker error'
          });
        },
      );
  });
}
