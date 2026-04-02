import { expect, test } from "@playwright/test";
import {
  addOtherTarget,
  answerExpandedTarget,
  captureScreenshot,
  openTarget,
  removeOtherTarget,
  saveJsonArtifact,
  saveTextArtifact,
  submitRepeatingGroup,
} from "./utils/repeating-group";

declare global {
  interface Window {
    __foxieRepeatingGroupEvents?: Array<{
      timestamp: string;
      label: string;
      payload: unknown;
    }>;
  }
}

test("@repeating-group-harness captures operational evidence from the proof harness", async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    consoleMessages.push(message.text());
  });

  await page.goto("/poc/repeating-group/proof.html");
  await expect(page.getByRole("heading", { name: "Repeating Group Proof" })).toBeVisible();
  await expect(page.getByTestId("response-log")).toContainText("onDisplay");

  await captureScreenshot(page, "harness", "01-initial-render");

  const firstTargetPanel = await openTarget(page, "Matti Virtanen");
  await expect(firstTargetPanel).toContainText("Rate Matti Virtanen's performance");
  await captureScreenshot(page, "harness", "02-first-target-expanded");

  await answerExpandedTarget(firstTargetPanel, 4, "Matti handled the cycle well.");
  await captureScreenshot(page, "harness", "03-first-target-answered");

  const secondTargetPanel = await openTarget(page, "Sarah Smith");
  await expect(secondTargetPanel).toContainText("Rate Sarah Smith's performance");
  await answerExpandedTarget(secondTargetPanel, 2, "Sarah needs clearer follow-up loops.");
  await captureScreenshot(page, "harness", "04-second-target-answered");

  const otherTargetPanel = await addOtherTarget(page, "External Reviewer");
  await captureScreenshot(page, "harness", "05-other-target-added");
  await answerExpandedTarget(otherTargetPanel, 5, "External reviewer delivered strong insight.");
  await captureScreenshot(page, "harness", "06-other-target-answered");

  await removeOtherTarget(page);
  await captureScreenshot(page, "harness", "07-other-target-removed");

  await submitRepeatingGroup(page);
  await expect(page.getByText("Thank you")).toBeVisible();
  await captureScreenshot(page, "harness", "08-final-state");

  const events = await page.evaluate(() => window.__foxieRepeatingGroupEvents ?? []);
  const onResponseEvents = events.filter((event) => event.label === "onResponse");
  const finalResponse = onResponseEvents.at(-1) as
    | {
        payload?: {
          data?: Record<string, string | number>;
          finished?: boolean;
        };
      }
    | undefined;

  expect(onResponseEvents.length).toBeGreaterThan(0);
  expect(finalResponse?.payload?.data).toMatchObject({
    "rg1_target-1_rating-1": 4,
    "rg1_target-1_open-1": "Matti handled the cycle well.",
    "rg1_target-2_rating-1": 2,
    "rg1_target-2_open-1": "Sarah needs clearer follow-up loops.",
  });
  expect(finalResponse?.payload?.data).not.toHaveProperty("rg1_other-1_rating-1");

  saveJsonArtifact("harness", "harness-events.json", events);
  saveJsonArtifact("harness", "harness-console.json", consoleMessages);
  saveTextArtifact("harness", "harness-output.txt", await page.getByTestId("response-log").innerText());
});
