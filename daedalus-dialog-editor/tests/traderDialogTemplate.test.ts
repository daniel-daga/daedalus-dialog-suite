/**
 * Merchant/trader scaffolder (feature-suggestions item 5): generate the
 * standard vanilla trade dialog — permanent C_INFO with trade = TRUE and an
 * info function calling B_GiveTradeInv (vanilla shape: DIA_VLK_413_Bosper.d).
 * @jest-environment node
 */
import { createTraderDialogTemplate, TRADER_DEFAULT_DESCRIPTION } from '../src/renderer/utils/traderDialogTemplate';
import { execFileSync } from 'child_process';

describe('createTraderDialogTemplate', () => {
  const source = createTraderDialogTemplate({
    npcInstanceName: 'VLK_413_Bosper',
    dialogName: 'DIA_Bosper_Trade',
    description: 'Zeig mir Deine Waren.'
  });

  test('exports the vanilla default description', () => {
    expect(TRADER_DEFAULT_DESCRIPTION).toBe('Zeig mir Deine Waren.');
  });

  test('emits the permanent trade instance', () => {
    expect(source).toContain('INSTANCE DIA_Bosper_Trade (C_INFO)');
    expect(source).toContain('npc\t\t\t= VLK_413_Bosper;');
    expect(source).toContain('nr\t\t\t= 700;');
    expect(source).toContain('condition\t= DIA_Bosper_Trade_Condition;');
    expect(source).toContain('information\t= DIA_Bosper_Trade_Info;');
    expect(source).toContain('permanent\t= TRUE;');
    expect(source).toContain('trade\t\t= TRUE;');
    expect(source).toContain('description\t= "Zeig mir Deine Waren.";');
  });

  test('condition returns TRUE and info hands over the trade inventory', () => {
    expect(source).toContain('FUNC INT DIA_Bosper_Trade_Condition()');
    expect(source).toContain('\treturn TRUE;');
    expect(source).toContain('FUNC VOID DIA_Bosper_Trade_Info()');
    expect(source).toContain('\tB_GiveTradeInv (self);');
    // Voice numbers are unknowable at scaffold time — no spoken lines
    expect(source).not.toContain('AI_Output');
  });

  test('sanitizes quotes and newlines in the description', () => {
    const quoted = createTraderDialogTemplate({
      npcInstanceName: 'VLK_413_Bosper',
      dialogName: 'DIA_Bosper_Trade',
      description: 'Zeig mir "alles"\nwas du hast!'
    });
    expect(quoted).toContain("description\t= \"Zeig mir 'alles' was du hast!\";");
  });

  test('parses cleanly and the trade flag survives code regeneration', () => {
    // Real-parser validation runs in a child process (native tree-sitter
    // binding cannot be loaded twice per Jest worker); the regeneration
    // proves the generically modeled C_INFO `trade` property round-trips.
    const parserPath = require.resolve('daedalus-parser');
    const visitorPath = require.resolve('daedalus-parser/semantic-visitor');
    const generatorPath = require.resolve('daedalus-parser/semantic-code-generator');
    const script = `
      let src = '';
      process.stdin.on('data', (d) => { src += d; });
      process.stdin.on('end', () => {
        const DaedalusParser = require(${JSON.stringify(parserPath)});
        const { SemanticModelBuilderVisitor } = require(${JSON.stringify(visitorPath)});
        const { SemanticCodeGenerator } = require(${JSON.stringify(generatorPath)});
        const result = new DaedalusParser().parse(src);
        const visitor = new SemanticModelBuilderVisitor();
        visitor.pass1_createObjects(result.tree.rootNode);
        visitor.pass2_analyzeAndLink(result.tree.rootNode);
        const dialog = visitor.semanticModel.dialogs['DIA_Bosper_Trade'];
        const regenerated = new SemanticCodeGenerator().generateSemanticModel(visitor.semanticModel);
        console.log(JSON.stringify({
          hasErrors: !!result.hasErrors,
          dialogs: Object.keys(visitor.semanticModel.dialogs),
          functions: Object.keys(visitor.semanticModel.functions),
          npc: dialog && dialog.properties && dialog.properties.npc,
          trade: dialog && dialog.properties && dialog.properties.trade,
          permanent: dialog && dialog.properties && dialog.properties.permanent,
          regenerated
        }));
      });
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      input: source,
      encoding: 'utf8'
    });
    const parsed = JSON.parse(output);
    expect(parsed.hasErrors).toBe(false);
    expect(parsed.dialogs).toEqual(['DIA_Bosper_Trade']);
    expect(parsed.functions).toEqual(
      expect.arrayContaining(['DIA_Bosper_Trade_Condition', 'DIA_Bosper_Trade_Info'])
    );
    expect(parsed.npc).toBe('VLK_413_Bosper');
    // The generically modeled C_INFO properties keep their verbatim source
    // value, which is exactly what guarantees the round-trip.
    expect(parsed.trade).toBe('TRUE');
    expect(parsed.permanent).toBe('TRUE');
    expect(parsed.regenerated).toContain('trade\t\t= TRUE;');
    expect(parsed.regenerated).toContain('B_GiveTradeInv');
  });
});
