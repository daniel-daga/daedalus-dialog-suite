const DaedalusParser = require('./src/parser');
const { ProductionASTSemanticDialogFactory } = require('./src/production-ast-semantic-dialog');

const parser = new DaedalusParser();

const source = `instance TestDialog (C_INFO)
{
    npc = TestNPC;
    description = "Original description";
};`;

console.log('=== ROLLBACK WITH CORRUPTION TEST ===');

const parseResult = parser.parse(source, { includeSource: true });
const dialogs = ProductionASTSemanticDialogFactory.createFromParseResult(parseResult, parser);
const dialog = dialogs[0];

// Replicate the exact test sequence
console.log('1. Setup - setDescription (like previous test)...');
dialog.setDescription('New description');

console.log('2. Setup - batch updateProperties (this causes corruption)...');
dialog.beginTransaction()
  .updateProperties({
    description: 'Batch updated description',
    permanent: true,
    important: false
  }, false)
  .commit();

console.log('Description after batch:', dialog.description);
console.log('Source after batch:', JSON.stringify(dialog.getSourceCode()));

// Now the actual test
console.log('3. Begin transaction for rollback test...');
const originalDescription = dialog.description;
console.log('Original description saved:', originalDescription);

dialog.beginTransaction()
  .setDescription('This will be rolled back', false);
console.log('Description in transaction:', dialog.description);
console.log('Transaction start source:', JSON.stringify(dialog.transaction.transactionStartSourceCode));

console.log('4. Rolling back...');
const originalResync = dialog._resyncFromSource;
dialog._resyncFromSource = function() {
  console.log('  _resyncFromSource called...');
  console.log('  Transaction source after rollback:', JSON.stringify(this.transaction.getSourceCode()));
  const result = originalResync.call(this);
  console.log('  Description after resync:', this.description);
  return result;
};

dialog.rollback();

console.log('5. After rollback:');
console.log('Description:', dialog.description);
console.log('Expected:', originalDescription);
console.log('Match:', dialog.description === originalDescription);

if (dialog.description === originalDescription) {
  console.log('\n✅ ROLLBACK WITH CORRUPTION TEST PASSED');
} else {
  console.log('\n❌ ROLLBACK WITH CORRUPTION TEST FAILED');
}