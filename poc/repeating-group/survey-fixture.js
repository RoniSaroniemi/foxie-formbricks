const responseLogElement = document.getElementById("response-log");
window.__foxieRepeatingGroupEvents = [];

const logEvent = (label, payload) => {
  const formattedPayload =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  window.__foxieRepeatingGroupEvents.push({
    timestamp: new Date().toISOString(),
    label,
    payload,
  });
  responseLogElement.textContent += `\n\n[${new Date().toISOString()}] ${label}\n${formattedPayload}`;
};

const survey = {
  id: "repeating-group-proof",
  name: "Repeating Group Proof",
  type: "link",
  status: "inProgress",
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
      buttonLabel: { default: "Next" },
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
      buttonLink: "",
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
};

const styling = {
  allowStyleOverwrite: true,
  brandColor: { light: "#0f766e" },
  cardArrangement: { linkSurveys: "simple", appSurveys: "simple" },
};

window.__foxieRepeatingGroupSurveyFixture = { survey, styling };

window.formbricksSurveys.renderSurveyInline({
  survey,
  styling,
  isBrandingEnabled: false,
  languageCode: "default",
  containerId: "survey-container",
  onDisplay: async () => {
    logEvent("onDisplay", "Survey displayed");
  },
  onResponse: (response) => {
    logEvent("onResponse", response);
  },
  onFinished: () => {
    logEvent("onFinished", "Survey finished");
  },
});
