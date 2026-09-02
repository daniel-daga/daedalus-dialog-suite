module.exports = grammar({
  name: 'daedalus',

  extras: $ => [
    /\s/,
    $.comment,
  ],

  conflicts: $ => [
    [$.if_statement],
  ],

  rules: {
    program: $ => repeat($._declaration),

    _declaration: $ => choice(
      $.instance_declaration,
      $.function_declaration,
      $.variable_declaration,
      $.class_declaration,
      $.prototype_declaration,
    ),

    // Instance declaration: instance DEV_2130_Szmyk (Npc_Default)
    instance_declaration: $ => seq(
      field('keyword', alias(/[iI][nN][sS][tT][aA][nN][cC][eE]/, 'instance')),
      field('name', $.identifier),
      '(',
      field('parent', $.identifier),
      ')',
      field('body', $.block),
      optional(';'),
    ),

    // Function declaration: func void/int functionName()
    function_declaration: $ => seq(
      field('keyword', alias(/[fF][uU][nN][cC]/, 'func')),
      field('return_type', $._type),
      field('name', $.identifier),
      '(',
      field('parameters', optional($.parameter_list)),
      ')',
      field('body', $.block),
      optional(';'),
    ),

    // Variable declaration: const/var type name[size] = value;
    variable_declaration: $ => seq(
      field('keyword', choice(
        alias(/[cC][oO][nN][sS][tT]/, 'const'),
        alias(/[vV][aA][rR]/, 'var'),
      )),
      field('type', $._type),
      field('name', $.identifier),
      optional(seq(
        '[',
        field('size', $._expression),
        ']'
      )),
      optional(seq(
        '=',
        field('value', choice($._expression, $.array_initialization))
      )),
      ';',
    ),

    array_initialization: $ => seq(
      '{',
      $._expression,
      repeat(seq(',', $._expression)),
      optional(','), // Allow trailing comma
      '}'
    ),

    // Class declaration: class ClassName { ... }
    class_declaration: $ => seq(
      field('keyword', alias(/[cC][lL][aA][sS][sS]/, 'class')),
      field('name', $.identifier),
      field('body', $.class_body),
      optional(';'),
    ),

    // Prototype declaration: prototype PrototypeName(ParentClass) { ... }
    // Body is a block, as for instances: retail prototypes carry call
    // statements (B_SetAttributesToChapter) between their assignments.
    prototype_declaration: $ => seq(
      field('keyword', alias(/[pP][rR][oO][tT][oO][tT][yY][pP][eE]/, 'prototype')),
      field('name', $.identifier),
      '(',
      field('parent', $.identifier),
      ')',
      field('body', $.block),
      optional(';'),
    ),

    // Class body can contain variable declarations and assignments
    class_body: $ => seq(
      '{',
      repeat(choice(
        $.variable_declaration,
        $.assignment_statement,
      )),
      '}',
    ),

    parameter_list: $ => seq(
      $.parameter,
      repeat(seq(',', $.parameter)),
    ),

    parameter: $ => seq(
      optional(choice(/[vV][aA][rR]/, /[cC][oO][nN][sS][tT]/)),
      field('type', $._type),
      field('name', $.identifier),
    ),

    _type: $ => choice(
      alias(/[vV][oO][iI][dD]/, 'void'),
      alias(/[iI][nN][tT]/, 'int'),
      alias(/[fF][lL][oO][aA][tT]/, 'float'),
      alias(/[sS][tT][rR][iI][nN][gG]/, 'string'),
      $.identifier, // custom types
    ),

    block: $ => seq(
      '{',
      repeat($._statement),
      '}',
    ),

    _statement: $ => choice(
      $.assignment_statement,
      $.expression_statement,
      $.if_statement,
      $.return_statement,
      $.variable_declaration,
    ),

    assignment_statement: $ => seq(
      field('left', choice($.identifier, $.member_access, $.array_access)),
      choice('=', '+=', '-=', '*=', '/='),
      field('right', $._expression),
      ';',
    ),

    expression_statement: $ => prec.right(1, seq(
      $._expression,
      optional(';'),
    )),

    if_statement: $ => seq(
      alias(/[iI][fF]/, 'if'),
      field('condition', $._expression),
      field('consequence', $.block),
      optional(';'), // Allow semicolon after if block
      optional(seq(
        alias(/[eE][lL][sS][eE]/, 'else'),
        field('alternative', choice($.block, $.if_statement)),
        optional(';')
      )),
    ),

    return_statement: $ => prec.right(seq(
      alias(/[rR][eE][tT][uU][rR][nN]/, 'return'),
      optional(field('value', $._expression)),
      ';',
    )),

    _expression: $ => choice(
      $.binary_expression,
      $.unary_expression,
      $.call_expression,
      $.array_access,
      $.member_access,
      $.identifier,
      $.number,
      $.string,
      $.boolean,
      $.parenthesized_expression,
    ),

    binary_expression: $ => choice(
      prec.left(1, seq($._expression, '||', $._expression)),
      prec.left(2, seq($._expression, '&&', $._expression)),
      prec.left(3, seq($._expression, '|', $._expression)),
      prec.left(4, seq($._expression, '^', $._expression)),
      prec.left(5, seq($._expression, '&', $._expression)),
      prec.left(6, seq($._expression, choice('==', '!='), $._expression)),
      prec.left(7, seq($._expression, choice('<', '<=', '>', '>='), $._expression)),
      prec.left(8, seq($._expression, choice('<<', '>>'), $._expression)),
      prec.left(9, seq($._expression, choice('+', '-'), $._expression)),
      prec.left(10, seq($._expression, choice('*', '/', '%'), $._expression)),
    ),

    unary_expression: $ => prec(11, seq(
      field('operator', choice('!', '~', '+', '-')),
      field('operand', $._expression),
    )),

    array_access: $ => prec(12, seq(
      field('array', $._expression),
      '[',
      field('index', $._expression),
      ']',
    )),

    member_access: $ => prec(12, seq(
      field('object', $._expression),
      '.',
      field('member', $.identifier),
    )),

    call_expression: $ => prec(13, seq(
      field('function', choice($.identifier, $.member_access)),
      '(',
      field('arguments', optional($.argument_list)),
      ')',
    )),

    argument_list: $ => seq(
      $._expression,
      repeat(seq(',', $._expression)),
    ),

    parenthesized_expression: $ => seq(
      '(',
      $._expression,
      ')',
    ),

    identifier: $ => prec(-1, /[a-zA-Z_\u0080-\u00FF][a-zA-Z0-9_\u0080-\u00FF]*/), 

    number: $ => /\d+(\.\d+)?/,

    // Daedalus has no string escape sequences (docs/reference/parser-roundtrip-scope.md):
    // a backslash is an ordinary character and the string ends at the next `"`.
    // Newlines are allowed (multi-line strings).
    string: $ => token(seq(
      '"',
      /[^"]*/,
      '"'
    )),

    boolean: $ => choice(
      /[tT][rR][uU][eE]/,
      /[fF][aA][lL][sS][eE]/
    ),

    comment: $ => token(choice(
      // Single line comment - everything until end of line
      seq('//', /[^\r\n]*/),
      // Multi-line comment
      seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
    )),
  },
});