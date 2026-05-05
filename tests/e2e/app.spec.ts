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
            defaultProvider: "deepseek",
            providers: [
              {
                id: "deepseek",
                label: "DeepSeek",
                models: ["deepseek-v4-flash", "deepseek-v4-pro"],
                baseUrl: "https://api.deepseek.com/chat/completions",
                apiKeyEnv: "DEEPSEEK_API_KEY",
              },
              {
                id: "minimax",
                label: "MiniMax",
                models: ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2"],
                baseUrl: "https://api.minimaxi.com/v1/chat/completions",
                apiKeyEnv: "MINIMAX_API_KEY",
              },
              {
                id: "kimi",
                label: "Kimi",
                models: ["kimi-k2.6", "kimi-k2.5", "moonshot-v1-128k"],
                baseUrl: "https://api.moonshot.cn/v1/chat/completions",
                apiKeyEnv: "MOONSHOT_API_KEY",
              },
              {
                id: "zhipu",
                label: "智谱 GLM",
                models: ["glm-5.1", "glm-4.7", "glm-4.5"],
                baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                apiKeyEnv: "ZAI_API_KEY",
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
  await expect(page.locator(".document-heading").getByRole("heading", { name: "未命名" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "资料库分区" })).toBeVisible();
  await expect(page.getByRole("button", { name: "全部笔记" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "工作区笔记" })).toBeVisible();
  await expect(page.getByLabel("检查器标签").getByRole("button", { name: "预览" })).toHaveCount(0);

  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type(
    "# Preview title\n\n| Name | Value |\n| --- | --- |\n| Alpha | 42 |\n\n- [x] done item\n\nhttps://example.com",
  );

  await page.getByRole("button", { name: "分屏" }).click();
  await expect(page.locator(".document-main .markdown-preview")).toBeVisible();
  await expect(page.locator(".document-main .markdown-preview h1")).toHaveText("Preview title");
  const firstPreviewBlockOffset = await page.locator(".document-main .markdown-preview h1").evaluate((heading) => {
    const preview = heading.closest(".markdown-preview");
    if (!preview) return Number.POSITIVE_INFINITY;
    return heading.getBoundingClientRect().top - preview.getBoundingClientRect().top;
  });
  expect(firstPreviewBlockOffset).toBeLessThan(20);
  await expect(page.locator(".document-main .markdown-preview table")).toContainText("Alpha");
  await expect(page.locator(".document-main").getByRole("checkbox", { name: "done item" })).toBeChecked();
  await expect(page.locator(".document-main").getByRole("link", { name: "https://example.com" })).toBeVisible();

  await page.getByLabel("编辑模式").getByRole("button", { name: "预览" }).click();
  await expect(page.locator(".editor-frame")).toHaveCount(0);
  await expect(page.locator(".document-main .markdown-preview")).toBeVisible();

  await page.getByRole("button", { name: "编辑" }).click();
  await expect(page.locator(".editor-frame")).toBeVisible();
});

test("applies markdown toolbar shortcuts to the editor", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("Toolbar text");

  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.getByLabel("Markdown 快捷格式").getByRole("button", { name: "B" }).click();

  await expect(page.locator(".cm-content")).toContainText("**Toolbar text**");
});

test("persists settings across reload", async ({ page }) => {
  await page.getByText("设置", { exact: true }).click();
  await page.getByLabel("默认视图").selectOption("preview");
  await page.getByLabel("搜索结果").selectOption("120");
  await page.getByLabel("文件检查").selectOption("10");
  await expect(page.getByLabel("AI 助手提供方")).not.toContainText("外部命令");
  await page.getByText("高级 AI 设置").click();
  await page.getByRole("button", { name: "使用外部命令" }).click();
  await page.getByLabel("外部命令路径").fill("/tmp/lmd-assistant");
  await page.getByLabel("外部命令超时时间").selectOption("120");

  await page.reload();

  await page.getByText("设置", { exact: true }).click();
  await expect(page.getByLabel("编辑模式").getByRole("button", { name: "预览" })).toHaveClass(/active/);
  await expect(page.getByLabel("默认视图")).toHaveValue("preview");
  await expect(page.getByLabel("搜索结果")).toHaveValue("120");
  await expect(page.getByLabel("文件检查")).toHaveValue("10");
  await expect(page.getByLabel("AI 助手提供方")).not.toContainText("外部命令");
  await page.getByText("高级 AI 设置").click();
  await expect(page.getByLabel("外部命令路径")).toHaveValue("/tmp/lmd-assistant");
  await expect(page.getByLabel("外部命令超时时间")).toHaveValue("120");
});

test("saves and exports the current document", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("# Saved title\n\nBody");

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存 untitled.md。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "untitled.md" })).toBeVisible();

  await page.getByText("更多").click();
  await page.getByRole("button", { name: "导出 HTML" }).click();
  await expect(page.getByText("已导出 HTML 到 untitled.html。")).toBeVisible();

  await page.getByText("更多").click();
  await page.getByRole("button", { name: "导出 PDF" }).click();
  await expect(page.getByText("已导出 PDF 到 untitled.pdf。")).toBeVisible();

  const calls = await page.evaluate(() => window.__LMD_TEST_CALLS__);
  expect(calls.map((call) => call.command)).toEqual(
    expect.arrayContaining(["save_markdown_file", "export_markdown_html", "export_markdown_pdf"]),
  );
});

test("opens workspace, searches, and opens a match", async ({ page }) => {
  await page.getByRole("button", { name: "工作区" }).click();
  await expect(page.getByText("已打开工作区，共 5 个文件。")).toBeVisible();
  await expect(page.getByRole("button", { name: /alpha\.md/ })).toBeVisible();

  await page.getByLabel("搜索工作区").fill("needle");
  await page.getByLabel("搜索工作区").press("Enter");
  await expect(page.getByText("找到 1 条工作区匹配结果。")).toBeVisible();

  await page.getByRole("button", { name: /needle match/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "alpha.md" })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("Opened from workspace.");

  const searchCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "search_workspace"),
  );
  expect(searchCall?.args).toMatchObject({ rootPath: "/workspace", query: "needle", maxResults: 80 });
});

test("shows a clear message when native workspace actions run in web preview", async ({ page }) => {
  await page.evaluate(() => {
    window.__LMD_TEST_API__ = undefined;
  });

  await page.getByRole("button", { name: "工作区" }).click();
  await expect(page.getByText(/本地文件和工作区操作需要在 Tauri 桌面应用中使用/)).toBeVisible();
});

test("filters workspace files from the library rail", async ({ page }) => {
  await page.getByRole("button", { name: "工作区" }).click();
  const libraryNav = page.getByRole("navigation", { name: "资料库分区" });

  await libraryNav.getByRole("button", { name: "笔记", exact: true }).click();
  await expect(page.getByRole("button", { name: /notes\/topic\.md/ })).toBeVisible();
  await expect(page.locator(".file-kind").filter({ hasText: "笔记" })).toBeVisible();
  await expect(page.getByRole("button", { name: /wiki\/overview\.md/ })).toHaveCount(0);

  await libraryNav.getByRole("button", { name: "知识库", exact: true }).click();
  await expect(page.getByRole("button", { name: /wiki\/overview\.md/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /wiki\/inbox\/draft\.md/ })).toBeVisible();
  await expect(page.locator(".file-kind").filter({ hasText: "知识库" })).toBeVisible();
  await expect(page.getByRole("button", { name: /notes\/topic\.md/ })).toHaveCount(0);

  await libraryNav.getByRole("button", { name: "收件箱", exact: true }).click();
  await expect(page.getByRole("button", { name: /wiki\/inbox\/draft\.md/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /wiki\/overview\.md/ })).toHaveCount(0);

  await libraryNav.getByRole("button", { name: "全部笔记", exact: true }).click();
  await expect(page.getByRole("button", { name: /alpha\.md/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /sources\/source-doc\.md/ })).toBeVisible();
  await expect(page.locator(".file-kind").filter({ hasText: "资料" })).toBeVisible();
});

test("collapses and restores the note library", async ({ page }) => {
  await expect(page.getByRole("complementary", { name: "工作区笔记" })).toBeVisible();

  await page.getByRole("button", { name: "隐藏笔记栏" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/left-closed/);
  await expect(page.getByRole("button", { name: "显示笔记栏" })).toBeVisible();

  await page.getByRole("button", { name: "显示笔记栏" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/left-open/);
  await expect(page.getByRole("complementary", { name: "工作区笔记" })).toBeVisible();
});

test("initializes a knowledge workspace", async ({ page }) => {
  await page.getByRole("button", { name: "工作区" }).click();
  await expect(page.getByText("标准工作区")).toBeVisible();

  await page.getByText("更多").click();
  await page.getByRole("button", { name: "初始化知识库" }).click();
  await expect(page.getByText("知识库工作区已初始化。")).toBeVisible();
  await expect(page.getByText("知识库工作区已就绪")).toBeVisible();
  await page.getByText("更多").click();
  await expect(page.getByRole("button", { name: "初始化知识库" })).toBeDisabled();

  const initCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "initialize_knowledge_workspace"),
  );
  expect(initCall?.args).toMatchObject({ rootPath: "/workspace" });
});

test("shows document knowledge for initialized workspaces", async ({ page }) => {
  await page.getByRole("button", { name: "工作区" }).click();
  await page.getByText("更多").click();
  await page.getByRole("button", { name: "初始化知识库" }).click();

  await page.locator(".file-list .file-item").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "alpha.md" })).toBeVisible();
  await page.getByLabel("编辑模式").getByRole("button", { name: "分屏" }).click();
  await page.getByLabel("检查器标签").getByRole("button", { name: "知识" }).click();

  await expect(page.locator(".knowledge-link-item span").filter({ hasText: "wiki/overview.md" }).first()).toBeVisible();
  await expect(page.getByText("#writing")).toBeVisible();
  await expect(page.locator(".knowledge-link-item.unresolved strong").first()).toHaveText("Missing Topic");
  await expect(page.getByText("sources/source-doc.md")).toBeVisible();
  await expect(page.getByRole("button", { name: "打开 index.md" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开 log.md" })).toBeVisible();
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
  await page.getByRole("button", { name: "工作区" }).click();
  await page.getByText("更多").click();
  await page.getByRole("button", { name: "初始化知识库" }).click();
  await page.locator(".file-list .file-item").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("编辑模式").getByRole("button", { name: "分屏" })).toHaveClass(/active/);
  await page.getByLabel("检查器标签").getByRole("button", { name: "AI 助手" }).click();
  await expect(page.getByRole("complementary", { name: "检查器" })).toBeVisible();
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("上下文已加载");
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("2 条，来自 alpha.md");

  await page.getByText("设置", { exact: true }).click();
  await page.getByText("高级 AI 设置").click();
  await page.getByRole("button", { name: "使用外部命令" }).click();
  await page.getByLabel("外部命令路径").fill("/tmp/lmd-assistant");
  await page.getByText("设置", { exact: true }).click();

  await page.getByRole("button", { name: "总结笔记" }).click();
  await expect(page.getByText("AI 草稿已生成。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "alpha summary" })).toBeVisible();
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("已请求 AI");
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("external_command / command-json-v1");
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("草稿已生成");

  await page.getByRole("button", { name: "保存为 Wiki 页面" }).click();
  await expect(page.getByText("已将 Wiki 草稿保存到 alpha-summary.md。")).toBeVisible();
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("草稿已保存");
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("alpha-summary.md");

  const summarizeCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "summarize_query_context"),
  );
  expect(summarizeCall?.args).toMatchObject({
    rootPath: "/workspace",
    currentPath: "/workspace/alpha.md",
    provider: "external_command",
    model: "command-json-v1",
    task: "summarize",
    externalCommand: "/tmp/lmd-assistant",
  });

  const saveDraftCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "save_wiki_draft"),
  );
  expect(saveDraftCall?.args).toMatchObject({
    rootPath: "/workspace",
    title: "alpha summary",
  });
});
