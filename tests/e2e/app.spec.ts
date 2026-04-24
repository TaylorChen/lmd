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
    let knowledgeInitialized = false;

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
              {
                path: "/workspace/notes/topic.md",
                relativePath: "notes/topic.md",
                name: "topic.md",
                byteSize: 84,
              },
              {
                path: "/workspace/sources/source-doc.md",
                relativePath: "sources/source-doc.md",
                name: "source-doc.md",
                byteSize: 64,
              },
              {
                path: "/workspace/wiki/overview.md",
                relativePath: "wiki/overview.md",
                name: "overview.md",
                byteSize: 96,
              },
              {
                path: "/workspace/wiki/inbox/draft.md",
                relativePath: "wiki/inbox/draft.md",
                name: "draft.md",
                byteSize: 32,
              },
            ],
            knowledge: {
              isInitialized: knowledgeInitialized,
              notesPath: "/workspace/notes",
              sourcesPath: "/workspace/sources",
              wikiPath: "/workspace/wiki",
              schemaPath: "/workspace/AGENTS.md",
              manifestPath: "/workspace/.lmd/knowledge/manifest.json",
            },
          };
        }

        if (command === "document_knowledge") {
          return {
            currentPath: String(args?.currentPath ?? "/workspace/alpha.md"),
            currentRelativePath: "alpha.md",
            frontmatter: [{ key: "title", value: "Alpha" }],
            tags: ["writing", "focus"],
            outgoingLinks: [
              {
                target: "Beta",
                label: "Beta",
                resolvedPath: "/workspace/wiki/beta.md",
                resolvedRelativePath: "wiki/beta.md",
                resolvedName: "beta.md",
                sourceKind: "wiki",
              },
            ],
            backlinks: [
              {
                path: "/workspace/wiki/overview.md",
                relativePath: "wiki/overview.md",
                name: "overview.md",
                sourceKind: "wiki",
                label: "Alpha",
              },
            ],
            unresolvedLinks: [
              {
                target: "Missing Topic",
                label: "Missing Topic",
                resolvedPath: null,
                resolvedRelativePath: null,
                resolvedName: null,
                sourceKind: null,
              },
            ],
            relatedWikiPages: [
              {
                path: "/workspace/wiki/overview.md",
                relativePath: "wiki/overview.md",
                name: "overview.md",
                sourceKind: "wiki",
                label: "Alpha",
              },
            ],
            sourceReferences: [
              {
                path: "/workspace/sources/source-doc.md",
                relativePath: "sources/source-doc.md",
                name: "source-doc.md",
                sourceKind: "source",
                label: "Source Doc",
              },
            ],
          };
        }

        if (command === "knowledge_lint_report") {
          return {
            issues: [
              {
                kind: "unresolved_link",
                severity: "warning",
                path: "/workspace/alpha.md",
                relativePath: "alpha.md",
                message: "Unresolved link: Missing Topic",
              },
              {
                kind: "not_in_index",
                severity: "info",
                path: "/workspace/wiki/overview.md",
                relativePath: "wiki/overview.md",
                message: "Wiki page is not linked from wiki/index.md.",
              },
            ],
          };
        }

        if (command === "query_context") {
          return {
            currentPath: String(args?.currentPath ?? "/workspace/alpha.md"),
            currentRelativePath: "alpha.md",
            items: [
              {
                path: "/workspace/alpha.md",
                relativePath: "alpha.md",
                name: "alpha.md",
                sourceKind: "note",
                reason: "current_document",
                excerpt: "Opened from workspace.",
              },
              {
                path: "/workspace/wiki/overview.md",
                relativePath: "wiki/overview.md",
                name: "overview.md",
                sourceKind: "wiki",
                reason: "linked_wiki",
                excerpt: "Overview context excerpt.",
              },
            ],
          };
        }

        if (command === "summarize_query_context") {
          return {
            title: "alpha summary",
            content: "# alpha summary\n\n## Summary\n\n- Draft from current query context.",
          };
        }

        if (command === "assistant_catalog") {
          return {
            defaultProvider: "builtin",
            providers: [
              {
                id: "builtin",
                label: "Builtin",
                models: ["local-summary-v1", "local-summary-v2"],
              },
              {
                id: "mock_openai",
                label: "Mock OpenAI",
                models: ["gpt-mock-1", "gpt-mock-2"],
              },
              {
                id: "external_command",
                label: "External Command",
                models: ["command-json-v1"],
              },
            ],
          };
        }

        if (command === "save_wiki_draft") {
          return "/workspace/wiki/inbox/alpha-summary.md";
        }

        if (command === "initialize_knowledge_workspace") {
          knowledgeInitialized = true;
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
            knowledge: {
              isInitialized: true,
              notesPath: "/workspace/notes",
              sourcesPath: "/workspace/sources",
              wikiPath: "/workspace/wiki",
              schemaPath: "/workspace/AGENTS.md",
              manifestPath: "/workspace/.lmd/knowledge/manifest.json",
            },
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
          if (!String(args?.html ?? "").includes("<h1>Saved title</h1>")) {
            throw new Error("HTML export did not receive rendered markdown");
          }
          if (!String(args?.html ?? "").startsWith("<!doctype html>")) {
            throw new Error("HTML export did not receive a full document");
          }
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
  await expect(page.locator(".toolbar").getByRole("heading", { name: "Untitled" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Library sections" })).toBeVisible();
  await expect(page.getByRole("button", { name: "All Notes" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Workspace notes" })).toBeVisible();

  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type(
    "# Preview title\n\n| Name | Value |\n| --- | --- |\n| Alpha | 42 |\n\n- [x] done item\n\nhttps://example.com",
  );

  await page.getByRole("button", { name: "Split" }).click();
  await expect(page.locator(".document-main .markdown-preview")).toBeVisible();
  await expect(page.locator(".document-main .markdown-preview h1")).toHaveText("Preview title");
  await expect(page.locator(".document-main .markdown-preview table")).toContainText("Alpha");
  await expect(page.locator(".document-main").getByRole("checkbox", { name: "done item" })).toBeChecked();
  await expect(page.locator(".document-main").getByRole("link", { name: "https://example.com" })).toBeVisible();

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator(".editor-frame")).toHaveCount(0);
  await expect(page.locator(".document-main .markdown-preview")).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.locator(".editor-frame")).toBeVisible();
});

test("persists settings across reload", async ({ page }) => {
  await page.getByLabel("Default view").selectOption("preview");
  await page.getByLabel("Search results").selectOption("120");
  await page.getByLabel("File check").selectOption("10");
  await page.getByLabel("Assistant provider").selectOption("mock_openai");
  await page.getByLabel("Assistant model").selectOption("gpt-mock-2");

  await page.reload();

  await expect(page.getByRole("button", { name: "Preview" })).toHaveClass(/active/);
  await expect(page.getByLabel("Default view")).toHaveValue("preview");
  await expect(page.getByLabel("Search results")).toHaveValue("120");
  await expect(page.getByLabel("File check")).toHaveValue("10");
  await expect(page.getByLabel("Assistant provider")).toHaveValue("mock_openai");
  await expect(page.getByLabel("Assistant model")).toHaveValue("gpt-mock-2");
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
  await expect(page.getByText("Opened workspace with 5 files.")).toBeVisible();
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

test("filters workspace files from the library rail", async ({ page }) => {
  await page.getByRole("button", { name: "Workspace" }).click();
  const libraryNav = page.getByRole("navigation", { name: "Library sections" });

  await libraryNav.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByRole("button", { name: /notes\/topic\.md/ })).toBeVisible();
  await expect(page.locator(".file-kind").filter({ hasText: "note" })).toBeVisible();
  await expect(page.getByRole("button", { name: /wiki\/overview\.md/ })).toHaveCount(0);

  await libraryNav.getByRole("button", { name: "Wiki", exact: true }).click();
  await expect(page.getByRole("button", { name: /wiki\/overview\.md/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /wiki\/inbox\/draft\.md/ })).toBeVisible();
  await expect(page.locator(".file-kind").filter({ hasText: "wiki" })).toBeVisible();
  await expect(page.getByRole("button", { name: /notes\/topic\.md/ })).toHaveCount(0);

  await libraryNav.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("button", { name: /wiki\/inbox\/draft\.md/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /wiki\/overview\.md/ })).toHaveCount(0);

  await libraryNav.getByRole("button", { name: "All Notes", exact: true }).click();
  await expect(page.getByRole("button", { name: /alpha\.md/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /sources\/source-doc\.md/ })).toBeVisible();
  await expect(page.locator(".file-kind").filter({ hasText: "source" })).toBeVisible();
});

test("initializes a knowledge workspace", async ({ page }) => {
  await page.getByRole("button", { name: "Workspace" }).click();
  await expect(page.getByText("Standard workspace")).toBeVisible();

  await page.getByRole("button", { name: "Init Knowledge" }).click();
  await expect(page.getByText("Knowledge workspace initialized.")).toBeVisible();
  await expect(page.getByText("Knowledge workspace ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Init Knowledge" })).toBeDisabled();

  const initCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "initialize_knowledge_workspace"),
  );
  expect(initCall?.args).toMatchObject({ rootPath: "/workspace" });
});

test("shows document knowledge for initialized workspaces", async ({ page }) => {
  await page.getByRole("button", { name: "Workspace" }).click();
  await page.getByRole("button", { name: "Init Knowledge" }).click();

  await page.locator(".file-list .file-item").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "alpha.md" })).toBeVisible();
  await page.getByRole("button", { name: "Split" }).click();
  await page.locator(".toolbar").getByRole("button", { name: "Knowledge" }).click();

  await expect(page.locator(".knowledge-link-item span").filter({ hasText: "wiki/overview.md" }).first()).toBeVisible();
  await expect(page.getByText("#writing")).toBeVisible();
  await expect(page.locator(".knowledge-link-item.unresolved strong").first()).toHaveText("Missing Topic");
  await expect(page.getByText("sources/source-doc.md")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open index.md" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open log.md" })).toBeVisible();
  await expect(page.getByText("Unresolved link: Missing Topic")).toBeVisible();
  await expect(page.getByText("Overview context excerpt.")).toBeVisible();

  const knowledgeCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "document_knowledge"),
  );
  expect(knowledgeCall?.args).toMatchObject({
    rootPath: "/workspace",
    currentPath: "/workspace/alpha.md",
  });
  expect(knowledgeCall?.args?.currentContent).toBeUndefined();

  const lintCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "knowledge_lint_report"),
  );
  expect(lintCall?.args).toMatchObject({ rootPath: "/workspace" });

  const contextCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "query_context"),
  );
  expect(contextCall?.args).toMatchObject({
    rootPath: "/workspace",
    currentPath: "/workspace/alpha.md",
  });
});

test("builds and saves an assistant draft", async ({ page }) => {
  await page.getByRole("button", { name: "Workspace" }).click();
  await page.getByRole("button", { name: "Init Knowledge" }).click();
  await page.locator(".file-list .file-item").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Edit" })).toHaveClass(/active/);
  await page.locator(".toolbar").getByRole("button", { name: "Assistant" }).click();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Assistant run log" })).toContainText("Context loaded");
  await expect(page.getByRole("list", { name: "Assistant run log" })).toContainText("2 items from alpha.md");

  await page.getByRole("button", { name: "Summarize Context" }).click();
  await expect(page.getByText("Assistant draft generated.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "alpha summary" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Assistant run log" })).toContainText("Summary requested");
  await expect(page.getByRole("list", { name: "Assistant run log" })).toContainText("builtin / local-summary-v1");
  await expect(page.getByRole("list", { name: "Assistant run log" })).toContainText("Draft generated");

  await page.getByRole("button", { name: "Save as Wiki Page" }).click();
  await expect(page.getByText("Saved wiki draft to alpha-summary.md.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Assistant run log" })).toContainText("Draft saved");
  await expect(page.getByRole("list", { name: "Assistant run log" })).toContainText("alpha-summary.md");

  const summarizeCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "summarize_query_context"),
  );
  expect(summarizeCall?.args).toMatchObject({
    rootPath: "/workspace",
    currentPath: "/workspace/alpha.md",
    provider: "builtin",
    model: "local-summary-v1",
  });

  const saveDraftCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "save_wiki_draft"),
  );
  expect(saveDraftCall?.args).toMatchObject({
    rootPath: "/workspace",
    title: "alpha summary",
  });
});
