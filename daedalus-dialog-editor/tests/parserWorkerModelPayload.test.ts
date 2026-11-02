import { handleParserRequest } from '../src/main/workers/parser.worker';

interface WireModel {
  dialogs: Record<string, {
    properties: Record<string, unknown>;
    actions?: unknown[];
  }>;
  functions: Record<string, { actions?: unknown[] }>;
}

const DIALOG_FILE = 'instance DIA_Cross(C_INFO) { npc = SOME_NPC; nr = 1; information = DIA_Cross_Info; };';

const FUNCTION_FILE = [
  'func void DIA_Cross_Info() {',
  '  AI_Output(other, self, "DIA_Cross_15_00");',
  '  AI_StopProcessInfos(self);',
  '};'
].join('\n');

const parse = (id: string, sourceCode: string): WireModel =>
  handleParserRequest({ id, sourceCode }) as WireModel;

describe('the semantic model that crosses the parser worker IPC (#443)', () => {
  it('carries a dialog body once, under the function that owns it', () => {
    const model = parse('1', [
      'instance DIA_D(C_INFO) { information = DIA_D_Info; };',
      FUNCTION_FILE.replaceAll('DIA_Cross', 'DIA_D')
    ].join('\n'));

    expect(model.dialogs.DIA_D.properties.information).toBe('DIA_D_Info');
    expect(model.dialogs.DIA_D).not.toHaveProperty('actions');
    expect(model.functions.DIA_D_Info.actions).toHaveLength(2);
    expect(JSON.stringify(model.dialogs.DIA_D)).not.toContain('DIA_D_15_00');
  });

  it('reports the same action count on both sides of the hop for a cross-file information function', () => {
    const dialogModel = parse('2', DIALOG_FILE);
    const functionModel = parse('3', FUNCTION_FILE);
    // The merge the project model performs: dialogs and functions from
    // different files share one dictionary, and nothing re-links the dialog.
    const merged: WireModel = {
      dialogs: { ...dialogModel.dialogs },
      functions: { ...functionModel.functions }
    };

    expect(merged.functions.DIA_Cross_Info.actions).toHaveLength(2);
    expect(merged.dialogs.DIA_Cross.actions).toBeUndefined();
    // The dialog names the owner, so the one authority is reachable from it.
    expect(merged.functions[merged.dialogs.DIA_Cross.properties.information as string].actions).toHaveLength(2);
  });
});
