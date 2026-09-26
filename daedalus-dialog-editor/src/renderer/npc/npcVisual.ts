import type { NpcDefinition, NpcCallStatement, NpcEdit, NpcStatement } from '../../shared/types';
import type { NpcBodyRequest } from '../../shared/worldTypes';

// What the NPC preview draws, read from the NPC's own statements
// (docs/plans/npc-editor.md §4). Pure: no React, no IPC, no assets.
//
// The engine externals are read as they are — their signatures are the
// engine's. `B_SetNpcVisual` is a script function, and it is expanded in place
// into the engine calls its *retail* body makes (Daniel supplied it,
// 2026-09-26): HUMANS.MDS; `hum_body_Naked0` for a man, width 0.9 below 50
// strength and 1.1 above 100; `Hum_Body_Babe0` for a woman, a male body
// texture 0-3 moved up by 4; skin colour and teeth always 0. A mod that
// rewrote the helper is drawn by the retail mapping regardless.

export interface NpcVisual {
  /** `Mdl_SetVisual`'s model — `HUMANS.MDS` — whose hierarchy places the head. */
  model: string;
  bodyMesh: string;
  bodyTexture: number;
  skinColor: number;
  headMesh: string;
  headTexture: number;
  teethTexture: number;
  /** The armour item instance, or null for `NO_ARMOR` (-1). */
  armor: string | null;
  fatness: number;
  /** `Mdl_SetModelScale` — width, height, depth. */
  scale: [number, number, number];
  /** What the preview had to assume, in words for the user. */
  notes: string[];
}

export type NpcVisualResult = { ok: true; visual: NpcVisual } | { ok: false; reason: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const unquote = (value: string) => (/^"[^"]*"$/.test(value) ? value.slice(1, -1) : null);

class Unresolved extends Error {}

/**
 * `lookup` answers an integer constant's value from the project, or undefined
 * when it defines none.
 */
export function resolveNpcVisual(
  npc: NpcDefinition,
  lookup: (name: string) => number | undefined,
): NpcVisualResult {
  const int = (expr: string | undefined): number => {
    const value = (expr ?? '').trim();
    if (/^-?\d+$/.test(value)) return Number(value);
    const constant = lookup(value);
    if (constant === undefined) throw new Unresolved(`${value || 'A missing argument'} is not a known integer constant`);
    return constant;
  };
  const float = (expr: string | undefined): number => {
    const value = (expr ?? '').trim();
    if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Unresolved(`${value || 'A missing argument'} is not a number literal`);
    return Number(value);
  };
  const str = (expr: string | undefined): string => {
    const value = unquote((expr ?? '').trim());
    if (value === null) throw new Unresolved(`${expr ?? 'A missing argument'} is not a string literal`);
    return value;
  };

  try {
    const calls = expandHelpers(npc, int);
    const last = (name: string) => [...calls].reverse().find((c) => same(c.name, name));
    const model = last('Mdl_SetVisual');
    const body = last('Mdl_SetVisualBody');
    if (!model) return { ok: false, reason: 'No Mdl_SetVisual call' };
    if (!body) return { ok: false, reason: 'No Mdl_SetVisualBody call' };

    const [, bodyMesh, bodyTex, skin, headMesh, headTex, teeth, armor] = body.args;
    const armorExpr = (armor ?? '').trim();
    const fatness = last('Mdl_SetModelFatness')?.args[1];
    const scale = last('Mdl_SetModelScale');
    return {
      ok: true,
      visual: {
        model: str(model.args[1]),
        bodyMesh: str(bodyMesh),
        bodyTexture: int(bodyTex),
        skinColor: int(skin),
        headMesh: str(headMesh),
        headTexture: int(headTex),
        teethTexture: int(teeth),
        // An armour argument is an item instance, which is no integer constant.
        armor: armorExpr === '' || armorExpr === '-1' || lookup(armorExpr) === -1 ? null : armorExpr,
        fatness: fatness === undefined ? 0 : float(fatness),
        scale: scale ? [float(scale.args[1]), float(scale.args[2]), float(scale.args[3])] : [1, 1, 1],
        notes: scale && assumedWidth.has(scale) ? [ASSUMED_WIDTH] : [],
      },
    };
  } catch (error) {
    if (error instanceof Unresolved) return { ok: false, reason: error.message };
    throw error;
  }
}

const ASSUMED_WIDTH = 'Width assumed normal: strength is not a known value where B_SetNpcVisual runs';
/** The scale calls a helper expansion made up because strength was unknown. */
const assumedWidth = new WeakSet<NpcCallStatement>();

// Calls that cannot change an NPC's strength. Any other call is a script
// function that may (B_SetAttributesToChapter does), as may a statement the
// parser left unclassified.
const KEEPS_STRENGTH = /^(mdl_|equipitem$|createinvitems?$)/i;

/** The NPC's calls in order, with each `B_SetNpcVisual` replaced by the engine
 *  calls its retail body makes at that point. */
function expandHelpers(npc: NpcDefinition, int: (expr: string | undefined) => number): NpcCallStatement[] {
  const out: NpcCallStatement[] = [];
  // The prototype's strength is not visible here, so it starts unknown.
  let strength: number | undefined;
  const synthetic = (template: NpcCallStatement, name: string, args: string[]): NpcCallStatement =>
    ({ ...template, name, args });

  for (const statement of npc.statements) {
    if (statement.kind === 'field') {
      if (same(statement.field, 'attribute') && same(statement.index ?? '', 'ATR_STRENGTH')) {
        try { strength = int(statement.value); } catch { strength = undefined; }
      }
      continue;
    }
    if (statement.kind === 'other') { strength = undefined; continue; }
    if (!same(statement.name, 'B_SetNpcVisual')) {
      if (!KEEPS_STRENGTH.test(statement.name)) strength = undefined;
      out.push(statement);
      continue;
    }

    const [slf, gender, headMesh, faceTex, bodyTex, armor] = statement.args;
    out.push(synthetic(statement, 'Mdl_SetVisual', [slf, '"HUMANS.MDS"']));
    if (int(gender) === int('MALE')) {
      out.push(synthetic(statement, 'Mdl_SetVisualBody',
        [slf, '"hum_body_Naked0"', bodyTex, '0', headMesh, faceTex, '0', armor]));
      // Between 50 and 100 the helper sets no scale at all, so an earlier
      // one stands.
      if (strength === undefined || strength < 50 || strength > 100) {
        const width = strength === undefined ? '1' : strength < 50 ? '0.9' : '1.1';
        const scale = synthetic(statement, 'Mdl_SetModelScale', [slf, width, '1', '1']);
        if (strength === undefined) assumedWidth.add(scale);
        out.push(scale);
      }
    } else {
      const tex = int(bodyTex);
      out.push(synthetic(statement, 'Mdl_SetVisualBody',
        [slf, '"Hum_Body_Babe0"', String(tex >= 0 && tex <= 3 ? tex + 4 : tex), '0', headMesh, faceTex, '0', armor]));
    }
  }
  return out;
}

/**
 * What the worker assembles for `visual`. An armour item's `visual_change`
 * replaces the naked body mesh, as it does in the engine; `itemSource` answers
 * an item instance's source text, or undefined when the project has none.
 */
export function npcBodyRequest(
  visual: NpcVisual,
  itemSource: (instance: string) => string | undefined,
): { request: NpcBodyRequest; notes: string[] } {
  const notes = [...visual.notes];
  if (visual.fatness !== 0) notes.push(`Fatness ${visual.fatness} is not drawn yet`);
  let body = visual.bodyMesh;
  if (visual.armor !== null) {
    const source = itemSource(visual.armor);
    const change = source === undefined ? null : /\bvisual_change\s*=\s*"([^"]+)"/i.exec(source);
    if (source === undefined) notes.push(`Armour ${visual.armor} is not an item the project defines, so it is not drawn`);
    else if (change === null) notes.push(`Armour ${visual.armor} has no visual_change, so it is not drawn`);
    else body = change[1];
  }
  return {
    request: {
      model: visual.model,
      body,
      bodyTexture: visual.bodyTexture,
      skinColor: visual.skinColor,
      head: visual.headMesh,
      headTexture: visual.headTexture,
      teethTexture: visual.teethTexture,
      scale: visual.scale,
    },
    notes,
  };
}

/**
 * `npc` with `edits` applied in memory — what the preview draws while the form
 * is unsaved. Statements land where the parser's writer puts them (a field
 * after the last field, a call after the last call of its name, else last),
 * because order is what `resolveNpcVisual` reads. Text and ranges are not
 * maintained: nothing here is written back.
 */
export function withEdits(npc: NpcDefinition, edits: readonly NpcEdit[]): NpcDefinition {
  let statements: NpcStatement[] = [...npc.statements];
  const range = { startIndex: 0, endIndex: 0 };
  const isField = (s: NpcStatement, field: string, index?: string) =>
    s.kind === 'field' && same(s.field, field) && same(s.index ?? '', index ?? '');
  const callsOf = (name: string) => statements.filter((s): s is NpcCallStatement => s.kind === 'call' && same(s.name, name));
  const insertAfterLast = (statement: NpcStatement, match: (s: NpcStatement) => boolean) => {
    const at = statements.map(match).lastIndexOf(true);
    statements.splice(at === -1 ? statements.length : at + 1, 0, statement);
  };

  for (const edit of edits) {
    if (edit.op === 'set') {
      const at = statements.findIndex((s) => isField(s, edit.field, edit.index));
      const statement: NpcStatement = {
        kind: 'field', field: edit.field, index: edit.index, value: edit.value, text: '', range, valueRange: range,
      };
      if (at !== -1) statements[at] = { ...statements[at], value: edit.value } as NpcStatement;
      else insertAfterLast(statement, (s) => s.kind === 'field');
    } else if (edit.op === 'remove') {
      statements = statements.filter((s) => !isField(s, edit.field, edit.index));
    } else if (edit.op === 'addCall') {
      insertAfterLast(
        { kind: 'call', name: edit.name, args: edit.args, text: '', range, argsRange: range },
        (s) => s.kind === 'call' && same(s.name, edit.name),
      );
    } else {
      const target = callsOf(edit.name)[edit.occurrence ?? 0];
      if (target === undefined) {
        if (edit.op === 'setCall') {
          insertAfterLast(
            { kind: 'call', name: edit.name, args: edit.args, text: '', range, argsRange: range },
            (s) => s.kind === 'call' && same(s.name, edit.name),
          );
        }
        continue;
      }
      const at = statements.indexOf(target);
      if (edit.op === 'setCall') statements[at] = { ...target, args: edit.args };
      else statements.splice(at, 1);
    }
  }
  return { ...npc, statements };
}
