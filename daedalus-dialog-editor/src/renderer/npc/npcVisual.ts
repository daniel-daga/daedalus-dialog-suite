import type { NpcDefinition, NpcCallStatement } from '../../shared/types';

// What the NPC preview draws, read from the NPC's own statements
// (docs/plans/npc-editor.md §4). Pure: no React, no IPC, no assets.
//
// Only the engine externals are read — their signatures are the engine's and
// no mod can change them. `B_SetNpcVisual` is a script function mods rewrite,
// so until its retail body is confirmed an NPC whose visual it sets last is
// reported as undrawable rather than guessed at.

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
  const calls = npc.statements.filter((s): s is NpcCallStatement => s.kind === 'call');
  const last = (name: string) => [...calls].reverse().find((c) => same(c.name, name));
  const indexOf = (c: NpcCallStatement | undefined) => (c ? calls.indexOf(c) : -1);

  const model = last('Mdl_SetVisual');
  const body = last('Mdl_SetVisualBody');
  const helper = last('B_SetNpcVisual');
  if (helper && indexOf(helper) > Math.max(indexOf(model), indexOf(body))) {
    return {
      ok: false,
      reason: 'The visual is set by B_SetNpcVisual, whose body is a script function the preview does not read yet',
    };
  }
  if (!model) return { ok: false, reason: 'No Mdl_SetVisual call' };
  if (!body) return { ok: false, reason: 'No Mdl_SetVisualBody call' };

  const int = (expr: string | undefined): number => {
    const value = (expr ?? '').trim();
    if (/^-?\d+$/.test(value)) return Number(value);
    const constant = lookup(value);
    if (constant === undefined) throw new Unresolved(`${value || 'A missing argument'} is not a known integer constant`);
    return constant;
  };
  const float = (expr: string): number => {
    const value = expr.trim();
    if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Unresolved(`${value} is not a number literal`);
    return Number(value);
  };
  const str = (expr: string | undefined): string => {
    const value = unquote((expr ?? '').trim());
    if (value === null) throw new Unresolved(`${expr ?? 'A missing argument'} is not a string literal`);
    return value;
  };

  try {
    const [, bodyMesh, bodyTex, skin, headMesh, headTex, teeth, armor] = body.args;
    const armorExpr = (armor ?? '').trim();
    const fatness = last('Mdl_SetModelFatness')?.args[1];
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
      },
    };
  } catch (error) {
    if (error instanceof Unresolved) return { ok: false, reason: error.message };
    throw error;
  }
}

/**
 * A texture as a body or head variant: ZenGin replaces the `_V0` (variation)
 * and `_C0` (colour) channels of the mesh's base texture name.
 */
export function variantTextureName(name: string, variation: number, color: number): string {
  return name.replace(/_V\d+/i, `_V${variation}`).replace(/_C\d+/i, `_C${color}`);
}
