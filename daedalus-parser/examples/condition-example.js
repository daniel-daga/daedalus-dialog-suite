// Example demonstrating condition parsing in Daedalus dialogs

const DaedalusParser = require('daedalus-parser');
const { SemanticModelBuilderVisitor } = require('daedalus-parser/semantic-visitor');
const { SemanticCodeGenerator } = require('daedalus-parser/semantic-code-generator');
const { NpcKnowsInfoCondition } = require('daedalus-parser/semantic-model');

// Example dialog with Npc_KnowsInfo condition
const exampleDialog = `
instance DIA_Merchant_SpecialOffer(C_INFO)
{
	npc			= VLK_123_Merchant;
	nr			= 10;
	condition	= DIA_Merchant_SpecialOffer_Condition;
	information	= DIA_Merchant_SpecialOffer_Info;
	permanent	= FALSE;
	description = "Do you have any special offers?";
};

func int DIA_Merchant_SpecialOffer_Condition()
{
	if (Npc_KnowsInfo(other, DIA_Merchant_Hello))
	{
		return TRUE;
	};
};

func void DIA_Merchant_SpecialOffer_Info()
{
	AI_Output(self, other, "MERCHANT_SPECIAL_01"); //Yes, today I have a great deal for you!
	AI_Output(other, self, "MERCHANT_SPECIAL_02"); //Tell me more.
};
`;

console.log('=== Daedalus Dialog Condition Parsing Example ===\n');

// Parse the dialog
const parser = DaedalusParser.create();
const tree = parser.parse(exampleDialog);

// Build semantic model
console.log('Building semantic model...\n');
const visitor = new SemanticModelBuilderVisitor();
visitor.pass1_createObjects(tree.rootNode);
visitor.pass2_analyzeAndLink(tree.rootNode);

// Access the dialog and its conditions
const dialog = visitor.semanticModel.dialogs['DIA_Merchant_SpecialOffer'];
console.log('Dialog:', dialog.name);
console.log('Description:', dialog.properties.description);
console.log('Permanent:', dialog.properties.permanent);
console.log('\nConditions found:', dialog.properties.condition.conditions.length);

if (dialog.properties.condition.conditions.length > 0) {
  console.log('\nCondition details:');
  dialog.properties.condition.conditions.forEach((condition, index) => {
    console.log(`  ${index + 1}. Type: ${condition.getTypeName()}`);
    console.log(`     Display: ${condition.toDisplayString()}`);

    if (condition instanceof NpcKnowsInfoCondition) {
      console.log(`     NPC: ${condition.npc}`);
      console.log(`     Dialog Reference: ${condition.dialogRef}`);
      console.log(`     Code: ${condition.generateCode({})}`);
    }
  });
}

// Demonstrate programmatic condition addition
console.log('\n=== Adding a new condition programmatically ===\n');

// Create a new condition: player must also know another dialog
const newCondition = new NpcKnowsInfoCondition('other', 'DIA_Merchant_FirstVisit');
dialog.properties.condition.conditions.push(newCondition);

console.log('Added condition:', newCondition.toDisplayString());
console.log('Total conditions now:', dialog.properties.condition.conditions.length);

// Generate code with the new condition
console.log('\n=== Generated Code ===\n');
const generator = new SemanticCodeGenerator({
  indentSize: 1,
  indentChar: '\t',
  includeComments: true,
  sectionHeaders: true
});

const generatedCode = generator.generateSemanticModel(visitor.semanticModel);
console.log(generatedCode);

console.log('\n=== Round-trip Verification ===\n');

// Parse the generated code
const tree2 = parser.parse(generatedCode);
const visitor2 = new SemanticModelBuilderVisitor();
visitor2.pass1_createObjects(tree2.rootNode);
visitor2.pass2_analyzeAndLink(tree2.rootNode);

const dialog2 = visitor2.semanticModel.dialogs['DIA_Merchant_SpecialOffer'];
console.log('Round-trip successful!');
console.log('Conditions preserved:', dialog2.properties.condition.conditions.length);
console.log('First condition:', dialog2.properties.condition.conditions[0].toDisplayString());
console.log('Second condition:', dialog2.properties.condition.conditions[1].toDisplayString());
