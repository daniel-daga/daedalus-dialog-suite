// Example: Using the semantic code generator programmatically
// This demonstrates the intended usage pattern: SemanticModel -> Code

import { createDaedalusParser } from '../src/parser-utils';
import { SemanticModelBuilderVisitor } from '../src/semantic-visitor';
import { SemanticCodeGenerator } from '../src/semantic-code-generator';
import { Dialog, DialogFunction, SemanticModel } from '../src/semantic-model';

// ============================================================================
// Example 1: Generate code from a manually constructed semantic model
// ============================================================================

function example1_ManualModel() {
  console.log('=== Example 1: Manual Semantic Model ===\n');

  // Create a semantic model programmatically
  const model: SemanticModel = {
    dialogs: {},
    functions: {}
  };

  // Create a simple dialog
  const dialog = new Dialog('DIA_Test_Greeting', 'C_INFO');
  dialog.properties.npc = 'TEST_NPC';
  dialog.properties.nr = 1;
  dialog.properties.permanent = false;
  dialog.properties.description = 'Hello there!';

  // Create condition function
  const conditionFunc = new DialogFunction('DIA_Test_Greeting_Condition', 'int');
  dialog.properties.condition = conditionFunc;

  // Create information function
  const infoFunc = new DialogFunction('DIA_Test_Greeting_Info', 'void');
  dialog.properties.information = infoFunc;

  // Add to model
  model.dialogs[dialog.name] = dialog;
  model.functions[conditionFunc.name] = conditionFunc;
  model.functions[infoFunc.name] = infoFunc;

  // Generate code
  const generator = new SemanticCodeGenerator();
  const code = generator.generateSemanticModel(model);

  console.log(code);
}

// ============================================================================
// Example 2: Parse existing code, modify semantic model, regenerate
// ============================================================================

function example2_ParseModifyGenerate() {
  console.log('\n=== Example 2: Parse -> Modify -> Generate ===\n');

  const sourceCode = `
instance DIA_Merchant_Trade(C_INFO)
{
\tnpc\t= MER_123_Merchant;
\tnr\t= 10;
\tcondition\t= DIA_Merchant_Trade_Condition;
\tinformation\t= DIA_Merchant_Trade_Info;
\tpermanent\t= TRUE;
\tdescription\t= "Let's trade";
};

func int DIA_Merchant_Trade_Condition()
{
\treturn TRUE;
};

func void DIA_Merchant_Trade_Info()
{
\tAI_Output(self, other, "MER_TRADE_01");
};
`;

  // Parse the code
  const parser = createDaedalusParser();
  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  // Modify the semantic model
  const dialog = visitor.semanticModel.dialogs.DIA_Merchant_Trade;
  dialog.properties.description = '"Show me your wares"'; // Change description
  dialog.properties.nr = 5; // Change priority

  // Generate modified code
  const generator = new SemanticCodeGenerator();
  const modifiedCode = generator.generateSemanticModel(visitor.semanticModel);

  console.log('Modified code:');
  console.log(modifiedCode);
}

// ============================================================================
// Example 3: Generate code with custom options
// ============================================================================

function example3_CustomOptions() {
  console.log('\n=== Example 3: Custom Generator Options ===\n');

  // Create a simple model
  const model: SemanticModel = {
    dialogs: {},
    functions: {}
  };

  const dialog = new Dialog('DIA_Test_Exit', 'C_INFO');
  dialog.properties.npc = 'TEST_NPC';
  dialog.properties.nr = 999;
  dialog.properties.description = 'DIALOG_ENDE';

  const func = new DialogFunction('DIA_Test_Exit_Info', 'void');
  dialog.properties.information = func;

  model.dialogs[dialog.name] = dialog;
  model.functions[func.name] = func;

  // Generate with different options
  console.log('--- With spaces (4) and no comments ---');
  const gen1 = new SemanticCodeGenerator({
    indentChar: ' ',
    indentSize: 4,
    includeComments: false,
    sectionHeaders: false
  });
  console.log(gen1.generateSemanticModel(model));

  console.log('\n--- With uppercase keywords ---');
  const gen2 = new SemanticCodeGenerator({
    uppercaseKeywords: true,
    sectionHeaders: false
  });
  console.log(gen2.generateSemanticModel(model));
}

// ============================================================================
// Example 4: Generate individual components
// ============================================================================

function example4_IndividualComponents() {
  console.log('\n=== Example 4: Generate Individual Components ===\n');

  const generator = new SemanticCodeGenerator();

  // Generate just a dialog
  const dialog = new Dialog('DIA_Test_Individual', 'C_INFO');
  dialog.properties.npc = 'TEST_NPC';
  dialog.properties.nr = 42;
  dialog.properties.permanent = true;

  console.log('Generated dialog only:');
  console.log(generator.generateDialog(dialog));

  // Generate just a function
  const func = new DialogFunction('TestFunction', 'int');
  console.log('Generated function only:');
  console.log(generator.generateFunction(func));
}

// ============================================================================
// Run examples
// ============================================================================

if (require.main === module) {
  example1_ManualModel();
  example2_ParseModifyGenerate();
  example3_CustomOptions();
  example4_IndividualComponents();
}