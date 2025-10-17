"use strict";
// Utility functions for parser setup and common operations
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
exports.createDaedalusParser = createDaedalusParser;
exports.parseDaedalusSource = parseDaedalusSource;
exports.parseSemanticModel = parseSemanticModel;
exports.validateDaedalusFile = validateDaedalusFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const semantic_visitor_1 = require("./semantic-visitor");
/**
 * Create and configure a Daedalus parser instance
 * @returns Configured tree-sitter parser ready for Daedalus source
 */
function createDaedalusParser() {
    const Parser = require('tree-sitter');
    const Daedalus = require('../bindings/node');
    const parser = new Parser();
    parser.setLanguage(Daedalus);
    return parser;
}
/**
 * Parse Daedalus source code and return the syntax tree
 * @param sourceCode - Daedalus source code to parse
 * @returns Parse tree
 */
function parseDaedalusSource(sourceCode) {
    const parser = createDaedalusParser();
    return parser.parse(sourceCode);
}
/**
 * Parse Daedalus source code and build semantic model with error handling
 * @param sourceCode - Daedalus source code to parse
 * @returns Semantic model with error information if syntax errors exist
 */
function parseSemanticModel(sourceCode) {
    const parser = createDaedalusParser();
    const tree = parser.parse(sourceCode);
    const visitor = new semantic_visitor_1.SemanticModelBuilderVisitor();
    // Check for syntax errors first
    visitor.checkForSyntaxErrors(tree.rootNode, sourceCode);
    // If there are syntax errors, return the model with errors
    if (visitor.semanticModel.hasErrors) {
        return visitor.semanticModel;
    }
    // Otherwise, proceed with normal semantic analysis
    visitor.pass1_createObjects(tree.rootNode);
    visitor.pass2_analyzeAndLink(tree.rootNode);
    return visitor.semanticModel;
}
/**
 * Validate that a file exists and has the expected .d extension
 * @param filename - Path to file to validate
 * @throws Error if file doesn't exist
 */
function validateDaedalusFile(filename) {
    if (!fs.existsSync(filename)) {
        throw new Error(`File not found: ${filename}`);
    }
    const ext = path.extname(filename);
    if (ext !== '.d') {
        console.warn(`Warning: Expected .d file extension, got '${ext}'`);
    }
}
