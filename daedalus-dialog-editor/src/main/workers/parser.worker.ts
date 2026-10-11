import { SemanticModelBuilderVisitor } from 'daedalus-parser/semantic-visitor';
import { extractNpcDefinition, applyNpcEdits, type NpcEdit } from 'daedalus-parser/npc-definition';

import DaedalusParser from 'daedalus-parser';

// Use the parser instance from the library to ensure ABI compatibility
// between the Language object and the Parser implementation.
// This avoids "Invalid argument" errors caused by mismatched tree-sitter versions.
const daedalusWrapper = new DaedalusParser();

// This runs as a forked child process, not a worker thread: a SIGSEGV inside
// tree-sitter must not be able to reach the Electron main process. See
// `ForkedWorker`.
const send = process.send?.bind(process);

export interface ParserRequest {
  id: string;
  sourceCode: string;
  /** Absent for a plain parse. The NPC reader and writer parse too, so they
   *  run here for the same reason (docs/plans/npc-editor.md, Phase 2). */
  npc?: 'extract' | 'apply';
  edits?: NpcEdit[];
}

/** The answer to one request; throws to report an error. */
export function handleParserRequest(message: ParserRequest): unknown {
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

  // Return the semantic model
  return visitor.semanticModel;
}

if (send) {
  process.on('message', (message: ParserRequest) => {
    try {
      send({ id: message.id, result: handleParserRequest(message) });
    } catch (error) {
      console.error('[Worker] Error during parsing:', error);
      send({
        id: message.id,
        error: error instanceof Error ? error.message : 'Unknown worker error'
      });
    }
  });
}
