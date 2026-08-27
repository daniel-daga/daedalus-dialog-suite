// The per-class field catalogue (level-editor.md §14.1 item 1.4, Phase 1b-2).
//
// Everything the editor has written so far is on `zCVob`: a position, a
// rotation, a name, a visual, six flags. The fields that make a VOB the thing it
// *is* — the Daedalus instance an `oCItem` spawns, the range and the colour a
// `zCVobLight` lights with — live on the subclasses, and **none of them are in
// the columnar index**: `vobIndex` interns the class *name* and carries not one
// field of the class. That is the fact the whole per-class op is shaped around,
// and it is why this table exists rather than eight more optional keys on
// `VobProps`.
//
// One table, here, because three allowlists already have to move in lockstep
// with nothing shared between them: the binding's `kKnownKeys`, the editor's
// `VOB_FLAG_KEYS`, and `PROP_KEYS` next door. The op builder, the IPC validator
// and the property grid can all read this one, so adding a class is one entry
// rather than three that agree by hand. The C++ table stays separate and
// unavoidable — what ties it to this one is a per-key round-trip test in
// `zenkit-node`, not a shared constant.
//
// It is deliberately narrow. Enums are out because retail data contains
// out-of-range enum values (`zCMover.lerpMode` is 120 on three VOBs) and a
// dropdown that cannot represent one destroys it on write; unbounded lists are
// out because they are the first payloads with no length to cap; and
// `zCVobLight.isStatic` is out because flipping it changes *which fields the
// archive contains*, so its inverse does not restore the world. Each of those is
// a decision, and each belongs with the first class that forces it.

/**
 * What a class field's value can be.
 *
 * Three kinds, chosen to force every structural decision at once: a plain
 * string, a finite scalar, and a small fixed-arity array of integers. Nothing
 * here is a nested record, which is what keeps the op's IPC assertion a flat
 * walk over keys.
 */
export type ClassPropValue = string | number | readonly number[];

/** A VOB's class fields as an op carries them — only the keys being written. */
export interface ClassProps {
  [key: string]: ClassPropValue;
}

/**
 * One field: what it is called, what kind of value it takes, and the bounds a
 * value outside of which is refused.
 *
 * The bounds live in the catalogue rather than in the validator because the grid
 * needs the same numbers to reject a typed value before it commits one, and two
 * hand-written copies of "0 to 255" is one copy too many. For a colour they are
 * per channel.
 */
export interface FieldDescriptor {
  key: string;
  kind: 'string' | 'float' | 'color';
  min?: number;
  max?: number;
}

/** The Daedalus instance the item spawns from — free text at this layer, with
 *  the same trust level `name` has: validating it against the parser's item
 *  index would couple the World surface to the semantic model. */
const OC_ITEM_FIELDS = [
  { key: 'instance', kind: 'string' },
] as const satisfies readonly FieldDescriptor[];

const ZC_VOB_LIGHT_FIELDS = [
  { key: 'range', kind: 'float', min: 0 },
  { key: 'color', kind: 'color', min: 0, max: 255 },
] as const satisfies readonly FieldDescriptor[];

/**
 * Class name → the fields the editor writes on it, in the order it draws them.
 *
 * `as const satisfies` for the same reason `PROP_KEYS` has it: the literal types
 * survive, so `kind` is checked against the three the validator switches on
 * rather than being widened to `string` and discovered at runtime.
 */
export const CLASS_FIELDS = {
  oCItem: OC_ITEM_FIELDS,
  zCVobLight: ZC_VOB_LIGHT_FIELDS,
} as const satisfies Record<string, readonly FieldDescriptor[]>;

/** A class the catalogue knows. Not every class in a world is one — a world has
 *  37 and this has two, which is the point of asking through `fieldOf`. */
export type ClassName = keyof typeof CLASS_FIELDS;

/** Shared rather than allocated per miss: `classPropKeys` is called on every
 *  render of the property grid, and most VOBs are of a class with no entry. */
const NO_FIELDS: readonly FieldDescriptor[] = [];

/**
 * The fields catalogued for `className`, empty for one that is not catalogued.
 *
 * The class name arrives from a world, so the lookup is a boundary and is
 * `hasOwnProperty` rather than an index plus `??`: a plain object literal answers
 * `CLASS_FIELDS['toString']` with a *function*, and the grid would be handed a
 * method to iterate.
 */
function fieldsOf(className: string): readonly FieldDescriptor[] {
  return Object.prototype.hasOwnProperty.call(CLASS_FIELDS, className)
    ? CLASS_FIELDS[className as ClassName]
    : NO_FIELDS;
}

/** The keys of `className`'s fields, in catalogue order — the per-class
 *  analogue of `PROP_KEYS`, and the order an op writes them in so that two ops
 *  built from the same edit are the same object. */
export function classPropKeys(className: string): readonly string[] {
  return fieldsOf(className).map((field) => field.key);
}

/** The descriptor for one key of one class, or null when that class does not
 *  have it — which is how a cross-class key is refused before it is ever built
 *  into an op. */
export function fieldOf(className: string, key: string): FieldDescriptor | null {
  return fieldsOf(className).find((field) => field.key === key) ?? null;
}
