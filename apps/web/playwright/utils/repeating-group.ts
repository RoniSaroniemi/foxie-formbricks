import { type Locator, type Page, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export type VerificationMode = "harness" | "real";

const evidenceRoot = path.join(process.cwd(), "evidence", "track-2b");

const ensureDir = (dirPath: string) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const sanitizeFileName = (fileName: string) => fileName.replace(/[^a-zA-Z0-9-_]/g, "-");

export const getEvidenceDir = (mode: VerificationMode) => {
  const dirPath = path.join(evidenceRoot, "screenshots", mode);
  ensureDir(dirPath);
  return dirPath;
};

export const getArtifactPath = (mode: VerificationMode, fileName: string) => {
  ensureDir(evidenceRoot);
  return path.join(evidenceRoot, fileName.replace("{mode}", mode));
};

export const saveJsonArtifact = (mode: VerificationMode, fileName: string, data: unknown) => {
  const artifactPath = getArtifactPath(mode, fileName);
  ensureDir(path.dirname(artifactPath));
  fs.writeFileSync(artifactPath, JSON.stringify(data, null, 2));
};

export const saveTextArtifact = (mode: VerificationMode, fileName: string, contents: string) => {
  const artifactPath = getArtifactPath(mode, fileName);
  ensureDir(path.dirname(artifactPath));
  fs.writeFileSync(artifactPath, contents);
};

export const captureScreenshot = async (page: Page, mode: VerificationMode, fileName: string) => {
  const screenshotPath = path.join(getEvidenceDir(mode), `${sanitizeFileName(fileName)}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const getTargetToggle = (page: Page, targetLabel: string) =>
  page.getByRole("button", { name: new RegExp(`^${escapeRegExp(targetLabel)}\\b`) }).first();

export const openTarget = async (page: Page, targetLabel: string): Promise<Locator> => {
  await getTargetToggle(page, targetLabel).click();
  const panel = page.locator('[data-testid^="repeating-group-panel-"]').last();
  await expect(panel).toBeVisible();
  return panel;
};

export const answerExpandedTarget = async (panel: Locator, ratingValue: number, textValue: string) => {
  await panel
    .locator("label")
    .filter({ hasText: new RegExp(`^${ratingValue}$`) })
    .first()
    .click();
  const textInput = panel.locator("textarea, input[type='text']").first();
  await expect(textInput).toBeVisible();
  await textInput.fill(textValue);
};

export const addOtherTarget = async (page: Page, targetName: string) => {
  await page.getByTestId("repeating-group-add-other").click();
  await expect(page.getByTestId("repeating-group-other-input")).toBeVisible();
  await page.getByTestId("repeating-group-other-input").fill(targetName);
  await page.getByTestId("repeating-group-other-confirm").click();
  const panel = page.getByTestId("repeating-group-panel-other-1");
  await expect(panel).toBeVisible();
  return panel;
};

export const removeOtherTarget = async (page: Page) => {
  await page.getByTestId("repeating-group-remove-other-1").click();
  await expect(page.getByTestId("repeating-group-target-other-1")).toHaveCount(0);
};

export const submitRepeatingGroup = async (page: Page) => {
  await page.getByRole("button", { name: /^(Next|Finish)$/ }).click();
};
