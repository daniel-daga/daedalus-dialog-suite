
from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.on("console", lambda msg: print(f"Browser console: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"Browser error: {exc}"))

        # Mock window.editorAPI
        js_mock = r"""
            console.log("Mocking editorAPI");

            const createModel = () => {
                 const constants = {};
                    for (let i = 0; i < 100; i++) {
                        const name = 'TOPIC_Quest_' + i;
                        constants[name] = {
                            name: name,
                            value: '"Quest ' + i + '"',
                            type: 'string',
                            filePath: '/path/to/file.d'
                        };
                    }
                    return {
                        constants: constants,
                        variables: {},
                        functions: {},
                        instances: {},
                        classes: {},
                        hasErrors: false,
                        errors: []
                    };
            };

            window.editorAPI = {
                openFileDialog: async () => {
                    console.log("openFileDialog called");
                    return '/path/to/file.d';
                },
                openProjectFolderDialog: async () => null,
                getRecentProjects: async () => [],
                buildProjectIndex: async () => ({
                    dialogsByNpc: new Map(),
                    questFiles: [],
                    npcs: [],
                    allFiles: []
                }),
                readFile: async () => {
                    console.log("readFile called");
                    return 'const string TOPIC_Quest1 = "Quest 1";';
                },
                parseDialogFile: async () => {
                    console.log("parseDialogFile called");
                    return createModel();
                },
                parseSource: async (code) => {
                    console.log("parseSource called");
                    return createModel();
                }
            };
        """
        page.add_init_script(js_mock)

        page.goto("http://localhost:5173")

        # Click Open Single File button
        page.get_by_role("button", name="Open Single File").click()

        # Wait for something that indicates MainLayout is loading
        try:
            page.wait_for_selector('[aria-label="Dialog Editor"]', timeout=5000)
            print("Dialog Editor button found")
        except:
            print("Dialog Editor button NOT found")
            page.screenshot(path="/home/jules/verification/debug_fail.png")
            print(page.inner_text("body"))
            browser.close()
            return

        # Wait for Quest Editor button to be visible
        try:
            page.wait_for_selector('[aria-label="Quest Editor"]', timeout=5000)
            print("Quest Editor button found")
        except:
             print("Quest Editor button NOT found")
             page.screenshot(path="/home/jules/verification/debug_fail_quest.png")
             browser.close()
             return

        # Click Quest Editor button
        page.get_by_label("Quest Editor").click()

        # Wait for Quest List to render items
        try:
            page.wait_for_selector("text=Quest 0", timeout=5000)
            print("Quest 0 found")
        except:
             print("Quest 0 NOT found")
             page.screenshot(path="/home/jules/verification/debug_fail_list.png")
             browser.close()
             return

        # Take screenshot
        page.screenshot(path="/home/jules/verification/verification.png")

        browser.close()

if __name__ == "__main__":
    run()
