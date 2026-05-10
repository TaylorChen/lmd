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
                anchor: null,
                isBlockReference: false,
                resolvedPath: "/workspace/wiki/beta.md",
                resolvedRelativePath: "wiki/beta.md",
                resolvedName: "beta.md",
                sourceKind: "wiki",
              },
              {
                target: "alpha#^block-alpha",
                label: "Alpha block",
                anchor: "^block-alpha",
                isBlockReference: true,
                resolvedPath: "/workspace/alpha.md",
                resolvedRelativePath: "alpha.md",
                resolvedName: "alpha.md",
                sourceKind: "note",
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
                anchor: null,
                isBlockReference: false,
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

        if (command === "git_workspace_status") {
          return {
            isRepository: true,
            branch: "main",
            changes: [{ status: "M", path: "alpha.md" }],
            currentFileDiff: "diff --git a/alpha.md b/alpha.md\n+Changed",
            recentCommits: [
              { hash: "abc123", subject: "Initial commit", author: "LMD", date: "2026-05-07" },
            ],
          };
        }

        if (command === "git_commit_workspace") {
          return {
            isRepository: true,
            branch: "main",
            changes: [],
            currentFileDiff: "",
            recentCommits: [
              { hash: "def456", subject: String(args?.message ?? ""), author: "LMD", date: "2026-05-07" },
            ],
          };
        }

        if (command === "summarize_query_context") {
          return {
            title: "alpha summary",
            content: "# alpha summary\n\n## Summary\n\n- Draft from current query context.",
          };
        }

        if (command === "summarize_editor_context") {
          return {
            title: "chat reply",
            content: "你好，我可以帮助你整理当前 Markdown 内容。",
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
                id: "ollama",
                label: "Ollama",
                models: ["qwen2.5:7b", "llama3.2", "deepseek-r1:7b"],
                baseUrl: "http://127.0.0.1:11434/v1/chat/completions",
              },
              {
                id: "lmstudio",
                label: "LM Studio",
                models: ["local-model"],
                baseUrl: "http://127.0.0.1:1234/v1/chat/completions",
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

        if (command === "list_history_snapshots") {
          return [
            {
              path: "/workspace/.lmd/history/alpha.md/1000.md",
              name: "1000",
              modifiedMs: 1000,
              byteSize: 42,
            },
          ];
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

        if (command === "initialize_knowledge_index" || command === "rebuild_knowledge_index") {
          return {
            documentCount: knowledgeInitialized ? 5 : 0,
            indexedCount: knowledgeInitialized ? 5 : 0,
            removedCount: 0,
            databasePath: "/workspace/.lmd/knowledge/lmd.db",
          };
        }

        if (command === "open_markdown_path") {
          if (args?.path === "/workspace/wiki/beta.md") {
            return {
              path: args.path,
              content: "# Beta\n\nEmbedded beta content.\n\nTarget paragraph. ^beta-block",
              byteSize: 58,
              lineCount: 5,
              modifiedMs: 1000,
              isLarge: false,
              readOnly: false,
              visibleStartLine: 1,
              visibleLineCount: 5,
            };
          }
          return {
            path: args?.path as string,
            content: "# Alpha\n\nOpened from workspace.\n\n![[Beta]]\n\nAlpha target block. ^block-alpha",
            byteSize: 31,
            lineCount: 7,
            modifiedMs: 1000,
            isLarge: false,
            readOnly: false,
            visibleStartLine: 1,
            visibleLineCount: 3,
          };
        }

        if (command === "open_daily_note") {
          const date = String(args?.date ?? "2026-05-07");
          return {
            path: `/workspace/daily/${date}.md`,
            content: `# Daily ${date}\n\n## 记录\n\n- `,
            byteSize: 34,
            lineCount: 5,
            modifiedMs: 2400,
            isLarge: false,
            readOnly: false,
            visibleStartLine: 1,
            visibleLineCount: 5,
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

        if (command === "create_markdown_file") {
          const directory = String(args?.directory ?? "").replace(/^\/+|\/+$/g, "");
          const name = String(args?.name ?? "untitled.md").endsWith(".md")
            ? String(args?.name ?? "untitled.md")
            : `${String(args?.name ?? "untitled")}.md`;
          const targetPath = `/workspace/${directory ? `${directory}/` : ""}${name}`;
          return {
            path: targetPath,
            byteSize: new TextEncoder().encode(String(args?.content ?? "")).length,
            lineCount: 2,
            modifiedMs: 2200,
          };
        }

        if (command === "create_folder") {
          const directory = String(args?.directory ?? "notes/new-folder");
          return `/workspace/${directory}`;
        }

        if (command === "delete_folder") {
          return null;
        }

        if (command === "rename_markdown_file") {
          const newName = String(args?.newName ?? "renamed.md");
          return {
            path: `/workspace/${newName.endsWith(".md") ? newName : `${newName}.md`}`,
            byteSize: 31,
            lineCount: 3,
            modifiedMs: 2300,
          };
        }

        if (command === "move_markdown_file") {
          const targetDirectory = String(args?.targetDirectory ?? "").replace(/^\/+|\/+$/g, "");
          const name = String(args?.path ?? "/workspace/alpha.md").split("/").pop() ?? "alpha.md";
          return {
            path: `/workspace/${targetDirectory ? `${targetDirectory}/` : ""}${name}`,
            byteSize: 31,
            lineCount: 3,
            modifiedMs: 2400,
          };
        }

        if (command === "delete_markdown_file" || command === "reveal_in_finder") {
          return null;
        }

        if (command === "import_attachment") {
          return {
            path: "/workspace/attachments/diagram.png",
            markdown: "![diagram](../attachments/diagram.png)",
          };
        }

        if (command === "import_pasted_attachment") {
          return {
            path: "/workspace/attachments/pasted.png",
            markdown: "![pasted](../attachments/pasted.png)",
          };
        }

        if (command === "open_history_snapshot") {
          return {
            path: String(args?.path ?? "/workspace/.lmd/history/alpha.md"),
            name: "alpha.md",
            content: "# Snapshot\n\nOld version",
            byteSize: 22,
            lineCount: 3,
            modifiedMs: 900,
            isLarge: false,
            readOnly: false,
            visibleStartLine: 1,
            visibleLineCount: 3,
          };
        }

        if (command === "test_assistant_connection") {
          return "AI 连接测试成功。";
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

        if (command === "export_markdown_docx") {
          return "/tmp/untitled.docx";
        }

        if (command === "rename_workspace_tag") {
          return { filesChanged: 2, replacements: 4 };
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

async function pressAppShortcut(page: Page, key: string, options: { shift?: boolean } = {}) {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  if (options.shift) await page.keyboard.down("Shift");
  await page.keyboard.press(key);
  if (options.shift) await page.keyboard.up("Shift");
  await page.keyboard.up(modifier);
}

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("edits markdown and renders preview modes", async ({ page }) => {
  await expect(page.getByRole("tab", { name: "未命名" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "资料库分区" })).toBeVisible();
  await expect(page.getByRole("button", { name: "全部笔记" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "工作区笔记" })).toBeVisible();
  await expect(page.getByLabel("检查器标签").getByRole("button", { name: "预览" })).toHaveCount(0);

  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type(
    "---\ntitle: Preview title\ntags: [math, diagram]\n---\n\n# Preview title\n\nInline math $a^2 + b^2 = c^2$.\n\n$$E=mc^2$$\n\n```mermaid\ngraph TD\nA-->B\n```\n\n```plantuml\n@startuml\nAlice -> Bob: Hi\n@enduml\n```\n\n```javascript\nconst answer = 42;\n```\n\n| Name | Value |\n| --- | --- |\n| Alpha | 42 |\n\n- [x] done item\n\nhttps://example.com",
  );
  await page.keyboard.type(
    Array.from({ length: 12 }, (_, index) => `\n\n## Long section ${index + 1}\n\nScrollable source line ${index + 1}`).join(""),
  );
  const sourceCanScroll = await page.locator(".editor-frame").evaluate((node) => {
    const content = node.querySelector(".cm-editor");
    if (!content) return false;
    const contentHeight = content.getBoundingClientRect().height;
    const viewportHeight = node.getBoundingClientRect().height;
    node.scrollTop = 0;
    node.scrollBy({ top: 240 });
    return contentHeight > viewportHeight && node.scrollTop > 0;
  });
  expect(sourceCanScroll).toBeTruthy();
  await pressAppShortcut(page, "F");
  await expect(page.getByPlaceholder("查找...")).toBeFocused();
  await page.keyboard.type("Preview");
  await expect(page.getByLabel("匹配数量")).toHaveText("1/2");
  await page.getByRole("button", { name: "下一个匹配" }).click();
  await expect(page.getByLabel("匹配数量")).toHaveText("2/2");
  await page.getByRole("button", { name: "关闭查找" }).click();
  await expect(page.getByRole("search", { name: "文档查找" })).toHaveCount(0);

  await pressAppShortcut(page, "E", { shift: true });
  await pressAppShortcut(page, "\\");
  await expect(page.locator(".document-main .markdown-preview")).toBeVisible();
  await expect(page.locator(".document-main .markdown-preview h1")).toHaveText("Preview title");
  const firstPreviewBlockOffset = await page.locator(".document-main .markdown-preview h1").evaluate((heading) => {
    const preview = heading.closest(".markdown-preview");
    if (!preview) return Number.POSITIVE_INFINITY;
    return heading.getBoundingClientRect().top - preview.getBoundingClientRect().top;
  });
  expect(firstPreviewBlockOffset).toBeLessThan(20);
  await expect(page.locator(".document-main .markdown-preview")).not.toContainText("tags: [math, diagram]");
  await expect(page.locator(".document-main .markdown-preview .katex").first()).toBeVisible();
  await expect(page.locator(".document-main .markdown-preview .mermaid svg").first()).toBeVisible();
  await expect(page.locator(".document-main .markdown-preview .plantuml-block")).toContainText("Alice -> Bob");
  await expect(page.locator(".document-main .markdown-preview pre code .hljs-keyword").first()).toHaveText("const");
  await expect(page.locator(".document-main .markdown-preview table")).toContainText("Alpha");
  await expect(page.locator(".document-main").getByRole("checkbox", { name: "done item" })).toBeChecked();
  await expect(page.locator(".document-main").getByRole("link", { name: "https://example.com" })).toBeVisible();
  await pressAppShortcut(page, "\\");
  await expect(page.locator(".editor-frame")).toBeVisible();
  await expect(page.locator(".document-main .markdown-preview")).toHaveCount(0);

  await pressAppShortcut(page, "E");
  await expect(page.locator(".editor-frame")).toHaveCount(0);
  await expect(page.locator(".document-main .markdown-preview")).toBeVisible();

  await pressAppShortcut(page, "E", { shift: true });
  await expect(page.locator(".editor-frame")).toBeVisible();
});

test("applies markdown toolbar shortcuts to the editor", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("Toolbar text");

  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.getByLabel("Markdown 快捷格式").getByRole("button", { name: "B" }).click();

  await expect(page.locator(".cm-content")).toContainText("**Toolbar text**");

  await page.keyboard.press("End");
  await page.getByLabel("Markdown 快捷格式").getByText("格式", { exact: true }).click();
  await page.getByRole("button", { name: "插入表格" }).click();
  await expect(page.locator(".cm-content")).toContainText("| 列 1 | 列 2 | 列 3 |");

  await page.keyboard.type("\n\nBlock target");
  await page.getByLabel("Markdown 快捷格式").getByText("格式", { exact: true }).click();
  await page.getByRole("button", { name: "块 ID" }).click();
  await expect(page.locator(".cm-content")).toContainText("^block-");
  await pressAppShortcut(page, "E", { shift: true });
  await pressAppShortcut(page, "\\");
  await expect(page.locator(".document-main .markdown-preview .block-anchor").first()).toContainText("^block-");

  await pressAppShortcut(page, "E", { shift: true });
  await page.getByLabel("Markdown 快捷格式").getByText("格式", { exact: true }).click();
  await page.getByRole("button", { name: "块引用" }).click();
  await expect(page.locator(".cm-content")).toContainText("[[当前笔记#^block-");
  await pressAppShortcut(page, "E", { shift: true });
  await pressAppShortcut(page, "\\");
  await expect(page.locator(".document-main .markdown-preview .wiki-link").first()).toContainText("当前笔记#^block-");
});

test("supports daily notes, lightweight table tools, and git status", async ({ page }) => {
  await page.getByRole("button", { name: "工作区" }).click();
  await page.getByRole("button", { name: "今日笔记" }).click();
  await expect(page.getByRole("tab", { name: /\.md$/ })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("# Daily");

  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("name,value\nalpha,1");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.getByLabel("Markdown 快捷格式").getByText("格式", { exact: true }).click();
  await page.getByRole("button", { name: "CSV 表格" }).click();
  await expect(page.locator(".cm-content")).toContainText("| name | value |");
  await page.getByLabel("Markdown 快捷格式").getByText("格式", { exact: true }).click();
  await page.getByRole("button", { name: "加行" }).click();
  await expect(page.getByText("已添加表格行。")).toBeVisible();
  await page.getByLabel("Markdown 快捷格式").getByText("格式", { exact: true }).click();
  await page.getByRole("button", { name: "加列" }).click();
  await expect(page.getByText("已添加表格列。")).toBeVisible();

  await page.getByText("Git", { exact: true }).click();
  await expect(page.getByLabel("Git 状态")).toContainText("main");
  await expect(page.getByLabel("Git 状态")).toContainText("alpha.md");
  await expect(page.getByLabel("Git 状态")).toContainText("Initial commit");
  await page.getByRole("button", { name: "提交改动" }).click();
  await page.getByRole("dialog", { name: "提交 Git 改动" }).getByLabel("提交信息").fill("Save daily note");
  await page.getByRole("dialog", { name: "提交 Git 改动" }).getByRole("button", { name: "提交" }).click();
  await expect(page.getByText("Git 提交已完成。")).toBeVisible();

  const calls = await page.evaluate(() => window.__LMD_TEST_CALLS__?.map((call) => call.command));
  expect(calls).toEqual(expect.arrayContaining(["open_daily_note", "git_workspace_status", "git_commit_workspace"]));
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
  await page.getByRole("button", { name: "测试 AI 连接" }).click();
  await expect(page.getByText("AI 连接测试成功。")).toBeVisible();

  await page.reload();

  await page.getByText("设置", { exact: true }).click();
  await expect(page.locator(".editor-frame")).toHaveCount(0);
  await expect(page.locator(".document-main .markdown-preview")).toBeVisible();
  await expect(page.getByLabel("默认视图")).toHaveValue("preview");
  await expect(page.getByLabel("搜索结果")).toHaveValue("120");
  await expect(page.getByLabel("文件检查")).toHaveValue("10");
  await expect(page.getByLabel("AI 助手提供方")).not.toContainText("外部命令");
  await page.getByText("高级 AI 设置").click();
  await expect(page.getByLabel("外部命令路径")).toHaveValue("/tmp/lmd-assistant");
  await expect(page.getByLabel("外部命令超时时间")).toHaveValue("120");
});

test("allows assistant chat without knowledge context", async ({ page }) => {
  const sendButton = page.getByRole("button", { name: "发送" });

  await expect(sendButton).toBeDisabled();
  await page.getByLabel("输入 AI 指令").fill("你好");
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  await expect(page.getByLabel("AI 对话")).toContainText("你好");
  await expect(page.getByLabel("AI 对话")).toContainText("你好，我可以帮助你整理当前 Markdown 内容。");
  await expect(page.getByText("AI 草稿已生成。")).toHaveCount(0);

  const chatCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "summarize_editor_context"),
  );
  expect(chatCall?.args).toMatchObject({
    currentRelativePath: "未命名",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "chat",
    prompt: "你好",
  });
});

test("saves and exports the current document", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("# Saved title\n\nBody");

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存 untitled.md。")).toBeVisible();
  await expect(page.getByRole("tab", { name: "untitled.md" })).toBeVisible();

  await page.getByText("更多").click();
  await page.getByRole("button", { name: "导出 HTML" }).click();
  await expect(page.getByText("已导出 HTML 到 untitled.html。")).toBeVisible();

  await page.getByText("更多").click();
  await page.getByRole("button", { name: "导出 PDF" }).click();
  await expect(page.getByText("已导出 PDF 到 untitled.pdf。")).toBeVisible();

  await page.getByText("更多").click();
  await page.getByRole("button", { name: "导出 DOCX" }).click();
  await expect(page.getByText("已导出 DOCX 到 untitled.docx。")).toBeVisible();

  const calls = await page.evaluate(() => window.__LMD_TEST_CALLS__);
  expect(calls.map((call) => call.command)).toEqual(
    expect.arrayContaining([
      "save_markdown_file",
      "export_markdown_html",
      "export_markdown_pdf",
      "export_markdown_docx",
    ]),
  );
});

test("removes files from the recent list without deleting the document", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("# Recent title\n\nBody");

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存 untitled.md。")).toBeVisible();

  await page.getByRole("navigation", { name: "资料库分区" }).getByRole("button", { name: "最近" }).click();
  await expect(page.locator(".file-list .file-item").filter({ hasText: "untitled.md" })).toBeVisible();

  await page.getByRole("button", { name: "移除最近文件 untitled.md" }).click();
  await expect(page.getByText("已从最近列表移除。")).toBeVisible();
  await expect(page.getByText("暂无最近文件。")).toBeVisible();
  await expect(page.getByRole("tab", { name: "untitled.md" })).toBeVisible();

  const recentFiles = await page.evaluate(() => window.localStorage.getItem("lmd:recent-files"));
  expect(recentFiles).toBe("[]");
  const lastDocumentPath = await page.evaluate(() => window.localStorage.getItem("lmd:last-document-path"));
  expect(lastDocumentPath).toBeNull();
});

test("opens workspace, searches, and opens a match", async ({ page }) => {
  await page.getByRole("button", { name: "工作区" }).click();
  await expect(page.getByText("已打开工作区，共 5 个文件。")).toBeVisible();
  await expect(page.getByLabel("工作区目录树")).toBeVisible();
  await expect(page.getByRole("button", { name: "▾ wiki" })).toBeVisible();
  await expect(page.getByRole("button", { name: /alpha\.md/ })).toBeVisible();

  await page.getByLabel("搜索工作区").fill("needle");
  await page.getByLabel("搜索工作区").press("Enter");
  await expect(page.getByText("找到 1 条工作区匹配结果。")).toBeVisible();

  await page.getByRole("button", { name: /needle match/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "alpha.md" })).toBeVisible();
  await expect(page.getByRole("search", { name: "文档查找" })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("Opened from workspace.");
  await page.getByLabel("检查器标签").getByRole("button", { name: "大纲" }).click();
  await expect(page.getByLabel("文档大纲").getByRole("button", { name: /Alpha/ })).toBeVisible();

  const searchCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "search_workspace"),
  );
  expect(searchCall?.args).toMatchObject({ rootPath: "/workspace", query: "needle", maxResults: 80 });
});

test("opens the workspace file context menu", async ({ page }) => {
  await page.getByRole("button", { name: "工作区" }).click();
  const fileItem = page.locator(".file-list .file-item").filter({ hasText: "notes/topic.md" }).first();
  await fileItem.dispatchEvent("contextmenu", {
    button: 2,
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY: 160,
  });
  await expect(page.getByRole("menu", { name: "文件菜单" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "重命名" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "移动到目录" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "在 Finder 中显示" })).toBeVisible();
  await page.getByRole("menuitem", { name: "打开" }).click();
  await expect(page.getByRole("tab", { name: "topic.md" })).toBeVisible();
});

test("manages folders and moves workspace files from context menus", async ({ page }) => {
  await page.getByRole("button", { name: "工作区" }).click();

  const folderItem = page.locator(".file-tree-folder").filter({ hasText: "notes" }).first();
  await folderItem.dispatchEvent("contextmenu", {
    button: 2,
    bubbles: true,
    cancelable: true,
    clientX: 140,
    clientY: 180,
  });
  await expect(page.getByRole("menu", { name: "文件夹菜单" })).toBeVisible();
  await page.getByRole("menuitem", { name: "新建文件夹" }).click();
  await page.getByLabel("文件夹名称").fill("ideas");
  await page.getByRole("dialog", { name: "新建文件夹" }).getByRole("button", { name: "创建" }).click();
  await expect(page.getByText("已创建文件夹 notes/ideas。")).toBeVisible();

  const fileItem = page.locator(".file-list .file-item").filter({ hasText: "alpha.md" }).first();
  await fileItem.dispatchEvent("contextmenu", {
    button: 2,
    bubbles: true,
    cancelable: true,
    clientX: 160,
    clientY: 220,
  });
  await page.getByRole("menuitem", { name: "移动到目录" }).click();
  await expect(page.getByRole("dialog", { name: "移动 Markdown" })).toBeVisible();
  await page.getByLabel("目标目录").fill("notes/ideas");
  await page.getByRole("dialog", { name: "移动 Markdown" }).getByRole("button", { name: "移动" }).click();
  await expect(page.getByText("已移动到 alpha.md。")).toBeVisible();

  const calls = await page.evaluate(() => window.__LMD_TEST_CALLS__);
  expect(calls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: "create_folder",
        args: expect.objectContaining({ rootPath: "/workspace", directory: "notes/ideas" }),
      }),
      expect.objectContaining({
        command: "move_markdown_file",
        args: expect.objectContaining({
          rootPath: "/workspace",
          path: "/workspace/alpha.md",
          targetDirectory: "notes/ideas",
        }),
      }),
    ]),
  );
});

test("opens workspace files in closable document tabs", async ({ page }) => {
  await page.getByRole("button", { name: "关闭 未命名" }).click();
  await expect(page.getByRole("tab", { name: "未命名" })).toHaveCount(0);
  await expect(page.getByLabel("缺省页").getByRole("heading", { name: "没有打开的笔记" })).toBeVisible();
  await expect(page.locator(".document-heading")).toHaveCount(0);

  await page.getByRole("button", { name: "工作区" }).click();

  await page.locator(".file-list .file-item").filter({ hasText: "alpha.md" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "alpha.md" })).toBeVisible();

  await page.locator(".file-list .file-item").filter({ hasText: "notes/topic.md" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "topic.md" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "topic.md" })).toBeVisible();

  await page.getByRole("tab", { name: "alpha.md" }).click();
  await expect(page.getByRole("tab", { name: "alpha.md" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "关闭 alpha.md" }).click();
  await expect(page.getByRole("tab", { name: "alpha.md" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "topic.md" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "关闭 topic.md" }).click();
  await expect(page.getByRole("tab", { name: "topic.md" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "未命名" })).toHaveCount(0);
  await expect(page.getByLabel("缺省页").getByRole("heading", { name: "没有打开的笔记" })).toBeVisible();
  await expect(page.locator(".document-heading")).toHaveCount(0);
});

test("renames tags across the workspace", async ({ page }) => {
  await page.getByRole("button", { name: "工作区" }).click();
  await page.getByText("更多").click();
  await page.getByRole("button", { name: "命令面板" }).click();
  await page.getByLabel("搜索命令").fill("重命名标签");
  await page.getByRole("button", { name: /重命名标签/ }).click();

  await expect(page.getByRole("dialog", { name: "重命名标签" })).toBeVisible();
  await page.getByLabel("原标签").fill("focus");
  await page.getByLabel("新标签").fill("deep-work");
  await page.getByRole("dialog", { name: "重命名标签" }).getByRole("button", { name: "重命名" }).click();

  await expect(page.getByText("已将 #focus 重命名为 #deep-work，更新 2 个文件、4 处。")).toBeVisible();
  const renameCall = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.find((call) => call.command === "rename_workspace_tag"),
  );
  expect(renameCall?.args).toMatchObject({
    rootPath: "/workspace",
    oldTag: "focus",
    newTag: "deep-work",
  });
});

test("creates named notes, renames files, imports attachments, and uses command palette", async ({ page }) => {
  await page.getByRole("button", { name: "工作区" }).click();

  await page.getByRole("button", { name: "新建" }).click();
  await expect(page.getByRole("dialog", { name: "新建 Markdown" })).toBeVisible();
  await page.getByLabel("文件名").fill("daily.md");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("tab", { name: "daily.md" })).toBeVisible();

  await page.getByRole("tab", { name: "daily.md" }).click({ button: "right" });
  await page.getByRole("menu", { name: "标签页菜单" }).getByRole("menuitem", { name: "重命名" }).click();
  await expect(page.getByRole("dialog", { name: "重命名 Markdown" })).toBeVisible();
  await page.getByLabel("文件名").fill("renamed.md");
  await page.getByRole("dialog", { name: "重命名 Markdown" }).getByRole("button", { name: "重命名" }).click();
  await expect(page.getByRole("tab", { name: "renamed.md" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "daily.md" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "renamed.md" })).toBeVisible();
  await expect(page.getByText("该文件已从磁盘中删除。")).toHaveCount(0);

  await page.locator(".cm-content").click();
  await page.getByText("更多").click();
  await page.getByRole("button", { name: "添加附件" }).click();
  await expect(page.locator(".cm-content")).toContainText("![diagram](../attachments/diagram.png)");

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await expect(page.getByRole("dialog", { name: "命令面板" })).toBeVisible();
  await page.getByLabel("搜索命令").fill("wiki");
  await page.getByRole("button", { name: /新建 Wiki 页面/ }).click();
  await expect(page.getByRole("dialog", { name: "新建 Wiki 页面" })).toBeVisible();
  await page.getByLabel("页面文件名").fill("概念.md");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".cm-content")).toContainText("[[概念]]");
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
  await expect(page.getByRole("tab", { name: "alpha.md" })).toBeVisible();
  await pressAppShortcut(page, "\\");
  await page.getByLabel("检查器标签").getByRole("button", { name: "知识" }).click();

  await expect(page.locator(".knowledge-link-item span").filter({ hasText: "wiki/overview.md" }).first()).toBeVisible();
  await pressAppShortcut(page, "E");
  await expect(page.locator(".document-main .markdown-preview")).toBeVisible();
  await expect(page.locator(".markdown-transclusion").filter({ hasText: "Embedded beta content." })).toBeVisible();
  await pressAppShortcut(page, "E", { shift: true });
  await expect(page.locator(".cm-content")).toBeVisible();
  const blockReferenceSection = page.locator(".knowledge-section").filter({ hasText: "块引用" }).first();
  await expect(blockReferenceSection).toBeVisible();
  await expect(blockReferenceSection.locator(".knowledge-link-item").filter({ hasText: "alpha.md#^block-alpha" })).toBeVisible();
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

  const frontmatterForm = page.locator(".frontmatter-form");
  await frontmatterForm.getByLabel("标题").fill("Alpha Note");
  await frontmatterForm.getByLabel("标签").fill("writing, focus, draft");
  await frontmatterForm.getByLabel("状态").fill("active");
  await frontmatterForm.getByRole("button", { name: "应用到笔记" }).click();

  await expect(page.getByText("Front Matter 已更新。")).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("title: Alpha Note");
  await expect(page.locator(".cm-content")).toContainText("tags: [writing, focus, draft]");
  await expect(page.locator(".cm-content")).toContainText("status: active");
});

test("builds and saves an assistant draft", async ({ page }) => {
  await page.getByRole("button", { name: "工作区" }).click();
  await page.getByText("更多").click();
  await page.getByRole("button", { name: "初始化知识库" }).click();
  await page.locator(".file-list .file-item").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".document-main .markdown-preview")).toBeVisible();
  await expect(page.locator(".editor-frame")).toBeVisible();
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
  await expect(page.getByLabel("AI 对话")).toContainText("# alpha summary");
  await expect(page.getByText("引用来源 2")).toBeVisible();
  await expect(page.getByText("Overview context excerpt.")).toBeVisible();
  await expect(page.getByText("AI 草稿已生成。")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("已请求 AI");
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("external_command / command-json-v1");
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("草稿已生成");

  await page.getByRole("button", { name: "保存为 Wiki 页面" }).click();
  await expect(page.getByText("已将 Wiki 草稿保存到 alpha-summary.md。")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "资料库分区" }).getByRole("button", { name: "收件箱" })).toHaveClass(/active/);
  await expect(page.locator(".file-list .file-item").filter({ hasText: "alpha-summary.md" })).toBeVisible();
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("草稿已保存");
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("alpha-summary.md");

  await page.getByRole("button", { name: "保存对话" }).click();
  await expect(page.getByText("已将 AI 对话保存到 alpha-summary.md。")).toBeVisible();
  await expect(page.getByRole("list", { name: "AI 助手运行日志" })).toContainText("对话已保存");

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
  const saveDraftCalls = await page.evaluate(() =>
    window.__LMD_TEST_CALLS__?.filter((call) => call.command === "save_wiki_draft"),
  );
  expect(saveDraftCalls?.some((call) => String(call.args?.title ?? "").startsWith("AI 对话"))).toBe(true);
});
