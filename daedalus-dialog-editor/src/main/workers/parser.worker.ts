import { parentPort } from 'worker_threads';
import { SemanticModelBuilderVisitor } from 'daedalus-parser/semantic-visitor';

// @ts-ignore - CommonJS module
const DaedalusParser = require('daedalus-parser');

// Use the parser instance from the library to ensure ABI compatibility
// between the Language object and the Parser implementation.
// This avoids "Invalid argument" errors caused by mismatched tree-sitter versions.
const daedalusWrapper = new DaedalusParser();

if (parentPort) {
  parentPort.on('message', (message: { id: string; sourceCode: string }) => {
    try {
      const { id, sourceCode } = message;

      if (typeof sourceCode !== 'string') {
        throw new Error(`Invalid sourceCode type: ${typeof sourceCode}`);
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
        parentPort!.postMessage({ id, result: visitor.semanticModel });
        return;
      }

      // Otherwise, proceed with semantic analysis
      visitor.pass1_createObjects(tree.rootNode as any);
      visitor.pass2_analyzeAndLink(tree.rootNode as any);

      // Return the semantic model
      parentPort!.postMessage({ id, result: visitor.semanticModel });
    } catch (error) {
      console.error('[Worker] Error during parsing:', error);
      parentPort!.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : 'Unknown worker error'
      });
    }
  });
}
