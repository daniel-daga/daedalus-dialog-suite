import { extractFreePointSites, resolveFreePointSites } from '../scripts/check-free-point-sites.js';

// The counting behind `check-free-point-sites.js`, the measurement the
// world-editor review's finding 6 asks for under *Forward*: how many of the
// retail `Wld_IsFPAvailable`/`AI_GotoFP` sites resolve against a world's
// `zCVobSpot` set. The script needs the script corpus and a world; this pins
// what it counts, on inputs small enough to read.

test('takes the fragment out of both externals', () => {
  const sites = extractFreePointSites(
    'func void x() {\n'
    + '\tif (Wld_IsFPAvailable(self, "ROAM"))\n'
    + '\t{ AI_GotoFP(self, "FP_ROAM_CITY_01"); };\n'
    + '};\n',
    'a.d'
  );
  expect(sites).toEqual([
    { external: 'Wld_IsFPAvailable', name: 'ROAM', literal: true, filePath: 'a.d', line: 2 },
    { external: 'AI_GotoFP', name: 'FP_ROAM_CITY_01', literal: true, filePath: 'a.d', line: 3 }
  ]);
});

test('a non-literal argument is a site with no name', () => {
  // A fragment passed as a constant or a variable is a site the measurement
  // cannot resolve, and dropping it would understate the denominator.
  const sites = extractFreePointSites('AI_GotoFP(self, spot);', 'a.d');
  expect(sites).toEqual([
    { external: 'AI_GotoFP', name: null, literal: false, filePath: 'a.d', line: 1 }
  ]);
});

test('a commented-out call is not a site', () => {
  const source = '// AI_GotoFP(self, "FP_A");\n/* Wld_IsFPAvailable(self, "B"); */\nAI_GotoFP(self, "FP_C");\n';
  expect(extractFreePointSites(source, 'a.d').map((s: { name: string }) => s.name)).toEqual(['FP_C']);
});

test('classifies each literal exact, prefix, infix or unresolved', () => {
  const sites = extractFreePointSites(
    'AI_GotoFP(self, "FP_ROAM_CITY_01");\n'
    + 'AI_GotoFP(self, "FP_ROAM_CITY");\n'
    + 'Wld_IsFPAvailable(self, "ROAM");\n'
    + 'Wld_IsFPAvailable(self, "NOWHERE");\n'
    + 'AI_GotoFP(self, spot);\n',
    'a.d'
  );
  const r = resolveFreePointSites(sites, ['FP_ROAM_CITY_01', 'FP_STAND_OC_02']);
  expect(r).toMatchObject({
    sites: 5, literal: 4, nonLiteral: 1,
    exact: 1, prefix: 1, infix: 1, unresolved: 1
  });
  expect(r.unresolvedNames).toEqual(['NOWHERE']);
});

test('matching is case-insensitive and the free points may be lower case', () => {
  const sites = extractFreePointSites('AI_GotoFP(self, "fp_roam_city_01");', 'a.d');
  expect(resolveFreePointSites(sites, ['FP_ROAM_CITY_01']).exact).toBe(1);
});

test('resolution is per site, so one name counted twice counts twice', () => {
  const sites = extractFreePointSites('AI_GotoFP(self, "FP_A");\nAI_GotoFP(self, "FP_A");\n', 'a.d');
  expect(resolveFreePointSites(sites, ['FP_A']).exact).toBe(2);
});
