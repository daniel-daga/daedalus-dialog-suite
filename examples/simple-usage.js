/**
 * Simple Usage Example for Daedalus Parser Library
 *
 * This example demonstrates the basic functionality of the library
 * for quick integration into your editor UI project.
 */

const DaedalusParser = require('daedalus-parser');

// Example: Basic Dialog Editor Functionality
async function demonstrateLibraryUsage() {
  console.log('🚀 Daedalus Parser Library Demo\n');

  // 1. Create parser instance
  const parser = new DaedalusParser();

  // 2. Sample dialog code (you would load this from your editor)
  const sampleDialogCode = `
// Sample dialog for demonstration
instance DIA_Demo_Hello (C_INFO)
{
    npc         = Demo_NPC;
    nr          = 1;
    condition   = DIA_Demo_Hello_Condition;
    information = DIA_Demo_Hello_Info;
    permanent   = FALSE;
    description = "Hello, can you help me?";
};

func int DIA_Demo_Hello_Condition()
{
    if (Npc_GetDistToNpc(self, other) < 500)
    {
        return TRUE;
    };
    return FALSE;
};

func void DIA_Demo_Hello_Info()
{
    AI_Output(other, self, "DIA_Demo_Hello_01");  // Hello, can you help me?
    AI_Output(self, other, "DIA_Demo_Hello_02");  // Sure, what do you need?

    // Add some choices
    Info_ClearChoices(DIA_Demo_Hello);
    Info_AddChoice(DIA_Demo_Hello, "I need directions", DIA_Demo_Directions);
    Info_AddChoice(DIA_Demo_Hello, "Never mind", DIA_Demo_Goodbye);
};
`;

  try {
    // 3. Parse the dialog code
    console.log('📖 Parsing dialog code...');
    const dialogData = parser.parseDialogSource(sampleDialogCode);

    console.log(`✅ Successfully parsed ${dialogData.metadata.totalDialogs} dialogs`);
    console.log(`   Parse time: ${dialogData.metadata.parseTime.toFixed(2)}ms`);

    // 4. Show dialog structure
    console.log('\n📋 Dialog Structure:');
    Object.entries(dialogData.npcs).forEach(([npcName, npc]) => {
      console.log(`   NPC: ${npcName}`);
      npc.dialogs.forEach(dialog => {
        console.log(`     - ${dialog.name}: "${dialog.description}"`);
        if (dialog.conditionLogic && dialog.conditionLogic.statements.length > 0) {
          console.log(`       Condition: Has ${dialog.conditionLogic.statements.length} statement(s)`);
        }
        if (dialog.dialogFlow) {
          console.log(`       Flow: ${dialog.dialogFlow.totalLines} lines, ${dialog.dialogFlow.totalChoices} choices`);
        }
      });
    });

    // 5. Validate the code
    console.log('\n🔍 Validating dialog syntax...');
    const validation = parser.validateDialogSource(sampleDialogCode);

    if (validation.isValid) {
      console.log('✅ Dialog code is valid!');
    } else {
      console.log('❌ Validation errors found:');
      validation.errors.forEach(error => {
        console.log(`   - ${error.type}: ${error.message}`);
      });
    }

    // 6. Convert to JSON (for your UI state)
    console.log('\n🔄 Converting to JSON...');
    const jsonString = parser.convertToJson(sampleDialogCode, true);
    console.log(`✅ JSON generated (${jsonString.length} characters)`);

    // 7. Modify the dialog data (simulate UI changes)
    console.log('\n✏️  Simulating dialog modification...');
    const modifiedData = JSON.parse(jsonString);

    // Example: Change dialog description
    const firstNPC = Object.values(modifiedData.npcs)[0];
    const firstDialog = firstNPC.dialogs[0];
    firstDialog.description = "Hello, I've been modified!";
    firstDialog.nr = 99; // Change dialog number

    // 8. Convert back to Daedalus source
    console.log('\n🔄 Converting back to Daedalus source...');
    const regeneratedCode = parser.convertFromJson(modifiedData);

    console.log('✅ Successfully regenerated Daedalus code');
    console.log('\n📝 Modified dialog instance:');
    const lines = regeneratedCode.split('\n');
    const instanceStart = lines.findIndex(line => line.includes('instance'));
    const instanceEnd = lines.findIndex((line, index) => index > instanceStart && line.includes('};'));

    for (let i = instanceStart; i <= instanceEnd; i++) {
      console.log(`   ${lines[i]}`);
    }

    // 9. Show statistics
    console.log('\n📊 Dialog Statistics:');
    const stats = parser.getDialogStats(regeneratedCode);
    console.log(`   Total Dialogs: ${stats.totalDialogs}`);
    console.log(`   Total NPCs: ${stats.totalNPCs}`);
    console.log(`   Total Functions: ${stats.totalFunctions}`);
    console.log(`   Parse Time: ${stats.parseTime.toFixed(2)}ms`);

    // 10. Demonstrate error handling
    console.log('\n🚨 Testing error handling...');
    try {
      parser.parseDialogSource('invalid syntax');
    } catch (error) {
      console.log(`✅ Error caught correctly: ${error.message}`);
    }

    console.log('\n🎉 Demo completed successfully!');

    return {
      originalCode: sampleDialogCode,
      dialogData,
      jsonString,
      regeneratedCode,
      stats
    };

  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    throw error;
  }
}

// Example: Integration with a simple editor class
class SimpleDialogEditor {
  constructor() {
    this.parser = new DaedalusParser();
    this.currentData = null;
    this.currentFile = null;
  }

  // Load dialog from string (e.g., from your text editor)
  loadFromString(sourceCode) {
    try {
      this.currentData = this.parser.parseDialogSource(sourceCode);
      return { success: true, data: this.currentData };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Get validation results for real-time feedback
  validate(sourceCode) {
    return this.parser.validateDialogSource(sourceCode);
  }

  // Export current data as JSON (for saving editor state)
  exportAsJson() {
    if (!this.currentData) {
      throw new Error('No dialog data to export');
    }
    return this.parser.convertToJson(
      this.parser.generateDaedalus(this.currentData),
      true
    );
  }

  // Update dialog properties (e.g., from your UI form)
  updateDialog(npcName, dialogIndex, updates) {
    if (!this.currentData || !this.currentData.npcs[npcName]) {
      throw new Error('Invalid dialog reference');
    }

    const dialog = this.currentData.npcs[npcName].dialogs[dialogIndex];
    Object.assign(dialog, updates);

    return this.regenerateSource();
  }

  // Get current source code
  regenerateSource() {
    if (!this.currentData) {
      throw new Error('No dialog data available');
    }
    return this.parser.generateDaedalus(this.currentData);
  }

  // Get dialog statistics for your UI
  getStats() {
    if (!this.currentData) {
      return null;
    }
    return {
      totalDialogs: this.currentData.metadata.totalDialogs,
      totalNPCs: this.currentData.metadata.totalNPCs,
      npcs: Object.keys(this.currentData.npcs),
      dialogs: Object.values(this.currentData.npcs)
        .flatMap(npc => npc.dialogs.map(d => ({
          name: d.name,
          npc: d.npc,
          description: d.description
        })))
    };
  }
}

// Example: Using the editor class
function demonstrateEditorUsage() {
  console.log('\n🎛️  Simple Editor Demo\n');

  const editor = new SimpleDialogEditor();

  const sampleCode = `
instance TestDialog (C_INFO)
{
    npc = TestNPC;
    nr = 1;
    description = "Original description";
};

func int TestDialog_Condition() { return TRUE; };
func void TestDialog_Info() { AI_Output(self, other, "Hi"); };
`;

  // Load dialog
  const loadResult = editor.loadFromString(sampleCode);
  console.log('📖 Load result:', loadResult.success ? 'Success' : loadResult.error);

  if (loadResult.success) {
    // Show stats
    const stats = editor.getStats();
    console.log('📊 Stats:', stats);

    // Update dialog
    const updatedSource = editor.updateDialog('TestNPC', 0, {
      description: 'Updated from editor!',
      nr: 42
    });

    console.log('\n✏️  Updated source code:');
    console.log(updatedSource);

    // Validate updated code
    const validation = editor.validate(updatedSource);
    console.log('\n🔍 Validation:', validation.isValid ? 'Valid' : 'Invalid');
  }
}

// Run the demos
if (require.main === module) {
  demonstrateLibraryUsage()
    .then(() => demonstrateEditorUsage())
    .catch(error => {
      console.error('Demo failed:', error);
      process.exit(1);
    });
}

module.exports = {
  demonstrateLibraryUsage,
  SimpleDialogEditor,
  demonstrateEditorUsage
};

/*
To run this example:

1. Make sure the daedalus-parser library is installed
2. Run: node examples/simple-usage.js

This will demonstrate:
- Basic parsing functionality
- Dialog validation
- JSON conversion
- Source code regeneration
- Error handling
- A simple editor class for integration

Key takeaways for your editor UI:
- Use parseDialogSource() for real-time parsing
- Use validateDialogSource() for live validation feedback
- Use convertToJson() to work with dialog data in your UI
- Use convertFromJson() to regenerate source code
- All methods include proper error handling
*/