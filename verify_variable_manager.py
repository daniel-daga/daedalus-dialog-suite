from playwright.sync_api import Page, expect, sync_playwright

def verify_variable_manager(page: Page):
    # Mock window.editorAPI
    page.add_init_script("""
        window.editorAPI = {
            parseSource: async () => ({}),
            validateModel: async () => ({ isValid: true, errors: [] }),
            generateCode: async () => "",
            saveFile: async () => ({ success: true }),
            readFile: async () => "",
            writeFile: async () => ({ success: true }),
            openFileDialog: async () => null,
            saveFileDialog: async () => null,
            openProjectFolderDialog: async () => "/test/project",
            buildProjectIndex: async () => ({
                npcs: ["TestNPC"],
                dialogsByNpc: {},
                allFiles: ["test.d"],
                questFiles: ["test.d"]
            }),
            parseDialogFile: async () => ({
                dialogs: {},
                functions: {},
                constants: {
                    "TEST_CONST": { name: "TEST_CONST", type: "int", value: 1, filePath: "test.d" }
                },
                variables: {
                    "TEST_VAR": { name: "TEST_VAR", type: "int", filePath: "test.d" }
                },
                hasErrors: false,
                errors: []
            })
        };
    """)

    page.goto("http://localhost:5173/")

    # Click Open Project
    page.get_by_role("button", name="Open Project").first.click()

    # Sidebar should appear. Look for Variable Manager button.
    variable_btn = page.get_by_label("Variable Manager")
    expect(variable_btn).to_be_visible()
    variable_btn.click()

    # Check for "Variable Manager" header
    expect(page.get_by_role("heading", name="Variable Manager")).to_be_visible()

    # Check if variables are displayed (Table)
    expect(page.get_by_text("TEST_CONST")).to_be_visible()
    expect(page.get_by_text("TEST_VAR")).to_be_visible()

    # Check Add Variable button
    expect(page.get_by_role("button", name="Add Variable")).to_be_visible()

    # Take screenshot
    page.screenshot(path="verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_variable_manager(page)
        finally:
            browser.close()
