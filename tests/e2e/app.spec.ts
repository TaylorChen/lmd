import { expect, test, type Page } from "@playwright/test";

type TestCall = {
  command: string;
  args?: Record<string, unknown>;
};

declare global {
  interface Window {
    __LMD_TEST_API__?: {
      invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    __LMD_TEST_CALLS__?: TestCall[];
  }
}

async function installTauriMock(page: Page) {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];

    window.__LMD_TEST_API__ = {
      async invoke(command, args) {
        calls.push({ command, args });

        if (command === "file_metadata") {
          return { exists: true, byteSize: 32, modifiedMs: 2000 };
        }

        if (command === "open_workspace" || command === "refresh_workspace") {
          return {
            rootPath: "/workspace",
            files: [
              {
                path: "/workspace/alpha.md",
                relativePath: "alpha.md",
                name: "alpha.md",
                byteSize: 42,
              },
            ],
          };
        }

        if (command === "open_markdown_path") {
          return {
            path: args?.path as string,
            content: "# Alpha\n\nOpened from workspace.",
            byteSize: 31,
            lineCount: 3,
            modifiedMs: 1000,
            isLarge: false,
            readOnly: false,
            visibleStartLine: 1,
            visibleLineCount: 3,
          };
        }

        if (command === "search_workspace") {
          return [
            {
              path: "/workspace/alpha.md",
              relativePath: "alpha.md",
              lineNumber: 2,
              lineText: "needle match",
              matchStart: 0,
              matchEnd: 6,
            },
          ];
        }

        if (command === "save_markdown_file") {
          const content = String(args?.content ?? "");
          return {
            path: (args?.path as string | null) ?? "/tmp/untitled.md",
            byteSize: new TextEncoder().encode(content).length,
            lineCount: content ? content.split(/\r\n|\r|\n/).length : 0,
            modifiedMs: 2000,
          };
        }

        if (command === "export_markdown_html") {
          return "/tmp/untitled.html";
        }

        if (command === "export_markdown_pdf") {
          return "/tmp/untitled.pdf";
        }

        throw new Error(`Unhandled test command: ${command}`);
      },
    };

    window.localStorage.setItem("lmd:test-calls", JSON.stringify(calls));
    Object.defineProperty(window, "__LMD_TEST_CALLS__", {
      value: calls,
      configurable: true,
    });
  });
}

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("edits markdown and renders preview modes", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Untitled" })).toBeVisible();

  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("# Preview title\n\n- item one");

  await page.getByRole("button", { name: "Split" }).click();
  await expect(page.locator(".markdown-preview")).toBeVisible();
  await expect(page.locator(".markdown-preview h1")).toHaveText("Preview title");
  await expect(page.locator(".markdown-preview li")).toHaveText("item one");

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator(".editor-frame")).toHaveCount(0);
  await expect(page.locator(".markdown-preview")).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.locator(".editor-frame")).toBeVisible();
});

test("persists settings across reload", async ({ page }) => {
  await page.getByLabel("Default view").selectOption("preview");
  await page.getByLabel("Search results").selectOption("120");
  await page.getByLabel("File check").selectOption("10");

  await page.reload();

  await expect(page.getByRole("button", { name: "Preview" })).toHaveClass(/active/);
  await expect(page.getByLabel("Default view")).toHaveValue("preview");
  await expect(page.getByLabel("Search results")).toHaveValue("120");
  await expect(page.getByLabel("File check")).toHaveValue("10");
});

test("saves and exports the current document", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("# Saved title\n\nBody");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved untitled.md.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "untitled.md" })).toBeVisible();

  await page.getByRole("button", { name: "Export HTML" }).click();
  await expect(page.getByText("Exported HTML to untitled.html.")).toBeVisible();

  await page.getByRole("button", { name: "Export PDF" }).click();
  await expect(page.getByText("Exported PDF to untitled.pdf.")).toBeVisible();

  const calls = await page.evaluate(() => window.__LMD_TEST_CALLS__);
  expect(calls.map((call) => call.command)).toEqual(
    expect.arrayContaining(["save_markdown_file", "export_markdown_html", "export_markdown_pdf"]),
  );
});

test("opens workspace, searches, and opens a match", async ({ page }) => {
  await page.getByRole("button", { name: "Workspace" }).click();
  await expect(page.getByText("Opened workspace with 1 files.")).toBeVisible();
  await expect(page.getByRole("button", { name: /alpha\.md/ })).toBeVisible();

  await page.getByLabel("Search workspace").fill("needle");
  await page.getByLabel("Search workspace").press("Enter");
  await expect(page.getByText("Found 1 workspace matches.")).toBeVisible();

  await page.getByRole("button", { name: /needle match/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "alpha.md" })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("Opened from workspace.");

  const searchCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "search_workspace"),
  );
  expect(searchCall?.args).toMatchObject({ rootPath: "/workspace", query: "needle", maxResults: 80 });
});
