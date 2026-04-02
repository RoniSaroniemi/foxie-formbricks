import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TSurveyQuestionTypeEnum, type TSurveyRepeatingGroupQuestion } from "@formbricks/types/surveys/types";
import { RepeatingGroupQuestion } from "./repeating-group-question";

const mockGetUpdatedTtc = vi.fn().mockReturnValue({ rg1: 500 });
const mockUseTtc = vi.fn();
const mockRatingQuestion = vi.fn();
const mockOpenTextQuestion = vi.fn();

vi.mock("@/components/buttons/back-button", () => ({
  BackButton: ({ onClick, backButtonLabel }: any) => (
    <button data-testid="back-button" onClick={onClick}>
      {backButtonLabel}
    </button>
  ),
}));

vi.mock("@/components/buttons/submit-button", () => ({
  SubmitButton: ({ onClick, buttonLabel }: any) => (
    <button data-testid="submit-button" onClick={onClick}>
      {buttonLabel ?? "Next"}
    </button>
  ),
}));

vi.mock("@/components/general/headline", () => ({
  Headline: ({ headline }: any) => <div data-testid="headline">{headline}</div>,
}));

vi.mock("@/components/general/subheader", () => ({
  Subheader: ({ subheader }: any) => <div data-testid="subheader">{subheader}</div>,
}));

vi.mock("@/components/wrappers/scrollable-container", () => ({
  ScrollableContainer: ({ children }: any) => <div data-testid="scrollable-container">{children}</div>,
}));

vi.mock("@/lib/i18n", () => ({
  getLocalizedValue: (value: any) => (typeof value === "string" ? value : (value?.default ?? "")),
}));

vi.mock("@/lib/ttc", () => ({
  getUpdatedTtc: (...args: any[]) => mockGetUpdatedTtc(...args),
  useTtc: (...args: any[]) => mockUseTtc(...args),
}));

vi.mock("./rating-question", () => ({
  RatingQuestion: (props: any) => {
    mockRatingQuestion(props);
    return (
      <div data-testid={`rating-${props.question.id}`}>
        <span>{props.question.headline.default}</span>
        <button onClick={() => props.onChange({ [props.question.id]: 5 })}>Answer rating</button>
      </div>
    );
  },
}));

vi.mock("./open-text-question", () => ({
  OpenTextQuestion: (props: any) => {
    mockOpenTextQuestion(props);
    return (
      <div data-testid={`open-text-${props.question.id}`}>
        <span>{props.question.headline.default}</span>
        <button onClick={() => props.onChange({ [props.question.id]: "Detailed feedback" })}>
          Answer open text
        </button>
      </div>
    );
  },
}));

describe("RepeatingGroupQuestion", () => {
  const mockOnChange = vi.fn();
  const mockOnSubmit = vi.fn();
  const mockOnBack = vi.fn();
  const mockSetTtc = vi.fn();

  const baseQuestion: TSurveyRepeatingGroupQuestion = {
    id: "rg1",
    type: TSurveyQuestionTypeEnum.RepeatingGroup,
    headline: { default: "Evaluate each team member" },
    subheader: { default: "Open a row to answer repeated questions." },
    required: false,
    buttonLabel: { default: "Next" },
    backButtonLabel: { default: "Back" },
    targets: [
      { id: "target-1", name: "Matti Virtanen", displayData: { name: "Matti Virtanen" }, isUnlisted: false },
      { id: "target-2", name: "Sarah Smith", displayData: { name: "Sarah Smith" }, isUnlisted: false },
    ],
    subQuestions: [
      {
        id: "rating-1",
        type: TSurveyQuestionTypeEnum.Rating,
        headline: { default: "Rate {{target.name}}" },
        subheader: { default: "How did {{target.name}} perform?" },
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
        type: TSurveyQuestionTypeEnum.OpenText,
        headline: { default: "Share feedback for {{target.name}}" },
        subheader: { default: "Any notes?" },
        inputType: "text",
        placeholder: { default: "Type feedback for {{target.name}}" },
        required: false,
        buttonLabel: { default: "Next" },
        backButtonLabel: { default: "Back" },
        longAnswer: false,
        charLimit: { enabled: false },
      },
    ],
    maxTargets: 3,
  };

  const baseProps = {
    question: baseQuestion,
    value: {},
    onChange: mockOnChange,
    onSubmit: mockOnSubmit,
    onBack: mockOnBack,
    isFirstQuestion: false,
    isLastQuestion: false,
    languageCode: "default",
    ttc: {},
    setTtc: mockSetTtc,
    autoFocusEnabled: false,
    currentQuestionId: "rg1",
    isBackButtonHidden: false,
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUpdatedTtc.mockReturnValue({ rg1: 500 });
  });

  afterEach(() => {
    cleanup();
  });

  test("renders the repeating group shell with target rows", () => {
    render(<RepeatingGroupQuestion {...baseProps} />);

    expect(screen.getByTestId("headline")).toHaveTextContent("Evaluate each team member");
    expect(screen.getByTestId("subheader")).toHaveTextContent("Open a row to answer repeated questions.");
    expect(screen.getByRole("button", { name: /matti virtanen/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sarah smith/i })).toBeInTheDocument();
  });

  test("expands a target row and renders standalone sub-questions with composite ids", async () => {
    const user = userEvent.setup();
    render(<RepeatingGroupQuestion {...baseProps} />);

    await user.click(screen.getByRole("button", { name: /matti virtanen/i }));

    expect(screen.getByTestId("rating-rg1_target-1_rating-1")).toBeInTheDocument();
    expect(screen.getByTestId("open-text-rg1_target-1_open-1")).toBeInTheDocument();
    expect(screen.getByText("Rate Matti Virtanen")).toBeInTheDocument();
    expect(screen.getByText("Share feedback for Matti Virtanen")).toBeInTheDocument();
  });

  test("merges composite-key child answers into the repeating group response map", async () => {
    const user = userEvent.setup();
    render(<RepeatingGroupQuestion {...baseProps} value={{ "rg1_target-1_open-1": "Existing feedback" }} />);

    await user.click(screen.getByRole("button", { name: /matti virtanen/i }));
    await user.click(screen.getByTestId("rating-rg1_target-1_rating-1").querySelector("button")!);

    expect(mockOnChange).toHaveBeenCalledWith({
      "rg1_target-1_open-1": "Existing feedback",
      "rg1_target-1_rating-1": 5,
    });
  });

  test("submits only active repeating-group answers and updates TTC", async () => {
    const user = userEvent.setup();
    render(
      <RepeatingGroupQuestion
        {...baseProps}
        value={{
          "rg1_target-1_rating-1": 4,
          "rg1_target-1_open-1": "Strong collaboration",
          q2: "unrelated answer",
        }}
      />
    );

    await user.click(screen.getByTestId("submit-button"));

    expect(mockSetTtc).toHaveBeenCalledWith({ rg1: 500 });
    expect(mockOnSubmit).toHaveBeenCalledWith(
      {
        "rg1_target-1_rating-1": 4,
        "rg1_target-1_open-1": "Strong collaboration",
      },
      { rg1: 500 }
    );
  });

  test("adds an unlisted target with deterministic ids", async () => {
    const user = userEvent.setup();
    render(<RepeatingGroupQuestion {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Other..." }));
    await user.type(screen.getByLabelText("Add an unlisted target"), "New Target");
    await user.click(screen.getByRole("button", { name: "Add target" }));

    expect(screen.getByTestId("rating-rg1_other-1_rating-1")).toBeInTheDocument();
    expect(screen.getByTestId("open-text-rg1_other-1_open-1")).toBeInTheDocument();
  });

  test("removes unlisted target rows and emits deletion updates for their keys", async () => {
    const user = userEvent.setup();
    const questionWithUnlistedTarget = {
      ...baseQuestion,
      targets: [
        ...baseQuestion.targets,
        {
          id: "other-1",
          name: "Temporary Person",
          displayData: { name: "Temporary Person" },
          isUnlisted: true,
        },
      ],
    };

    render(
      <RepeatingGroupQuestion
        {...baseProps}
        question={questionWithUnlistedTarget}
        value={{
          "rg1_other-1_rating-1": 3,
          "rg1_other-1_open-1": "Temporary notes",
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Remove Temporary Person" }));

    expect(mockOnChange).toHaveBeenCalledWith({
      "rg1_other-1_rating-1": undefined,
      "rg1_other-1_open-1": undefined,
    });
    expect(screen.queryByRole("button", { name: /temporary person/i })).not.toBeInTheDocument();
  });

  test("shows a warning when the max target limit is reached", async () => {
    const user = userEvent.setup();
    render(<RepeatingGroupQuestion {...baseProps} question={{ ...baseQuestion, maxTargets: 2 }} />);

    await user.click(screen.getByRole("button", { name: "Other..." }));

    expect(screen.getByText("Maximum of 2 evaluation targets reached.")).toBeInTheDocument();
  });
});
