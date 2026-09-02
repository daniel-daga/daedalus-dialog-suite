import type { LintRule, Problem, ProblemLocus } from '../types';
import type { PortalFinding } from '../../../../shared/worldTypes';
import { PORTAL_PLANARITY_TOLERANCE } from 'zen-world';

/**
 * The portal checks' consumer (level-editor.md §16.20 slice 3, §16.22 q1–q3).
 *
 * The checks live in `zen-world` and run in the zenkit worker over the open
 * world's mesh; what reaches this rule is their findings, one per defect, each
 * pinned to a polygon where one carries the material. This rule only turns a
 * finding into a `Problem`: an id, a severity, a message and a **world locus
 * by polygon** — which the panel lists and does not make clickable, because
 * framing a polygon is deliberately not built (Daniel, 2026-09-02).
 *
 * **No world open means no findings**, exactly as `waypoint-not-in-world`: an
 * absent list is nothing known, never nothing legal.
 *
 * Severity follows what the measurement said about each kind. A malformed
 * name and an unknown sector are errors — the portal cannot pair, and no
 * retail world has either (§16.18). A missing mirror is the warning q1 asked
 * for; a fold past 12.1 units and a reversed normal are warnings because the
 * checks that find them are set at retail's own worst (§16.22 q2, q3).
 */
export const portalsRule: LintRule = (view): Problem[] => {
  const { portalFindings } = view;
  if (!portalFindings) return [];

  const problems: Problem[] = [];
  const seen = new Set<string>();
  for (const finding of portalFindings) {
    const problem = problemOf(finding);
    // A material the mesh lists twice is one name and one row.
    if (seen.has(problem.id)) continue;
    seen.add(problem.id);
    problems.push(problem);
  }
  return problems;
};

const locusOf = (polygon: number | null): ProblemLocus =>
  (polygon === null ? { kind: 'world' } : { kind: 'world', polygon });

function problemOf(finding: PortalFinding): Problem {
  switch (finding.kind) {
    case 'portal-material-malformed':
      return {
        id: `portal-material-malformed:${finding.material}`,
        rule: finding.kind,
        severity: 'error',
        message: `Portal material "${finding.material}" is not P:<sector>_<sector>.`,
        locus: locusOf(finding.polygon),
      };
    case 'portal-material-unknown-sector':
      return {
        id: `portal-material-unknown-sector:${finding.material}:${finding.sector}`,
        rule: finding.kind,
        severity: 'error',
        message: `Portal material "${finding.material}" names sector "${finding.sector}", which this world does not have.`,
        locus: locusOf(finding.polygon),
      };
    case 'portal-unpaired':
      return {
        id: `portal-unpaired:${finding.material}`,
        rule: finding.kind,
        severity: 'warning',
        message: `Portal material "${finding.material}" has no mirror "${finding.wanted}".`,
        locus: locusOf(finding.polygon),
      };
    case 'portal-non-planar':
      return {
        id: `portal-non-planar:${finding.polygon}`,
        rule: finding.kind,
        severity: 'warning',
        message: `Portal polygon ${finding.polygon} ("${finding.material}") is ${finding.spread.toFixed(1)} units off its own plane; retail stays within ${PORTAL_PLANARITY_TOLERANCE}.`,
        locus: locusOf(finding.polygon),
      };
    case 'portal-reversed':
      return {
        id: `portal-reversed:${finding.polygon}`,
        rule: finding.kind,
        severity: 'warning',
        message: `Portal polygon ${finding.polygon} ("${finding.material}") faces away from sector "${finding.sector}".`,
        locus: locusOf(finding.polygon),
      };
  }
}
