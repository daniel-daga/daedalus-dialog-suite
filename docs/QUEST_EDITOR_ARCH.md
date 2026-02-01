# Quest Editor Architecture & Design

## 1. Introduction
This document outlines the architectural understanding and design requirements for transforming the Daedalus Dialog Editor into a full-fledged Quest Editor. It analyzes the underlying Gothic 2 scripting structures, maps them to our internal data models, and proposes UI/UX directions, including future node-based visualizations.

## 2. Gothic 2 Quest Architecture
In Gothic 2, a "Quest" (or Mission) is not a single encapsulated object. Instead, it is a logical concept stitched together by three distinct scripting elements: **Constants**, **Variables**, and **Function Calls**.

### 2.1. The Topic Constant (The "Name")
A quest starts with a display name. This is defined as a global string constant, typically in a file like `LOG_Constants.d`.
*   **Convention:** `const string TOPIC_MyQuest = "The Lost Sheep";`
*   **Purpose:** Holds the text actually shown to the player in the Log Menu.
*   **Key Insight:** The engine relies on the *variable name* (`TOPIC_MyQuest`) to link log entries, but displays the *string value* ("The Lost Sheep").

### 2.2. The Mission Variable (The "State")
The state of the quest is tracked by a global integer variable.
*   **Convention:** `var int MIS_MyQuest;`
*   **Purpose:** Tracks the current status of the quest.
*   **States:**
    *   `LOG_RUNNING` (1): Quest is active.
    *   `LOG_SUCCESS` (2): Quest completed successfully.
    *   `LOG_FAILED` (3): Quest failed.
    *   `LOG_OBSOLETE` (4): Quest is no longer relevant.

### 2.3. The Logic (The "Actions")
Quests are manipulated inside Dialogs (`instance ... (C_INFO)`) or other events using specific function calls.

*   **`Log_CreateTopic(topicName, section)`**
    *   Registers the quest in the log.
    *   *Example:* `Log_CreateTopic(TOPIC_MyQuest, LOG_MISSION);`
*   **`Log_SetTopicStatus(topicName, status)`**
    *   Updates the engine's internal status for the topic.
    *   *Example:* `Log_SetTopicStatus(TOPIC_MyQuest, LOG_RUNNING);`
*   **`B_LogEntry(topicName, entryText)`**
    *   Adds a text entry to the quest's history.
    *   *Example:* `B_LogEntry(TOPIC_MyQuest, "I found the sheep.");`
*   **State Assignment**
    *   Directly updating the variable is common for logic checks.
    *   *Example:* `MIS_MyQuest = LOG_SUCCESS;`

### 2.4. Conditional Logic (The Flow)
The progression of a quest is dictated by **Conditions**. A dialog (and thus a quest update) can only trigger if its `condition` function returns `TRUE`.
*   **`Npc_KnowsInfo(hero, DIA_OtherDialog)`**: Checks if the player has heard a previous dialog. This creates a linear dependency chain.
*   **`Npc_HasItems(hero, ItMi_QuestItem, 1)`**: Checks if the player has collected a required item.
*   **`MIS_MyQuest == LOG_RUNNING`**: Checks the quest state itself.

---

## 3. Semantic Model Mapping & Gap Analysis

### 3.1. Current Capabilities
The `daedalus-parser` currently excels at parsing **Dialogs** and **Function Bodies**. It successfully extracts:
*   `Dialog` instances.
*   `DialogFunction` bodies.
*   Specific actions like `CreateTopic`, `LogEntry`, and `LogSetTopicStatus` within those bodies.
*   **Conditions**: The `SemanticModelBuilderVisitor` captures `NpcKnowsInfoCondition`, `VariableCondition`, and generic conditions.

This means we can currently answer: *"Which dialogs modify a quest?"* (by looking at the arguments passed to `Log_*` functions) and *"What enables this dialog?"* (by looking at the conditions).

### 3.2. The Gap: Global Scope
The current `SemanticModelBuilderVisitor` primarily focuses on `instance_declaration` (Dialogs) and `function_declaration` (Functions). It **ignores** global `const` and `var` declarations.

**Missing Data:**
1.  **Quest List:** We cannot generate a list of all available quests because we don't parse `TOPIC_*` constants.
2.  **Display Names:** We only see `TOPIC_MyQuest` (the identifier) in function calls, not "The Lost Sheep" (the value).
3.  **State Variables:** We don't track the existence of `MIS_*` variables.

### 3.3. Data Structure Requirements
To support a Quest Editor, the `SemanticModel` needs to be extended to include a **Global Symbol Table**.

*   **New Entity:** `GlobalConstant`
    *   `name`: string (e.g., "TOPIC_MyQuest")
    *   `value`: string | number (e.g., "The Lost Sheep")
    *   `type`: string (e.g., "string")
*   **New Entity:** `GlobalVariable`
    *   `name`: string (e.g., "MIS_MyQuest")
    *   `type`: string (e.g., "int")

**Linking Strategy:**
When the parser encounters `Log_CreateTopic(TOPIC_MyQuest, ...)`, it should theoretically be able to look up `TOPIC_MyQuest` in the Global Symbol Table to retrieve the display name "The Lost Sheep".

---

## 4. Editor UI Implications

### 4.1. The Quest Overview Panel
A new main view in the editor dedicated to quests.
*   **List View:** Displays all detected `TOPIC_*` constants.
*   **Filtering:** Filter by "Active in Project" (referenced in at least one dialog) vs. "Unused".
*   **Create New Quest:** A wizard that automates the boilerplate:
    1.  Ask for Quest Name ("The Lost Sheep").
    2.  Ask for Internal Name (`MyQuest`).
    3.  Automatically generates/appends `const string TOPIC_MyQuest...` and `var int MIS_MyQuest...` to the appropriate `.d` files.

### 4.2. Quest Details View
Selecting a quest from the list shows its "Life Cycle":
*   **Properties:** Name, Internal ID.
*   **References:** A list of all Dialogs that touch this quest.
    *   *Started in:* `DIA_Shepherd_Hello`
    *   *Updated in:* `DIA_Shepherd_FoundWolf`
    *   *Finished in:* `DIA_Shepherd_Reward`
*   **Log Preview:** A simulation of what the player's log would look like, aggregating all `B_LogEntry` text strings found in the code.

### 4.3. Dialog Editor Integration
When writing a dialog:
*   **Autocomplete:** Typing `Log_CreateTopic(` should suggest `TOPIC_*` constants.
*   **Contextual Info:** Hovering over `TOPIC_MyQuest` should show the tooltip "The Lost Sheep".
*   **Quest Picker:** A UI widget to insert "Update Quest" logic blocks without writing code manually.

---

## 5. Future Vision: Node-Based Quest View

Moving beyond linear lists, a **Node-Based View** would visualize the non-linear flow of a quest.

### 5.1. Concept
*   **Nodes:** Represent **Events** or **Dialogs** where the quest state changes or a log entry is added.
*   **Edges:** Represent the **Conditions** (Dependencies) that allow the flow to proceed from one node to another.

### 5.2. Visualization Logic
*   **Start Node:** The Dialog containing `Log_CreateTopic`.
*   **Intermediate Nodes:** Dialogs containing `B_LogEntry`.
*   **End Nodes:** Dialogs setting `LOG_SUCCESS` or `LOG_FAILED`.
*   **Connections (Edges):**
    *   **Dialog Dependency:** If `DIA_B` has condition `Npc_KnowsInfo(hero, DIA_A)`, draw a solid arrow from `DIA_A` to `DIA_B`.
    *   **Item Dependency:** If `DIA_C` has condition `Npc_HasItems(..., ItMi_QuestItem)`, draw a dashed arrow or annotation indicating "Requires Item".
    *   **Variable Dependency:** If `DIA_D` checks `MIS_MyQuest == LOG_RUNNING`, it explicitly visually belongs to the "Active" phase of the quest.

### 5.3. Swimlanes
Since quests often involve multiple NPCs, the node graph could be organized into **Swimlanes**, where each horizontal lane represents a specific NPC.
*   *Lane 1 (Shepherd):* [Start Quest] -> [Reward]
*   *Lane 2 (Wolf):* [Kill Wolf]

This visual abstraction allows writers to spot dead ends, missing logic (e.g., a node with no incoming arrows), or overly complex dependency chains at a glance.
