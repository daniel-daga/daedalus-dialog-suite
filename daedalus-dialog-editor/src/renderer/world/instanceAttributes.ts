// The two per-instance attribute names the VOB shaders read.
//
// Their own module, and a leaf one: `WorldScene` writes them, `VobPicker`
// copies them into its proxy geometry and `DecalLayer` compiles one into its
// billboard — and `WorldScene` owns `DecalLayer`, so a constant living in
// `WorldScene` made an import cycle out of it. A name three readers share is
// not a member of any one of them.

/**
 * The name of the per-instance "do not draw this one" attribute, shared by the
 * drawn mesh and by the pick pass's proxy for it.
 *
 * Per-class visibility (level-editor.md §16.16) cannot be `mesh.visible`: a VOB
 * is one instance inside an `InstancedMesh` shared with every other VOB of the
 * same visual. Nor can it be a zero-scale instance matrix, tempting as that is
 * — the instance matrix is what `positionOf` and `rotationOf` read a VOB's pose
 * back out of, so collapsing it would put the gizmo of a hidden VOB at the
 * origin and make an op carry it there. So the flag is an attribute beside the
 * matrix, and hiding is one float per instance rather than anything structural.
 */
export const HIDDEN_ATTRIBUTE = 'instanceHidden';

/**
 * The name of the per-instance "this one is selected" attribute.
 *
 * A sibling of {@link HIDDEN_ATTRIBUTE}, for the reason given there: a VOB is
 * one instance inside an `InstancedMesh` shared with every other VOB of the
 * same visual, so neither `mesh.visible` nor anything on the material can say
 * something about *one* of them.
 */
export const SELECTED_ATTRIBUTE = 'instanceSelected';
