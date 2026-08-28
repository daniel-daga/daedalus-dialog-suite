// Portal metadata, checked from the two name lists the payload already carries
// (level-editor.md §16.18, slice 1). ZenGin marks a portal face with a material
// named `P:<sector>_<sector>`, so the whole static check is string work over
// `mesh.materials` and `bsp.sectorNames` — no geometry, and no binding change.
//
// Measured over the retail G2 worlds on 2026-08-28, which is what fixes the
// shapes this accepts: OldWorld 100 `P:` materials against 38 sectors, NewWorld
// 318 against 154, AddonWorld 154 against 154. All uppercase `P:`, all with
// exactly one underscore, no sector name containing one, and every named side
// present in `sectorNames`. An empty side is normal and common — `P:OWCAVE01_`
// and `P:_OWCAVE01` are 44 of OldWorld's 100 — so only a name with *both* sides
// empty is malformed.

export type PortalMaterialProblem =
  /** The name is not `P:<sector>_<sector>`: no separator, more than one, or nothing either side. */
  | { kind: 'portal-material-malformed'; material: string }
  /** A side names a sector the compiled world does not have — the shape of a portal that will not pair. */
  | { kind: 'portal-material-unknown-sector'; material: string; sector: string };

export interface PortalMaterialInput {
  /** `mesh.materials`, in the order polygons index them. */
  materials: readonly string[];
  /** `bsp.sectorNames`. */
  sectorNames: readonly string[];
}

export function checkPortalMaterials({
  materials,
  sectorNames,
}: PortalMaterialInput): PortalMaterialProblem[] {
  const known = new Set(sectorNames.map((name) => name.toUpperCase()));
  const problems: PortalMaterialProblem[] = [];

  for (const material of materials) {
    if (!material.toUpperCase().startsWith('P:')) continue;

    const sides = material.slice(2).split('_');
    if (sides.length !== 2 || (!sides[0] && !sides[1])) {
      problems.push({ kind: 'portal-material-malformed', material });
      continue;
    }

    for (const sector of sides) {
      // Case-insensitively: retail is uniformly uppercase on both sides, so
      // nothing measured says a case difference fails to pair.
      if (sector && !known.has(sector.toUpperCase())) {
        problems.push({ kind: 'portal-material-unknown-sector', material, sector });
      }
    }
  }

  return problems;
}
