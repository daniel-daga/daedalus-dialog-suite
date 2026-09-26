// The body of an NPC instance as statements an editor can read and change,
// and the writer that changes them (docs/plans/npc-editor.md, Phase 1).
//
// Everything works on an instance's verbatim `sourceText` — the text
// `GlobalInstance` already carries and the generator already re-emits — so an
// edit is a new `sourceText` and saves through the existing pipeline unchanged.
//
// Statements are classified by *shape*, not by a list of known names: a field
// assignment, a call, or anything else. Which fields and calls a form has a
// control for is the editor's business; the parser keeps them all.
//
// The writer patches, it never regenerates. An edit replaces the range of the
// one statement it touches, so comments, blank lines, alignment and every
// statement nobody edited survive byte for byte.
//
// On demand rather than in the declaration pass: whether an instance is an NPC
// is decided through prototype chains that usually live in another file, which
// a per-file parse cannot see, and most instances in a project are never
// opened in an editor.

import DaedalusParser from '../core/parser';
import { TreeSitterNode } from './semantic-model';

export interface NpcRange {
  startIndex: number;
  endIndex: number;
}

interface StatementBase {
  /** The statement's text, `;` included. */
  text: string;
  /** Where `text` sits in the source the definition was extracted from. */
  range: NpcRange;
}

/** `field = value;` or `field[index] = value;` — `value` is the expression as written. */
export interface NpcFieldStatement extends StatementBase {
  kind: 'field';
  field: string;
  index?: string;
  value: string;
  valueRange: NpcRange;
}

/** `Name(arg, …);` — each argument as written. */
export interface NpcCallStatement extends StatementBase {
  kind: 'call';
  name: string;
  args: string[];
  /** The argument list, parentheses included. */
  argsRange: NpcRange;
}

/** Anything else (an `if`, a member assignment) — kept, never edited. */
export interface NpcOtherStatement extends StatementBase {
  kind: 'other';
}

export type NpcStatement = NpcFieldStatement | NpcCallStatement | NpcOtherStatement;

export interface NpcDefinition {
  name: string;
  parent: string;
  /** In source order; comments are not statements. */
  statements: NpcStatement[];
  /** The index of the body's closing `}`. */
  closingBraceIndex: number;
}

export type NpcEdit =
  | { op: 'set'; field: string; index?: string; value: string }
  | { op: 'remove'; field: string; index?: string }
  /** `occurrence` picks which call of that name, 0-based; it defaults to 0. */
  | { op: 'setCall'; name: string; args: string[]; occurrence?: number }
  | { op: 'removeCall'; name: string; occurrence?: number }
  /** Always a new call, even when the name is already called. */
  | { op: 'addCall'; name: string; args: string[] };

export function extractNpcDefinition(source: string): NpcDefinition {
  const { tree } = DaedalusParser.parseSource(source);
  const root = tree.rootNode as TreeSitterNode;
  if (root.hasError) {
    throw new Error('NPC source has a syntax error');
  }
  const declarations = root.namedChildren.filter((n) => n.type !== 'comment');
  const instance = declarations[0];
  if (declarations.length !== 1 || instance.type !== 'instance_declaration') {
    throw new Error('NPC source must be a single instance declaration');
  }
  const body = instance.childForFieldName('body');
  if (!body) {
    throw new Error('NPC instance has no body');
  }

  const statements = body.namedChildren
    .filter((n) => n.type !== 'comment')
    .map(toStatement);

  return {
    name: instance.childForFieldName('name')?.text ?? '',
    parent: instance.childForFieldName('parent')?.text ?? '',
    statements,
    closingBraceIndex: body.child(body.childCount - 1).startIndex,
  };
}

function rangeOf(node: TreeSitterNode): NpcRange {
  return { startIndex: node.startIndex, endIndex: node.endIndex };
}

function toStatement(node: TreeSitterNode): NpcStatement {
  const base = { text: node.text, range: rangeOf(node) };

  if (node.type === 'assignment_statement') {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (left && right) {
      if (left.type === 'identifier') {
        return { ...base, kind: 'field', field: left.text, value: right.text, valueRange: rangeOf(right) };
      }
      const array = left.type === 'array_access' ? left.childForFieldName('array') : null;
      const index = left.type === 'array_access' ? left.childForFieldName('index') : null;
      if (array?.type === 'identifier' && index) {
        return {
          ...base, kind: 'field', field: array.text, index: index.text,
          value: right.text, valueRange: rangeOf(right),
        };
      }
    }
  }

  if (node.type === 'expression_statement') {
    const call = node.namedChildren[0];
    const fn = call?.type === 'call_expression' ? call.childForFieldName('function') : null;
    // `arguments` is absent for `Foo()`, and never includes the parentheses.
    const open = call?.children.find((n) => n.type === '(');
    const close = call?.children[call.childCount - 1];
    if (fn?.type === 'identifier' && open && close?.type === ')') {
      const argList = call.childForFieldName('arguments');
      return {
        ...base, kind: 'call', name: fn.text,
        args: argList ? argList.namedChildren.filter((n) => n.type !== 'comment').map((n) => n.text) : [],
        argsRange: { startIndex: open.startIndex, endIndex: close.endIndex },
      };
    }
  }

  return { ...base, kind: 'other' };
}

const same = (a: string | undefined, b: string | undefined) =>
  (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

interface Splice {
  start: number;
  end: number;
  text: string;
  order: number;
}

/**
 * Apply `edits` to an NPC instance's source. Every edit is resolved against
 * the *original* statements, so edits in one call do not see each other.
 * An absent field is inserted on a line of its own after the last field, an
 * absent call after the last call of its name or else the last statement;
 * removing an absent one does nothing. Calls match by name and `occurrence`,
 * because retail calls `EquipItem` once per weapon.
 */
export function applyNpcEdits(source: string, edits: NpcEdit[]): string {
  if (edits.length === 0) return source;
  const npc = extractNpcDefinition(source);
  const fields = npc.statements.filter((s): s is NpcFieldStatement => s.kind === 'field');
  const calls = npc.statements.filter((s): s is NpcCallStatement => s.kind === 'call');
  const findField = (field: string, index?: string) =>
    fields.find((s) => same(s.field, field) && same(s.index, index));
  const callsNamed = (name: string) => calls.filter((s) => same(s.name, name));
  const findCall = (name: string, occurrence = 0) => callsNamed(name)[occurrence];
  const newCall = (name: string, args: string[], order: number) => {
    const named = callsNamed(name);
    return insertAfter(source, npc, named[named.length - 1], `${name} (${args.join(', ')});`, order);
  };

  const splices: Splice[] = edits.map((edit, order) => {
    switch (edit.op) {
      case 'set': {
        const existing = findField(edit.field, edit.index);
        if (existing) {
          return { start: existing.valueRange.startIndex, end: existing.valueRange.endIndex, text: edit.value, order };
        }
        const target = edit.index === undefined ? edit.field : `${edit.field}[${edit.index}]`;
        return insertAfter(source, npc, fields[fields.length - 1], `${target} = ${edit.value};`, order);
      }
      case 'remove':
        return removal(source, findField(edit.field, edit.index), order);
      case 'setCall': {
        const existing = findCall(edit.name, edit.occurrence);
        if (existing) {
          const args = `(${edit.args.join(', ')})`;
          return { start: existing.argsRange.startIndex, end: existing.argsRange.endIndex, text: args, order };
        }
        return newCall(edit.name, edit.args, order);
      }
      case 'addCall':
        return newCall(edit.name, edit.args, order);
      case 'removeCall':
        return removal(source, findCall(edit.name, edit.occurrence), order);
    }
  });

  // Back to front, so an earlier splice's indices are still the original
  // ones; at one insertion point the earlier edit ends up first.
  splices.sort((a, b) => b.start - a.start || b.order - a.order);
  let out = source;
  for (const s of splices) {
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  }
  return out;
}

/** Insert `text` on a new line after `anchor`'s line (default: the last
 *  statement), indented like it; with no statement at all, before the `}`. */
function insertAfter(
  source: string, npc: NpcDefinition, anchor: NpcStatement | undefined, text: string, order: number
): Splice {
  const after = anchor ?? npc.statements[npc.statements.length - 1];
  if (after) {
    const lineStart = source.lastIndexOf('\n', after.range.startIndex - 1) + 1;
    const indent = /^[ \t]*/.exec(source.slice(lineStart))![0];
    let lineEnd = source.indexOf('\n', after.range.endIndex);
    if (lineEnd === -1) lineEnd = source.length;
    if (source[lineEnd - 1] === '\r') lineEnd -= 1;
    return { start: lineEnd, end: lineEnd, text: `\n${indent}${text}`, order };
  }
  const brace = npc.closingBraceIndex;
  const lineStart = source.lastIndexOf('\n', brace - 1) + 1;
  if (/^[ \t]*$/.test(source.slice(lineStart, brace))) {
    return { start: lineStart, end: lineStart, text: `\t${text}\n`, order };
  }
  return { start: brace, end: brace, text: ` ${text} `, order };
}

/** Delete `statement`: its whole line when nothing but whitespace and a
 *  trailing `//` comment shares it, otherwise the statement alone. */
function removal(source: string, statement: NpcStatement | undefined, order: number): Splice {
  if (!statement) return { start: 0, end: 0, text: '', order };
  const { startIndex, endIndex } = statement.range;
  const lineStart = source.lastIndexOf('\n', startIndex - 1) + 1;
  const newline = source.indexOf('\n', endIndex);
  const lineEnd = newline === -1 ? source.length : newline;
  const aloneOnLine =
    /^[ \t]*$/.test(source.slice(lineStart, startIndex)) &&
    /^[ \t]*(\/\/.*)?\r?$/.test(source.slice(endIndex, lineEnd));
  if (aloneOnLine) {
    return newline === -1
      ? { start: Math.max(lineStart - 1, 0), end: lineEnd, text: '', order }
      : { start: lineStart, end: newline + 1, text: '', order };
  }
  const trailing = /^[ \t]*/.exec(source.slice(endIndex))![0].length;
  return { start: startIndex, end: endIndex + trailing, text: '', order };
}
