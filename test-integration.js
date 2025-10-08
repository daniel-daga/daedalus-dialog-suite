const DaedalusParser = require('./src/parser');

const parser = new DaedalusParser();

// Test data
const simpleDialogData = {
  dialogs: [{
    name: 'TestDialog',
    npc: 'TestNPC',
    description: 'A test dialog',
    condition: 'TestDialog_Condition',
    information: 'TestDialog_Info'
  }],
  functions: [{
    name: 'TestDialog_Condition',
    returnType: 'int',
    body: 'return TRUE;'
  }]
};

console.log('Testing new generateDaedalusSimple method...');

try {
  const result = parser.generateDaedalusSimple(simpleDialogData);
  console.log('✅ Success! Generated:');
  console.log('---');
  console.log(result);
  console.log('---');
  console.log('Contains expected elements:');
  console.log('- TestDialog instance:', result.includes('instance TestDialog (C_INFO)'));
  console.log('- NPC assignment:', result.includes('npc = TestNPC'));
  console.log('- Description:', result.includes('"A test dialog"'));
} catch (error) {
  console.error('❌ Error:', error.message);
}

console.log('\nTesting original generateDaedalus still works...');
try {
  const result2 = parser.generateDaedalus(simpleDialogData);
  console.log('✅ Original method works too! Length:', result2.length);
} catch (error) {
  console.error('❌ Error:', error.message);
}