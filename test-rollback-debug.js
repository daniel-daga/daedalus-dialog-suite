const DaedalusParser = require('./src/parser');
const { ProductionASTSemanticDialogFactory } = require('./src/production-ast-semantic-dialog');

const parser = new DaedalusParser();

const source = `instance TestDialog (C_INFO)
{
    npc = TestNPC;
    description = "Original description";
};`;

console.log('=== ROLLBACK DEBUG TEST ===');

const parseResult = parser.parse(source, { includeSource: true });
const dialogs = ProductionASTSemanticDialogFactory.createFromParseResult(parseResult, parser);
const dialog = dialogs[0];

// Setup
console.log('1. Setup - set description to establish rollback point...');
dialog.setDescription('Rollback Point Description');
console.log('Description after setup:', dialog.description);

console.log('2. Begin transaction and change description...');
dialog.beginTransaction()
  .setDescription('Transaction Description', false);
console.log('Description in transaction:', dialog.description);

console.log('3. Check transaction source before rollback...');
console.log('Transaction source:', JSON.stringify(dialog.transaction.getSourceCode()));

console.log('4. Check committed source (should still be rollback point)...');
console.log('Committed source:', JSON.stringify(dialog.getSourceCode()));

console.log('5. Rolling back...');
// Let's add some debug to the rollback process
const originalResync = dialog._resyncFromSource;
dialog._resyncFromSource = function() {
  console.log('  _resyncFromSource called...');
  console.log('  Transaction source after rollback:', JSON.stringify(this.transaction.getSourceCode()));
  const result = originalResync.call(this);
  console.log('  Description after resync:', this.description);
  return result;
};

dialog.rollback();

console.log('6. After rollback:');
console.log('Description:', dialog.description);
console.log('Expected: "Rollback Point Description"');
console.log('Match:', dialog.description === 'Rollback Point Description');