#!/usr/bin/env npx ts-node

/**
 * Simple API Demonstration
 *
 * This shows the intended usage: SemanticModel → Code Generation
 * The input is always a semantic model, not file paths.
 */

import {
  SemanticModel,
  Dialog,
  DialogFunction,
  DialogLine,
  CreateTopic,
  LogEntry,
  SemanticCodeGenerator
} from '../src/semantic-visitor-index';

// ============================================================================
// Create a semantic model from scratch
// ============================================================================

const model: SemanticModel = {
  dialogs: {},
  functions: {}
};

// Create a dialog for a merchant NPC
const dialog = new Dialog('DIA_Merchant_BuyWeapon', 'C_INFO');
dialog.properties.npc = 'BAU_950_Merchant';
dialog.properties.nr = 10;
dialog.properties.permanent = true;
dialog.properties.description = 'I want to buy a weapon';

// Create condition function
const conditionFunc = new DialogFunction('DIA_Merchant_BuyWeapon_Condition', 'int');

// Create information function with actions
const infoFunc = new DialogFunction('DIA_Merchant_BuyWeapon_Info', 'void');
infoFunc.actions.push(
  new DialogLine('self', 'Looking for a fine blade? I have just what you need!', 'MERCHANT_WEAPON_01'),
  new CreateTopic('TOPIC_TradeWeapons', 'LOG_NOTE'),
  new LogEntry('TOPIC_TradeWeapons', 'The merchant has weapons for sale')
);

// Link functions to dialog
dialog.properties.condition = conditionFunc;
dialog.properties.information = infoFunc;

// Add to model
model.dialogs[dialog.name] = dialog;
model.functions[conditionFunc.name] = conditionFunc;
model.functions[infoFunc.name] = infoFunc;

// ============================================================================
// Generate code from semantic model
// ============================================================================

const generator = new SemanticCodeGenerator();
const generatedCode = generator.generateSemanticModel(model);

console.log('=== Generated Daedalus Code ===\n');
console.log(generatedCode);

console.log('\n=== That\'s it! ===');
console.log('Input: SemanticModel object');
console.log('Output: Formatted Daedalus source code');
console.log('\nThe semantic model can come from:');
console.log('  • Parsing existing .d files (SemanticModelBuilderVisitor)');
console.log('  • Manual construction (as shown above)');
console.log('  • Visual editor UI (future Electron app)');
console.log('  • Database/JSON import');
console.log('  • Any other source that builds the semantic model');