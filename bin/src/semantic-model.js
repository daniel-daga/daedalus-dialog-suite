"use strict";
// Semantic model classes and types for Daedalus dialog parsing
Object.defineProperty(exports, "__esModule", { value: true });
exports.Dialog = exports.Condition = exports.NpcKnowsInfoCondition = exports.ChapterTransitionAction = exports.ExchangeRoutineAction = exports.SetAttitudeAction = exports.AttackAction = exports.GiveInventoryItems = exports.CreateInventoryItems = exports.Choice = exports.Action = exports.LogSetTopicStatus = exports.LogEntry = exports.CreateTopic = exports.DialogLine = exports.DialogFunction = void 0;
class DialogFunction {
    constructor(name, returnType) {
        this.name = name;
        this.returnType = returnType;
        this.calls = [];
        this.actions = [];
    }
}
exports.DialogFunction = DialogFunction;
class DialogLine {
    constructor(speaker, text, id) {
        this.speaker = speaker;
        this.text = text;
        this.id = id;
    }
    generateCode(options) {
        const comment = options.includeComments ? ` //${this.text}` : '';
        return `AI_Output(${this.speaker}, other, "${this.id}");${comment}`;
    }
    toDisplayString() {
        return `[DialogLine: ${this.speaker} -> "${this.text}"]`;
    }
    getTypeName() {
        return 'DialogLine';
    }
}
exports.DialogLine = DialogLine;
class CreateTopic {
    constructor(topic, topicType = null) {
        this.topic = topic;
        this.topicType = topicType;
    }
    generateCode(_options) {
        if (this.topicType) {
            return `Log_CreateTopic(${this.topic}, ${this.topicType});`;
        }
        return `Log_CreateTopic(${this.topic});`;
    }
    toDisplayString() {
        return `[CreateTopic: ${this.topic}${this.topicType ? `, ${this.topicType}` : ''}]`;
    }
    getTypeName() {
        return 'CreateTopic';
    }
}
exports.CreateTopic = CreateTopic;
class LogEntry {
    constructor(topic, text) {
        this.topic = topic;
        this.text = text;
    }
    generateCode(_options) {
        return `B_LogEntry(${this.topic}, "${this.text}");`;
    }
    toDisplayString() {
        return `[LogEntry: ${this.topic} -> "${this.text}"]`;
    }
    getTypeName() {
        return 'LogEntry';
    }
}
exports.LogEntry = LogEntry;
class LogSetTopicStatus {
    constructor(topic, status) {
        this.topic = topic;
        this.status = status;
    }
    generateCode(_options) {
        return `Log_SetTopicStatus(${this.topic}, ${this.status});`;
    }
    toDisplayString() {
        return `[LogSetTopicStatus: ${this.topic} -> ${this.status}]`;
    }
    getTypeName() {
        return 'LogSetTopicStatus';
    }
}
exports.LogSetTopicStatus = LogSetTopicStatus;
class Action {
    constructor(action) {
        this.action = action;
    }
    generateCode(_options) {
        const code = this.action.trim();
        return code.endsWith(';') ? code : `${code};`;
    }
    toDisplayString() {
        return `[Action: ${this.action}]`;
    }
    getTypeName() {
        return 'Action';
    }
}
exports.Action = Action;
class Choice {
    constructor(dialogRef, text, targetFunction) {
        this.dialogRef = dialogRef;
        this.text = text;
        this.targetFunction = targetFunction;
    }
    generateCode(_options) {
        return `Info_AddChoice(${this.dialogRef}, "${this.text}", ${this.targetFunction});`;
    }
    toDisplayString() {
        return `[Choice: "${this.text}" -> ${this.targetFunction}]`;
    }
    getTypeName() {
        return 'Choice';
    }
}
exports.Choice = Choice;
class CreateInventoryItems {
    constructor(target, item, quantity) {
        this.target = target;
        this.item = item;
        this.quantity = quantity;
    }
    generateCode(_options) {
        return `CreateInvItems(${this.target}, ${this.item}, ${this.quantity});`;
    }
    toDisplayString() {
        return `[CreateItems: ${this.target} gets ${this.quantity}x ${this.item}]`;
    }
    getTypeName() {
        return 'CreateInventoryItems';
    }
}
exports.CreateInventoryItems = CreateInventoryItems;
class GiveInventoryItems {
    constructor(giver, receiver, item, quantity) {
        this.giver = giver;
        this.receiver = receiver;
        this.item = item;
        this.quantity = quantity;
    }
    generateCode(_options) {
        return `B_GiveInvItems(${this.giver}, ${this.receiver}, ${this.item}, ${this.quantity});`;
    }
    toDisplayString() {
        return `[GiveItems: ${this.giver} gives ${this.receiver} ${this.quantity}x ${this.item}]`;
    }
    getTypeName() {
        return 'GiveInventoryItems';
    }
}
exports.GiveInventoryItems = GiveInventoryItems;
class AttackAction {
    constructor(attacker, target, attackReason, damage) {
        this.attacker = attacker;
        this.target = target;
        this.attackReason = attackReason;
        this.damage = damage;
    }
    generateCode(_options) {
        return `B_Attack(${this.attacker}, ${this.target}, ${this.attackReason}, ${this.damage});`;
    }
    toDisplayString() {
        return `[Attack: ${this.attacker} attacks ${this.target} (${this.attackReason}, dmg:${this.damage})]`;
    }
    getTypeName() {
        return 'AttackAction';
    }
}
exports.AttackAction = AttackAction;
class SetAttitudeAction {
    constructor(target, attitude) {
        this.target = target;
        this.attitude = attitude;
    }
    generateCode(_options) {
        return `B_SetAttitude(${this.target}, ${this.attitude});`;
    }
    toDisplayString() {
        return `[SetAttitude: ${this.target} -> ${this.attitude}]`;
    }
    getTypeName() {
        return 'SetAttitudeAction';
    }
}
exports.SetAttitudeAction = SetAttitudeAction;
class ExchangeRoutineAction {
    constructor(target, routine) {
        this.target = target;
        this.routine = routine;
    }
    generateCode(_options) {
        return `Npc_ExchangeRoutine(${this.target}, "${this.routine}");`;
    }
    toDisplayString() {
        return `[ExchangeRoutine: ${this.target} -> "${this.routine}"]`;
    }
    getTypeName() {
        return 'ExchangeRoutineAction';
    }
}
exports.ExchangeRoutineAction = ExchangeRoutineAction;
class ChapterTransitionAction {
    constructor(chapter, world) {
        this.chapter = chapter;
        this.world = world;
    }
    generateCode(_options) {
        return `B_Kapitelwechsel(${this.chapter}, ${this.world});`;
    }
    toDisplayString() {
        return `[ChapterTransition: Chapter ${this.chapter} in ${this.world}]`;
    }
    getTypeName() {
        return 'ChapterTransitionAction';
    }
}
exports.ChapterTransitionAction = ChapterTransitionAction;
// ===================================================================
// DIALOG CONDITION CLASSES
// ===================================================================
/**
 * Represents a condition that checks if the player knows a specific dialog
 */
class NpcKnowsInfoCondition {
    constructor(npc, dialogRef) {
        this.npc = npc;
        this.dialogRef = dialogRef;
    }
    generateCode(_options) {
        return `Npc_KnowsInfo(${this.npc}, ${this.dialogRef})`;
    }
    toDisplayString() {
        return `[NpcKnowsInfo: ${this.npc} knows ${this.dialogRef}]`;
    }
    getTypeName() {
        return 'NpcKnowsInfoCondition';
    }
}
exports.NpcKnowsInfoCondition = NpcKnowsInfoCondition;
/**
 * Generic condition for any other condition expression
 */
class Condition {
    constructor(condition) {
        this.condition = condition;
    }
    generateCode(_options) {
        return this.condition.trim();
    }
    toDisplayString() {
        return `[Condition: ${this.condition}]`;
    }
    getTypeName() {
        return 'Condition';
    }
}
exports.Condition = Condition;
// ===================================================================
// DIALOG CLASS
// ===================================================================
class Dialog {
    constructor(name, parent) {
        this.name = name;
        this.parent = parent;
        this.properties = {};
        this.actions = [];
        this.conditions = [];
    }
}
exports.Dialog = Dialog;
