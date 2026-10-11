import type { NpcDefinition, NpcEdit, NpcFieldStatement, NpcCallStatement, NpcStatement } from '../../shared/types';
import type { NpcItemCategory } from './npcItemCategories';

// What the NPC editor's form shows, and how its values become edits
// (docs/plans/npc-editor.md, Phase 2). Pure: no React, no IPC.
//
// A control reads one statement of the NPC's body — a field, an indexed field,
// or one argument of the vanilla `B_SetNpcVisual` call — and a value is the
// expression exactly as written, so a constant stays a constant and a string
// is written back with its quotes. An empty control means "absent from the
// script", never a default the editor made up.
//
// A `string` control shows a string literal's content and writes what is typed
// back as a literal — unless a non-literal (a constant) stood there, which is
// then edited as the expression it is.

export const VISUAL_CALL = 'B_SetNpcVisual';
export const EQUIP_CALL = 'EquipItem';

type Target =
  | { kind: 'field'; field: string; index?: string }
  | { kind: 'visualArg'; arg: number }
  | { kind: 'overlay' }
  /** The first EquipItem whose item source declares this category. */
  | { kind: 'equip'; category: NpcItemCategory };

export interface NpcFormField {
  key: string;
  label: string;
  group: 'main' | 'attributes' | 'hitChance' | 'protection' | 'visual' | 'equipment';
  target: Target;
  /** Shown without quotes and written back as a string literal. */
  string?: true;
  /** Where the control's selectable choices come from. */
  options?: { constantPrefix: string; values?: string[] } | { itemPrefix: string } | { routines: true }
    | { npcField: 'voice' } | { values: string[] }
    | { assets: 'headMesh' | 'walkOverlay' } | { itemCategory: NpcItemCategory };
}

const f = (
  key: string, label: string, group: NpcFormField['group'], field: string, index?: string,
  options?: NpcFormField['options'],
): NpcFormField => ({ key, label, group, target: { kind: 'field', field, index }, options });

const v = (key: string, label: string, arg: number, options?: NpcFormField['options']): NpcFormField =>
  ({ key, label, group: 'visual', target: { kind: 'visualArg', arg }, options });

export const NPC_FORM_FIELDS: NpcFormField[] = [
  { ...f('name', 'Name', 'main', 'name'), string: true },
  f('guild', 'Guild', 'main', 'guild', undefined, { constantPrefix: 'GIL_' }),
  f('id', 'ID', 'main', 'id'),
  f('voice', 'Voice', 'main', 'voice', undefined, { npcField: 'voice' }),
  f('flags', 'Flags', 'main', 'flags', undefined, { constantPrefix: 'NPC_FLAG_', values: ['0'] }),
  f('npctype', 'NPC type', 'main', 'npctype', undefined, { constantPrefix: 'NPCTYPE_' }),
  f('level', 'Level', 'main', 'level'),
  f('fightTactic', 'Fight tactic', 'main', 'fight_tactic', undefined, { constantPrefix: 'FAI_' }),
  f('dailyRoutine', 'Daily routine', 'main', 'daily_routine', undefined, { routines: true }),
  f('strength', 'Strength', 'attributes', 'attribute', 'ATR_STRENGTH'),
  f('dexterity', 'Dexterity', 'attributes', 'attribute', 'ATR_DEXTERITY'),
  f('mana', 'Mana', 'attributes', 'attribute', 'ATR_MANA_MAX'),
  f('hitpoints', 'Hit points', 'attributes', 'attribute', 'ATR_HITPOINTS_MAX'),
  f('hitChance1h', 'One-handed', 'hitChance', 'HitChance', 'NPC_TALENT_1H'),
  f('hitChance2h', 'Two-handed', 'hitChance', 'HitChance', 'NPC_TALENT_2H'),
  f('hitChanceBow', 'Bow', 'hitChance', 'HitChance', 'NPC_TALENT_BOW'),
  f('hitChanceCrossbow', 'Crossbow', 'hitChance', 'HitChance', 'NPC_TALENT_CROSSBOW'),
  f('protectionBlunt', 'Blunt', 'protection', 'protection', 'PROT_BLUNT'),
  f('protectionEdge', 'Edge', 'protection', 'protection', 'PROT_EDGE'),
  f('protectionPoint', 'Point', 'protection', 'protection', 'PROT_POINT'),
  f('protectionFire', 'Fire', 'protection', 'protection', 'PROT_FIRE'),
  f('protectionFly', 'Fly', 'protection', 'protection', 'PROT_FLY'),
  f('protectionMagic', 'Magic', 'protection', 'protection', 'PROT_MAGIC'),
  v('gender', 'Gender', 1, { values: ['MALE', 'FEMALE'] }),
  { ...v('headMesh', 'Head mesh', 2, { assets: 'headMesh' }), string: true },
  { key: 'walkOverlay', label: 'Walk overlay', group: 'visual', target: { kind: 'overlay' },
    string: true, options: { assets: 'walkOverlay' } },
  v('faceTexture', 'Face texture', 3, { constantPrefix: 'Face' }),
  v('bodyTexture', 'Body texture', 4, { constantPrefix: 'BodyTex' }),
  v('armor', 'Armor', 5, { itemCategory: 'armor' }),
  { key: 'meleeWeapon', label: 'Melee weapon', group: 'equipment', target: { kind: 'equip', category: 'meleeWeapon' }, options: { itemCategory: 'meleeWeapon' } },
  { key: 'rangedWeapon', label: 'Ranged weapon', group: 'equipment', target: { kind: 'equip', category: 'rangedWeapon' }, options: { itemCategory: 'rangedWeapon' } },
];

const VISUAL_FIELDS = NPC_FORM_FIELDS.filter((field) => field.target.kind === 'visualArg');

export type NpcFormValues = Record<string, string>;

const same = (a: string | undefined, b: string | undefined) =>
  (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

function findField(npc: NpcDefinition, field: string, index?: string): NpcFieldStatement | undefined {
  return npc.statements.find((s): s is NpcFieldStatement =>
    s.kind === 'field' && same(s.field, field) && same(s.index, index));
}

function findVisualCall(npc: NpcDefinition): NpcCallStatement | undefined {
  return npc.statements.find((s): s is NpcCallStatement => s.kind === 'call' && same(s.name, VISUAL_CALL));
}

export type NpcItemCategoryLookup = (instance: string) => NpcItemCategory | undefined;

const LEGACY_EQUIP_PREFIX: Record<NpcItemCategory, string> = {
  armor: 'ITAR_', meleeWeapon: 'ITMW_', rangedWeapon: 'ITRW_',
};

/** The category's equip call and its occurrence among all EquipItem calls. */
function findEquip(
  npc: NpcDefinition,
  category: NpcItemCategory,
  categoryOfItem?: NpcItemCategoryLookup,
): { call: NpcCallStatement; occurrence: number } | undefined {
  const equips = npc.statements.filter((s): s is NpcCallStatement => s.kind === 'call' && same(s.name, EQUIP_CALL));
  const occurrence = equips.findIndex((call) => {
    const item = (call.args[1] ?? '').trim().replace(/^"|"$/g, '');
    const parsedCategory = categoryOfItem?.(item);
    return parsedCategory === category
      || (parsedCategory === undefined && item.toUpperCase().startsWith(LEGACY_EQUIP_PREFIX[category]));
  });
  return occurrence === -1 ? undefined : { call: equips[occurrence], occurrence };
}

/** The first `Mdl_ApplyOverlayMds` using a mounted HUMANS_ walk overlay. */
function findWalkOverlay(npc: NpcDefinition): { call: NpcCallStatement; occurrence: number } | undefined {
  const overlays = npc.statements.filter(
    (s): s is NpcCallStatement => s.kind === 'call' && same(s.name, 'Mdl_ApplyOverlayMds'),
  );
  const occurrence = overlays.findIndex((call) => {
    const argument = (call.args[1] ?? '').trim().replace(/^"|"$/g, '');
    return argument.toUpperCase().startsWith('HUMANS_') && argument.toUpperCase().endsWith('.MDS');
  });
  return occurrence === -1 ? undefined : { call: overlays[occurrence], occurrence };
}

const isStringLiteral = (value: string) => /^"[^"]*"$/.test(value);

/** The expression the script has for `field`, or undefined when absent. */
function writtenValue(npc: NpcDefinition, field: NpcFormField, categoryOfItem?: NpcItemCategoryLookup): string | undefined {
  const { target } = field;
  if (target.kind === 'field') return findField(npc, target.field, target.index)?.value;
  if (target.kind === 'equip') return findEquip(npc, target.category, categoryOfItem)?.call.args[1];
  if (target.kind === 'overlay') return findWalkOverlay(npc)?.call.args[1];
  return findVisualCall(npc)?.args[target.arg];
}

/** What a typed value is written as: quoted for a `string` control, unless a
 *  non-literal stood there. */
function toExpression(npc: NpcDefinition, field: NpcFormField, typed: string, categoryOfItem?: NpcItemCategoryLookup): string {
  if (!field.string) return typed;
  const existing = writtenValue(npc, field, categoryOfItem);
  return existing !== undefined && !isStringLiteral(existing) ? typed : `"${typed}"`;
}

export function formValuesFrom(npc: NpcDefinition, categoryOfItem?: NpcItemCategoryLookup): NpcFormValues {
  const values: NpcFormValues = {};
  for (const field of NPC_FORM_FIELDS) {
    const written = writtenValue(npc, field, categoryOfItem) ?? '';
    values[field.key] = field.string && isStringLiteral(written) ? written.slice(1, -1) : written;
  }
  return values;
}

/** Why the form cannot be saved, or null when it can. */
export function validateNpcForm(values: NpcFormValues): string | null {
  for (const field of NPC_FORM_FIELDS) {
    if (/[\r\n]/.test(values[field.key] ?? '')) {
      return `${field.label} must be on one line`;
    }
    if (field.string && (values[field.key] ?? '').includes('"')) {
      return `${field.label} must not contain a double quote`;
    }
  }
  const filled = VISUAL_FIELDS.filter((field) => (values[field.key] ?? '').trim() !== '').length;
  if (filled !== 0 && filled !== VISUAL_FIELDS.length) {
    return `The visual needs all ${VISUAL_FIELDS.length} values, or none`;
  }
  return null;
}

/** The edits that turn `before` into `after`, in form order. */
export function editsBetween(
  npc: NpcDefinition,
  before: NpcFormValues,
  after: NpcFormValues,
  categoryOfItem?: NpcItemCategoryLookup,
): NpcEdit[] {
  const edits: NpcEdit[] = [];
  const changed = (key: string) => (before[key] ?? '').trim() !== (after[key] ?? '').trim();

  for (const field of NPC_FORM_FIELDS) {
    if (field.target.kind !== 'field' || !changed(field.key)) continue;
    const { field: name, index } = field.target;
    const typed = (after[field.key] ?? '').trim();
    const target = index === undefined ? { field: name } : { field: name, index };
    edits.push(typed === ''
      ? { op: 'remove', ...target }
      : { op: 'set', ...target, value: toExpression(npc, field, typed) });
  }

  for (const field of NPC_FORM_FIELDS) {
    if (field.target.kind !== 'equip' || !changed(field.key)) continue;
    const typed = (after[field.key] ?? '').trim();
    const existing = findEquip(npc, field.target.category, categoryOfItem);
    if (!existing) {
      if (typed !== '') edits.push({ op: 'addCall', name: EQUIP_CALL, args: ['self', typed] });
    } else if (typed === '') {
      edits.push({ op: 'removeCall', name: EQUIP_CALL, occurrence: existing.occurrence });
    } else {
      edits.push({
        op: 'setCall', name: EQUIP_CALL, occurrence: existing.occurrence, args: [existing.call.args[0], typed],
      });
    }
  }

  for (const field of NPC_FORM_FIELDS) {
    if (field.target.kind !== 'overlay' || !changed(field.key)) continue;
    const typed = (after[field.key] ?? '').trim();
    const existing = findWalkOverlay(npc);
    if (!existing) {
      if (typed !== '') edits.push({ op: 'addCall', name: 'Mdl_ApplyOverlayMds', args: ['self', toExpression(npc, field, typed)] });
    } else if (typed === '') {
      edits.push({ op: 'removeCall', name: 'Mdl_ApplyOverlayMds', occurrence: existing.occurrence });
    } else {
      edits.push({
        op: 'setCall', name: 'Mdl_ApplyOverlayMds', occurrence: existing.occurrence,
        args: [existing.call.args[0], toExpression(npc, field, typed)],
      });
    }
  }

  if (VISUAL_FIELDS.some((field) => changed(field.key))) {
    const typed = VISUAL_FIELDS.map((field) => (after[field.key] ?? '').trim());
    if (typed.every((arg) => arg === '')) {
      edits.push({ op: 'removeCall', name: VISUAL_CALL });
    } else {
      const first = findVisualCall(npc)?.args[0] ?? 'self';
      const args = VISUAL_FIELDS.map((field, i) => toExpression(npc, field, typed[i]));
      edits.push({ op: 'setCall', name: VISUAL_CALL, args: [first, ...args] });
    }
  }
  return edits;
}

/** The statements no control reads — shown read-only, and never touched. */
export function uncoveredStatements(npc: NpcDefinition, categoryOfItem?: NpcItemCategoryLookup): NpcStatement[] {
  const visual = findVisualCall(npc);
  const covered = new Set<NpcStatement>(visual ? [visual] : []);
  for (const field of NPC_FORM_FIELDS) {
    const { target } = field;
    const statement = target.kind === 'field' ? findField(npc, target.field, target.index)
      : target.kind === 'equip' ? findEquip(npc, target.category, categoryOfItem)?.call
        : target.kind === 'overlay' ? findWalkOverlay(npc)?.call
        : undefined;
    if (statement) covered.add(statement);
  }
  return npc.statements.filter((s) => !covered.has(s));
}
