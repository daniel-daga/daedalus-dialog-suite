const DaedalusParser = require('./src/parser');
const { ProductionASTSemanticDialogFactory } = require('./src/production-ast-semantic-dialog');

const parser = new DaedalusParser();

const source = `instance TestDialog (C_INFO)
{
    npc = TestNPC;
    description = "Original description";
};`;

console.log('=== SPECIFIC ROLLBACK TEST ===');

// Start fresh for each test like the real test suite does
const parseResult = parser.parse(source, { includeSource: true });
const dialogs = ProductionASTSemanticDialogFactory.createFromParseResult(parseResult, parser);
const dialog = dialogs[0];

// First do the setup that would happen in previous tests
console.log('1. Setup - setDescription to simulate test sequence...');
dialog.setDescription('New description');

console.log('2. Setup - batch updateProperties...');
dialog.beginTransaction()
  .updateProperties({
    description: 'Batch updated description',
    permanent: true,
    important: false
  }, false)
  .commit();

console.log('3. Now test rollback functionality...');
const originalDescription = dialog.description;
console.log('Original description before rollback test:', originalDescription);

// This is the actual test
console.log('4. Begin transaction and set description...');
dialog.beginTransaction()
  .setDescription('This will be rolled back', false);

// Before commit, description should be updated in memory
console.log('In transaction - description should be "This will be rolled back":', dialog.description);
console.log('Match:', dialog.description === 'This will be rolled back');

// Rollback
console.log('5. Rolling back...');
dialog.rollback();

// Should return to previous state
console.log('6. After rollback - description should match original:', dialog.description);
console.log('Expected:', originalDescription);
console.log('Actual:', dialog.description);
console.log('Match:', dialog.description === originalDescription);

if (dialog.description === originalDescription) {
  console.log('\n✅ ROLLBACK TEST PASSED');
} else {
  console.log('\n❌ ROLLBACK TEST FAILED');
  console.log('Expected:', JSON.stringify(originalDescription));
  console.log('Actual:', JSON.stringify(dialog.description));
}