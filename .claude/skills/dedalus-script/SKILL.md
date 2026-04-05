---
name: dedalus-script
description: >
  Expert knowledge for Daedalus (.d) script files used in Gothic 2 modding.
  Triggers when reading, writing, editing, or debugging .d files containing
  NPC instances, dialog trees, quest logic, or game scripting.
paths: "**/*.d"
---

# Daedalus Script Expert

You are an expert in the Daedalus scripting language used for Gothic 1/2 modding.
This repository contains a Tree-sitter parser and visual editor for Daedalus dialog scripts.

## Language Overview

Daedalus is a statically-typed, C-like scripting language with **case-insensitive keywords**.
Files use the `.d` extension.

### Core Constructs

**Instance declarations** define NPCs, dialogs, and items by inheriting from a parent class:

```daedalus
instance DIA_Szmyk_Hello (C_INFO)
{
    npc         = DEV_2130_Szmyk;
    nr          = 1;
    condition   = DIA_Szmyk_Hello_Condition;
    information = DIA_Szmyk_Hello_Info;
    permanent   = false;
    important   = true;
};
```

**Functions** have explicit return types (`void`, `int`, `float`, `string`, or custom types):

```daedalus
func int DIA_Szmyk_Hello_Condition()
{
    return true;
};
```

**Variables and constants**:

```daedalus
var int myVar;
const string MESSAGE = "Hello";
var int myArray[10];
```

**Classes and prototypes**:

```daedalus
class MyClass { var int value; };
prototype Npc_Default (C_NPC) { /* defaults */ };
```

### Dialog System Pattern

Dialogs follow a strict naming convention and three-part structure:

1. **Instance** (`C_INFO`) - declares the dialog with properties
2. **Condition function** (`func int ..._Condition`) - returns `TRUE` when dialog is available
3. **Info function** (`func void ..._Info`) - executes dialog actions

```daedalus
// 1. Dialog instance
instance DIA_Farim_Hallo (C_INFO)
{
    npc         = SLD_99003_Farim;
    nr          = 1;
    condition   = DIA_Farim_Hallo_Condition;
    information = DIA_Farim_Hallo_Info;
    permanent   = FALSE;
    description = "Hallo, kannst du mir helfen?";
};

// 2. Condition function
func int DIA_Farim_Hallo_Condition()
{
    return TRUE;
};

// 3. Info function
func void DIA_Farim_Hallo_Info()
{
    AI_Output (other, self, "DIA_Farim_Hallo_15_00"); //Player line
    AI_Output (self, other, "DIA_Farim_Hallo_14_01"); //NPC response
    AI_StopProcessInfos (self);
};
```

### NPC Instance Pattern

NPC instances inherit from `Npc_Default` and set attributes, visuals, inventory, and daily routines:

```daedalus
instance SLD_99003_Farim (Npc_Default)
{
    name    = "Farim";
    guild   = GIL_SLD;
    id      = 99003;
    voice   = 11;
    level   = 100;

    attribute[ATR_STRENGTH]      = 50;
    attribute[ATR_HITPOINTS_MAX] = 150;
    attribute[ATR_HITPOINTS]     = 150;

    B_SetNpcVisual (self, MALE, "Hum_Head_Fighter", Face_N_NormalBart08, BodyTex_N, ITAR_Bau_L);
    daily_routine = Rtn_Start_99003;
};
```

### Key Built-in Functions

| Function | Purpose |
|---|---|
| `AI_Output(speaker, listener, sound_id)` | Dialog line (comment after `//` is subtitle text) |
| `AI_StopProcessInfos(self)` | End current dialog |
| `Info_AddChoice(dialog, text, func)` | Add player choice |
| `Info_ClearChoices(dialog)` | Clear choices |
| `B_GiveInvItems(giver, taker, item, count)` | Transfer items |
| `Npc_KnowsInfo(npc, dialog)` | Check if dialog was seen |
| `Log_CreateTopic(topic, type)` | Create quest log entry |
| `B_LogEntry(topic, text)` | Add quest log text |
| `Npc_ExchangeRoutine(npc, routine)` | Change NPC daily routine |
| `B_SetNpcVisual(npc, gender, head, face, body_tex, armor)` | Set NPC appearance |

### Naming Conventions

- Dialog files: `DIA_<NpcName>.d`
- NPC files: `<Guild>_<Id>_<Name>.d` (e.g., `SLD_99003_Farim.d`)
- Dialog instances: `DIA_<Npc>_<Topic>`
- Condition functions: `DIA_<Npc>_<Topic>_Condition`
- Info functions: `DIA_<Npc>_<Topic>_Info`
- Exit dialogs use `nr = 999` and `description = DIALOG_ENDE`
- `AI_Output` sound IDs encode voice gender: `_15_` = player (male hero), `_14_` = NPC male, `_13_` = NPC female

### Operators

- Logical: `||`, `&&`
- Comparison: `==`, `!=`, `<`, `<=`, `>`, `>=`
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- Bitwise: `|`, `^`, `&`, `<<`, `>>`
- Unary: `!`, `~`, `+`, `-`

## Repository-Specific Notes

- The **Tree-sitter grammar** is in `daedalus-parser/grammar.js`
- The **semantic model** (`daedalus-parser/src/semantic/`) extracts dialog structures from parse trees
- The **code generator** (`daedalus-parser/src/codegen/`) emits formatted Daedalus source from semantic models
- Example scripts are in `daedalus-parser/examples/` and `daedalus-parser/reference/`
- Use `npm test` in `daedalus-parser/` to validate parser changes
- Follow TDD: write a failing test first, then implement

## When Editing .d Files

1. Maintain consistent casing within a file (the language is case-insensitive but files should be internally consistent)
2. Every dialog instance needs matching `_Condition` and `_Info` functions
3. Every `.d` file with dialogs should include an EXIT dialog (`nr = 999`, `permanent = TRUE`)
4. `AI_Output` lines must have a `//comment` with the subtitle text
5. Statements inside instance and function bodies end with `;` — the closing brace of the block also ends with `;`
