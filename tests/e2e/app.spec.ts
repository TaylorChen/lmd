import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
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
