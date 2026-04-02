import { type APIRequestContext, expect } from "@playwright/test";
import { RESPONSES_API_URL, SURVEYS_API_URL } from "./api/constants";
import { test } from "./lib/fixtures";
import { loginAndGetApiKey } from "./lib/utils";
import {
  addOtherTarget,
  answerExpandedTarget,
  captureScreenshot,
  openTarget,
  removeOtherTarget,
  saveJsonArtifact,
  submitRepeatingGroup,
} from "./utils/repeating-group";

const buildSurveyPayload = (environmentId: string) => ({
  environmentId,
  type: "link",
  status: "inProgress",
  name: "Repeating Group Operational Verification",
  welcomeCard: {
    enabled: false,
    headline: { default: "" },
    html: { default: "" },
    buttonLabel: { default: "Start" },
    timeToFinish: false,
    showResponseCount: false,
  },
  questions: [
    {
      id: "rg1",
      type: "repeatingGroup",
      headline: { default: "How have these team members performed?" },
      subheader: { default: "Expand each row and answer the repeated question set." },
      required: false,
      buttonLabel: { default: "Finish" },
      backButtonLabel: { default: "Back" },
      maxTargets: 5,
      targets: [
        {
          id: "target-1",
          name: "Matti Virtanen",
          displayData: { name: "Matti Virtanen", role: "Lead Developer" },
          isUnlisted: false,
        },
        {
          id: "target-2",
          name: "Sarah Smith",
          displayData: { name: "Sarah Smith", role: "Customer Success Manager" },
          isUnlisted: false,
        },
      ],
      subQuestions: [
        {
          id: "rating-1",
          type: "rating",
          headline: { default: "Rate {{target.name}}'s performance" },
          subheader: { default: "Consider the expectations for {{target.name}} in this cycle." },
          required: false,
          scale: "number",
          range: 5,
          lowerLabel: { default: "Poor" },
          upperLabel: { default: "Excellent" },
          buttonLabel: { default: "Next" },
          backButtonLabel: { default: "Back" },
          isColorCodingEnabled: false,
        },
        {
          id: "open-1",
          type: "openText",
          headline: { default: "Any comments about {{target.name}}?" },
          subheader: { default: "Share strengths, risks, or suggested improvements." },
          placeholder: { default: "Write feedback for {{target.name}}" },
          inputType: "text",
          required: false,
          buttonLabel: { default: "Next" },
          backButtonLabel: { default: "Back" },
          longAnswer: true,
        },
      ],
    },
  ],
  endings: [
    {
      id: "end1",
      type: "endScreen",
      headline: { default: "Thank you" },
      subheader: { default: "Your repeating group answers were captured." },
      buttonLabel: { default: "Close" },
      buttonLink: "https://example.com/close",
    },
  ],
  hiddenFields: {
    enabled: false,
    fieldIds: [],
  },
  languages: [],
  variables: [],
  showLanguageSwitch: false,
  isBackButtonHidden: false,
  recaptcha: {
    enabled: false,
    threshold: 0.5,
  },
});

const getPersistedFinishedResponse = async (request: APIRequestContext, apiKey: string, surveyId: string) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await request.get(`${RESPONSES_API_URL}?surveyId=${surveyId}`, {
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
    });

    if (!response.ok()) {
      throw new Error(`Failed to fetch persisted responses for ${surveyId}: ${response.status()}`);
    }

    const responseBody = await response.json();
    const finishedResponse = responseBody.data.find((entry: { finished: boolean }) => entry.finished);

    if (finishedResponse) {
      return finishedResponse;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Timed out waiting for a finished persisted response for survey ${surveyId}`);
};

test("@repeating-group-real creates a real survey and captures operational evidence", async ({
  page,
  users,
  request,
}) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    consoleMessages.push(message.text());
  });

  const { environmentId, apiKey } = await loginAndGetApiKey(page, users);
  const createSurveyResponse = await request.post(SURVEYS_API_URL, {
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    data: buildSurveyPayload(environmentId),
  });

  const createSurveyStatus = createSurveyResponse.status();
  const createSurveyRawBody = await createSurveyResponse.text();
  saveJsonArtifact("real", "real-survey-create-response.json", {
    status: createSurveyStatus,
    body: createSurveyRawBody,
  });
  expect(
    createSurveyResponse.ok(),
    `Survey creation failed with status ${createSurveyStatus}: ${createSurveyRawBody}`
  ).toBeTruthy();
  const createSurveyBody = JSON.parse(createSurveyRawBody);
  const surveyId = createSurveyBody.data.id as string;
  const surveyUrl = `/s/${surveyId}`;
  saveJsonArtifact("real", "real-survey-created.json", {
    surveyId,
    environmentId,
    surveyUrl,
  });

  await page.goto(surveyUrl);
  await expect(page.locator('[data-testid^="repeating-group-question-"]').first()).toBeVisible();
  await captureScreenshot(page, "real", "01-real-survey-initial-render");

  const firstTargetPanel = await openTarget(page, "Matti Virtanen");
  await expect(firstTargetPanel.getByText("Rate Matti Virtanen's performance")).toBeVisible();
  await answerExpandedTarget(firstTargetPanel, 4, "Matti runtime answer.");
  await captureScreenshot(page, "real", "02-real-survey-first-target");

  const secondTargetPanel = await openTarget(page, "Sarah Smith");
  await expect(secondTargetPanel.getByText("Rate Sarah Smith's performance")).toBeVisible();
  await answerExpandedTarget(secondTargetPanel, 2, "Sarah runtime answer.");
  await captureScreenshot(page, "real", "03-real-survey-second-target");

  const otherTargetPanel = await addOtherTarget(page, "Operational Witness");
  await answerExpandedTarget(otherTargetPanel, 5, "Operational witness runtime answer.");
  await captureScreenshot(page, "real", "04-real-survey-other-target");

  await removeOtherTarget(page);
  await captureScreenshot(page, "real", "05-real-survey-other-removed");

  await submitRepeatingGroup(page);
  await expect(page.getByText("Thank you")).toBeVisible();
  await captureScreenshot(page, "real", "06-real-survey-final-state");

  const persistedResponse = await getPersistedFinishedResponse(request, apiKey, surveyId);

  expect(persistedResponse.data).toMatchObject({
    "rg1_target-1_rating-1": 4,
    "rg1_target-1_open-1": "Matti runtime answer.",
    "rg1_target-2_rating-1": 2,
    "rg1_target-2_open-1": "Sarah runtime answer.",
  });
  expect(persistedResponse.data).not.toHaveProperty("rg1_other-1_rating-1");
  expect(persistedResponse.data).not.toHaveProperty("rg1_other-1_open-1");

  saveJsonArtifact("real", "real-survey-console.json", consoleMessages);
  saveJsonArtifact("real", "real-survey-output.json", persistedResponse);
});
