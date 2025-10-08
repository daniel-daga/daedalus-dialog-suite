#include "tree_sitter/parser.h"

#if defined(__GNUC__) || defined(__clang__)
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#endif

#ifdef _MSC_VER
#pragma optimize("", off)
#elif defined(__clang__)
#pragma clang optimize off
#elif defined(__GNUC__)
#pragma GCC optimize ("O0")
#endif

#define LANGUAGE_VERSION 14
#define STATE_COUNT 146
#define LARGE_STATE_COUNT 2
#define SYMBOL_COUNT 106
#define ALIAS_COUNT 0
#define TOKEN_COUNT 75
#define EXTERNAL_TOKEN_COUNT 0
#define FIELD_COUNT 22
#define MAX_ALIAS_SEQUENCE_LENGTH 9
#define PRODUCTION_ID_COUNT 20

enum ts_symbol_identifiers {
  anon_sym_instance = 1,
  anon_sym_INSTANCE = 2,
  anon_sym_Instance = 3,
  anon_sym_LPAREN = 4,
  anon_sym_RPAREN = 5,
  anon_sym_SEMI = 6,
  anon_sym_func = 7,
  anon_sym_FUNC = 8,
  anon_sym_Func = 9,
  anon_sym_const = 10,
  anon_sym_CONST = 11,
  anon_sym_Const = 12,
  anon_sym_var = 13,
  anon_sym_VAR = 14,
  anon_sym_Var = 15,
  anon_sym_LBRACK = 16,
  anon_sym_RBRACK = 17,
  anon_sym_EQ = 18,
  anon_sym_class = 19,
  anon_sym_CLASS = 20,
  anon_sym_Class = 21,
  anon_sym_prototype = 22,
  anon_sym_PROTOTYPE = 23,
  anon_sym_Prototype = 24,
  anon_sym_LBRACE = 25,
  anon_sym_RBRACE = 26,
  anon_sym_COMMA = 27,
  anon_sym_void = 28,
  anon_sym_VOID = 29,
  anon_sym_Void = 30,
  anon_sym_int = 31,
  anon_sym_INT = 32,
  anon_sym_Int = 33,
  anon_sym_float = 34,
  anon_sym_FLOAT = 35,
  anon_sym_Float = 36,
  anon_sym_string = 37,
  anon_sym_STRING = 38,
  anon_sym_String = 39,
  anon_sym_if = 40,
  anon_sym_IF = 41,
  anon_sym_If = 42,
  anon_sym_else = 43,
  anon_sym_ELSE = 44,
  anon_sym_Else = 45,
  anon_sym_return = 46,
  anon_sym_RETURN = 47,
  anon_sym_Return = 48,
  anon_sym_PIPE_PIPE = 49,
  anon_sym_AMP_AMP = 50,
  anon_sym_EQ_EQ = 51,
  anon_sym_BANG_EQ = 52,
  anon_sym_LT = 53,
  anon_sym_LT_EQ = 54,
  anon_sym_GT = 55,
  anon_sym_GT_EQ = 56,
  anon_sym_PLUS = 57,
  anon_sym_DASH = 58,
  anon_sym_STAR = 59,
  anon_sym_SLASH = 60,
  anon_sym_PERCENT = 61,
  anon_sym_BANG = 62,
  anon_sym_TILDE = 63,
  anon_sym_DOT = 64,
  sym_identifier = 65,
  sym_number = 66,
  sym_string = 67,
  anon_sym_true = 68,
  anon_sym_TRUE = 69,
  anon_sym_True = 70,
  anon_sym_false = 71,
  anon_sym_FALSE = 72,
  anon_sym_False = 73,
  sym_comment = 74,
  sym_program = 75,
  sym__declaration = 76,
  sym_instance_declaration = 77,
  sym_function_declaration = 78,
  sym_variable_declaration = 79,
  sym_class_declaration = 80,
  sym_prototype_declaration = 81,
  sym_class_body = 82,
  sym_parameter_list = 83,
  sym_parameter = 84,
  sym__type = 85,
  sym_block = 86,
  sym__statement = 87,
  sym_assignment_statement = 88,
  sym_expression_statement = 89,
  sym_if_statement = 90,
  sym_return_statement = 91,
  sym__expression = 92,
  sym_binary_expression = 93,
  sym_unary_expression = 94,
  sym_array_access = 95,
  sym_member_access = 96,
  sym_call_expression = 97,
  sym_argument_list = 98,
  sym_parenthesized_expression = 99,
  sym_boolean = 100,
  aux_sym_program_repeat1 = 101,
  aux_sym_class_body_repeat1 = 102,
  aux_sym_parameter_list_repeat1 = 103,
  aux_sym_block_repeat1 = 104,
  aux_sym_argument_list_repeat1 = 105,
};

static const char * const ts_symbol_names[] = {
  [ts_builtin_sym_end] = "end",
  [anon_sym_instance] = "instance",
  [anon_sym_INSTANCE] = "INSTANCE",
  [anon_sym_Instance] = "Instance",
  [anon_sym_LPAREN] = "(",
  [anon_sym_RPAREN] = ")",
  [anon_sym_SEMI] = ";",
  [anon_sym_func] = "func",
  [anon_sym_FUNC] = "FUNC",
  [anon_sym_Func] = "Func",
  [anon_sym_const] = "const",
  [anon_sym_CONST] = "CONST",
  [anon_sym_Const] = "Const",
  [anon_sym_var] = "var",
  [anon_sym_VAR] = "VAR",
  [anon_sym_Var] = "Var",
  [anon_sym_LBRACK] = "[",
  [anon_sym_RBRACK] = "]",
  [anon_sym_EQ] = "=",
  [anon_sym_class] = "class",
  [anon_sym_CLASS] = "CLASS",
  [anon_sym_Class] = "Class",
  [anon_sym_prototype] = "prototype",
  [anon_sym_PROTOTYPE] = "PROTOTYPE",
  [anon_sym_Prototype] = "Prototype",
  [anon_sym_LBRACE] = "{",
  [anon_sym_RBRACE] = "}",
  [anon_sym_COMMA] = ",",
  [anon_sym_void] = "void",
  [anon_sym_VOID] = "VOID",
  [anon_sym_Void] = "Void",
  [anon_sym_int] = "int",
  [anon_sym_INT] = "INT",
  [anon_sym_Int] = "Int",
  [anon_sym_float] = "float",
  [anon_sym_FLOAT] = "FLOAT",
  [anon_sym_Float] = "Float",
  [anon_sym_string] = "string",
  [anon_sym_STRING] = "STRING",
  [anon_sym_String] = "String",
  [anon_sym_if] = "if",
  [anon_sym_IF] = "IF",
  [anon_sym_If] = "If",
  [anon_sym_else] = "else",
  [anon_sym_ELSE] = "ELSE",
  [anon_sym_Else] = "Else",
  [anon_sym_return] = "return",
  [anon_sym_RETURN] = "RETURN",
  [anon_sym_Return] = "Return",
  [anon_sym_PIPE_PIPE] = "||",
  [anon_sym_AMP_AMP] = "&&",
  [anon_sym_EQ_EQ] = "==",
  [anon_sym_BANG_EQ] = "!=",
  [anon_sym_LT] = "<",
  [anon_sym_LT_EQ] = "<=",
  [anon_sym_GT] = ">",
  [anon_sym_GT_EQ] = ">=",
  [anon_sym_PLUS] = "+",
  [anon_sym_DASH] = "-",
  [anon_sym_STAR] = "*",
  [anon_sym_SLASH] = "/",
  [anon_sym_PERCENT] = "%",
  [anon_sym_BANG] = "!",
  [anon_sym_TILDE] = "~",
  [anon_sym_DOT] = ".",
  [sym_identifier] = "identifier",
  [sym_number] = "number",
  [sym_string] = "string",
  [anon_sym_true] = "true",
  [anon_sym_TRUE] = "TRUE",
  [anon_sym_True] = "True",
  [anon_sym_false] = "false",
  [anon_sym_FALSE] = "FALSE",
  [anon_sym_False] = "False",
  [sym_comment] = "comment",
  [sym_program] = "program",
  [sym__declaration] = "_declaration",
  [sym_instance_declaration] = "instance_declaration",
  [sym_function_declaration] = "function_declaration",
  [sym_variable_declaration] = "variable_declaration",
  [sym_class_declaration] = "class_declaration",
  [sym_prototype_declaration] = "prototype_declaration",
  [sym_class_body] = "class_body",
  [sym_parameter_list] = "parameter_list",
  [sym_parameter] = "parameter",
  [sym__type] = "_type",
  [sym_block] = "block",
  [sym__statement] = "_statement",
  [sym_assignment_statement] = "assignment_statement",
  [sym_expression_statement] = "expression_statement",
  [sym_if_statement] = "if_statement",
  [sym_return_statement] = "return_statement",
  [sym__expression] = "_expression",
  [sym_binary_expression] = "binary_expression",
  [sym_unary_expression] = "unary_expression",
  [sym_array_access] = "array_access",
  [sym_member_access] = "member_access",
  [sym_call_expression] = "call_expression",
  [sym_argument_list] = "argument_list",
  [sym_parenthesized_expression] = "parenthesized_expression",
  [sym_boolean] = "boolean",
  [aux_sym_program_repeat1] = "program_repeat1",
  [aux_sym_class_body_repeat1] = "class_body_repeat1",
  [aux_sym_parameter_list_repeat1] = "parameter_list_repeat1",
  [aux_sym_block_repeat1] = "block_repeat1",
  [aux_sym_argument_list_repeat1] = "argument_list_repeat1",
};

static const TSSymbol ts_symbol_map[] = {
  [ts_builtin_sym_end] = ts_builtin_sym_end,
  [anon_sym_instance] = anon_sym_instance,
  [anon_sym_INSTANCE] = anon_sym_INSTANCE,
  [anon_sym_Instance] = anon_sym_Instance,
  [anon_sym_LPAREN] = anon_sym_LPAREN,
  [anon_sym_RPAREN] = anon_sym_RPAREN,
  [anon_sym_SEMI] = anon_sym_SEMI,
  [anon_sym_func] = anon_sym_func,
  [anon_sym_FUNC] = anon_sym_FUNC,
  [anon_sym_Func] = anon_sym_Func,
  [anon_sym_const] = anon_sym_const,
  [anon_sym_CONST] = anon_sym_CONST,
  [anon_sym_Const] = anon_sym_Const,
  [anon_sym_var] = anon_sym_var,
  [anon_sym_VAR] = anon_sym_VAR,
  [anon_sym_Var] = anon_sym_Var,
  [anon_sym_LBRACK] = anon_sym_LBRACK,
  [anon_sym_RBRACK] = anon_sym_RBRACK,
  [anon_sym_EQ] = anon_sym_EQ,
  [anon_sym_class] = anon_sym_class,
  [anon_sym_CLASS] = anon_sym_CLASS,
  [anon_sym_Class] = anon_sym_Class,
  [anon_sym_prototype] = anon_sym_prototype,
  [anon_sym_PROTOTYPE] = anon_sym_PROTOTYPE,
  [anon_sym_Prototype] = anon_sym_Prototype,
  [anon_sym_LBRACE] = anon_sym_LBRACE,
  [anon_sym_RBRACE] = anon_sym_RBRACE,
  [anon_sym_COMMA] = anon_sym_COMMA,
  [anon_sym_void] = anon_sym_void,
  [anon_sym_VOID] = anon_sym_VOID,
  [anon_sym_Void] = anon_sym_Void,
  [anon_sym_int] = anon_sym_int,
  [anon_sym_INT] = anon_sym_INT,
  [anon_sym_Int] = anon_sym_Int,
  [anon_sym_float] = anon_sym_float,
  [anon_sym_FLOAT] = anon_sym_FLOAT,
  [anon_sym_Float] = anon_sym_Float,
  [anon_sym_string] = anon_sym_string,
  [anon_sym_STRING] = anon_sym_STRING,
  [anon_sym_String] = anon_sym_String,
  [anon_sym_if] = anon_sym_if,
  [anon_sym_IF] = anon_sym_IF,
  [anon_sym_If] = anon_sym_If,
  [anon_sym_else] = anon_sym_else,
  [anon_sym_ELSE] = anon_sym_ELSE,
  [anon_sym_Else] = anon_sym_Else,
  [anon_sym_return] = anon_sym_return,
  [anon_sym_RETURN] = anon_sym_RETURN,
  [anon_sym_Return] = anon_sym_Return,
  [anon_sym_PIPE_PIPE] = anon_sym_PIPE_PIPE,
  [anon_sym_AMP_AMP] = anon_sym_AMP_AMP,
  [anon_sym_EQ_EQ] = anon_sym_EQ_EQ,
  [anon_sym_BANG_EQ] = anon_sym_BANG_EQ,
  [anon_sym_LT] = anon_sym_LT,
  [anon_sym_LT_EQ] = anon_sym_LT_EQ,
  [anon_sym_GT] = anon_sym_GT,
  [anon_sym_GT_EQ] = anon_sym_GT_EQ,
  [anon_sym_PLUS] = anon_sym_PLUS,
  [anon_sym_DASH] = anon_sym_DASH,
  [anon_sym_STAR] = anon_sym_STAR,
  [anon_sym_SLASH] = anon_sym_SLASH,
  [anon_sym_PERCENT] = anon_sym_PERCENT,
  [anon_sym_BANG] = anon_sym_BANG,
  [anon_sym_TILDE] = anon_sym_TILDE,
  [anon_sym_DOT] = anon_sym_DOT,
  [sym_identifier] = sym_identifier,
  [sym_number] = sym_number,
  [sym_string] = sym_string,
  [anon_sym_true] = anon_sym_true,
  [anon_sym_TRUE] = anon_sym_TRUE,
  [anon_sym_True] = anon_sym_True,
  [anon_sym_false] = anon_sym_false,
  [anon_sym_FALSE] = anon_sym_FALSE,
  [anon_sym_False] = anon_sym_False,
  [sym_comment] = sym_comment,
  [sym_program] = sym_program,
  [sym__declaration] = sym__declaration,
  [sym_instance_declaration] = sym_instance_declaration,
  [sym_function_declaration] = sym_function_declaration,
  [sym_variable_declaration] = sym_variable_declaration,
  [sym_class_declaration] = sym_class_declaration,
  [sym_prototype_declaration] = sym_prototype_declaration,
  [sym_class_body] = sym_class_body,
  [sym_parameter_list] = sym_parameter_list,
  [sym_parameter] = sym_parameter,
  [sym__type] = sym__type,
  [sym_block] = sym_block,
  [sym__statement] = sym__statement,
  [sym_assignment_statement] = sym_assignment_statement,
  [sym_expression_statement] = sym_expression_statement,
  [sym_if_statement] = sym_if_statement,
  [sym_return_statement] = sym_return_statement,
  [sym__expression] = sym__expression,
  [sym_binary_expression] = sym_binary_expression,
  [sym_unary_expression] = sym_unary_expression,
  [sym_array_access] = sym_array_access,
  [sym_member_access] = sym_member_access,
  [sym_call_expression] = sym_call_expression,
  [sym_argument_list] = sym_argument_list,
  [sym_parenthesized_expression] = sym_parenthesized_expression,
  [sym_boolean] = sym_boolean,
  [aux_sym_program_repeat1] = aux_sym_program_repeat1,
  [aux_sym_class_body_repeat1] = aux_sym_class_body_repeat1,
  [aux_sym_parameter_list_repeat1] = aux_sym_parameter_list_repeat1,
  [aux_sym_block_repeat1] = aux_sym_block_repeat1,
  [aux_sym_argument_list_repeat1] = aux_sym_argument_list_repeat1,
};

static const TSSymbolMetadata ts_symbol_metadata[] = {
  [ts_builtin_sym_end] = {
    .visible = false,
    .named = true,
  },
  [anon_sym_instance] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_INSTANCE] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_Instance] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_LPAREN] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_RPAREN] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_SEMI] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_func] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_FUNC] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_Func] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_const] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_CONST] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_Const] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_var] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_VAR] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_Var] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_LBRACK] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_RBRACK] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_EQ] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_class] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_CLASS] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_Class] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_prototype] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_PROTOTYPE] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_Prototype] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_LBRACE] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_RBRACE] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_COMMA] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_void] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_VOID] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_Void] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_int] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_INT] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_Int] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_float] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_FLOAT] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_Float] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_string] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_STRING] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_String] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_if] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_IF] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_If] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_else] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_ELSE] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_Else] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_return] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_RETURN] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_Return] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_PIPE_PIPE] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_AMP_AMP] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_EQ_EQ] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_BANG_EQ] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_LT] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_LT_EQ] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_GT] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_GT_EQ] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_PLUS] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_DASH] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_STAR] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_SLASH] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_PERCENT] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_BANG] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_TILDE] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_DOT] = {
    .visible = true,
    .named = false,
  },
  [sym_identifier] = {
    .visible = true,
    .named = true,
  },
  [sym_number] = {
    .visible = true,
    .named = true,
  },
  [sym_string] = {
    .visible = true,
    .named = true,
  },
  [anon_sym_true] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_TRUE] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_True] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_false] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_FALSE] = {
    .visible = true,
    .named = false,
  },
  [anon_sym_False] = {
    .visible = true,
    .named = false,
  },
  [sym_comment] = {
    .visible = true,
    .named = true,
  },
  [sym_program] = {
    .visible = true,
    .named = true,
  },
  [sym__declaration] = {
    .visible = false,
    .named = true,
  },
  [sym_instance_declaration] = {
    .visible = true,
    .named = true,
  },
  [sym_function_declaration] = {
    .visible = true,
    .named = true,
  },
  [sym_variable_declaration] = {
    .visible = true,
    .named = true,
  },
  [sym_class_declaration] = {
    .visible = true,
    .named = true,
  },
  [sym_prototype_declaration] = {
    .visible = true,
    .named = true,
  },
  [sym_class_body] = {
    .visible = true,
    .named = true,
  },
  [sym_parameter_list] = {
    .visible = true,
    .named = true,
  },
  [sym_parameter] = {
    .visible = true,
    .named = true,
  },
  [sym__type] = {
    .visible = false,
    .named = true,
  },
  [sym_block] = {
    .visible = true,
    .named = true,
  },
  [sym__statement] = {
    .visible = false,
    .named = true,
  },
  [sym_assignment_statement] = {
    .visible = true,
    .named = true,
  },
  [sym_expression_statement] = {
    .visible = true,
    .named = true,
  },
  [sym_if_statement] = {
    .visible = true,
    .named = true,
  },
  [sym_return_statement] = {
    .visible = true,
    .named = true,
  },
  [sym__expression] = {
    .visible = false,
    .named = true,
  },
  [sym_binary_expression] = {
    .visible = true,
    .named = true,
  },
  [sym_unary_expression] = {
    .visible = true,
    .named = true,
  },
  [sym_array_access] = {
    .visible = true,
    .named = true,
  },
  [sym_member_access] = {
    .visible = true,
    .named = true,
  },
  [sym_call_expression] = {
    .visible = true,
    .named = true,
  },
  [sym_argument_list] = {
    .visible = true,
    .named = true,
  },
  [sym_parenthesized_expression] = {
    .visible = true,
    .named = true,
  },
  [sym_boolean] = {
    .visible = true,
    .named = true,
  },
  [aux_sym_program_repeat1] = {
    .visible = false,
    .named = false,
  },
  [aux_sym_class_body_repeat1] = {
    .visible = false,
    .named = false,
  },
  [aux_sym_parameter_list_repeat1] = {
    .visible = false,
    .named = false,
  },
  [aux_sym_block_repeat1] = {
    .visible = false,
    .named = false,
  },
  [aux_sym_argument_list_repeat1] = {
    .visible = false,
    .named = false,
  },
};

enum ts_field_identifiers {
  field_alternative = 1,
  field_arguments = 2,
  field_array = 3,
  field_body = 4,
  field_condition = 5,
  field_consequence = 6,
  field_function = 7,
  field_index = 8,
  field_keyword = 9,
  field_left = 10,
  field_member = 11,
  field_name = 12,
  field_object = 13,
  field_operand = 14,
  field_operator = 15,
  field_parameters = 16,
  field_parent = 17,
  field_return_type = 18,
  field_right = 19,
  field_size = 20,
  field_type = 21,
  field_value = 22,
};

static const char * const ts_field_names[] = {
  [0] = NULL,
  [field_alternative] = "alternative",
  [field_arguments] = "arguments",
  [field_array] = "array",
  [field_body] = "body",
  [field_condition] = "condition",
  [field_consequence] = "consequence",
  [field_function] = "function",
  [field_index] = "index",
  [field_keyword] = "keyword",
  [field_left] = "left",
  [field_member] = "member",
  [field_name] = "name",
  [field_object] = "object",
  [field_operand] = "operand",
  [field_operator] = "operator",
  [field_parameters] = "parameters",
  [field_parent] = "parent",
  [field_return_type] = "return_type",
  [field_right] = "right",
  [field_size] = "size",
  [field_type] = "type",
  [field_value] = "value",
};

static const TSFieldMapSlice ts_field_map_slices[PRODUCTION_ID_COUNT] = {
  [1] = {.index = 0, .length = 3},
  [2] = {.index = 3, .length = 3},
  [3] = {.index = 6, .length = 2},
  [4] = {.index = 8, .length = 4},
  [5] = {.index = 12, .length = 4},
  [6] = {.index = 16, .length = 2},
  [7] = {.index = 18, .length = 4},
  [8] = {.index = 22, .length = 1},
  [9] = {.index = 23, .length = 2},
  [10] = {.index = 25, .length = 5},
  [11] = {.index = 30, .length = 4},
  [12] = {.index = 34, .length = 2},
  [13] = {.index = 36, .length = 2},
  [14] = {.index = 38, .length = 2},
  [15] = {.index = 40, .length = 1},
  [16] = {.index = 41, .length = 5},
  [17] = {.index = 46, .length = 2},
  [18] = {.index = 48, .length = 3},
  [19] = {.index = 51, .length = 3},
};

static const TSFieldMapEntry ts_field_map_entries[] = {
  [0] =
    {field_body, 2},
    {field_keyword, 0},
    {field_name, 1},
  [3] =
    {field_keyword, 0},
    {field_name, 2},
    {field_type, 1},
  [6] =
    {field_operand, 1},
    {field_operator, 0},
  [8] =
    {field_body, 5},
    {field_keyword, 0},
    {field_name, 1},
    {field_parent, 3},
  [12] =
    {field_body, 5},
    {field_keyword, 0},
    {field_name, 2},
    {field_return_type, 1},
  [16] =
    {field_name, 1},
    {field_type, 0},
  [18] =
    {field_keyword, 0},
    {field_name, 2},
    {field_type, 1},
    {field_value, 4},
  [22] =
    {field_function, 0},
  [23] =
    {field_member, 2},
    {field_object, 0},
  [25] =
    {field_body, 6},
    {field_keyword, 0},
    {field_name, 2},
    {field_parameters, 4},
    {field_return_type, 1},
  [30] =
    {field_keyword, 0},
    {field_name, 2},
    {field_size, 4},
    {field_type, 1},
  [34] =
    {field_left, 0},
    {field_right, 2},
  [36] =
    {field_arguments, 2},
    {field_function, 0},
  [38] =
    {field_array, 0},
    {field_index, 2},
  [40] =
    {field_value, 1},
  [41] =
    {field_keyword, 0},
    {field_name, 2},
    {field_size, 4},
    {field_type, 1},
    {field_value, 7},
  [46] =
    {field_condition, 2},
    {field_consequence, 4},
  [48] =
    {field_alternative, 6},
    {field_condition, 2},
    {field_consequence, 4},
  [51] =
    {field_alternative, 7},
    {field_condition, 2},
    {field_consequence, 4},
};

static const TSSymbol ts_alias_sequences[PRODUCTION_ID_COUNT][MAX_ALIAS_SEQUENCE_LENGTH] = {
  [0] = {0},
};

static const uint16_t ts_non_terminal_alias_map[] = {
  0,
};

static const TSStateId ts_primary_state_ids[STATE_COUNT] = {
  [0] = 0,
  [1] = 1,
  [2] = 2,
  [3] = 3,
  [4] = 4,
  [5] = 5,
  [6] = 6,
  [7] = 7,
  [8] = 8,
  [9] = 9,
  [10] = 10,
  [11] = 11,
  [12] = 12,
  [13] = 13,
  [14] = 14,
  [15] = 15,
  [16] = 16,
  [17] = 17,
  [18] = 18,
  [19] = 16,
  [20] = 17,
  [21] = 17,
  [22] = 16,
  [23] = 23,
  [24] = 24,
  [25] = 25,
  [26] = 26,
  [27] = 27,
  [28] = 28,
  [29] = 29,
  [30] = 30,
  [31] = 31,
  [32] = 32,
  [33] = 33,
  [34] = 34,
  [35] = 29,
  [36] = 36,
  [37] = 37,
  [38] = 38,
  [39] = 39,
  [40] = 39,
  [41] = 41,
  [42] = 42,
  [43] = 43,
  [44] = 44,
  [45] = 44,
  [46] = 46,
  [47] = 30,
  [48] = 48,
  [49] = 49,
  [50] = 50,
  [51] = 51,
  [52] = 52,
  [53] = 53,
  [54] = 36,
  [55] = 55,
  [56] = 41,
  [57] = 57,
  [58] = 58,
  [59] = 59,
  [60] = 60,
  [61] = 61,
  [62] = 62,
  [63] = 63,
  [64] = 64,
  [65] = 65,
  [66] = 66,
  [67] = 65,
  [68] = 68,
  [69] = 69,
  [70] = 70,
  [71] = 30,
  [72] = 72,
  [73] = 73,
  [74] = 74,
  [75] = 75,
  [76] = 29,
  [77] = 77,
  [78] = 78,
  [79] = 62,
  [80] = 80,
  [81] = 59,
  [82] = 66,
  [83] = 83,
  [84] = 84,
  [85] = 85,
  [86] = 68,
  [87] = 87,
  [88] = 88,
  [89] = 89,
  [90] = 90,
  [91] = 15,
  [92] = 92,
  [93] = 93,
  [94] = 90,
  [95] = 95,
  [96] = 96,
  [97] = 97,
  [98] = 93,
  [99] = 99,
  [100] = 100,
  [101] = 99,
  [102] = 97,
  [103] = 103,
  [104] = 104,
  [105] = 105,
  [106] = 106,
  [107] = 106,
  [108] = 108,
  [109] = 109,
  [110] = 110,
  [111] = 111,
  [112] = 108,
  [113] = 113,
  [114] = 114,
  [115] = 115,
  [116] = 116,
  [117] = 117,
  [118] = 118,
  [119] = 119,
  [120] = 120,
  [121] = 121,
  [122] = 122,
  [123] = 123,
  [124] = 124,
  [125] = 118,
  [126] = 126,
  [127] = 127,
  [128] = 128,
  [129] = 129,
  [130] = 130,
  [131] = 131,
  [132] = 132,
  [133] = 133,
  [134] = 134,
  [135] = 135,
  [136] = 136,
  [137] = 137,
  [138] = 134,
  [139] = 139,
  [140] = 140,
  [141] = 141,
  [142] = 142,
  [143] = 143,
  [144] = 144,
  [145] = 145,
};

static bool ts_lex(TSLexer *lexer, TSStateId state) {
  START_LEXER();
  eof = lexer->eof(lexer);
  switch (state) {
    case 0:
      if (eof) ADVANCE(163);
      ADVANCE_MAP(
        '!', 253,
        '"', 5,
        '%', 251,
        '&', 10,
        '(', 167,
        ')', 168,
        '*', 249,
        '+', 247,
        ',', 196,
        '-', 248,
        '.', 255,
        '/', 250,
        ';', 169,
        '<', 243,
        '=', 187,
        '>', 245,
        'C', 34,
        'E', 35,
        'F', 16,
        'I', 30,
        'P', 48,
        'R', 24,
        'S', 57,
        'T', 46,
        'V', 18,
        '[', 185,
        ']', 186,
        'c', 102,
        'e', 99,
        'f', 74,
        'i', 92,
        'p', 128,
        'r', 91,
        's', 149,
        't', 126,
        'v', 68,
        '{', 194,
        '|', 161,
        '}', 195,
        '~', 254,
      );
      if (('\t' <= lookahead && lookahead <= '\r') ||
          lookahead == ' ') SKIP(0);
      if (('0' <= lookahead && lookahead <= '9')) ADVANCE(354);
      END_STATE();
    case 1:
      if (lookahead == '\r') ADVANCE(5);
      if (lookahead == '"') ADVANCE(356);
      if (lookahead == '\\') ADVANCE(154);
      if (('0' <= lookahead && lookahead <= '7')) ADVANCE(5);
      if (lookahead != 0) ADVANCE(5);
      END_STATE();
    case 2:
      if (lookahead == '\r') ADVANCE(5);
      if (lookahead == '"') ADVANCE(356);
      if (lookahead == '\\') ADVANCE(154);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'F') ||
          ('a' <= lookahead && lookahead <= 'f')) ADVANCE(5);
      if (lookahead != 0) ADVANCE(5);
      END_STATE();
    case 3:
      if (lookahead == '\r') ADVANCE(5);
      if (lookahead == '"') ADVANCE(356);
      if (lookahead == '\\') ADVANCE(154);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'F') ||
          ('a' <= lookahead && lookahead <= 'f')) ADVANCE(2);
      if (lookahead != 0) ADVANCE(5);
      END_STATE();
    case 4:
      if (lookahead == '\r') ADVANCE(5);
      if (lookahead == '"') ADVANCE(356);
      if (lookahead == '\\') ADVANCE(154);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'F') ||
          ('a' <= lookahead && lookahead <= 'f')) ADVANCE(3);
      if (lookahead != 0) ADVANCE(5);
      END_STATE();
    case 5:
      if (lookahead == '\r') ADVANCE(5);
      if (lookahead == '"') ADVANCE(356);
      if (lookahead == '\\') ADVANCE(154);
      if (lookahead != 0) ADVANCE(5);
      END_STATE();
    case 6:
      ADVANCE_MAP(
        '!', 253,
        '"', 5,
        '%', 251,
        '&', 10,
        '(', 167,
        ')', 168,
        '*', 249,
        '+', 247,
        ',', 196,
        '-', 248,
        '.', 255,
        '/', 250,
        ';', 169,
        '<', 243,
        '=', 187,
        '>', 245,
        'F', 256,
        'I', 264,
        'R', 260,
        'T', 278,
        '[', 185,
        ']', 186,
        'f', 295,
        'i', 305,
        'r', 304,
        't', 332,
        '|', 161,
        '}', 195,
        '~', 254,
      );
      if (('\t' <= lookahead && lookahead <= '\r') ||
          lookahead == ' ') SKIP(6);
      if (('0' <= lookahead && lookahead <= '9')) ADVANCE(354);
      if (('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 7:
      ADVANCE_MAP(
        '!', 252,
        '"', 5,
        '(', 167,
        ')', 168,
        '+', 247,
        '-', 248,
        '/', 12,
        ';', 169,
        'F', 256,
        'T', 278,
        'f', 295,
        't', 332,
        '~', 254,
      );
      if (('\t' <= lookahead && lookahead <= '\r') ||
          lookahead == ' ') SKIP(7);
      if (('0' <= lookahead && lookahead <= '9')) ADVANCE(354);
      if (('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 8:
      ADVANCE_MAP(
        '!', 252,
        '"', 5,
        '(', 167,
        '+', 247,
        '-', 248,
        '/', 12,
        ';', 169,
        'E', 270,
        'F', 256,
        'I', 264,
        'R', 260,
        'T', 278,
        'e', 315,
        'f', 295,
        'i', 305,
        'r', 304,
        't', 332,
        '}', 195,
        '~', 254,
      );
      if (('\t' <= lookahead && lookahead <= '\r') ||
          lookahead == ' ') SKIP(8);
      if (('0' <= lookahead && lookahead <= '9')) ADVANCE(354);
      if (('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 9:
      ADVANCE_MAP(
        '!', 252,
        '"', 5,
        '(', 167,
        '+', 247,
        '-', 248,
        '/', 12,
        'C', 277,
        'F', 256,
        'T', 278,
        'V', 257,
        'c', 324,
        'f', 295,
        't', 332,
        'v', 292,
        '}', 195,
        '~', 254,
      );
      if (('\t' <= lookahead && lookahead <= '\r') ||
          lookahead == ' ') SKIP(9);
      if (('0' <= lookahead && lookahead <= '9')) ADVANCE(354);
      if (('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 10:
      if (lookahead == '&') ADVANCE(240);
      END_STATE();
    case 11:
      ADVANCE_MAP(
        ')', 168,
        '/', 12,
        'F', 269,
        'I', 274,
        'S', 289,
        'V', 275,
        'f', 314,
        'i', 322,
        's', 348,
        'v', 325,
      );
      if (('\t' <= lookahead && lookahead <= '\r') ||
          lookahead == ' ') SKIP(11);
      if (('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 12:
      if (lookahead == '*') ADVANCE(14);
      if (lookahead == '/') ADVANCE(370);
      END_STATE();
    case 13:
      if (lookahead == '*') ADVANCE(13);
      if (lookahead == '/') ADVANCE(369);
      if (lookahead != 0) ADVANCE(14);
      END_STATE();
    case 14:
      if (lookahead == '*') ADVANCE(13);
      if (lookahead != 0) ADVANCE(14);
      END_STATE();
    case 15:
      if (lookahead == '/') ADVANCE(12);
      if (('\t' <= lookahead && lookahead <= '\r') ||
          lookahead == ' ') SKIP(15);
      if (('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 16:
      if (lookahead == 'A') ADVANCE(36);
      if (lookahead == 'L') ADVANCE(42);
      if (lookahead == 'U') ADVANCE(37);
      if (lookahead == 'a') ADVANCE(100);
      if (lookahead == 'l') ADVANCE(113);
      if (lookahead == 'u') ADVANCE(103);
      END_STATE();
    case 17:
      if (lookahead == 'A') ADVANCE(55);
      END_STATE();
    case 18:
      if (lookahead == 'A') ADVANCE(47);
      if (lookahead == 'O') ADVANCE(32);
      if (lookahead == 'a') ADVANCE(121);
      if (lookahead == 'o') ADVANCE(95);
      END_STATE();
    case 19:
      if (lookahead == 'A') ADVANCE(40);
      END_STATE();
    case 20:
      if (lookahead == 'A') ADVANCE(59);
      END_STATE();
    case 21:
      if (lookahead == 'C') ADVANCE(171);
      END_STATE();
    case 22:
      if (lookahead == 'C') ADVANCE(28);
      END_STATE();
    case 23:
      if (lookahead == 'D') ADVANCE(199);
      END_STATE();
    case 24:
      if (lookahead == 'E') ADVANCE(61);
      if (lookahead == 'e') ADVANCE(146);
      END_STATE();
    case 25:
      if (lookahead == 'E') ADVANCE(229);
      END_STATE();
    case 26:
      if (lookahead == 'E') ADVANCE(359);
      END_STATE();
    case 27:
      if (lookahead == 'E') ADVANCE(365);
      END_STATE();
    case 28:
      if (lookahead == 'E') ADVANCE(165);
      END_STATE();
    case 29:
      if (lookahead == 'E') ADVANCE(192);
      END_STATE();
    case 30:
      if (lookahead == 'F') ADVANCE(223);
      if (lookahead == 'N') ADVANCE(53);
      if (lookahead == 'f') ADVANCE(225);
      if (lookahead == 'n') ADVANCE(132);
      END_STATE();
    case 31:
      if (lookahead == 'G') ADVANCE(217);
      END_STATE();
    case 32:
      if (lookahead == 'I') ADVANCE(23);
      END_STATE();
    case 33:
      if (lookahead == 'I') ADVANCE(38);
      END_STATE();
    case 34:
      if (lookahead == 'L') ADVANCE(17);
      if (lookahead == 'O') ADVANCE(41);
      if (lookahead == 'l') ADVANCE(67);
      if (lookahead == 'o') ADVANCE(109);
      END_STATE();
    case 35:
      if (lookahead == 'L') ADVANCE(51);
      if (lookahead == 'l') ADVANCE(131);
      END_STATE();
    case 36:
      if (lookahead == 'L') ADVANCE(54);
      END_STATE();
    case 37:
      if (lookahead == 'N') ADVANCE(21);
      END_STATE();
    case 38:
      if (lookahead == 'N') ADVANCE(31);
      END_STATE();
    case 39:
      if (lookahead == 'N') ADVANCE(235);
      END_STATE();
    case 40:
      if (lookahead == 'N') ADVANCE(22);
      END_STATE();
    case 41:
      if (lookahead == 'N') ADVANCE(56);
      END_STATE();
    case 42:
      if (lookahead == 'O') ADVANCE(20);
      END_STATE();
    case 43:
      if (lookahead == 'O') ADVANCE(63);
      END_STATE();
    case 44:
      if (lookahead == 'O') ADVANCE(60);
      END_STATE();
    case 45:
      if (lookahead == 'P') ADVANCE(29);
      END_STATE();
    case 46:
      if (lookahead == 'R') ADVANCE(64);
      if (lookahead == 'r') ADVANCE(155);
      END_STATE();
    case 47:
      if (lookahead == 'R') ADVANCE(181);
      END_STATE();
    case 48:
      if (lookahead == 'R') ADVANCE(43);
      if (lookahead == 'r') ADVANCE(114);
      END_STATE();
    case 49:
      if (lookahead == 'R') ADVANCE(33);
      END_STATE();
    case 50:
      if (lookahead == 'R') ADVANCE(39);
      END_STATE();
    case 51:
      if (lookahead == 'S') ADVANCE(25);
      END_STATE();
    case 52:
      if (lookahead == 'S') ADVANCE(189);
      END_STATE();
    case 53:
      if (lookahead == 'S') ADVANCE(62);
      if (lookahead == 'T') ADVANCE(205);
      END_STATE();
    case 54:
      if (lookahead == 'S') ADVANCE(27);
      END_STATE();
    case 55:
      if (lookahead == 'S') ADVANCE(52);
      END_STATE();
    case 56:
      if (lookahead == 'S') ADVANCE(58);
      END_STATE();
    case 57:
      if (lookahead == 'T') ADVANCE(49);
      if (lookahead == 't') ADVANCE(123);
      END_STATE();
    case 58:
      if (lookahead == 'T') ADVANCE(175);
      END_STATE();
    case 59:
      if (lookahead == 'T') ADVANCE(211);
      END_STATE();
    case 60:
      if (lookahead == 'T') ADVANCE(66);
      END_STATE();
    case 61:
      if (lookahead == 'T') ADVANCE(65);
      END_STATE();
    case 62:
      if (lookahead == 'T') ADVANCE(19);
      END_STATE();
    case 63:
      if (lookahead == 'T') ADVANCE(44);
      END_STATE();
    case 64:
      if (lookahead == 'U') ADVANCE(26);
      END_STATE();
    case 65:
      if (lookahead == 'U') ADVANCE(50);
      END_STATE();
    case 66:
      if (lookahead == 'Y') ADVANCE(45);
      END_STATE();
    case 67:
      if (lookahead == 'a') ADVANCE(134);
      END_STATE();
    case 68:
      if (lookahead == 'a') ADVANCE(122);
      if (lookahead == 'o') ADVANCE(96);
      END_STATE();
    case 69:
      if (lookahead == 'a') ADVANCE(142);
      END_STATE();
    case 70:
      if (lookahead == 'a') ADVANCE(110);
      END_STATE();
    case 71:
      if (lookahead == 'a') ADVANCE(144);
      END_STATE();
    case 72:
      if (lookahead == 'a') ADVANCE(136);
      END_STATE();
    case 73:
      if (lookahead == 'a') ADVANCE(112);
      END_STATE();
    case 74:
      if (lookahead == 'a') ADVANCE(101);
      if (lookahead == 'l') ADVANCE(116);
      if (lookahead == 'u') ADVANCE(107);
      END_STATE();
    case 75:
      if (lookahead == 'c') ADVANCE(172);
      END_STATE();
    case 76:
      if (lookahead == 'c') ADVANCE(170);
      END_STATE();
    case 77:
      if (lookahead == 'c') ADVANCE(87);
      END_STATE();
    case 78:
      if (lookahead == 'c') ADVANCE(88);
      END_STATE();
    case 79:
      if (lookahead == 'd') ADVANCE(201);
      END_STATE();
    case 80:
      if (lookahead == 'd') ADVANCE(197);
      END_STATE();
    case 81:
      if (lookahead == 'e') ADVANCE(231);
      END_STATE();
    case 82:
      if (lookahead == 'e') ADVANCE(361);
      END_STATE();
    case 83:
      if (lookahead == 'e') ADVANCE(227);
      END_STATE();
    case 84:
      if (lookahead == 'e') ADVANCE(357);
      END_STATE();
    case 85:
      if (lookahead == 'e') ADVANCE(367);
      END_STATE();
    case 86:
      if (lookahead == 'e') ADVANCE(363);
      END_STATE();
    case 87:
      if (lookahead == 'e') ADVANCE(166);
      END_STATE();
    case 88:
      if (lookahead == 'e') ADVANCE(164);
      END_STATE();
    case 89:
      if (lookahead == 'e') ADVANCE(193);
      END_STATE();
    case 90:
      if (lookahead == 'e') ADVANCE(191);
      END_STATE();
    case 91:
      if (lookahead == 'e') ADVANCE(151);
      END_STATE();
    case 92:
      if (lookahead == 'f') ADVANCE(221);
      if (lookahead == 'n') ADVANCE(140);
      END_STATE();
    case 93:
      if (lookahead == 'g') ADVANCE(219);
      END_STATE();
    case 94:
      if (lookahead == 'g') ADVANCE(215);
      END_STATE();
    case 95:
      if (lookahead == 'i') ADVANCE(79);
      END_STATE();
    case 96:
      if (lookahead == 'i') ADVANCE(80);
      END_STATE();
    case 97:
      if (lookahead == 'i') ADVANCE(104);
      END_STATE();
    case 98:
      if (lookahead == 'i') ADVANCE(108);
      END_STATE();
    case 99:
      if (lookahead == 'l') ADVANCE(133);
      END_STATE();
    case 100:
      if (lookahead == 'l') ADVANCE(137);
      END_STATE();
    case 101:
      if (lookahead == 'l') ADVANCE(138);
      END_STATE();
    case 102:
      if (lookahead == 'l') ADVANCE(72);
      if (lookahead == 'o') ADVANCE(111);
      END_STATE();
    case 103:
      if (lookahead == 'n') ADVANCE(75);
      END_STATE();
    case 104:
      if (lookahead == 'n') ADVANCE(93);
      END_STATE();
    case 105:
      if (lookahead == 'n') ADVANCE(237);
      END_STATE();
    case 106:
      if (lookahead == 'n') ADVANCE(233);
      END_STATE();
    case 107:
      if (lookahead == 'n') ADVANCE(76);
      END_STATE();
    case 108:
      if (lookahead == 'n') ADVANCE(94);
      END_STATE();
    case 109:
      if (lookahead == 'n') ADVANCE(135);
      END_STATE();
    case 110:
      if (lookahead == 'n') ADVANCE(77);
      END_STATE();
    case 111:
      if (lookahead == 'n') ADVANCE(139);
      END_STATE();
    case 112:
      if (lookahead == 'n') ADVANCE(78);
      END_STATE();
    case 113:
      if (lookahead == 'o') ADVANCE(69);
      END_STATE();
    case 114:
      if (lookahead == 'o') ADVANCE(148);
      END_STATE();
    case 115:
      if (lookahead == 'o') ADVANCE(145);
      END_STATE();
    case 116:
      if (lookahead == 'o') ADVANCE(71);
      END_STATE();
    case 117:
      if (lookahead == 'o') ADVANCE(150);
      END_STATE();
    case 118:
      if (lookahead == 'o') ADVANCE(153);
      END_STATE();
    case 119:
      if (lookahead == 'p') ADVANCE(89);
      END_STATE();
    case 120:
      if (lookahead == 'p') ADVANCE(90);
      END_STATE();
    case 121:
      if (lookahead == 'r') ADVANCE(183);
      END_STATE();
    case 122:
      if (lookahead == 'r') ADVANCE(179);
      END_STATE();
    case 123:
      if (lookahead == 'r') ADVANCE(97);
      END_STATE();
    case 124:
      if (lookahead == 'r') ADVANCE(105);
      END_STATE();
    case 125:
      if (lookahead == 'r') ADVANCE(106);
      END_STATE();
    case 126:
      if (lookahead == 'r') ADVANCE(156);
      END_STATE();
    case 127:
      if (lookahead == 'r') ADVANCE(98);
      END_STATE();
    case 128:
      if (lookahead == 'r') ADVANCE(118);
      END_STATE();
    case 129:
      if (lookahead == 's') ADVANCE(190);
      END_STATE();
    case 130:
      if (lookahead == 's') ADVANCE(188);
      END_STATE();
    case 131:
      if (lookahead == 's') ADVANCE(81);
      END_STATE();
    case 132:
      if (lookahead == 's') ADVANCE(147);
      if (lookahead == 't') ADVANCE(207);
      END_STATE();
    case 133:
      if (lookahead == 's') ADVANCE(83);
      END_STATE();
    case 134:
      if (lookahead == 's') ADVANCE(129);
      END_STATE();
    case 135:
      if (lookahead == 's') ADVANCE(141);
      END_STATE();
    case 136:
      if (lookahead == 's') ADVANCE(130);
      END_STATE();
    case 137:
      if (lookahead == 's') ADVANCE(85);
      END_STATE();
    case 138:
      if (lookahead == 's') ADVANCE(86);
      END_STATE();
    case 139:
      if (lookahead == 's') ADVANCE(143);
      END_STATE();
    case 140:
      if (lookahead == 's') ADVANCE(152);
      if (lookahead == 't') ADVANCE(203);
      END_STATE();
    case 141:
      if (lookahead == 't') ADVANCE(177);
      END_STATE();
    case 142:
      if (lookahead == 't') ADVANCE(213);
      END_STATE();
    case 143:
      if (lookahead == 't') ADVANCE(173);
      END_STATE();
    case 144:
      if (lookahead == 't') ADVANCE(209);
      END_STATE();
    case 145:
      if (lookahead == 't') ADVANCE(159);
      END_STATE();
    case 146:
      if (lookahead == 't') ADVANCE(157);
      END_STATE();
    case 147:
      if (lookahead == 't') ADVANCE(70);
      END_STATE();
    case 148:
      if (lookahead == 't') ADVANCE(115);
      END_STATE();
    case 149:
      if (lookahead == 't') ADVANCE(127);
      END_STATE();
    case 150:
      if (lookahead == 't') ADVANCE(160);
      END_STATE();
    case 151:
      if (lookahead == 't') ADVANCE(158);
      END_STATE();
    case 152:
      if (lookahead == 't') ADVANCE(73);
      END_STATE();
    case 153:
      if (lookahead == 't') ADVANCE(117);
      END_STATE();
    case 154:
      if (lookahead == 'u') ADVANCE(4);
      if (lookahead == 'x') ADVANCE(2);
      if (('0' <= lookahead && lookahead <= '7')) ADVANCE(1);
      if (lookahead != 0 &&
          lookahead != '\n') ADVANCE(5);
      END_STATE();
    case 155:
      if (lookahead == 'u') ADVANCE(82);
      END_STATE();
    case 156:
      if (lookahead == 'u') ADVANCE(84);
      END_STATE();
    case 157:
      if (lookahead == 'u') ADVANCE(124);
      END_STATE();
    case 158:
      if (lookahead == 'u') ADVANCE(125);
      END_STATE();
    case 159:
      if (lookahead == 'y') ADVANCE(119);
      END_STATE();
    case 160:
      if (lookahead == 'y') ADVANCE(120);
      END_STATE();
    case 161:
      if (lookahead == '|') ADVANCE(239);
      END_STATE();
    case 162:
      if (('0' <= lookahead && lookahead <= '9')) ADVANCE(355);
      END_STATE();
    case 163:
      ACCEPT_TOKEN(ts_builtin_sym_end);
      END_STATE();
    case 164:
      ACCEPT_TOKEN(anon_sym_instance);
      END_STATE();
    case 165:
      ACCEPT_TOKEN(anon_sym_INSTANCE);
      END_STATE();
    case 166:
      ACCEPT_TOKEN(anon_sym_Instance);
      END_STATE();
    case 167:
      ACCEPT_TOKEN(anon_sym_LPAREN);
      END_STATE();
    case 168:
      ACCEPT_TOKEN(anon_sym_RPAREN);
      END_STATE();
    case 169:
      ACCEPT_TOKEN(anon_sym_SEMI);
      END_STATE();
    case 170:
      ACCEPT_TOKEN(anon_sym_func);
      END_STATE();
    case 171:
      ACCEPT_TOKEN(anon_sym_FUNC);
      END_STATE();
    case 172:
      ACCEPT_TOKEN(anon_sym_Func);
      END_STATE();
    case 173:
      ACCEPT_TOKEN(anon_sym_const);
      END_STATE();
    case 174:
      ACCEPT_TOKEN(anon_sym_const);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 175:
      ACCEPT_TOKEN(anon_sym_CONST);
      END_STATE();
    case 176:
      ACCEPT_TOKEN(anon_sym_CONST);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 177:
      ACCEPT_TOKEN(anon_sym_Const);
      END_STATE();
    case 178:
      ACCEPT_TOKEN(anon_sym_Const);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 179:
      ACCEPT_TOKEN(anon_sym_var);
      END_STATE();
    case 180:
      ACCEPT_TOKEN(anon_sym_var);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 181:
      ACCEPT_TOKEN(anon_sym_VAR);
      END_STATE();
    case 182:
      ACCEPT_TOKEN(anon_sym_VAR);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 183:
      ACCEPT_TOKEN(anon_sym_Var);
      END_STATE();
    case 184:
      ACCEPT_TOKEN(anon_sym_Var);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 185:
      ACCEPT_TOKEN(anon_sym_LBRACK);
      END_STATE();
    case 186:
      ACCEPT_TOKEN(anon_sym_RBRACK);
      END_STATE();
    case 187:
      ACCEPT_TOKEN(anon_sym_EQ);
      if (lookahead == '=') ADVANCE(241);
      END_STATE();
    case 188:
      ACCEPT_TOKEN(anon_sym_class);
      END_STATE();
    case 189:
      ACCEPT_TOKEN(anon_sym_CLASS);
      END_STATE();
    case 190:
      ACCEPT_TOKEN(anon_sym_Class);
      END_STATE();
    case 191:
      ACCEPT_TOKEN(anon_sym_prototype);
      END_STATE();
    case 192:
      ACCEPT_TOKEN(anon_sym_PROTOTYPE);
      END_STATE();
    case 193:
      ACCEPT_TOKEN(anon_sym_Prototype);
      END_STATE();
    case 194:
      ACCEPT_TOKEN(anon_sym_LBRACE);
      END_STATE();
    case 195:
      ACCEPT_TOKEN(anon_sym_RBRACE);
      END_STATE();
    case 196:
      ACCEPT_TOKEN(anon_sym_COMMA);
      END_STATE();
    case 197:
      ACCEPT_TOKEN(anon_sym_void);
      END_STATE();
    case 198:
      ACCEPT_TOKEN(anon_sym_void);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 199:
      ACCEPT_TOKEN(anon_sym_VOID);
      END_STATE();
    case 200:
      ACCEPT_TOKEN(anon_sym_VOID);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 201:
      ACCEPT_TOKEN(anon_sym_Void);
      END_STATE();
    case 202:
      ACCEPT_TOKEN(anon_sym_Void);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 203:
      ACCEPT_TOKEN(anon_sym_int);
      END_STATE();
    case 204:
      ACCEPT_TOKEN(anon_sym_int);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 205:
      ACCEPT_TOKEN(anon_sym_INT);
      END_STATE();
    case 206:
      ACCEPT_TOKEN(anon_sym_INT);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 207:
      ACCEPT_TOKEN(anon_sym_Int);
      END_STATE();
    case 208:
      ACCEPT_TOKEN(anon_sym_Int);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 209:
      ACCEPT_TOKEN(anon_sym_float);
      END_STATE();
    case 210:
      ACCEPT_TOKEN(anon_sym_float);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 211:
      ACCEPT_TOKEN(anon_sym_FLOAT);
      END_STATE();
    case 212:
      ACCEPT_TOKEN(anon_sym_FLOAT);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 213:
      ACCEPT_TOKEN(anon_sym_Float);
      END_STATE();
    case 214:
      ACCEPT_TOKEN(anon_sym_Float);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 215:
      ACCEPT_TOKEN(anon_sym_string);
      END_STATE();
    case 216:
      ACCEPT_TOKEN(anon_sym_string);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 217:
      ACCEPT_TOKEN(anon_sym_STRING);
      END_STATE();
    case 218:
      ACCEPT_TOKEN(anon_sym_STRING);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 219:
      ACCEPT_TOKEN(anon_sym_String);
      END_STATE();
    case 220:
      ACCEPT_TOKEN(anon_sym_String);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 221:
      ACCEPT_TOKEN(anon_sym_if);
      END_STATE();
    case 222:
      ACCEPT_TOKEN(anon_sym_if);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 223:
      ACCEPT_TOKEN(anon_sym_IF);
      END_STATE();
    case 224:
      ACCEPT_TOKEN(anon_sym_IF);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 225:
      ACCEPT_TOKEN(anon_sym_If);
      END_STATE();
    case 226:
      ACCEPT_TOKEN(anon_sym_If);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 227:
      ACCEPT_TOKEN(anon_sym_else);
      END_STATE();
    case 228:
      ACCEPT_TOKEN(anon_sym_else);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 229:
      ACCEPT_TOKEN(anon_sym_ELSE);
      END_STATE();
    case 230:
      ACCEPT_TOKEN(anon_sym_ELSE);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 231:
      ACCEPT_TOKEN(anon_sym_Else);
      END_STATE();
    case 232:
      ACCEPT_TOKEN(anon_sym_Else);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 233:
      ACCEPT_TOKEN(anon_sym_return);
      END_STATE();
    case 234:
      ACCEPT_TOKEN(anon_sym_return);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 235:
      ACCEPT_TOKEN(anon_sym_RETURN);
      END_STATE();
    case 236:
      ACCEPT_TOKEN(anon_sym_RETURN);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 237:
      ACCEPT_TOKEN(anon_sym_Return);
      END_STATE();
    case 238:
      ACCEPT_TOKEN(anon_sym_Return);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 239:
      ACCEPT_TOKEN(anon_sym_PIPE_PIPE);
      END_STATE();
    case 240:
      ACCEPT_TOKEN(anon_sym_AMP_AMP);
      END_STATE();
    case 241:
      ACCEPT_TOKEN(anon_sym_EQ_EQ);
      END_STATE();
    case 242:
      ACCEPT_TOKEN(anon_sym_BANG_EQ);
      END_STATE();
    case 243:
      ACCEPT_TOKEN(anon_sym_LT);
      if (lookahead == '=') ADVANCE(244);
      END_STATE();
    case 244:
      ACCEPT_TOKEN(anon_sym_LT_EQ);
      END_STATE();
    case 245:
      ACCEPT_TOKEN(anon_sym_GT);
      if (lookahead == '=') ADVANCE(246);
      END_STATE();
    case 246:
      ACCEPT_TOKEN(anon_sym_GT_EQ);
      END_STATE();
    case 247:
      ACCEPT_TOKEN(anon_sym_PLUS);
      END_STATE();
    case 248:
      ACCEPT_TOKEN(anon_sym_DASH);
      END_STATE();
    case 249:
      ACCEPT_TOKEN(anon_sym_STAR);
      END_STATE();
    case 250:
      ACCEPT_TOKEN(anon_sym_SLASH);
      if (lookahead == '*') ADVANCE(14);
      if (lookahead == '/') ADVANCE(370);
      END_STATE();
    case 251:
      ACCEPT_TOKEN(anon_sym_PERCENT);
      END_STATE();
    case 252:
      ACCEPT_TOKEN(anon_sym_BANG);
      END_STATE();
    case 253:
      ACCEPT_TOKEN(anon_sym_BANG);
      if (lookahead == '=') ADVANCE(242);
      END_STATE();
    case 254:
      ACCEPT_TOKEN(anon_sym_TILDE);
      END_STATE();
    case 255:
      ACCEPT_TOKEN(anon_sym_DOT);
      END_STATE();
    case 256:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'A') ADVANCE(268);
      if (lookahead == 'a') ADVANCE(312);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('B' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('b' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 257:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'A') ADVANCE(280);
      if (lookahead == 'a') ADVANCE(328);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('B' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('b' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 258:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'A') ADVANCE(287);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('B' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 259:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'D') ADVANCE(200);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 260:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'E') ADVANCE(288);
      if (lookahead == 'e') ADVANCE(346);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 261:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'E') ADVANCE(360);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 262:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'E') ADVANCE(366);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 263:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'E') ADVANCE(230);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 264:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'F') ADVANCE(224);
      if (lookahead == 'f') ADVANCE(226);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 265:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'G') ADVANCE(218);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 266:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'I') ADVANCE(259);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 267:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'I') ADVANCE(272);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 268:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'L') ADVANCE(283);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 269:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'L') ADVANCE(276);
      if (lookahead == 'l') ADVANCE(323);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 270:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'L') ADVANCE(284);
      if (lookahead == 'l') ADVANCE(338);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 271:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'N') ADVANCE(236);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 272:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'N') ADVANCE(265);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 273:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'N') ADVANCE(282);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 274:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'N') ADVANCE(286);
      if (lookahead == 'n') ADVANCE(342);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 275:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'O') ADVANCE(266);
      if (lookahead == 'o') ADVANCE(308);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 276:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'O') ADVANCE(258);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 277:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'O') ADVANCE(273);
      if (lookahead == 'o') ADVANCE(319);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 278:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'R') ADVANCE(290);
      if (lookahead == 'r') ADVANCE(349);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 279:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'R') ADVANCE(271);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 280:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'R') ADVANCE(182);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 281:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'R') ADVANCE(267);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 282:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'S') ADVANCE(285);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 283:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'S') ADVANCE(262);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 284:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'S') ADVANCE(263);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 285:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'T') ADVANCE(176);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 286:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'T') ADVANCE(206);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 287:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'T') ADVANCE(212);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 288:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'T') ADVANCE(291);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 289:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'T') ADVANCE(281);
      if (lookahead == 't') ADVANCE(331);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 290:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'U') ADVANCE(261);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 291:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'U') ADVANCE(279);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 292:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'a') ADVANCE(329);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('b' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 293:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'a') ADVANCE(344);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('b' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 294:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'a') ADVANCE(345);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('b' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 295:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'a') ADVANCE(313);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('b' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 296:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'd') ADVANCE(202);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 297:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'd') ADVANCE(198);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 298:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'e') ADVANCE(362);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 299:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'e') ADVANCE(358);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 300:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'e') ADVANCE(368);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 301:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'e') ADVANCE(364);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 302:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'e') ADVANCE(232);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 303:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'e') ADVANCE(228);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 304:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'e') ADVANCE(347);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 305:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'f') ADVANCE(222);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 306:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'g') ADVANCE(220);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 307:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'g') ADVANCE(216);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 308:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'i') ADVANCE(296);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 309:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'i') ADVANCE(297);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 310:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'i') ADVANCE(318);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 311:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'i') ADVANCE(320);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 312:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'l') ADVANCE(336);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 313:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'l') ADVANCE(337);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 314:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'l') ADVANCE(326);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 315:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'l') ADVANCE(339);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 316:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'n') ADVANCE(238);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 317:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'n') ADVANCE(234);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 318:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'n') ADVANCE(306);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 319:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'n') ADVANCE(334);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 320:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'n') ADVANCE(307);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 321:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'n') ADVANCE(335);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 322:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'n') ADVANCE(343);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 323:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'o') ADVANCE(293);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 324:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'o') ADVANCE(321);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 325:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'o') ADVANCE(309);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 326:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'o') ADVANCE(294);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 327:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'r') ADVANCE(316);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 328:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'r') ADVANCE(184);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 329:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'r') ADVANCE(180);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 330:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'r') ADVANCE(317);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 331:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'r') ADVANCE(310);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 332:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'r') ADVANCE(351);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 333:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'r') ADVANCE(311);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 334:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 's') ADVANCE(340);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 335:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 's') ADVANCE(341);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 336:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 's') ADVANCE(300);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 337:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 's') ADVANCE(301);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 338:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 's') ADVANCE(302);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 339:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 's') ADVANCE(303);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 340:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 't') ADVANCE(178);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 341:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 't') ADVANCE(174);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 342:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 't') ADVANCE(208);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 343:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 't') ADVANCE(204);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 344:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 't') ADVANCE(214);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 345:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 't') ADVANCE(210);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 346:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 't') ADVANCE(350);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 347:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 't') ADVANCE(352);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 348:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 't') ADVANCE(333);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 349:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'u') ADVANCE(298);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 350:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'u') ADVANCE(327);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 351:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'u') ADVANCE(299);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 352:
      ACCEPT_TOKEN(sym_identifier);
      if (lookahead == 'u') ADVANCE(330);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 353:
      ACCEPT_TOKEN(sym_identifier);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 354:
      ACCEPT_TOKEN(sym_number);
      if (lookahead == '.') ADVANCE(162);
      if (('0' <= lookahead && lookahead <= '9')) ADVANCE(354);
      END_STATE();
    case 355:
      ACCEPT_TOKEN(sym_number);
      if (('0' <= lookahead && lookahead <= '9')) ADVANCE(355);
      END_STATE();
    case 356:
      ACCEPT_TOKEN(sym_string);
      END_STATE();
    case 357:
      ACCEPT_TOKEN(anon_sym_true);
      END_STATE();
    case 358:
      ACCEPT_TOKEN(anon_sym_true);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 359:
      ACCEPT_TOKEN(anon_sym_TRUE);
      END_STATE();
    case 360:
      ACCEPT_TOKEN(anon_sym_TRUE);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 361:
      ACCEPT_TOKEN(anon_sym_True);
      END_STATE();
    case 362:
      ACCEPT_TOKEN(anon_sym_True);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 363:
      ACCEPT_TOKEN(anon_sym_false);
      END_STATE();
    case 364:
      ACCEPT_TOKEN(anon_sym_false);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 365:
      ACCEPT_TOKEN(anon_sym_FALSE);
      END_STATE();
    case 366:
      ACCEPT_TOKEN(anon_sym_FALSE);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 367:
      ACCEPT_TOKEN(anon_sym_False);
      END_STATE();
    case 368:
      ACCEPT_TOKEN(anon_sym_False);
      if (('0' <= lookahead && lookahead <= '9') ||
          ('A' <= lookahead && lookahead <= 'Z') ||
          lookahead == '_' ||
          ('a' <= lookahead && lookahead <= 'z')) ADVANCE(353);
      END_STATE();
    case 369:
      ACCEPT_TOKEN(sym_comment);
      END_STATE();
    case 370:
      ACCEPT_TOKEN(sym_comment);
      if (lookahead != 0 &&
          lookahead != '\n' &&
          lookahead != '\r') ADVANCE(370);
      END_STATE();
    default:
      return false;
  }
}

static const TSLexMode ts_lex_modes[STATE_COUNT] = {
  [0] = {.lex_state = 0},
  [1] = {.lex_state = 0},
  [2] = {.lex_state = 6},
  [3] = {.lex_state = 6},
  [4] = {.lex_state = 6},
  [5] = {.lex_state = 6},
  [6] = {.lex_state = 6},
  [7] = {.lex_state = 6},
  [8] = {.lex_state = 6},
  [9] = {.lex_state = 6},
  [10] = {.lex_state = 6},
  [11] = {.lex_state = 6},
  [12] = {.lex_state = 6},
  [13] = {.lex_state = 6},
  [14] = {.lex_state = 6},
  [15] = {.lex_state = 6},
  [16] = {.lex_state = 6},
  [17] = {.lex_state = 6},
  [18] = {.lex_state = 6},
  [19] = {.lex_state = 6},
  [20] = {.lex_state = 6},
  [21] = {.lex_state = 6},
  [22] = {.lex_state = 6},
  [23] = {.lex_state = 6},
  [24] = {.lex_state = 9},
  [25] = {.lex_state = 9},
  [26] = {.lex_state = 9},
  [27] = {.lex_state = 0},
  [28] = {.lex_state = 0},
  [29] = {.lex_state = 8},
  [30] = {.lex_state = 8},
  [31] = {.lex_state = 8},
  [32] = {.lex_state = 7},
  [33] = {.lex_state = 8},
  [34] = {.lex_state = 7},
  [35] = {.lex_state = 6},
  [36] = {.lex_state = 7},
  [37] = {.lex_state = 6},
  [38] = {.lex_state = 6},
  [39] = {.lex_state = 7},
  [40] = {.lex_state = 7},
  [41] = {.lex_state = 7},
  [42] = {.lex_state = 7},
  [43] = {.lex_state = 7},
  [44] = {.lex_state = 7},
  [45] = {.lex_state = 7},
  [46] = {.lex_state = 7},
  [47] = {.lex_state = 6},
  [48] = {.lex_state = 7},
  [49] = {.lex_state = 7},
  [50] = {.lex_state = 7},
  [51] = {.lex_state = 7},
  [52] = {.lex_state = 7},
  [53] = {.lex_state = 7},
  [54] = {.lex_state = 7},
  [55] = {.lex_state = 7},
  [56] = {.lex_state = 7},
  [57] = {.lex_state = 7},
  [58] = {.lex_state = 6},
  [59] = {.lex_state = 9},
  [60] = {.lex_state = 6},
  [61] = {.lex_state = 6},
  [62] = {.lex_state = 9},
  [63] = {.lex_state = 6},
  [64] = {.lex_state = 6},
  [65] = {.lex_state = 9},
  [66] = {.lex_state = 9},
  [67] = {.lex_state = 6},
  [68] = {.lex_state = 9},
  [69] = {.lex_state = 0},
  [70] = {.lex_state = 0},
  [71] = {.lex_state = 0},
  [72] = {.lex_state = 0},
  [73] = {.lex_state = 0},
  [74] = {.lex_state = 0},
  [75] = {.lex_state = 0},
  [76] = {.lex_state = 0},
  [77] = {.lex_state = 0},
  [78] = {.lex_state = 0},
  [79] = {.lex_state = 0},
  [80] = {.lex_state = 0},
  [81] = {.lex_state = 0},
  [82] = {.lex_state = 0},
  [83] = {.lex_state = 0},
  [84] = {.lex_state = 0},
  [85] = {.lex_state = 0},
  [86] = {.lex_state = 0},
  [87] = {.lex_state = 0},
  [88] = {.lex_state = 0},
  [89] = {.lex_state = 0},
  [90] = {.lex_state = 0},
  [91] = {.lex_state = 0},
  [92] = {.lex_state = 11},
  [93] = {.lex_state = 0},
  [94] = {.lex_state = 0},
  [95] = {.lex_state = 0},
  [96] = {.lex_state = 0},
  [97] = {.lex_state = 0},
  [98] = {.lex_state = 0},
  [99] = {.lex_state = 0},
  [100] = {.lex_state = 0},
  [101] = {.lex_state = 0},
  [102] = {.lex_state = 0},
  [103] = {.lex_state = 0},
  [104] = {.lex_state = 11},
  [105] = {.lex_state = 11},
  [106] = {.lex_state = 11},
  [107] = {.lex_state = 11},
  [108] = {.lex_state = 0},
  [109] = {.lex_state = 0},
  [110] = {.lex_state = 0},
  [111] = {.lex_state = 0},
  [112] = {.lex_state = 0},
  [113] = {.lex_state = 0},
  [114] = {.lex_state = 0},
  [115] = {.lex_state = 0},
  [116] = {.lex_state = 0},
  [117] = {.lex_state = 0},
  [118] = {.lex_state = 0},
  [119] = {.lex_state = 0},
  [120] = {.lex_state = 0},
  [121] = {.lex_state = 0},
  [122] = {.lex_state = 0},
  [123] = {.lex_state = 0},
  [124] = {.lex_state = 0},
  [125] = {.lex_state = 0},
  [126] = {.lex_state = 0},
  [127] = {.lex_state = 15},
  [128] = {.lex_state = 15},
  [129] = {.lex_state = 0},
  [130] = {.lex_state = 0},
  [131] = {.lex_state = 0},
  [132] = {.lex_state = 0},
  [133] = {.lex_state = 15},
  [134] = {.lex_state = 15},
  [135] = {.lex_state = 15},
  [136] = {.lex_state = 15},
  [137] = {.lex_state = 0},
  [138] = {.lex_state = 15},
  [139] = {.lex_state = 0},
  [140] = {.lex_state = 0},
  [141] = {.lex_state = 15},
  [142] = {.lex_state = 15},
  [143] = {.lex_state = 0},
  [144] = {.lex_state = 0},
  [145] = {.lex_state = 15},
};

static const uint16_t ts_parse_table[LARGE_STATE_COUNT][SYMBOL_COUNT] = {
  [0] = {
    [ts_builtin_sym_end] = ACTIONS(1),
    [anon_sym_instance] = ACTIONS(1),
    [anon_sym_INSTANCE] = ACTIONS(1),
    [anon_sym_Instance] = ACTIONS(1),
    [anon_sym_LPAREN] = ACTIONS(1),
    [anon_sym_RPAREN] = ACTIONS(1),
    [anon_sym_SEMI] = ACTIONS(1),
    [anon_sym_func] = ACTIONS(1),
    [anon_sym_FUNC] = ACTIONS(1),
    [anon_sym_Func] = ACTIONS(1),
    [anon_sym_const] = ACTIONS(1),
    [anon_sym_CONST] = ACTIONS(1),
    [anon_sym_Const] = ACTIONS(1),
    [anon_sym_var] = ACTIONS(1),
    [anon_sym_VAR] = ACTIONS(1),
    [anon_sym_Var] = ACTIONS(1),
    [anon_sym_LBRACK] = ACTIONS(1),
    [anon_sym_RBRACK] = ACTIONS(1),
    [anon_sym_EQ] = ACTIONS(1),
    [anon_sym_class] = ACTIONS(1),
    [anon_sym_CLASS] = ACTIONS(1),
    [anon_sym_Class] = ACTIONS(1),
    [anon_sym_prototype] = ACTIONS(1),
    [anon_sym_PROTOTYPE] = ACTIONS(1),
    [anon_sym_Prototype] = ACTIONS(1),
    [anon_sym_LBRACE] = ACTIONS(1),
    [anon_sym_RBRACE] = ACTIONS(1),
    [anon_sym_COMMA] = ACTIONS(1),
    [anon_sym_void] = ACTIONS(1),
    [anon_sym_VOID] = ACTIONS(1),
    [anon_sym_Void] = ACTIONS(1),
    [anon_sym_int] = ACTIONS(1),
    [anon_sym_INT] = ACTIONS(1),
    [anon_sym_Int] = ACTIONS(1),
    [anon_sym_float] = ACTIONS(1),
    [anon_sym_FLOAT] = ACTIONS(1),
    [anon_sym_Float] = ACTIONS(1),
    [anon_sym_string] = ACTIONS(1),
    [anon_sym_STRING] = ACTIONS(1),
    [anon_sym_String] = ACTIONS(1),
    [anon_sym_if] = ACTIONS(1),
    [anon_sym_IF] = ACTIONS(1),
    [anon_sym_If] = ACTIONS(1),
    [anon_sym_else] = ACTIONS(1),
    [anon_sym_ELSE] = ACTIONS(1),
    [anon_sym_Else] = ACTIONS(1),
    [anon_sym_return] = ACTIONS(1),
    [anon_sym_RETURN] = ACTIONS(1),
    [anon_sym_Return] = ACTIONS(1),
    [anon_sym_PIPE_PIPE] = ACTIONS(1),
    [anon_sym_AMP_AMP] = ACTIONS(1),
    [anon_sym_EQ_EQ] = ACTIONS(1),
    [anon_sym_BANG_EQ] = ACTIONS(1),
    [anon_sym_LT] = ACTIONS(1),
    [anon_sym_LT_EQ] = ACTIONS(1),
    [anon_sym_GT] = ACTIONS(1),
    [anon_sym_GT_EQ] = ACTIONS(1),
    [anon_sym_PLUS] = ACTIONS(1),
    [anon_sym_DASH] = ACTIONS(1),
    [anon_sym_STAR] = ACTIONS(1),
    [anon_sym_SLASH] = ACTIONS(1),
    [anon_sym_PERCENT] = ACTIONS(1),
    [anon_sym_BANG] = ACTIONS(1),
    [anon_sym_TILDE] = ACTIONS(1),
    [anon_sym_DOT] = ACTIONS(1),
    [sym_number] = ACTIONS(1),
    [sym_string] = ACTIONS(1),
    [anon_sym_true] = ACTIONS(1),
    [anon_sym_TRUE] = ACTIONS(1),
    [anon_sym_True] = ACTIONS(1),
    [anon_sym_false] = ACTIONS(1),
    [anon_sym_FALSE] = ACTIONS(1),
    [anon_sym_False] = ACTIONS(1),
    [sym_comment] = ACTIONS(3),
  },
  [1] = {
    [sym_program] = STATE(139),
    [sym__declaration] = STATE(27),
    [sym_instance_declaration] = STATE(27),
    [sym_function_declaration] = STATE(27),
    [sym_variable_declaration] = STATE(27),
    [sym_class_declaration] = STATE(27),
    [sym_prototype_declaration] = STATE(27),
    [aux_sym_program_repeat1] = STATE(27),
    [ts_builtin_sym_end] = ACTIONS(5),
    [anon_sym_instance] = ACTIONS(7),
    [anon_sym_INSTANCE] = ACTIONS(7),
    [anon_sym_Instance] = ACTIONS(7),
    [anon_sym_func] = ACTIONS(9),
    [anon_sym_FUNC] = ACTIONS(9),
    [anon_sym_Func] = ACTIONS(9),
    [anon_sym_const] = ACTIONS(11),
    [anon_sym_CONST] = ACTIONS(11),
    [anon_sym_Const] = ACTIONS(11),
    [anon_sym_var] = ACTIONS(11),
    [anon_sym_VAR] = ACTIONS(11),
    [anon_sym_Var] = ACTIONS(11),
    [anon_sym_class] = ACTIONS(13),
    [anon_sym_CLASS] = ACTIONS(13),
    [anon_sym_Class] = ACTIONS(13),
    [anon_sym_prototype] = ACTIONS(15),
    [anon_sym_PROTOTYPE] = ACTIONS(15),
    [anon_sym_Prototype] = ACTIONS(15),
    [sym_comment] = ACTIONS(3),
  },
};

static const uint16_t ts_small_parse_table[] = {
  [0] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(19), 18,
      anon_sym_EQ,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_LT,
      anon_sym_GT,
      anon_sym_SLASH,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    ACTIONS(17), 21,
      anon_sym_LPAREN,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_LBRACK,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_STAR,
      anon_sym_PERCENT,
      anon_sym_TILDE,
      anon_sym_DOT,
      sym_number,
      sym_string,
  [47] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(23), 18,
      anon_sym_EQ,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_LT,
      anon_sym_GT,
      anon_sym_SLASH,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    ACTIONS(21), 21,
      anon_sym_LPAREN,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_LBRACK,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_STAR,
      anon_sym_PERCENT,
      anon_sym_TILDE,
      anon_sym_DOT,
      sym_number,
      sym_string,
  [94] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(29), 16,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_LT,
      anon_sym_GT,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    ACTIONS(25), 17,
      anon_sym_LPAREN,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_TILDE,
      sym_number,
      sym_string,
  [148] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(39), 17,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_LT,
      anon_sym_GT,
      anon_sym_SLASH,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    ACTIONS(37), 21,
      anon_sym_LPAREN,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_LBRACK,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_STAR,
      anon_sym_PERCENT,
      anon_sym_TILDE,
      anon_sym_DOT,
      sym_number,
      sym_string,
  [194] = 5,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(29), 17,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_LT,
      anon_sym_GT,
      anon_sym_SLASH,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    ACTIONS(25), 19,
      anon_sym_LPAREN,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_STAR,
      anon_sym_PERCENT,
      anon_sym_TILDE,
      sym_number,
      sym_string,
  [244] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(43), 17,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_LT,
      anon_sym_GT,
      anon_sym_SLASH,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    ACTIONS(41), 21,
      anon_sym_LPAREN,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_LBRACK,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_STAR,
      anon_sym_PERCENT,
      anon_sym_TILDE,
      anon_sym_DOT,
      sym_number,
      sym_string,
  [290] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(47), 17,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_LT,
      anon_sym_GT,
      anon_sym_SLASH,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    ACTIONS(45), 21,
      anon_sym_LPAREN,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_LBRACK,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_STAR,
      anon_sym_PERCENT,
      anon_sym_TILDE,
      anon_sym_DOT,
      sym_number,
      sym_string,
  [336] = 5,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(51), 17,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_LT,
      anon_sym_GT,
      anon_sym_SLASH,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    ACTIONS(49), 19,
      anon_sym_LPAREN,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_STAR,
      anon_sym_PERCENT,
      anon_sym_TILDE,
      sym_number,
      sym_string,
  [386] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
    ACTIONS(25), 9,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(29), 14,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [452] = 11,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
    ACTIONS(25), 11,
      anon_sym_LPAREN,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(29), 14,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [514] = 10,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
    ACTIONS(25), 13,
      anon_sym_LPAREN,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(29), 14,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [574] = 8,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
    ACTIONS(25), 15,
      anon_sym_LPAREN,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(29), 16,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_LT,
      anon_sym_GT,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [630] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(67), 17,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_LT,
      anon_sym_GT,
      anon_sym_SLASH,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    ACTIONS(65), 21,
      anon_sym_LPAREN,
      anon_sym_RPAREN,
      anon_sym_SEMI,
      anon_sym_LBRACK,
      anon_sym_RBRACK,
      anon_sym_RBRACE,
      anon_sym_COMMA,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_STAR,
      anon_sym_PERCENT,
      anon_sym_TILDE,
      anon_sym_DOT,
      sym_number,
      sym_string,
  [676] = 4,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(71), 1,
      anon_sym_EQ,
    ACTIONS(73), 17,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_LT,
      anon_sym_GT,
      anon_sym_SLASH,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    ACTIONS(69), 18,
      anon_sym_LPAREN,
      anon_sym_SEMI,
      anon_sym_LBRACK,
      anon_sym_RBRACE,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_STAR,
      anon_sym_PERCENT,
      anon_sym_TILDE,
      anon_sym_DOT,
      sym_number,
      sym_string,
  [722] = 12,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(77), 1,
      anon_sym_RBRACE,
    ACTIONS(85), 1,
      sym_identifier,
    ACTIONS(87), 2,
      sym_number,
      sym_string,
    STATE(15), 2,
      sym_array_access,
      sym_member_access,
    ACTIONS(79), 3,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
    ACTIONS(81), 3,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(17), 6,
      sym__statement,
      sym_assignment_statement,
      sym_expression_statement,
      sym_if_statement,
      sym_return_statement,
      aux_sym_block_repeat1,
    STATE(18), 6,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [783] = 12,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(85), 1,
      sym_identifier,
    ACTIONS(91), 1,
      anon_sym_RBRACE,
    ACTIONS(87), 2,
      sym_number,
      sym_string,
    STATE(15), 2,
      sym_array_access,
      sym_member_access,
    ACTIONS(79), 3,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
    ACTIONS(81), 3,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(18), 6,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
    STATE(23), 6,
      sym__statement,
      sym_assignment_statement,
      sym_expression_statement,
      sym_if_statement,
      sym_return_statement,
      aux_sym_block_repeat1,
  [844] = 15,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(93), 1,
      anon_sym_SEMI,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
    ACTIONS(95), 4,
      anon_sym_RBRACE,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(97), 14,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      anon_sym_BANG,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [911] = 12,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(85), 1,
      sym_identifier,
    ACTIONS(101), 1,
      anon_sym_RBRACE,
    ACTIONS(87), 2,
      sym_number,
      sym_string,
    STATE(15), 2,
      sym_array_access,
      sym_member_access,
    ACTIONS(79), 3,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
    ACTIONS(81), 3,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(18), 6,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
    STATE(21), 6,
      sym__statement,
      sym_assignment_statement,
      sym_expression_statement,
      sym_if_statement,
      sym_return_statement,
      aux_sym_block_repeat1,
  [972] = 12,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(85), 1,
      sym_identifier,
    ACTIONS(103), 1,
      anon_sym_RBRACE,
    ACTIONS(87), 2,
      sym_number,
      sym_string,
    STATE(15), 2,
      sym_array_access,
      sym_member_access,
    ACTIONS(79), 3,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
    ACTIONS(81), 3,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(18), 6,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
    STATE(23), 6,
      sym__statement,
      sym_assignment_statement,
      sym_expression_statement,
      sym_if_statement,
      sym_return_statement,
      aux_sym_block_repeat1,
  [1033] = 12,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(85), 1,
      sym_identifier,
    ACTIONS(105), 1,
      anon_sym_RBRACE,
    ACTIONS(87), 2,
      sym_number,
      sym_string,
    STATE(15), 2,
      sym_array_access,
      sym_member_access,
    ACTIONS(79), 3,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
    ACTIONS(81), 3,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(18), 6,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
    STATE(23), 6,
      sym__statement,
      sym_assignment_statement,
      sym_expression_statement,
      sym_if_statement,
      sym_return_statement,
      aux_sym_block_repeat1,
  [1094] = 12,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(85), 1,
      sym_identifier,
    ACTIONS(107), 1,
      anon_sym_RBRACE,
    ACTIONS(87), 2,
      sym_number,
      sym_string,
    STATE(15), 2,
      sym_array_access,
      sym_member_access,
    ACTIONS(79), 3,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
    ACTIONS(81), 3,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(18), 6,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
    STATE(20), 6,
      sym__statement,
      sym_assignment_statement,
      sym_expression_statement,
      sym_if_statement,
      sym_return_statement,
      aux_sym_block_repeat1,
  [1155] = 12,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(109), 1,
      anon_sym_LPAREN,
    ACTIONS(112), 1,
      anon_sym_RBRACE,
    ACTIONS(123), 1,
      sym_identifier,
    ACTIONS(126), 2,
      sym_number,
      sym_string,
    STATE(15), 2,
      sym_array_access,
      sym_member_access,
    ACTIONS(114), 3,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
    ACTIONS(117), 3,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
    ACTIONS(120), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(129), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(18), 6,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
    STATE(23), 6,
      sym__statement,
      sym_assignment_statement,
      sym_expression_statement,
      sym_if_statement,
      sym_return_statement,
      aux_sym_block_repeat1,
  [1216] = 11,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(132), 1,
      anon_sym_LPAREN,
    ACTIONS(138), 1,
      anon_sym_RBRACE,
    ACTIONS(143), 1,
      sym_identifier,
    ACTIONS(146), 2,
      sym_number,
      sym_string,
    STATE(91), 2,
      sym_array_access,
      sym_member_access,
    STATE(24), 3,
      sym_variable_declaration,
      sym_assignment_statement,
      aux_sym_class_body_repeat1,
    ACTIONS(140), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(135), 6,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
    ACTIONS(149), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(103), 6,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [1272] = 11,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(154), 1,
      anon_sym_RBRACE,
    ACTIONS(156), 1,
      sym_identifier,
    ACTIONS(158), 2,
      sym_number,
      sym_string,
    STATE(91), 2,
      sym_array_access,
      sym_member_access,
    STATE(26), 3,
      sym_variable_declaration,
      sym_assignment_statement,
      aux_sym_class_body_repeat1,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    ACTIONS(152), 6,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
    STATE(103), 6,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [1328] = 11,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(156), 1,
      sym_identifier,
    ACTIONS(160), 1,
      anon_sym_RBRACE,
    ACTIONS(158), 2,
      sym_number,
      sym_string,
    STATE(91), 2,
      sym_array_access,
      sym_member_access,
    STATE(24), 3,
      sym_variable_declaration,
      sym_assignment_statement,
      aux_sym_class_body_repeat1,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    ACTIONS(152), 6,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
    STATE(103), 6,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [1384] = 8,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(162), 1,
      ts_builtin_sym_end,
    ACTIONS(7), 3,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
    ACTIONS(9), 3,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
    ACTIONS(13), 3,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
    ACTIONS(15), 3,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
    ACTIONS(11), 6,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
    STATE(28), 7,
      sym__declaration,
      sym_instance_declaration,
      sym_function_declaration,
      sym_variable_declaration,
      sym_class_declaration,
      sym_prototype_declaration,
      aux_sym_program_repeat1,
  [1428] = 8,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(164), 1,
      ts_builtin_sym_end,
    ACTIONS(166), 3,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
    ACTIONS(169), 3,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
    ACTIONS(175), 3,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
    ACTIONS(178), 3,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
    ACTIONS(172), 6,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
    STATE(28), 7,
      sym__declaration,
      sym_instance_declaration,
      sym_function_declaration,
      sym_variable_declaration,
      sym_class_declaration,
      sym_prototype_declaration,
      aux_sym_program_repeat1,
  [1472] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(181), 9,
      anon_sym_LPAREN,
      anon_sym_SEMI,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(183), 16,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_else,
      anon_sym_ELSE,
      anon_sym_Else,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [1505] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(185), 9,
      anon_sym_LPAREN,
      anon_sym_SEMI,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(187), 16,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_else,
      anon_sym_ELSE,
      anon_sym_Else,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [1538] = 5,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(191), 1,
      anon_sym_SEMI,
    ACTIONS(195), 3,
      anon_sym_else,
      anon_sym_ELSE,
      anon_sym_Else,
    ACTIONS(189), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(193), 13,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [1575] = 9,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(197), 1,
      anon_sym_RPAREN,
    ACTIONS(199), 1,
      sym_identifier,
    STATE(144), 1,
      sym_argument_list,
    ACTIONS(201), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(78), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [1619] = 4,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(207), 3,
      anon_sym_else,
      anon_sym_ELSE,
      anon_sym_Else,
    ACTIONS(203), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(205), 13,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [1653] = 8,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(209), 1,
      anon_sym_SEMI,
    ACTIONS(211), 1,
      sym_identifier,
    ACTIONS(213), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(100), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [1694] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(181), 9,
      anon_sym_LPAREN,
      anon_sym_SEMI,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(183), 13,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [1724] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(215), 1,
      sym_identifier,
    ACTIONS(217), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(98), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [1762] = 4,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(221), 1,
      anon_sym_SEMI,
    ACTIONS(219), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(223), 13,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [1794] = 4,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(227), 1,
      anon_sym_SEMI,
    ACTIONS(225), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(229), 13,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [1826] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(231), 1,
      sym_identifier,
    ACTIONS(233), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(101), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [1864] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(235), 1,
      sym_identifier,
    ACTIONS(237), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(99), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [1902] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(239), 1,
      sym_identifier,
    ACTIONS(241), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(90), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [1940] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(243), 1,
      sym_identifier,
    ACTIONS(245), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(10), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [1978] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(247), 1,
      sym_identifier,
    ACTIONS(249), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(95), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2016] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(251), 1,
      sym_identifier,
    ACTIONS(253), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(97), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2054] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(255), 1,
      sym_identifier,
    ACTIONS(257), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(102), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2092] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(259), 1,
      sym_identifier,
    ACTIONS(261), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(89), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2130] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(185), 9,
      anon_sym_LPAREN,
      anon_sym_SEMI,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(187), 13,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [2160] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(263), 1,
      sym_identifier,
    ACTIONS(265), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(11), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2198] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(267), 1,
      sym_identifier,
    ACTIONS(269), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(12), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2236] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(271), 1,
      sym_identifier,
    ACTIONS(273), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(13), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2274] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(275), 1,
      sym_identifier,
    ACTIONS(277), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(4), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2312] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(279), 1,
      sym_identifier,
    ACTIONS(281), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(6), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2350] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(283), 1,
      sym_identifier,
    ACTIONS(285), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(88), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2388] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(287), 1,
      sym_identifier,
    ACTIONS(289), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(93), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2426] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(291), 1,
      sym_identifier,
    ACTIONS(293), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(9), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2464] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(295), 1,
      sym_identifier,
    ACTIONS(297), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(94), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2502] = 7,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(75), 1,
      anon_sym_LPAREN,
    ACTIONS(299), 1,
      sym_identifier,
    ACTIONS(301), 2,
      sym_number,
      sym_string,
    ACTIONS(83), 4,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
    ACTIONS(89), 6,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
    STATE(96), 8,
      sym__expression,
      sym_binary_expression,
      sym_unary_expression,
      sym_array_access,
      sym_member_access,
      sym_call_expression,
      sym_parenthesized_expression,
      sym_boolean,
  [2540] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(303), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(305), 13,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [2569] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(307), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(309), 13,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [2598] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(311), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(313), 13,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [2627] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(315), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(317), 13,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [2656] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(319), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(321), 13,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [2685] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(323), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(325), 13,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [2714] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(327), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(329), 13,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [2743] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(331), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(333), 13,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [2772] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(335), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(337), 13,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [2801] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(331), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(333), 13,
      anon_sym_if,
      anon_sym_IF,
      anon_sym_If,
      anon_sym_return,
      anon_sym_RETURN,
      anon_sym_Return,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [2830] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(339), 8,
      anon_sym_LPAREN,
      anon_sym_RBRACE,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_BANG,
      anon_sym_TILDE,
      sym_number,
      sym_string,
    ACTIONS(341), 13,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      sym_identifier,
      anon_sym_true,
      anon_sym_TRUE,
      anon_sym_True,
      anon_sym_false,
      anon_sym_FALSE,
      anon_sym_False,
  [2859] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(345), 1,
      anon_sym_SEMI,
    ACTIONS(343), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [2887] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(347), 20,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_SEMI,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [2913] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(185), 20,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_SEMI,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [2939] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(351), 1,
      anon_sym_SEMI,
    ACTIONS(349), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [2967] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(353), 20,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_SEMI,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [2993] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(357), 1,
      anon_sym_SEMI,
    ACTIONS(355), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3021] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(361), 1,
      anon_sym_SEMI,
    ACTIONS(359), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3049] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(181), 20,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_SEMI,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3075] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(365), 1,
      anon_sym_SEMI,
    ACTIONS(363), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3103] = 15,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(367), 1,
      anon_sym_RPAREN,
    ACTIONS(369), 1,
      anon_sym_COMMA,
    STATE(111), 1,
      aux_sym_argument_list_repeat1,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [3154] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(319), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3179] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(371), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3204] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(307), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3229] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(335), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3254] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(373), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3279] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(375), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3304] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(377), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3329] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(339), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3354] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(379), 19,
      ts_builtin_sym_end,
      anon_sym_instance,
      anon_sym_INSTANCE,
      anon_sym_Instance,
      anon_sym_func,
      anon_sym_FUNC,
      anon_sym_Func,
      anon_sym_const,
      anon_sym_CONST,
      anon_sym_Const,
      anon_sym_var,
      anon_sym_VAR,
      anon_sym_Var,
      anon_sym_class,
      anon_sym_CLASS,
      anon_sym_Class,
      anon_sym_prototype,
      anon_sym_PROTOTYPE,
      anon_sym_Prototype,
  [3379] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
    ACTIONS(381), 2,
      anon_sym_RPAREN,
      anon_sym_COMMA,
  [3425] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(383), 1,
      anon_sym_RPAREN,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [3470] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(385), 1,
      anon_sym_SEMI,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [3515] = 4,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(387), 1,
      anon_sym_EQ,
    ACTIONS(73), 3,
      anon_sym_LT,
      anon_sym_GT,
      anon_sym_SLASH,
    ACTIONS(69), 13,
      anon_sym_LPAREN,
      anon_sym_LBRACK,
      anon_sym_PIPE_PIPE,
      anon_sym_AMP_AMP,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
      anon_sym_PLUS,
      anon_sym_DASH,
      anon_sym_STAR,
      anon_sym_PERCENT,
      anon_sym_DOT,
  [3542] = 6,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(389), 1,
      anon_sym_RPAREN,
    STATE(113), 1,
      sym_parameter,
    STATE(130), 1,
      sym_parameter_list,
    STATE(133), 1,
      sym__type,
    ACTIONS(391), 13,
      anon_sym_void,
      anon_sym_VOID,
      anon_sym_Void,
      anon_sym_int,
      anon_sym_INT,
      anon_sym_Int,
      anon_sym_float,
      anon_sym_FLOAT,
      anon_sym_Float,
      anon_sym_string,
      anon_sym_STRING,
      anon_sym_String,
      sym_identifier,
  [3573] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(393), 1,
      anon_sym_RBRACK,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [3618] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(395), 1,
      anon_sym_SEMI,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [3663] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(397), 1,
      anon_sym_RBRACK,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [3708] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(399), 1,
      anon_sym_RPAREN,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [3753] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(401), 1,
      anon_sym_SEMI,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [3798] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(403), 1,
      anon_sym_RBRACK,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [3843] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(405), 1,
      anon_sym_SEMI,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [3888] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(407), 1,
      anon_sym_SEMI,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [3933] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(409), 1,
      anon_sym_SEMI,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [3978] = 13,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(411), 1,
      anon_sym_SEMI,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [4023] = 12,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(27), 1,
      anon_sym_LBRACK,
    ACTIONS(33), 1,
      anon_sym_SLASH,
    ACTIONS(35), 1,
      anon_sym_DOT,
    ACTIONS(53), 1,
      anon_sym_LPAREN,
    ACTIONS(55), 1,
      anon_sym_AMP_AMP,
    ACTIONS(99), 1,
      anon_sym_PIPE_PIPE,
    ACTIONS(31), 2,
      anon_sym_STAR,
      anon_sym_PERCENT,
    ACTIONS(57), 2,
      anon_sym_EQ_EQ,
      anon_sym_BANG_EQ,
    ACTIONS(59), 2,
      anon_sym_LT,
      anon_sym_GT,
    ACTIONS(61), 2,
      anon_sym_LT_EQ,
      anon_sym_GT_EQ,
    ACTIONS(63), 2,
      anon_sym_PLUS,
      anon_sym_DASH,
  [4065] = 4,
    ACTIONS(3), 1,
      sym_comment,
    STATE(120), 1,
      sym_parameter,
    STATE(133), 1,
      sym__type,
    ACTIONS(391), 13,
      anon_sym_void,
      anon_sym_VOID,
      anon_sym_Void,
      anon_sym_int,
      anon_sym_INT,
      anon_sym_Int,
      anon_sym_float,
      anon_sym_FLOAT,
      anon_sym_Float,
      anon_sym_string,
      anon_sym_STRING,
      anon_sym_String,
      sym_identifier,
  [4090] = 3,
    ACTIONS(3), 1,
      sym_comment,
    STATE(136), 1,
      sym__type,
    ACTIONS(413), 13,
      anon_sym_void,
      anon_sym_VOID,
      anon_sym_Void,
      anon_sym_int,
      anon_sym_INT,
      anon_sym_Int,
      anon_sym_float,
      anon_sym_FLOAT,
      anon_sym_Float,
      anon_sym_string,
      anon_sym_STRING,
      anon_sym_String,
      sym_identifier,
  [4112] = 3,
    ACTIONS(3), 1,
      sym_comment,
    STATE(138), 1,
      sym__type,
    ACTIONS(415), 13,
      anon_sym_void,
      anon_sym_VOID,
      anon_sym_Void,
      anon_sym_int,
      anon_sym_INT,
      anon_sym_Int,
      anon_sym_float,
      anon_sym_FLOAT,
      anon_sym_Float,
      anon_sym_string,
      anon_sym_STRING,
      anon_sym_String,
      sym_identifier,
  [4134] = 3,
    ACTIONS(3), 1,
      sym_comment,
    STATE(134), 1,
      sym__type,
    ACTIONS(417), 13,
      anon_sym_void,
      anon_sym_VOID,
      anon_sym_Void,
      anon_sym_int,
      anon_sym_INT,
      anon_sym_Int,
      anon_sym_float,
      anon_sym_FLOAT,
      anon_sym_Float,
      anon_sym_string,
      anon_sym_STRING,
      anon_sym_String,
      sym_identifier,
  [4156] = 4,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(419), 1,
      anon_sym_SEMI,
    ACTIONS(421), 1,
      anon_sym_LBRACK,
    ACTIONS(423), 1,
      anon_sym_EQ,
  [4169] = 4,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(381), 1,
      anon_sym_RPAREN,
    ACTIONS(425), 1,
      anon_sym_COMMA,
    STATE(109), 1,
      aux_sym_argument_list_repeat1,
  [4182] = 4,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(428), 1,
      anon_sym_RPAREN,
    ACTIONS(430), 1,
      anon_sym_COMMA,
    STATE(114), 1,
      aux_sym_parameter_list_repeat1,
  [4195] = 4,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(369), 1,
      anon_sym_COMMA,
    ACTIONS(432), 1,
      anon_sym_RPAREN,
    STATE(109), 1,
      aux_sym_argument_list_repeat1,
  [4208] = 4,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(434), 1,
      anon_sym_SEMI,
    ACTIONS(436), 1,
      anon_sym_LBRACK,
    ACTIONS(438), 1,
      anon_sym_EQ,
  [4221] = 4,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(430), 1,
      anon_sym_COMMA,
    ACTIONS(440), 1,
      anon_sym_RPAREN,
    STATE(110), 1,
      aux_sym_parameter_list_repeat1,
  [4234] = 4,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(442), 1,
      anon_sym_RPAREN,
    ACTIONS(444), 1,
      anon_sym_COMMA,
    STATE(114), 1,
      aux_sym_parameter_list_repeat1,
  [4247] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(447), 1,
      anon_sym_LBRACE,
    STATE(74), 1,
      sym_block,
  [4257] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(449), 1,
      anon_sym_LBRACE,
    STATE(31), 1,
      sym_block,
  [4267] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(447), 1,
      anon_sym_LBRACE,
    STATE(72), 1,
      sym_block,
  [4277] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(451), 1,
      anon_sym_SEMI,
    ACTIONS(453), 1,
      anon_sym_EQ,
  [4287] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(455), 2,
      anon_sym_RPAREN,
      anon_sym_COMMA,
  [4295] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(442), 2,
      anon_sym_RPAREN,
      anon_sym_COMMA,
  [4303] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(457), 1,
      anon_sym_LBRACE,
    STATE(37), 1,
      sym_block,
  [4313] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(457), 1,
      anon_sym_LBRACE,
    STATE(38), 1,
      sym_block,
  [4323] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(447), 1,
      anon_sym_LBRACE,
    STATE(77), 1,
      sym_block,
  [4333] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(459), 1,
      anon_sym_LBRACE,
    STATE(75), 1,
      sym_class_body,
  [4343] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(461), 1,
      anon_sym_SEMI,
    ACTIONS(463), 1,
      anon_sym_EQ,
  [4353] = 3,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(459), 1,
      anon_sym_LBRACE,
    STATE(69), 1,
      sym_class_body,
  [4363] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(465), 1,
      sym_identifier,
  [4370] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(467), 1,
      sym_identifier,
  [4377] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(469), 1,
      anon_sym_LPAREN,
  [4384] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(471), 1,
      anon_sym_RPAREN,
  [4391] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(473), 1,
      anon_sym_LPAREN,
  [4398] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(475), 1,
      anon_sym_LPAREN,
  [4405] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(477), 1,
      sym_identifier,
  [4412] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(479), 1,
      sym_identifier,
  [4419] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(481), 1,
      sym_identifier,
  [4426] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(483), 1,
      sym_identifier,
  [4433] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(485), 1,
      anon_sym_LPAREN,
  [4440] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(487), 1,
      sym_identifier,
  [4447] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(489), 1,
      ts_builtin_sym_end,
  [4454] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(491), 1,
      anon_sym_RPAREN,
  [4461] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(493), 1,
      sym_identifier,
  [4468] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(495), 1,
      sym_identifier,
  [4475] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(497), 1,
      anon_sym_RPAREN,
  [4482] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(499), 1,
      anon_sym_RPAREN,
  [4489] = 2,
    ACTIONS(3), 1,
      sym_comment,
    ACTIONS(501), 1,
      sym_identifier,
};

static const uint32_t ts_small_parse_table_map[] = {
  [SMALL_STATE(2)] = 0,
  [SMALL_STATE(3)] = 47,
  [SMALL_STATE(4)] = 94,
  [SMALL_STATE(5)] = 148,
  [SMALL_STATE(6)] = 194,
  [SMALL_STATE(7)] = 244,
  [SMALL_STATE(8)] = 290,
  [SMALL_STATE(9)] = 336,
  [SMALL_STATE(10)] = 386,
  [SMALL_STATE(11)] = 452,
  [SMALL_STATE(12)] = 514,
  [SMALL_STATE(13)] = 574,
  [SMALL_STATE(14)] = 630,
  [SMALL_STATE(15)] = 676,
  [SMALL_STATE(16)] = 722,
  [SMALL_STATE(17)] = 783,
  [SMALL_STATE(18)] = 844,
  [SMALL_STATE(19)] = 911,
  [SMALL_STATE(20)] = 972,
  [SMALL_STATE(21)] = 1033,
  [SMALL_STATE(22)] = 1094,
  [SMALL_STATE(23)] = 1155,
  [SMALL_STATE(24)] = 1216,
  [SMALL_STATE(25)] = 1272,
  [SMALL_STATE(26)] = 1328,
  [SMALL_STATE(27)] = 1384,
  [SMALL_STATE(28)] = 1428,
  [SMALL_STATE(29)] = 1472,
  [SMALL_STATE(30)] = 1505,
  [SMALL_STATE(31)] = 1538,
  [SMALL_STATE(32)] = 1575,
  [SMALL_STATE(33)] = 1619,
  [SMALL_STATE(34)] = 1653,
  [SMALL_STATE(35)] = 1694,
  [SMALL_STATE(36)] = 1724,
  [SMALL_STATE(37)] = 1762,
  [SMALL_STATE(38)] = 1794,
  [SMALL_STATE(39)] = 1826,
  [SMALL_STATE(40)] = 1864,
  [SMALL_STATE(41)] = 1902,
  [SMALL_STATE(42)] = 1940,
  [SMALL_STATE(43)] = 1978,
  [SMALL_STATE(44)] = 2016,
  [SMALL_STATE(45)] = 2054,
  [SMALL_STATE(46)] = 2092,
  [SMALL_STATE(47)] = 2130,
  [SMALL_STATE(48)] = 2160,
  [SMALL_STATE(49)] = 2198,
  [SMALL_STATE(50)] = 2236,
  [SMALL_STATE(51)] = 2274,
  [SMALL_STATE(52)] = 2312,
  [SMALL_STATE(53)] = 2350,
  [SMALL_STATE(54)] = 2388,
  [SMALL_STATE(55)] = 2426,
  [SMALL_STATE(56)] = 2464,
  [SMALL_STATE(57)] = 2502,
  [SMALL_STATE(58)] = 2540,
  [SMALL_STATE(59)] = 2569,
  [SMALL_STATE(60)] = 2598,
  [SMALL_STATE(61)] = 2627,
  [SMALL_STATE(62)] = 2656,
  [SMALL_STATE(63)] = 2685,
  [SMALL_STATE(64)] = 2714,
  [SMALL_STATE(65)] = 2743,
  [SMALL_STATE(66)] = 2772,
  [SMALL_STATE(67)] = 2801,
  [SMALL_STATE(68)] = 2830,
  [SMALL_STATE(69)] = 2859,
  [SMALL_STATE(70)] = 2887,
  [SMALL_STATE(71)] = 2913,
  [SMALL_STATE(72)] = 2939,
  [SMALL_STATE(73)] = 2967,
  [SMALL_STATE(74)] = 2993,
  [SMALL_STATE(75)] = 3021,
  [SMALL_STATE(76)] = 3049,
  [SMALL_STATE(77)] = 3075,
  [SMALL_STATE(78)] = 3103,
  [SMALL_STATE(79)] = 3154,
  [SMALL_STATE(80)] = 3179,
  [SMALL_STATE(81)] = 3204,
  [SMALL_STATE(82)] = 3229,
  [SMALL_STATE(83)] = 3254,
  [SMALL_STATE(84)] = 3279,
  [SMALL_STATE(85)] = 3304,
  [SMALL_STATE(86)] = 3329,
  [SMALL_STATE(87)] = 3354,
  [SMALL_STATE(88)] = 3379,
  [SMALL_STATE(89)] = 3425,
  [SMALL_STATE(90)] = 3470,
  [SMALL_STATE(91)] = 3515,
  [SMALL_STATE(92)] = 3542,
  [SMALL_STATE(93)] = 3573,
  [SMALL_STATE(94)] = 3618,
  [SMALL_STATE(95)] = 3663,
  [SMALL_STATE(96)] = 3708,
  [SMALL_STATE(97)] = 3753,
  [SMALL_STATE(98)] = 3798,
  [SMALL_STATE(99)] = 3843,
  [SMALL_STATE(100)] = 3888,
  [SMALL_STATE(101)] = 3933,
  [SMALL_STATE(102)] = 3978,
  [SMALL_STATE(103)] = 4023,
  [SMALL_STATE(104)] = 4065,
  [SMALL_STATE(105)] = 4090,
  [SMALL_STATE(106)] = 4112,
  [SMALL_STATE(107)] = 4134,
  [SMALL_STATE(108)] = 4156,
  [SMALL_STATE(109)] = 4169,
  [SMALL_STATE(110)] = 4182,
  [SMALL_STATE(111)] = 4195,
  [SMALL_STATE(112)] = 4208,
  [SMALL_STATE(113)] = 4221,
  [SMALL_STATE(114)] = 4234,
  [SMALL_STATE(115)] = 4247,
  [SMALL_STATE(116)] = 4257,
  [SMALL_STATE(117)] = 4267,
  [SMALL_STATE(118)] = 4277,
  [SMALL_STATE(119)] = 4287,
  [SMALL_STATE(120)] = 4295,
  [SMALL_STATE(121)] = 4303,
  [SMALL_STATE(122)] = 4313,
  [SMALL_STATE(123)] = 4323,
  [SMALL_STATE(124)] = 4333,
  [SMALL_STATE(125)] = 4343,
  [SMALL_STATE(126)] = 4353,
  [SMALL_STATE(127)] = 4363,
  [SMALL_STATE(128)] = 4370,
  [SMALL_STATE(129)] = 4377,
  [SMALL_STATE(130)] = 4384,
  [SMALL_STATE(131)] = 4391,
  [SMALL_STATE(132)] = 4398,
  [SMALL_STATE(133)] = 4405,
  [SMALL_STATE(134)] = 4412,
  [SMALL_STATE(135)] = 4419,
  [SMALL_STATE(136)] = 4426,
  [SMALL_STATE(137)] = 4433,
  [SMALL_STATE(138)] = 4440,
  [SMALL_STATE(139)] = 4447,
  [SMALL_STATE(140)] = 4454,
  [SMALL_STATE(141)] = 4461,
  [SMALL_STATE(142)] = 4468,
  [SMALL_STATE(143)] = 4475,
  [SMALL_STATE(144)] = 4482,
  [SMALL_STATE(145)] = 4489,
};

static const TSParseActionEntry ts_parse_actions[] = {
  [0] = {.entry = {.count = 0, .reusable = false}},
  [1] = {.entry = {.count = 1, .reusable = false}}, RECOVER(),
  [3] = {.entry = {.count = 1, .reusable = true}}, SHIFT_EXTRA(),
  [5] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_program, 0, 0, 0),
  [7] = {.entry = {.count = 1, .reusable = true}}, SHIFT(145),
  [9] = {.entry = {.count = 1, .reusable = true}}, SHIFT(105),
  [11] = {.entry = {.count = 1, .reusable = true}}, SHIFT(107),
  [13] = {.entry = {.count = 1, .reusable = true}}, SHIFT(142),
  [15] = {.entry = {.count = 1, .reusable = true}}, SHIFT(141),
  [17] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_member_access, 3, 0, 9),
  [19] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_member_access, 3, 0, 9),
  [21] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_array_access, 4, 0, 14),
  [23] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_array_access, 4, 0, 14),
  [25] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_binary_expression, 3, 0, 0),
  [27] = {.entry = {.count = 1, .reusable = true}}, SHIFT(43),
  [29] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_binary_expression, 3, 0, 0),
  [31] = {.entry = {.count = 1, .reusable = true}}, SHIFT(52),
  [33] = {.entry = {.count = 1, .reusable = false}}, SHIFT(52),
  [35] = {.entry = {.count = 1, .reusable = true}}, SHIFT(127),
  [37] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_call_expression, 4, 0, 13),
  [39] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_call_expression, 4, 0, 13),
  [41] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_parenthesized_expression, 3, 0, 0),
  [43] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_parenthesized_expression, 3, 0, 0),
  [45] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_call_expression, 3, 0, 8),
  [47] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_call_expression, 3, 0, 8),
  [49] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_unary_expression, 2, 0, 3),
  [51] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_unary_expression, 2, 0, 3),
  [53] = {.entry = {.count = 1, .reusable = true}}, SHIFT(32),
  [55] = {.entry = {.count = 1, .reusable = true}}, SHIFT(48),
  [57] = {.entry = {.count = 1, .reusable = true}}, SHIFT(49),
  [59] = {.entry = {.count = 1, .reusable = false}}, SHIFT(50),
  [61] = {.entry = {.count = 1, .reusable = true}}, SHIFT(50),
  [63] = {.entry = {.count = 1, .reusable = true}}, SHIFT(51),
  [65] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_boolean, 1, 0, 0),
  [67] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_boolean, 1, 0, 0),
  [69] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym__expression, 1, 0, 0),
  [71] = {.entry = {.count = 1, .reusable = false}}, SHIFT(45),
  [73] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym__expression, 1, 0, 0),
  [75] = {.entry = {.count = 1, .reusable = true}}, SHIFT(57),
  [77] = {.entry = {.count = 1, .reusable = true}}, SHIFT(29),
  [79] = {.entry = {.count = 1, .reusable = false}}, SHIFT(131),
  [81] = {.entry = {.count = 1, .reusable = false}}, SHIFT(34),
  [83] = {.entry = {.count = 1, .reusable = true}}, SHIFT(55),
  [85] = {.entry = {.count = 1, .reusable = false}}, SHIFT(15),
  [87] = {.entry = {.count = 1, .reusable = true}}, SHIFT(18),
  [89] = {.entry = {.count = 1, .reusable = false}}, SHIFT(14),
  [91] = {.entry = {.count = 1, .reusable = true}}, SHIFT(30),
  [93] = {.entry = {.count = 1, .reusable = true}}, SHIFT(61),
  [95] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_expression_statement, 1, 0, 0),
  [97] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_expression_statement, 1, 0, 0),
  [99] = {.entry = {.count = 1, .reusable = true}}, SHIFT(42),
  [101] = {.entry = {.count = 1, .reusable = true}}, SHIFT(35),
  [103] = {.entry = {.count = 1, .reusable = true}}, SHIFT(71),
  [105] = {.entry = {.count = 1, .reusable = true}}, SHIFT(47),
  [107] = {.entry = {.count = 1, .reusable = true}}, SHIFT(76),
  [109] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_block_repeat1, 2, 0, 0), SHIFT_REPEAT(57),
  [112] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_block_repeat1, 2, 0, 0),
  [114] = {.entry = {.count = 2, .reusable = false}}, REDUCE(aux_sym_block_repeat1, 2, 0, 0), SHIFT_REPEAT(131),
  [117] = {.entry = {.count = 2, .reusable = false}}, REDUCE(aux_sym_block_repeat1, 2, 0, 0), SHIFT_REPEAT(34),
  [120] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_block_repeat1, 2, 0, 0), SHIFT_REPEAT(55),
  [123] = {.entry = {.count = 2, .reusable = false}}, REDUCE(aux_sym_block_repeat1, 2, 0, 0), SHIFT_REPEAT(15),
  [126] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_block_repeat1, 2, 0, 0), SHIFT_REPEAT(18),
  [129] = {.entry = {.count = 2, .reusable = false}}, REDUCE(aux_sym_block_repeat1, 2, 0, 0), SHIFT_REPEAT(14),
  [132] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_class_body_repeat1, 2, 0, 0), SHIFT_REPEAT(57),
  [135] = {.entry = {.count = 2, .reusable = false}}, REDUCE(aux_sym_class_body_repeat1, 2, 0, 0), SHIFT_REPEAT(106),
  [138] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_class_body_repeat1, 2, 0, 0),
  [140] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_class_body_repeat1, 2, 0, 0), SHIFT_REPEAT(55),
  [143] = {.entry = {.count = 2, .reusable = false}}, REDUCE(aux_sym_class_body_repeat1, 2, 0, 0), SHIFT_REPEAT(91),
  [146] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_class_body_repeat1, 2, 0, 0), SHIFT_REPEAT(103),
  [149] = {.entry = {.count = 2, .reusable = false}}, REDUCE(aux_sym_class_body_repeat1, 2, 0, 0), SHIFT_REPEAT(14),
  [152] = {.entry = {.count = 1, .reusable = false}}, SHIFT(106),
  [154] = {.entry = {.count = 1, .reusable = true}}, SHIFT(73),
  [156] = {.entry = {.count = 1, .reusable = false}}, SHIFT(91),
  [158] = {.entry = {.count = 1, .reusable = true}}, SHIFT(103),
  [160] = {.entry = {.count = 1, .reusable = true}}, SHIFT(70),
  [162] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_program, 1, 0, 0),
  [164] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_program_repeat1, 2, 0, 0),
  [166] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_program_repeat1, 2, 0, 0), SHIFT_REPEAT(145),
  [169] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_program_repeat1, 2, 0, 0), SHIFT_REPEAT(105),
  [172] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_program_repeat1, 2, 0, 0), SHIFT_REPEAT(107),
  [175] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_program_repeat1, 2, 0, 0), SHIFT_REPEAT(142),
  [178] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_program_repeat1, 2, 0, 0), SHIFT_REPEAT(141),
  [181] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_block, 2, 0, 0),
  [183] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_block, 2, 0, 0),
  [185] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_block, 3, 0, 0),
  [187] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_block, 3, 0, 0),
  [189] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_if_statement, 5, 0, 17),
  [191] = {.entry = {.count = 1, .reusable = true}}, SHIFT(33),
  [193] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_if_statement, 5, 0, 17),
  [195] = {.entry = {.count = 1, .reusable = false}}, SHIFT(122),
  [197] = {.entry = {.count = 1, .reusable = true}}, SHIFT(8),
  [199] = {.entry = {.count = 1, .reusable = false}}, SHIFT(78),
  [201] = {.entry = {.count = 1, .reusable = true}}, SHIFT(78),
  [203] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_if_statement, 6, 0, 17),
  [205] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_if_statement, 6, 0, 17),
  [207] = {.entry = {.count = 1, .reusable = false}}, SHIFT(121),
  [209] = {.entry = {.count = 1, .reusable = true}}, SHIFT(58),
  [211] = {.entry = {.count = 1, .reusable = false}}, SHIFT(100),
  [213] = {.entry = {.count = 1, .reusable = true}}, SHIFT(100),
  [215] = {.entry = {.count = 1, .reusable = false}}, SHIFT(98),
  [217] = {.entry = {.count = 1, .reusable = true}}, SHIFT(98),
  [219] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_if_statement, 8, 0, 19),
  [221] = {.entry = {.count = 1, .reusable = true}}, SHIFT(63),
  [223] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_if_statement, 8, 0, 19),
  [225] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_if_statement, 7, 0, 18),
  [227] = {.entry = {.count = 1, .reusable = true}}, SHIFT(60),
  [229] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_if_statement, 7, 0, 18),
  [231] = {.entry = {.count = 1, .reusable = false}}, SHIFT(101),
  [233] = {.entry = {.count = 1, .reusable = true}}, SHIFT(101),
  [235] = {.entry = {.count = 1, .reusable = false}}, SHIFT(99),
  [237] = {.entry = {.count = 1, .reusable = true}}, SHIFT(99),
  [239] = {.entry = {.count = 1, .reusable = false}}, SHIFT(90),
  [241] = {.entry = {.count = 1, .reusable = true}}, SHIFT(90),
  [243] = {.entry = {.count = 1, .reusable = false}}, SHIFT(10),
  [245] = {.entry = {.count = 1, .reusable = true}}, SHIFT(10),
  [247] = {.entry = {.count = 1, .reusable = false}}, SHIFT(95),
  [249] = {.entry = {.count = 1, .reusable = true}}, SHIFT(95),
  [251] = {.entry = {.count = 1, .reusable = false}}, SHIFT(97),
  [253] = {.entry = {.count = 1, .reusable = true}}, SHIFT(97),
  [255] = {.entry = {.count = 1, .reusable = false}}, SHIFT(102),
  [257] = {.entry = {.count = 1, .reusable = true}}, SHIFT(102),
  [259] = {.entry = {.count = 1, .reusable = false}}, SHIFT(89),
  [261] = {.entry = {.count = 1, .reusable = true}}, SHIFT(89),
  [263] = {.entry = {.count = 1, .reusable = false}}, SHIFT(11),
  [265] = {.entry = {.count = 1, .reusable = true}}, SHIFT(11),
  [267] = {.entry = {.count = 1, .reusable = false}}, SHIFT(12),
  [269] = {.entry = {.count = 1, .reusable = true}}, SHIFT(12),
  [271] = {.entry = {.count = 1, .reusable = false}}, SHIFT(13),
  [273] = {.entry = {.count = 1, .reusable = true}}, SHIFT(13),
  [275] = {.entry = {.count = 1, .reusable = false}}, SHIFT(4),
  [277] = {.entry = {.count = 1, .reusable = true}}, SHIFT(4),
  [279] = {.entry = {.count = 1, .reusable = false}}, SHIFT(6),
  [281] = {.entry = {.count = 1, .reusable = true}}, SHIFT(6),
  [283] = {.entry = {.count = 1, .reusable = false}}, SHIFT(88),
  [285] = {.entry = {.count = 1, .reusable = true}}, SHIFT(88),
  [287] = {.entry = {.count = 1, .reusable = false}}, SHIFT(93),
  [289] = {.entry = {.count = 1, .reusable = true}}, SHIFT(93),
  [291] = {.entry = {.count = 1, .reusable = false}}, SHIFT(9),
  [293] = {.entry = {.count = 1, .reusable = true}}, SHIFT(9),
  [295] = {.entry = {.count = 1, .reusable = false}}, SHIFT(94),
  [297] = {.entry = {.count = 1, .reusable = true}}, SHIFT(94),
  [299] = {.entry = {.count = 1, .reusable = false}}, SHIFT(96),
  [301] = {.entry = {.count = 1, .reusable = true}}, SHIFT(96),
  [303] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_return_statement, 2, 0, 0),
  [305] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_return_statement, 2, 0, 0),
  [307] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_variable_declaration, 6, 0, 7),
  [309] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_variable_declaration, 6, 0, 7),
  [311] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_if_statement, 8, 0, 18),
  [313] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_if_statement, 8, 0, 18),
  [315] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_expression_statement, 2, 0, 0),
  [317] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_expression_statement, 2, 0, 0),
  [319] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_variable_declaration, 4, 0, 2),
  [321] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_variable_declaration, 4, 0, 2),
  [323] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_if_statement, 9, 0, 19),
  [325] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_if_statement, 9, 0, 19),
  [327] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_return_statement, 3, 0, 15),
  [329] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_return_statement, 3, 0, 15),
  [331] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_assignment_statement, 4, 0, 12),
  [333] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_assignment_statement, 4, 0, 12),
  [335] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_variable_declaration, 9, 0, 16),
  [337] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_variable_declaration, 9, 0, 16),
  [339] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_variable_declaration, 7, 0, 11),
  [341] = {.entry = {.count = 1, .reusable = false}}, REDUCE(sym_variable_declaration, 7, 0, 11),
  [343] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_class_declaration, 3, 0, 1),
  [345] = {.entry = {.count = 1, .reusable = true}}, SHIFT(87),
  [347] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_class_body, 3, 0, 0),
  [349] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_function_declaration, 6, 0, 5),
  [351] = {.entry = {.count = 1, .reusable = true}}, SHIFT(85),
  [353] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_class_body, 2, 0, 0),
  [355] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_instance_declaration, 6, 0, 4),
  [357] = {.entry = {.count = 1, .reusable = true}}, SHIFT(84),
  [359] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_prototype_declaration, 6, 0, 4),
  [361] = {.entry = {.count = 1, .reusable = true}}, SHIFT(83),
  [363] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_function_declaration, 7, 0, 10),
  [365] = {.entry = {.count = 1, .reusable = true}}, SHIFT(80),
  [367] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_argument_list, 1, 0, 0),
  [369] = {.entry = {.count = 1, .reusable = true}}, SHIFT(53),
  [371] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_function_declaration, 8, 0, 10),
  [373] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_prototype_declaration, 7, 0, 4),
  [375] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_instance_declaration, 7, 0, 4),
  [377] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_function_declaration, 7, 0, 5),
  [379] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_class_declaration, 4, 0, 1),
  [381] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_argument_list_repeat1, 2, 0, 0),
  [383] = {.entry = {.count = 1, .reusable = true}}, SHIFT(116),
  [385] = {.entry = {.count = 1, .reusable = true}}, SHIFT(59),
  [387] = {.entry = {.count = 1, .reusable = false}}, SHIFT(44),
  [389] = {.entry = {.count = 1, .reusable = true}}, SHIFT(117),
  [391] = {.entry = {.count = 1, .reusable = false}}, SHIFT(133),
  [393] = {.entry = {.count = 1, .reusable = true}}, SHIFT(118),
  [395] = {.entry = {.count = 1, .reusable = true}}, SHIFT(81),
  [397] = {.entry = {.count = 1, .reusable = true}}, SHIFT(3),
  [399] = {.entry = {.count = 1, .reusable = true}}, SHIFT(7),
  [401] = {.entry = {.count = 1, .reusable = true}}, SHIFT(65),
  [403] = {.entry = {.count = 1, .reusable = true}}, SHIFT(125),
  [405] = {.entry = {.count = 1, .reusable = true}}, SHIFT(66),
  [407] = {.entry = {.count = 1, .reusable = true}}, SHIFT(64),
  [409] = {.entry = {.count = 1, .reusable = true}}, SHIFT(82),
  [411] = {.entry = {.count = 1, .reusable = true}}, SHIFT(67),
  [413] = {.entry = {.count = 1, .reusable = false}}, SHIFT(136),
  [415] = {.entry = {.count = 1, .reusable = false}}, SHIFT(138),
  [417] = {.entry = {.count = 1, .reusable = false}}, SHIFT(134),
  [419] = {.entry = {.count = 1, .reusable = true}}, SHIFT(62),
  [421] = {.entry = {.count = 1, .reusable = true}}, SHIFT(36),
  [423] = {.entry = {.count = 1, .reusable = true}}, SHIFT(41),
  [425] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_argument_list_repeat1, 2, 0, 0), SHIFT_REPEAT(53),
  [428] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_parameter_list, 2, 0, 0),
  [430] = {.entry = {.count = 1, .reusable = true}}, SHIFT(104),
  [432] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_argument_list, 2, 0, 0),
  [434] = {.entry = {.count = 1, .reusable = true}}, SHIFT(79),
  [436] = {.entry = {.count = 1, .reusable = true}}, SHIFT(54),
  [438] = {.entry = {.count = 1, .reusable = true}}, SHIFT(56),
  [440] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_parameter_list, 1, 0, 0),
  [442] = {.entry = {.count = 1, .reusable = true}}, REDUCE(aux_sym_parameter_list_repeat1, 2, 0, 0),
  [444] = {.entry = {.count = 2, .reusable = true}}, REDUCE(aux_sym_parameter_list_repeat1, 2, 0, 0), SHIFT_REPEAT(104),
  [447] = {.entry = {.count = 1, .reusable = true}}, SHIFT(22),
  [449] = {.entry = {.count = 1, .reusable = true}}, SHIFT(16),
  [451] = {.entry = {.count = 1, .reusable = true}}, SHIFT(86),
  [453] = {.entry = {.count = 1, .reusable = true}}, SHIFT(39),
  [455] = {.entry = {.count = 1, .reusable = true}}, REDUCE(sym_parameter, 2, 0, 6),
  [457] = {.entry = {.count = 1, .reusable = true}}, SHIFT(19),
  [459] = {.entry = {.count = 1, .reusable = true}}, SHIFT(25),
  [461] = {.entry = {.count = 1, .reusable = true}}, SHIFT(68),
  [463] = {.entry = {.count = 1, .reusable = true}}, SHIFT(40),
  [465] = {.entry = {.count = 1, .reusable = true}}, SHIFT(2),
  [467] = {.entry = {.count = 1, .reusable = true}}, SHIFT(140),
  [469] = {.entry = {.count = 1, .reusable = true}}, SHIFT(135),
  [471] = {.entry = {.count = 1, .reusable = true}}, SHIFT(123),
  [473] = {.entry = {.count = 1, .reusable = true}}, SHIFT(46),
  [475] = {.entry = {.count = 1, .reusable = true}}, SHIFT(92),
  [477] = {.entry = {.count = 1, .reusable = true}}, SHIFT(119),
  [479] = {.entry = {.count = 1, .reusable = true}}, SHIFT(112),
  [481] = {.entry = {.count = 1, .reusable = true}}, SHIFT(143),
  [483] = {.entry = {.count = 1, .reusable = true}}, SHIFT(132),
  [485] = {.entry = {.count = 1, .reusable = true}}, SHIFT(128),
  [487] = {.entry = {.count = 1, .reusable = true}}, SHIFT(108),
  [489] = {.entry = {.count = 1, .reusable = true}},  ACCEPT_INPUT(),
  [491] = {.entry = {.count = 1, .reusable = true}}, SHIFT(115),
  [493] = {.entry = {.count = 1, .reusable = true}}, SHIFT(129),
  [495] = {.entry = {.count = 1, .reusable = true}}, SHIFT(126),
  [497] = {.entry = {.count = 1, .reusable = true}}, SHIFT(124),
  [499] = {.entry = {.count = 1, .reusable = true}}, SHIFT(5),
  [501] = {.entry = {.count = 1, .reusable = true}}, SHIFT(137),
};

#ifdef __cplusplus
extern "C" {
#endif
#ifdef TREE_SITTER_HIDE_SYMBOLS
#define TS_PUBLIC
#elif defined(_WIN32)
#define TS_PUBLIC __declspec(dllexport)
#else
#define TS_PUBLIC __attribute__((visibility("default")))
#endif

TS_PUBLIC const TSLanguage *tree_sitter_daedalus(void) {
  static const TSLanguage language = {
    .version = LANGUAGE_VERSION,
    .symbol_count = SYMBOL_COUNT,
    .alias_count = ALIAS_COUNT,
    .token_count = TOKEN_COUNT,
    .external_token_count = EXTERNAL_TOKEN_COUNT,
    .state_count = STATE_COUNT,
    .large_state_count = LARGE_STATE_COUNT,
    .production_id_count = PRODUCTION_ID_COUNT,
    .field_count = FIELD_COUNT,
    .max_alias_sequence_length = MAX_ALIAS_SEQUENCE_LENGTH,
    .parse_table = &ts_parse_table[0][0],
    .small_parse_table = ts_small_parse_table,
    .small_parse_table_map = ts_small_parse_table_map,
    .parse_actions = ts_parse_actions,
    .symbol_names = ts_symbol_names,
    .field_names = ts_field_names,
    .field_map_slices = ts_field_map_slices,
    .field_map_entries = ts_field_map_entries,
    .symbol_metadata = ts_symbol_metadata,
    .public_symbol_map = ts_symbol_map,
    .alias_map = ts_non_terminal_alias_map,
    .alias_sequences = &ts_alias_sequences[0][0],
    .lex_modes = ts_lex_modes,
    .lex_fn = ts_lex,
    .primary_state_ids = ts_primary_state_ids,
  };
  return &language;
}
#ifdef __cplusplus
}
#endif
