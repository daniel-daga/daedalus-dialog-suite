/**
 * The parser worker's NPC requests, against the real daedalus-parser: the
 * worker is the only place the editor runs a native parse, so the NPC reader
 * and writer (docs/plans/npc-editor.md Phase 2) run there too.
 *
 * @jest-environment node
 */

import { describe, it, expect } from '@jest/globals';
import { handleParserRequest } from '../src/main/workers/parser.worker';

const ONAR = [
  'instance BAU_900_Onar (Npc_Default)',
  '{',
  '\tname \t\t= "Onar";',
  '\tguild \t\t= GIL_BAU; // farmer',
  '\tB_SetNpcVisual (self, MALE, "Hum_Head_Fatbald", Face_N_Weak_Orry, BodyTex_N, ITAR_Vlk_H);',
  '};',
].join('\n');

describe('parser worker NPC requests', () => {
  it('extracts an NPC definition', () => {
    const npc = handleParserRequest({ id: '1', npc: 'extract', sourceCode: ONAR }) as {
      name: string;
      statements: Array<{ kind: string; field?: string; value?: string; name?: string; args?: string[] }>;
    };
    expect(npc.name).toBe('BAU_900_Onar');
    expect(npc.statements.map((s) => s.kind)).toEqual(['field', 'field', 'call']);
    expect(npc.statements[1]).toMatchObject({ field: 'guild', value: 'GIL_BAU' });
    expect(npc.statements[2].args).toHaveLength(6);
  });

  it('applies edits and returns the patched source', () => {
    const edited = handleParserRequest({
      id: '2',
      npc: 'apply',
      sourceCode: ONAR,
      edits: [{ op: 'set', field: 'guild', value: 'GIL_SLD' }],
    });
    expect(edited).toBe(ONAR.replace('GIL_BAU', 'GIL_SLD'));
  });

  it('still parses a plain request into a semantic model', () => {
    const model = handleParserRequest({ id: '3', sourceCode: ONAR }) as { instances: Record<string, unknown> };
    expect(Object.keys(model.instances)).toEqual(['BAU_900_Onar']);
  });

  it('throws on source that is not an instance, so the service rejects', () => {
    expect(() => handleParserRequest({ id: '4', npc: 'extract', sourceCode: 'func void X() {};' }))
      .toThrow(/instance/);
  });
});
