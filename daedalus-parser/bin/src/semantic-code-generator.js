"use strict";
// String-based code generator for Daedalus semantic model
// Generates clean, readable Daedalus source code from semantic model
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticCodeGenerator = void 0;
const semantic_model_1 = require("./semantic-model");
class SemanticCodeGenerator {
    constructor(options = {}) {
        this.options = {
            indentSize: 1,
            indentChar: '\t',
            includeComments: true,
            sectionHeaders: true,
            uppercaseKeywords: false,
            ...options
        };
    }
    /**
     * Generate complete Daedalus source file from semantic model
     */
    generateSemanticModel(model) {
        const sections = [];
        // Group dialogs and their associated functions together
        const processedFunctions = new Set();
        for (const dialogName in model.dialogs) {
            const dialog = model.dialogs[dialogName];
            const dialogSection = this.generateDialogSection(dialog, model, processedFunctions);
            sections.push(dialogSection);
        }
        // Generate any remaining functions not associated with dialogs
        for (const funcName in model.functions) {
            if (!processedFunctions.has(funcName)) {
                const func = model.functions[funcName];
                sections.push(this.generateFunction(func));
            }
        }
        return sections.join('\n');
    }
    /**
     * Generate a dialog section with its associated functions
     */
    generateDialogSection(dialog, model, processedFunctions) {
        const parts = [];
        // Section header
        if (this.options.sectionHeaders && this.options.includeComments) {
            const displayName = this.extractDisplayName(dialog.name);
            parts.push(this.generateSectionHeader(displayName));
        }
        // Dialog instance
        parts.push(this.generateDialog(dialog));
        // Associated functions (condition, information)
        const associatedFuncs = this.getAssociatedFunctions(dialog, model);
        for (const func of associatedFuncs) {
            processedFunctions.add(func.name);
            // Check if this is a condition function
            const isCondition = dialog.properties.condition instanceof semantic_model_1.DialogFunction &&
                dialog.properties.condition.name === func.name;
            parts.push(this.generateFunction(func, undefined, isCondition ? dialog.conditions : undefined));
        }
        return parts.join('\n');
    }
    /**
     * Extract display name from dialog instance name (e.g., DIA_Szmyk_Hello -> Hello)
     */
    extractDisplayName(dialogName) {
        const parts = dialogName.split('_');
        return parts.length > 2 ? parts.slice(2).join('_') : dialogName;
    }
    /**
     * Generate section header comment
     */
    generateSectionHeader(name) {
        const line = '*'.repeat(60);
        return `// ${line}\n//\t\t\t\t\t${name}\n// ${line}\n`;
    }
    /**
     * Get functions associated with a dialog (condition, information)
     */
    getAssociatedFunctions(dialog, model) {
        const funcs = [];
        if (dialog.properties.condition instanceof semantic_model_1.DialogFunction) {
            funcs.push(dialog.properties.condition);
        }
        if (dialog.properties.information instanceof semantic_model_1.DialogFunction) {
            funcs.push(dialog.properties.information);
        }
        return funcs;
    }
    /**
     * Generate a dialog instance declaration
     */
    generateDialog(dialog) {
        const indent = this.indent();
        const instanceKeyword = this.keyword('instance');
        const lines = [];
        lines.push(`${instanceKeyword} ${dialog.name}(C_INFO)`);
        lines.push('{');
        // Generate properties in conventional order
        const propertyOrder = ['npc', 'nr', 'condition', 'information', 'permanent', 'important', 'description'];
        const orderedKeys = new Set(propertyOrder);
        // Output ordered properties first
        for (const key of propertyOrder) {
            if (key in dialog.properties) {
                const value = dialog.properties[key];
                lines.push(`${indent}${key}${this.alignProperty(key)}= ${this.formatValue(value)};`);
            }
        }
        // Output remaining properties (using Set for O(1) lookup)
        for (const key in dialog.properties) {
            if (!orderedKeys.has(key)) {
                const value = dialog.properties[key];
                lines.push(`${indent}${key}${this.alignProperty(key)}= ${this.formatValue(value)};`);
            }
        }
        lines.push('};');
        lines.push('');
        return lines.join('\n');
    }
    /**
     * Generate alignment spacing for property assignment
     */
    alignProperty(propertyName) {
        // Align property assignments using single tab spacing (Gothic convention)
        return '\t';
    }
    /**
     * Format a property value for output
     */
    formatValue(value) {
        if (value instanceof semantic_model_1.DialogFunction) {
            return value.name;
        }
        if (typeof value === 'boolean') {
            return value ? 'TRUE' : 'FALSE';
        }
        if (typeof value === 'number') {
            return String(value);
        }
        // String - check if it looks like an identifier, already quoted, or needs quotes
        if (this.isIdentifier(value)) {
            return value;
        }
        // Check if already quoted
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            return value;
        }
        return `"${value}"`;
    }
    /**
     * Check if a string looks like an identifier (no spaces, special chars)
     */
    isIdentifier(str) {
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(str);
    }
    /**
     * Generate a function declaration
     */
    generateFunction(func, preservedBody, conditions) {
        const indent = this.indent();
        const funcKeyword = this.keyword('func');
        const returnType = this.normalizeReturnType(func.returnType);
        const lines = [];
        lines.push(`${funcKeyword} ${returnType} ${func.name}()`);
        lines.push('{');
        // Use preserved body if provided
        if (preservedBody) {
            // Split preserved body and indent each line
            const bodyLines = preservedBody.trim().split('\n');
            bodyLines.forEach(line => {
                lines.push(`${indent}${line}`);
            });
        }
        else if (conditions && conditions.length > 0) {
            // Generate condition function body
            this.generateConditionBody(conditions, lines, indent);
        }
        else if (func.actions.length > 0) {
            // Generate body from semantic actions
            func.actions.forEach(action => {
                const actionCode = this.generateAction(action);
                if (actionCode) {
                    const actionLines = actionCode.split('\n');
                    actionLines.forEach(line => {
                        if (line.trim()) {
                            lines.push(`${indent}${line}`);
                        }
                        else {
                            lines.push('');
                        }
                    });
                }
            });
        }
        else {
            // Empty function - add a simple return or placeholder
            if (returnType === 'int') {
                lines.push(`${indent}return TRUE;`);
            }
            else if (returnType === 'void') {
                lines.push(`${indent}// TODO: Implement function body`);
            }
        }
        lines.push('};');
        lines.push('');
        return lines.join('\n');
    }
    /**
     * Generate condition function body with if statement(s)
     */
    generateConditionBody(conditions, lines, indent) {
        if (conditions.length === 0) {
            lines.push(`${indent}return TRUE;`);
            return;
        }
        if (conditions.length === 1) {
            // Single condition - simple if
            const condCode = this.generateCondition(conditions[0]);
            lines.push(`${indent}if (${condCode})`);
            lines.push(`${indent}{`);
            lines.push(`${indent}${indent}return TRUE;`);
            lines.push(`${indent}};`);
        }
        else {
            // Multiple conditions - generate nested if statements (matching Gothic style)
            // Each condition wraps the next one, with return TRUE at the innermost level
            for (let i = 0; i < conditions.length; i++) {
                const condCode = this.generateCondition(conditions[i]);
                const currentIndent = indent.repeat(i + 1);
                lines.push(`${currentIndent}if (${condCode})`);
                lines.push(`${currentIndent}{`);
            }
            // Add return TRUE at the innermost level
            const innerIndent = indent.repeat(conditions.length + 1);
            lines.push(`${innerIndent}return TRUE;`);
            // Close all if statements
            for (let i = conditions.length - 1; i >= 0; i--) {
                const currentIndent = indent.repeat(i + 1);
                lines.push(`${currentIndent}};`);
            }
        }
    }
    /**
     * Generate code for a dialog condition using polymorphism
     */
    generateCondition(condition) {
        return condition.generateCode({
            includeComments: this.options.includeComments
        });
    }
    /**
     * Generate code for a dialog action using polymorphism
     * Each action knows how to generate its own code
     */
    generateAction(action) {
        return action.generateCode({
            includeComments: this.options.includeComments
        });
    }
    /**
     * Get indentation string
     */
    indent(level = 1) {
        return this.options.indentChar.repeat(this.options.indentSize * level);
    }
    /**
     * Format keyword according to options
     */
    keyword(kw) {
        return this.options.uppercaseKeywords ? kw.toUpperCase() : kw;
    }
    /**
     * Normalize return type case (int/INT -> int/INT based on options)
     */
    normalizeReturnType(type) {
        const normalized = type.toLowerCase();
        return this.options.uppercaseKeywords ? normalized.toUpperCase() : normalized;
    }
}
exports.SemanticCodeGenerator = SemanticCodeGenerator;
