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
      $.instance_forward_declaration,
      $.function_declaration,
      $.variable_declaration,
      $.class_declaration,
      $.prototype_declaration,
      $.meta_block,
      $.test_block,
      $.namespace_declaration,
    ),

    // zParserExtender is a Union extension, not the original compiler (#392):
    // its META header, `test` blocks and namespaces are carried verbatim and
    // given no meaning. Their bodies hold whatever zPE lets them hold, so they
    // accept declarations and statements alike, and nothing reads them.
    // `$._statement` already carries a variable declaration, so it is not
    // listed again: naming a rule in two branches of one choice is ambiguous.
    _extension_item: $ => choice(
      $.instance_declaration,
      $.instance_forward_declaration,
      $.function_declaration,
      $.class_declaration,
      $.prototype_declaration,
      $._statement,
    ),

    // META { Parser = Game; MergeMode = TRUE; }; — zPE writes the entries with
    // or without the semicolon, so both are accepted.
    meta_block: $ => seq(
      alias(/[mM][eE][tT][aA]/, 'META'),
      '{',
      repeat(seq(
        field('name', $.identifier),
        '=',
        field('value', $._expression),
        optional(';'),
      )),
      '}',
      ';',
    ),

    test_block: $ => seq(
      alias(/[tT][eE][sS][tT]/, 'test'),
      field('name', $.identifier),
      '{',
      repeat($._extension_item),
      '}',
      ';',
    ),

    namespace_declaration: $ => seq(
      alias(/[nN][aA][mM][eE][sS][pP][aA][cC][eE]/, 'namespace'),
      field('name', $.identifier),
      optional(seq('{', repeat($._extension_item), '}')),
      ';',
    ),

    // Instance declaration: instance DEV_2130_Szmyk (Npc_Default)
    instance_declaration: $ => seq(
      field('keyword', alias(/[iI][nN][sS][tT][aA][nN][cC][eE]/, 'instance')),
      field('name', $.identifier),
      '(',
      field('parent', $.identifier),
      ')',
      field('body', $.block),
      ';',
    ),

    // Instance declared without a body: `instance MEM_Game(oCGame);`, and
    // several at once, `instance a, b(C);` (#383, the reference grammars'
    // instanceDecl). Its own node so nothing that reads an instance body
    // meets one without.
    instance_forward_declaration: $ => seq(
      field('keyword', alias(/[iI][nN][sS][tT][aA][nN][cC][eE]/, 'instance')),
      field('name', $.identifier),
      repeat(seq(',', field('name', $.identifier))),
      '(',
      field('parent', $.identifier),
      ')',
      ';',
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
      ';',
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
      // `var int a, b;`, `var int a, var int b;`, `const int A = 1, B = 2;`
      // (#383): a comma list in one statement; each further name is a declarator.
      repeat(seq(',', field('declarator', $.variable_declarator))),
      ';',
    ),

    variable_declarator: $ => seq(
      optional(seq(
        field('keyword', choice(
          alias(/[cC][oO][nN][sS][tT]/, 'const'),
          alias(/[vV][aA][rR]/, 'var'),
        )),
        field('type', $._type),
      )),
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
      ';',
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
      ';',
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
      // `var int a[3]` (#383): both reference grammars take an array parameter.
      optional(seq('[', field('size', $._expression), ']')),
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
      ';',
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

    // `@` and `^` continue an identifier but never start one (#383): Ikarus's
    // `_@`/`_^`, LeGo's `Foo@`. Same rule as the DaedalusLanguageServer and
    // DaedalusCompiler grammars, so `a^b` is one name. Neither has xor, nor do we (#389).
    identifier: $ => prec(-1, /[a-zA-Z_\u00C0-\u00FF][a-zA-Z0-9_@^\u00C0-\u00FF]*/),

    // `1e5`, `.5` and `5.` too (#383), as both reference grammars read floats.
    number: $ => /(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/,

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