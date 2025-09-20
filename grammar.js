module.exports = grammar({
  name: 'daedalus',

  extras: $ => [
    /\s/,
    $.comment,
  ],

  rules: {
    program: $ => repeat($._declaration),

    _declaration: $ => choice(
      $.instance_declaration,
      $.function_declaration,
    ),

    // Instance declaration: instance DEV_2130_Szmyk (Npc_Default)
    instance_declaration: $ => seq(
      field('keyword', choice('instance', 'INSTANCE', 'Instance')),
      field('name', $.identifier),
      '(',
      field('parent', $.identifier),
      ')',
      field('body', $.block),
      optional(';'),
    ),

    // Function declaration: func void/int functionName()
    function_declaration: $ => seq(
      field('keyword', choice('func', 'FUNC', 'Func')),
      field('return_type', $._type),
      field('name', $.identifier),
      '(',
      field('parameters', optional($.parameter_list)),
      ')',
      field('body', $.block),
      optional(';'),
    ),

    parameter_list: $ => seq(
      $.parameter,
      repeat(seq(',', $.parameter)),
    ),

    parameter: $ => seq(
      field('type', $._type),
      field('name', $.identifier),
    ),

    _type: $ => choice(
      choice('void', 'VOID'),
      choice('int', 'INT'),
      choice('float', 'FLOAT'),
      choice('string', 'STRING'),
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
    ),

    assignment_statement: $ => seq(
      field('left', $.identifier),
      '=',
      field('right', $._expression),
      ';',
    ),

    expression_statement: $ => seq(
      $._expression,
      ';',
    ),

    if_statement: $ => seq(
      'if',
      '(',
      field('condition', $._expression),
      ')',
      field('consequence', $.block),
      optional(seq('else', field('alternative', $.block))),
    ),

    return_statement: $ => seq(
      'return',
      optional(field('value', $._expression)),
      ';',
    ),

    _expression: $ => choice(
      $.binary_expression,
      $.call_expression,
      $.identifier,
      $.number,
      $.string,
      $.boolean,
      $.parenthesized_expression,
    ),

    binary_expression: $ => choice(
      prec.left(1, seq($._expression, '||', $._expression)),
      prec.left(2, seq($._expression, '&&', $._expression)),
      prec.left(3, seq($._expression, choice('==', '!='), $._expression)),
      prec.left(4, seq($._expression, choice('<', '<=', '>', '>='), $._expression)),
      prec.left(5, seq($._expression, choice('+', '-'), $._expression)),
      prec.left(6, seq($._expression, choice('*', '/', '%'), $._expression)),
    ),

    call_expression: $ => seq(
      field('function', $._expression),
      '(',
      field('arguments', optional($.argument_list)),
      ')',
    ),

    argument_list: $ => seq(
      $._expression,
      repeat(seq(',', $._expression)),
    ),

    parenthesized_expression: $ => seq(
      '(',
      $._expression,
      ')',
    ),

    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/,

    number: $ => /\d+(\.\d+)?/,

    string: $ => /"([^"\\]|\\.)*"/,

    boolean: $ => choice('true', 'false', 'TRUE', 'FALSE'),

    comment: $ => token(choice(
      seq('//', /.*/),
      seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
    )),
  },
});