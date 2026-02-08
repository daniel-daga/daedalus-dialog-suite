from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app
        print("Navigating to app...")
        page.goto("http://localhost:5173")

        # Wait for the app to load (Welcome screen)
        page.wait_for_load_state("networkidle")
        print("App loaded.")

        # Inject mock overrides
        print("Injecting mocks...")
        page.evaluate("""
            window.editorAPI.openFileDialog = async () => 'sample.d';
            window.editorAPI.readFile = async (path) => {
                if (path === 'sample.d') {
                    return `// Sample Dialog File
INSTANCE DIA_Example_Hello(C_INFO)
{
    npc = PC_Hero;
    nr = 1;
    condition = DIA_Example_Hello_Condition;
    information = DIA_Example_Hello_Info;
    important = FALSE;
};

FUNC INT DIA_Example_Hello_Condition()
{
    if (Npc_KnowsInfo(other, DIA_Example_Hello)) {
        return TRUE;
    }
};

FUNC VOID DIA_Example_Hello_Info()
{
    AI_Output(self, other, "DIA_Example_Hello_15_00"); //Hello there!
    Log_CreateTopic(TOPIC_MyQuest, LOG_MISSION);
    Log_SetTopicStatus(TOPIC_MyQuest, LOG_RUNNING);
};
`;
                }
                return '';
            };
        """)

        # Click "Open Single File"
        print("Clicking 'Open Single File'...")
        page.get_by_role("button", name="Open Single File").click()

        # Wait for MainLayout to appear (sidebar)
        print("Waiting for editor to load...")
        page.get_by_label("Quest Editor").wait_for()

        # Switch to Quest Editor
        print("Switching to Quest Editor...")
        page.get_by_label("Quest Editor").click()

        print("Selecting quest...")
        # Check if "TOPIC_MyQuest" is visible
        try:
             page.get_by_text("TOPIC_MyQuest").wait_for(timeout=10000)
             page.get_by_text("TOPIC_MyQuest").click()
        except:
             print("TOPIC_MyQuest not found. Taking debug screenshot.")
             page.screenshot(path="debug_quest_list.png")
             raise

        # Wait for QuestFlow to render
        print("Waiting for graph nodes...")
        # The node should be labeled "DIA_Example_Hello"
        try:
            page.get_by_text("DIA_Example_Hello").first.wait_for(timeout=10000)
        except:
            print("DIA_Example_Hello not found. Checking if view mode is 'details'...")
            # If in details view, "DIA_Example_Hello" might be in a list or table?
            # Default view is Details. Details shows QuestDetails.
            # QuestDetails might show "Status: RUNNING".
            pass

        # Switch to Flow view
        print("Switching to Flow view...")
        page.get_by_label("Flow View").click()

        # Now verify MiniMap
        print("Verifying MiniMap...")
        minimap = page.locator(".react-flow__minimap")
        minimap.wait_for(timeout=5000)

        if minimap.is_visible():
            print("MiniMap is visible!")
        else:
            print("MiniMap is NOT visible!")
            exit(1)

        # Take screenshot
        print("Taking screenshot...")
        page.screenshot(path="/home/jules/verification/verification_quest_layout.png")
        print("Done.")

        browser.close()

if __name__ == "__main__":
    run()
