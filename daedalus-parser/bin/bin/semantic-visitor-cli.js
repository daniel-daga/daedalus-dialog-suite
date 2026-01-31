#!/usr/bin/env npx ts-node
"use strict";
// CLI tool for running semantic visitor on Daedalus files
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const semantic_visitor_index_1 = require("../src/semantic-visitor-index");
const parser_utils_1 = require("../src/parser-utils");
function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: npm run semantic <file.d>');
        console.log('');
        console.log('Analyze a Daedalus dialog file with the semantic visitor');
        console.log('');
        console.log('Examples:');
        console.log('  npm run semantic examples/DIA_Szmyk.d');
        console.log('  npm run semantic -- --help');
        process.exit(1);
    }
    const filename = args[0];
    if (filename === '--help' || filename === '-h') {
        console.log('Daedalus Semantic Visitor CLI');
        console.log('');
        console.log('Usage: npm run semantic <file.d>');
        console.log('');
        console.log('This tool parses a Daedalus dialog file and builds a semantic model');
        console.log('showing dialogs, functions, and semantic actions in execution order.');
        console.log('');
        console.log('Output includes:');
        console.log('  - AST structure (debug output)');
        console.log('  - Semantic model with dialogs and actions');
        console.log('  - Object linking verification');
        process.exit(0);
    }
    try {
        (0, parser_utils_1.validateDaedalusFile)(filename);
    }
    catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
    try {
        console.log(`🔍 Analyzing file: ${filename}`);
        console.log('');
        // Read and parse the file
        const sourceCode = fs.readFileSync(filename, 'utf8');
        const parser = (0, parser_utils_1.createDaedalusParser)();
        const tree = parser.parse(sourceCode);
        // Print AST structure for debugging
        //console.log('--- 🌳 AST Structure ---');
        //printTree(tree.rootNode);
        //console.log('');
        // Run semantic analysis
        const visitor = new semantic_visitor_index_1.SemanticModelBuilderVisitor();
        console.log('--- 📊 Semantic Analysis ---');
        console.log('Checking for syntax errors...');
        visitor.checkForSyntaxErrors(tree.rootNode, sourceCode);
        // If syntax errors exist, display them and exit
        if (visitor.semanticModel.hasErrors) {
            console.log('');
            console.log('--- ❌ Syntax Errors Found ---');
            console.log(`Found ${visitor.semanticModel.errors.length} syntax error(s):\n`);
            visitor.semanticModel.errors.forEach((err, idx) => {
                console.log(`Error ${idx + 1}:`);
                console.log(`  Type: ${err.type}`);
                console.log(`  Location: Line ${err.position.row}, Column ${err.position.column}`);
                console.log(`  Message: ${err.message}`);
                if (err.text) {
                    const preview = err.text.length > 50 ? err.text.substring(0, 50) + '...' : err.text;
                    console.log(`  Text: ${preview.replace(/\n/g, '\\n')}`);
                }
                console.log('');
            });
            console.log('Semantic analysis skipped due to syntax errors.');
            process.exit(1);
        }
        console.log('No syntax errors found.');
        console.log('Running Pass 1: Creating all objects...');
        visitor.pass1_createObjects(tree.rootNode);
        const functionCount = Object.keys(visitor.semanticModel.functions).length;
        const dialogCount = Object.keys(visitor.semanticModel.dialogs).length;
        console.log(`Found ${functionCount} functions and ${dialogCount} dialogs.`);
        console.log('Running Pass 2: Linking properties and analyzing bodies...');
        visitor.pass2_analyzeAndLink(tree.rootNode);
        console.log('');
        // Display results
        console.log('--- ✅ Semantic Model ---');
        // Create a display version that shows function actions
        const displayModel = {
            dialogs: visitor.semanticModel.dialogs,
            functions: Object.fromEntries(Object.entries(visitor.semanticModel.functions).map(([name, func]) => [
                name,
                {
                    name: func.name,
                    returnType: func.returnType,
                    actions: func.actions
                }
            ]))
        };
        console.log(JSON.stringify(displayModel, jsonReplacer, 2));
        console.log('');
        // Verification
        console.log('--- 🔗 Verification ---');
        let verificationCount = 0;
        let successCount = 0;
        for (const dialogName in visitor.semanticModel.dialogs) {
            const dialog = visitor.semanticModel.dialogs[dialogName];
            // Check condition function linking
            if (dialog.properties.condition && dialog.properties.condition instanceof semantic_visitor_index_1.DialogFunction) {
                const conditionName = dialog.properties.condition.name;
                const conditionFunc = visitor.semanticModel.functions[conditionName];
                verificationCount++;
                if (dialog.properties.condition === conditionFunc) {
                    successCount++;
                }
                console.log(`Dialog '${dialogName}' condition links to function '${conditionName}': ${dialog.properties.condition === conditionFunc ? '✅' : '❌'}`);
            }
            // Check information function linking
            if (dialog.properties.information && dialog.properties.information instanceof semantic_visitor_index_1.DialogFunction) {
                const infoName = dialog.properties.information.name;
                const infoFunc = visitor.semanticModel.functions[infoName];
                verificationCount++;
                if (dialog.properties.information === infoFunc) {
                    successCount++;
                }
                console.log(`Dialog '${dialogName}' information links to function '${infoName}': ${dialog.properties.information === infoFunc ? '✅' : '❌'}`);
            }
        }
        console.log(`\nVerification: ${successCount}/${verificationCount} object links verified successfully`);
        // Summary
        console.log('');
        console.log('--- 📈 Summary ---');
        console.log(`File: ${filename}`);
        console.log(`Size: ${sourceCode.length} characters`);
        console.log(`Dialogs: ${dialogCount}`);
        console.log(`Functions: ${functionCount}`);
        // Count actions from both dialogs and functions
        let totalActions = 0;
        const actionTypes = {};
        // Count dialog actions using polymorphism
        for (const dialog of Object.values(visitor.semanticModel.dialogs)) {
            totalActions += dialog.actions.length;
            dialog.actions.forEach(action => {
                const typeName = action.getTypeName();
                actionTypes[typeName] = (actionTypes[typeName] || 0) + 1;
            });
        }
        // Count function actions (note: this includes dialog information functions too, so some duplication)
        let totalFunctionActions = 0;
        for (const func of Object.values(visitor.semanticModel.functions)) {
            totalFunctionActions += func.actions.length;
        }
        console.log(`Total Dialog Actions: ${totalActions}`);
        console.log(`Total Function Actions: ${totalFunctionActions}`);
        if (totalActions > 0) {
            console.log(`Dialog Action Breakdown:`);
            Object.entries(actionTypes)
                .sort(([, a], [, b]) => b - a) // Sort by count descending
                .forEach(([typeName, count]) => {
                console.log(`  - ${typeName}: ${count}`);
            });
        }
    }
    catch (error) {
        console.error('Error during analysis:', error);
        process.exit(1);
    }
}
// Helper function to print AST tree
function printTree(node, indent = 0) {
    const prefix = '  '.repeat(indent);
    const textSnippet = node.text.replace(/\n/g, "\\n");
    console.log(`${prefix}- type: ${node.type}, text: "${textSnippet}"`);
    for (const child of node.namedChildren) {
        printTree(child, indent + 1);
    }
}
// JSON replacer for pretty printing semantic objects
function jsonReplacer(key, value) {
    if (value instanceof semantic_visitor_index_1.DialogFunction) {
        return `[Link to Function: ${value.name}]`;
    }
    // Use polymorphic toDisplayString() for all actions
    if (value && typeof value === 'object' && typeof value.toDisplayString === 'function') {
        return value.toDisplayString();
    }
    return value;
}
// Run if called directly
if (require.main === module) {
    main();
}
