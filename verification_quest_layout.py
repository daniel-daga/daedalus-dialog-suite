from playwright.sync_api import Page, expect, sync_playwright
import time

def test_quest_layout(page: Page):
    # Mock window.editorAPI
    page.add_init_script("""
        window.editorAPI = {
            parseSource: async () => ({ dialogs: {}, functions: {} }),
            validateModel: async () => ({ errors: [], warnings: [] }),
            generateCode: async () => "",
            saveFile: async () => ({ success: true }),
            readFile: async () => "",
            writeFile: async () => ({ success: true }),
            openFileDialog: async () => null,
            saveFileDialog: async () => null,
            openProjectFolderDialog: async () => "/fake/path",
            buildProjectIndex: async () => ({
                dialogsByNpc: {
                    "NPC_TEST": [
                        { dialogName: "DIA_TEST_HELLO", npc: "NPC_TEST", filePath: "/fake/file.d" },
                        { dialogName: "DIA_TEST_QUEST_START", npc: "NPC_TEST", filePath: "/fake/file.d" },
                        { dialogName: "DIA_TEST_QUEST_STEP1", npc: "NPC_TEST", filePath: "/fake/file.d" },
                        { dialogName: "DIA_TEST_QUEST_STEP2", npc: "NPC_TEST", filePath: "/fake/file.d" },
                        { dialogName: "DIA_TEST_QUEST_STEP3", npc: "NPC_TEST", filePath: "/fake/file.d" },
                        { dialogName: "DIA_TEST_QUEST_END", npc: "NPC_TEST", filePath: "/fake/file.d" }
                    ]
                },
                questFiles: ["/fake/file.d"],
                npcs: ["NPC_TEST"],
                allFiles: ["/fake/file.d"],
                quests: {
                    "TOPIC_TEST": { name: "TOPIC_TEST", description: "Test Quest", section: "Quests" }
                }
            }),
            parseDialogFile: async (path) => ({
                constants: {
                    "TOPIC_TEST": { name: "TOPIC_TEST", type: "string", value: '"Test Quest"', source: { file: "test.d" } }
                },
                functions: {
                    "DIA_TEST_QUEST_START_INFO": {
                        name: "DIA_TEST_QUEST_START_INFO",
                        actions: [
                            { type: "call", funcName: "Log_CreateTopic", topic: "TOPIC_TEST" },
                            { type: "call", funcName: "Log_SetTopicStatus", topic: "TOPIC_TEST", status: "LOG_RUNNING" }
                        ],
                        conditions: []
                    },
                    "DIA_TEST_QUEST_STEP1_INFO": {
                        name: "DIA_TEST_QUEST_STEP1_INFO",
                        actions: [],
                        conditions: [
                            { variableName: "MIS_TEST", operator: "==", value: "LOG_RUNNING" }
                        ]
                    },
                    "DIA_TEST_QUEST_STEP2_INFO": {
                        name: "DIA_TEST_QUEST_STEP2_INFO",
                        actions: [],
                        conditions: [
                            { variableName: "MIS_TEST", operator: "==", value: "LOG_RUNNING" }
                        ]
                    },
                    "DIA_TEST_QUEST_STEP3_INFO": {
                        name: "DIA_TEST_QUEST_STEP3_INFO",
                        actions: [],
                        conditions: [
                            { variableName: "MIS_TEST", operator: "==", value: "LOG_RUNNING" }
                        ]
                    },
                    "DIA_TEST_QUEST_END_INFO": {
                        name: "DIA_TEST_QUEST_END_INFO",
                        actions: [
                            { type: "call", funcName: "Log_SetTopicStatus", topic: "TOPIC_TEST", status: "LOG_SUCCESS" }
                        ],
                        conditions: [
                            { variableName: "MIS_TEST", operator: "==", value: "LOG_RUNNING" }
                        ]
                    }
                },
                dialogs: {
                    "DIA_TEST_QUEST_START": { properties: { npc: "NPC_TEST", information: "DIA_TEST_QUEST_START_INFO" } },
                    "DIA_TEST_QUEST_STEP1": { properties: { npc: "NPC_TEST", information: "DIA_TEST_QUEST_STEP1_INFO" } },
                    "DIA_TEST_QUEST_STEP2": { properties: { npc: "NPC_TEST", information: "DIA_TEST_QUEST_STEP2_INFO" } },
                    "DIA_TEST_QUEST_STEP3": { properties: { npc: "NPC_TEST", information: "DIA_TEST_QUEST_STEP3_INFO" } },
                    "DIA_TEST_QUEST_END": { properties: { npc: "NPC_TEST", information: "DIA_TEST_QUEST_END_INFO" } }
                }
            }),
            addAllowedPath: async () => {},
            getRecentProjects: async () => [],
            addRecentProject: async () => {}
        };
    """)

    print("Navigating to app...")
    page.goto("http://localhost:3000")

    # Wait for the Open Project button
    print("Clicking Open Project...")
    try:
        # Try to find the button by text if role fails (sometimes roles are tricky with MUI)
        page.get_by_role("button", name="Open Project").first.click(timeout=5000)
    except:
        print("Could not find 'Open Project' button. Dumping page content.")
        print(page.content())
        raise

    # Wait for project to load
    page.wait_for_timeout(2000)

    # Click 'Quest Editor' tab/view
    print("Clicking Quest Editor tab...")
    page.get_by_label("Quest Editor").click()

    # Select the quest 'TOPIC_TEST'
    print("Selecting TOPIC_TEST...")
    page.get_by_text("TOPIC_TEST").click()

    # Switch to "Flow" view
    print("Switching to Flow view...")
    try:
        page.get_by_label("Flow View").click()
    except Exception as e:
        print(f"Could not find Flow View button: {e}")
        # Try finding by icon or role if label fails
        page.get_by_role("button", name="Flow View").click()

    # Wait for rendering
    page.wait_for_timeout(2000)

    # Take screenshot
    print("Taking screenshot...")
    page.screenshot(path="verification_quest_layout.png")
    print("Done.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 1024})
        page = context.new_page()
        try:
            test_quest_layout(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="error_screenshot.png")
        finally:
            browser.close()
