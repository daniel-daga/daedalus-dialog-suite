/**
 * Issue #119 (Npc_SetRefuseTalk) and #123 (Info_ClearChoices):
 * the editor must expose both as first-class actions — creatable via the
 * factory, type-detected, rendered by a dedicated renderer, and code-generated
 * to the correct Daedalus calls.
 */
import { createAction } from '../src/renderer/components/actionFactory';
import { getActionType } from '../src/renderer/components/actionTypes';
import { getRendererForAction, ACTION_RENDERERS } from '../src/renderer/components/actionRenderers';
import UnknownActionRenderer from '../src/renderer/components/actionRenderers/UnknownActionRenderer';
import { CodeGeneratorService } from '../src/main/services/CodeGeneratorService';
import type { SetRefuseTalkAction, ClearChoicesAction } from '../src/renderer/types/global';

describe('Npc_SetRefuseTalk action (#119)', () => {
  test('factory creates a SetRefuseTalkAction with default target and 300 seconds', () => {
    const action = createAction('setRefuseTalkAction') as SetRefuseTalkAction;
    expect(action).toMatchObject({ type: 'SetRefuseTalkAction', target: 'self', seconds: 300 });
  });

  test('type detection and renderer registration', () => {
    const action = createAction('setRefuseTalkAction');
    expect(getActionType(action)).toBe('setRefuseTalkAction');
    expect(ACTION_RENDERERS.setRefuseTalkAction).toBeDefined();
    expect(getRendererForAction(action)).not.toBe(UnknownActionRenderer);
  });
});

describe('Info_ClearChoices action (#123)', () => {
  test('factory auto-fills the dialog instance from the current dialog context', () => {
    const action = createAction('clearChoicesAction', { dialogName: 'DIA_Diego_Hi' }) as ClearChoicesAction;
    expect(action).toMatchObject({ type: 'ClearChoicesAction', dialog: 'DIA_Diego_Hi' });
  });

  test('type detection and renderer registration', () => {
    const action = createAction('clearChoicesAction', { dialogName: 'DIA_Diego_Hi' });
    expect(getActionType(action)).toBe('clearChoicesAction');
    expect(ACTION_RENDERERS.clearChoicesAction).toBeDefined();
    expect(getRendererForAction(action)).not.toBe(UnknownActionRenderer);
  });
});

describe('code generation round-trip', () => {
  const settings = {
    indentChar: '\t' as const,
    includeComments: true,
    sectionHeaders: false,
    uppercaseKeywords: true
  };

  test('emits Npc_SetRefuseTalk and Info_ClearChoices', () => {
    const service = new CodeGeneratorService();
    const plainModel = {
      functions: {
        DIA_Test_Info: {
          name: 'DIA_Test_Info',
          returnType: 'void',
          calls: [],
          actions: [
            { type: 'SetRefuseTalkAction', target: 'self', seconds: 120 },
            { type: 'ClearChoicesAction', dialog: 'DIA_Test' }
          ]
        }
      },
      dialogs: {}
    };

    const code = service.generateCode(plainModel, settings);
    expect(code).toContain('Npc_SetRefuseTalk (self, 120);');
    expect(code).toContain('Info_ClearChoices (DIA_Test);');
  });
});
