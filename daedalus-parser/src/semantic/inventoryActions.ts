import { generateCallStatement } from './call-identity';
/**
 * Inventory action classes.
 *
 * Contains action types for creating, giving, trading, and removing items
 * in Daedalus dialog scripts.
 */

import type { CodeGenOptions, CodeGeneratable } from './semanticModelInterfaces';
import { formatNumericValue } from './parsers/numeric-literals';

export class CreateInventoryItems implements CodeGeneratable {
  public readonly type = 'CreateInventoryItems';
  public target: string;
  public item: string;
  public quantity: number | string;

  constructor(target: string, item: string, quantity: number | string) {
    this.target = target;
    this.item = item;
    this.quantity = quantity;
  }

  generateCode(_options: CodeGenOptions): string {
    return generateCallStatement(this, 'CreateInvItems', [this.target, this.item, formatNumericValue(this.quantity)]);
  }

  toDisplayString(): string {
    return `[CreateItems: ${this.target} gets ${this.quantity}x ${this.item}]`;
  }

  getTypeName(): string {
    return 'CreateInventoryItems';
  }
}

export class GiveInventoryItems implements CodeGeneratable {
  public readonly type = 'GiveInventoryItems';
  public giver: string;
  public receiver: string;
  public item: string;
  public quantity: number | string;

  constructor(giver: string, receiver: string, item: string, quantity: number | string) {
    this.giver = giver;
    this.receiver = receiver;
    this.item = item;
    this.quantity = quantity;
  }

  generateCode(_options: CodeGenOptions): string {
    return generateCallStatement(this, 'B_GiveInvItems', [this.giver, this.receiver, this.item, formatNumericValue(this.quantity)]);
  }

  toDisplayString(): string {
    return `[GiveItems: ${this.giver} gives ${this.receiver} ${this.quantity}x ${this.item}]`;
  }

  getTypeName(): string {
    return 'GiveInventoryItems';
  }
}

export class GiveTradeInventoryAction implements CodeGeneratable {
  public readonly type = 'GiveTradeInventoryAction';
  public tradeTarget: string;

  constructor(tradeTarget: string) {
    this.tradeTarget = tradeTarget;
  }

  generateCode(_options: CodeGenOptions): string {
    return generateCallStatement(this, 'B_GiveTradeInv', [this.tradeTarget]);
  }

  toDisplayString(): string {
    return `[GiveTradeInventory: ${this.tradeTarget}]`;
  }

  getTypeName(): string {
    return 'GiveTradeInventoryAction';
  }
}

export class UseItemAction implements CodeGeneratable {
  public readonly type = 'UseItemAction';
  public target: string;
  public item: string;

  constructor(target: string, item: string) {
    this.target = target;
    this.item = item;
  }

  generateCode(_options: CodeGenOptions): string {
    return generateCallStatement(this, 'B_UseItem', [this.target, this.item]);
  }

  toDisplayString(): string {
    return `[UseItem: ${this.target} uses ${this.item}]`;
  }

  getTypeName(): string {
    return 'UseItemAction';
  }
}

export class RemoveInventoryItemsAction implements CodeGeneratable {
  public readonly type = 'RemoveInventoryItemsAction';
  public removeFunctionName: 'Npc_RemoveInvItems' | 'Npc_RemoveInvItem';
  public removeNpc: string;
  public removeItem: string;
  public removeQuantity?: string;

  constructor(
    removeFunctionName: 'Npc_RemoveInvItems' | 'Npc_RemoveInvItem',
    removeNpc: string,
    removeItem: string,
    removeQuantity?: string
  ) {
    this.removeFunctionName = removeFunctionName;
    this.removeNpc = removeNpc;
    this.removeItem = removeItem;
    if (removeQuantity !== undefined) {
      this.removeQuantity = removeQuantity;
    }
  }

  generateCode(_options: CodeGenOptions): string {
    if (this.removeFunctionName.toLowerCase() === 'npc_removeinvitem') {
      return generateCallStatement(this, this.removeFunctionName, [this.removeNpc, this.removeItem]);
    }
    if (!this.removeQuantity?.trim()) {
      throw new Error('Npc_RemoveInvItems requires a quantity.');
    }
    const args = [this.removeNpc, this.removeItem, this.removeQuantity];
    return generateCallStatement(this, this.removeFunctionName, args);
  }

  toDisplayString(): string {
    const detail = this.removeQuantity === undefined
      ? `${this.removeNpc}, ${this.removeItem}`
      : `${this.removeNpc}, ${this.removeItem}, ${this.removeQuantity}`;
    return `[RemoveInventoryItems: ${detail}]`;
  }

  getTypeName(): string {
    return 'RemoveInventoryItemsAction';
  }
}
