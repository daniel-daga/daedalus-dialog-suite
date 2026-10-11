/**
 * Merchant/trader dialog boilerplate generation (feature-suggestions item 5).
 *
 * Generates the standard vanilla trade dialog: a permanent C_INFO with
 * trade = TRUE whose info function hands the trade inventory to the engine
 * via B_GiveTradeInv (vanilla shape: DIA_VLK_413_Bosper.d — nr = 700 places
 * the entry near the bottom of the menu, before the EXIT entry at 999).
 * No AI_Output lines are emitted: voice numbers are unknowable at scaffold
 * time.
 */

import { sanitizeDaedalusString } from './pathAndIdentifierUtils';

export const TRADER_DEFAULT_DESCRIPTION = 'Zeig mir Deine Waren.';

export interface TraderDialogConfig {
  description: string;
}

export function createTraderDialogTemplate(options: {
  npcInstanceName: string;
  dialogName: string;
  description: string;
}): string {
  const { npcInstanceName, dialogName } = options;
  const description = sanitizeDaedalusString(options.description);

  return [
    '// ************************************************************',
    '//\t\t\t  \tTrade',
    '// ************************************************************',
    '',
    `INSTANCE ${dialogName} (C_INFO)`,
    '{',
    `\tnpc\t\t\t= ${npcInstanceName};`,
    '\tnr\t\t\t= 700;',
    `\tcondition\t= ${dialogName}_Condition;`,
    `\tinformation\t= ${dialogName}_Info;`,
    '\tpermanent\t= TRUE;',
    '\ttrade\t\t= TRUE;',
    `\tdescription\t= "${description}";`,
    '};',
    '',
    `FUNC INT ${dialogName}_Condition()`,
    '{',
    '\treturn TRUE;',
    '};',
    '',
    `FUNC VOID ${dialogName}_Info()`,
    '{',
    '\tB_GiveTradeInv (self);',
    '};',
    ''
  ].join('\n');
}
