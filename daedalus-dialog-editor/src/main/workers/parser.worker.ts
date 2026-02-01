import { parentPort } from 'worker_threads';
import Parser from 'tree-sitter';
import { SemanticModelBuilderVisitor } from 'daedalus-parser/semantic-visitor';

// @ts-ignore - CommonJS module
const DaedalusParser = require('daedalus-parser');
const Daedalus = DaedalusParser.DaedalusLanguage;

const parser = new Parser();
parser.setLanguage(Daedalus);

if (parentPort) {
  parentPort.on('message', (message: { id: string; sourceCode: string }) => {
    try {
      const { id, sourceCode } = message;

      // Perform parsing
      const tree = parser.parse(sourceCode);
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
      parentPort!.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : 'Unknown worker error'
      });
    }
  });
}
