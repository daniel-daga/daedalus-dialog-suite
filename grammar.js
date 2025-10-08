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
      $.variable_declaration,
      $.class_declaration,
      $.prototype_declaration,
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

    // Variable declaration: const/var type name[size] = value;
    variable_declaration: $ => seq(
      field('keyword', choice('const', 'CONST', 'Const', 'var', 'VAR', 'Var')),
      field('type', $._type),
      field('name', $.identifier),
      optional(seq(
        '[',
        field('size', $._expression),
        ']'
      )),
      optional(seq(
        '=',
        field('value', $._expression)
      )),
      ';',
    ),

    // Class declaration: class ClassName { ... }
    class_declaration: $ => seq(
      field('keyword', choice('class', 'CLASS', 'Class')),
      field('name', $.identifier),
      field('body', $.class_body),
      optional(';'),
    ),

    // Prototype declaration: prototype PrototypeName(ParentClass) { ... }
    prototype_declaration: $ => seq(
      field('keyword', choice('prototype', 'PROTOTYPE', 'Prototype')),
      field('name', $.identifier),
      '(',
      field('parent', $.identifier),
      ')',
      field('body', $.class_body),
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
      field('type', $._type),
      field('name', $.identifier),
    ),

    _type: $ => choice(
      choice('void', 'VOID', 'Void'),
      choice('int', 'INT', 'Int'),
      choice('float', 'FLOAT', 'Float'),
      choice('string', 'STRING', 'String'),
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
      field('left', choice($.identifier, $.member_access, $.array_access)),
      '=',
      field('right', $._expression),
      ';',
    ),

    expression_statement: $ => prec.right(1, seq(
      $._expression,
      optional(';'),
    )),

    if_statement: $ => seq(
      choice('if', 'IF', 'If'),
      '(',
      field('condition', $._expression),
      ')',
      field('consequence', $.block),
      optional(';'), // Allow semicolon after if block
      optional(seq(
        choice('else', 'ELSE', 'Else'),
        field('alternative', $.block),
        optional(';')
      )),
    ),

    return_statement: $ => prec.right(seq(
      choice('return', 'RETURN', 'Return'),
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
      prec.left(3, seq($._expression, choice('==', '!='), $._expression)),
      prec.left(4, seq($._expression, choice('<', '<=', '>', '>='), $._expression)),
      prec.left(5, seq($._expression, choice('+', '-'), $._expression)),
      prec.left(6, seq($._expression, choice('*', '/', '%'), $._expression)),
    ),

    unary_expression: $ => prec(7, seq(
      field('operator', choice('!', '~', '+', '-')),
      field('operand', $._expression),
    )),

    array_access: $ => prec(8, seq(
      field('array', $._expression),
      '[',
      field('index', $._expression),
      ']',
    )),

    member_access: $ => prec(8, seq(
      field('object', $._expression),
      '.',
      field('member', $.identifier),
    )),

    call_expression: $ => prec(2, seq(
      field('function', $._expression),
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

    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/, // Supports constants like LOG_NOTE, Topic_Trader_Out

    number: $ => /\d+(\.\d+)?/,

    string: $ => token(seq(
      '"',
      repeat(choice(
        // Regular characters including newlines (for multi-line strings)
        /[^"\\]/,
        // Newline characters (allows multi-line strings)
        /\r?\n/,
        // Escape sequences
        seq('\\', choice(
          /[\\"/ntr]/,  // Common escapes
          /[0-7]{1,3}/, // Octal
          /x[0-9a-fA-F]{2}/, // Hex
          /u[0-9a-fA-F]{4}/, // Unicode
          /./ // Any other escaped character
        ))
      )),
      '"'
    )),

    boolean: $ => choice(
      'true', 'TRUE', 'True',
      'false', 'FALSE', 'False'
    ),

    comment: $ => token(choice(
      // Single line comment - everything until end of line
      seq('//', /[^\r\n]*/),
      // Multi-line comment
      seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
    )),
  },
});