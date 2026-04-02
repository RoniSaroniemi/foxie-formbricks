import { BackButton } from "@/components/buttons/back-button";
import { SubmitButton } from "@/components/buttons/submit-button";
import { Headline } from "@/components/general/headline";
import { Subheader } from "@/components/general/subheader";
import { ScrollableContainer } from "@/components/wrappers/scrollable-container";
import { getLocalizedValue } from "@/lib/i18n";
import { getUpdatedTtc, useTtc } from "@/lib/ttc";
import { useEffect, useMemo, useState } from "preact/hooks";
import { type TResponseData, type TResponseDataUpdate, type TResponseTtc } from "@formbricks/types/responses";
import type {
  TI18nString,
  TSurveyOpenTextQuestion,
  TSurveyQuestionId,
  TSurveyRatingQuestion,
  TSurveyRepeatingGroupQuestion,
  TSurveyRepeatingGroupSubQuestion,
  TSurveyRepeatingGroupTarget,
} from "@formbricks/types/surveys/types";
import { OpenTextQuestion } from "./open-text-question";
import { RatingQuestion } from "./rating-question";

interface RepeatingGroupQuestionProps {
  question: TSurveyRepeatingGroupQuestion;
  value: TResponseData;
  onChange: (responseData: TResponseDataUpdate) => void;
  onSubmit: (data: TResponseData, ttc: TResponseTtc) => void;
  onBack: () => void;
  isFirstQuestion: boolean;
  isLastQuestion: boolean;
  languageCode: string;
  ttc: TResponseTtc;
  setTtc: (ttc: TResponseTtc) => void;
  autoFocusEnabled: boolean;
  currentQuestionId: TSurveyQuestionId;
  isBackButtonHidden: boolean;
}

const getCompositeKey = (questionId: string, targetId: string, subQuestionId: string) =>
  `${questionId}_${targetId}_${subQuestionId}`;

const replaceTemplateTags = (text: string, target: TSurveyRepeatingGroupTarget): string => {
  return text.replace(/\{\{target\.(\w+)\}\}/g, (_, key: string) => {
    if (key === "name") {
      return target.displayData?.name ?? target.name ?? "";
    }

    return target.displayData?.[key] ?? "";
  });
};

const replaceTemplateTagsInI18nString = (
  localizedValue: TI18nString | undefined,
  target: TSurveyRepeatingGroupTarget
): TI18nString | undefined => {
  if (!localizedValue) {
    return localizedValue;
  }

  return Object.fromEntries(
    Object.entries(localizedValue).map(([locale, value]) => [locale, replaceTemplateTags(value, target)])
  );
};

const getActiveResponseData = (
  value: TResponseData,
  questionId: string,
  targets: TSurveyRepeatingGroupTarget[]
): TResponseData => {
  const targetPrefixes = targets.map((target) => `${questionId}_${target.id}_`);

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => targetPrefixes.some((prefix) => key.startsWith(prefix)))
  ) as TResponseData;
};

export function RepeatingGroupQuestion({
  question,
  value,
  onChange,
  onSubmit,
  onBack,
  isFirstQuestion,
  isLastQuestion,
  languageCode,
  ttc,
  setTtc,
  currentQuestionId,
  isBackButtonHidden,
}: RepeatingGroupQuestionProps) {
  const [expandedTargetId, setExpandedTargetId] = useState<string | null>(null);
  const [targets, setTargets] = useState(question.targets);
  const [otherInputValue, setOtherInputValue] = useState("");
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [warningShown, setWarningShown] = useState(false);
  const [startTime, setStartTime] = useState(performance.now());
  const [nextOtherIndex, setNextOtherIndex] = useState(() => {
    const otherTargetIndices = question.targets
      .map((target) => {
        const match = target.id.match(/^other-(\d+)$/);
        return match ? Number(match[1]) : 0;
      })
      .filter((index) => index > 0);

    return otherTargetIndices.length > 0 ? Math.max(...otherTargetIndices) + 1 : 1;
  });
  const incomingTargetsSignature = useMemo(
    () =>
      question.targets
        .map((target) => `${target.id}:${target.name}:${target.isUnlisted ? "1" : "0"}`)
        .join("|"),
    [question.targets]
  );

  const isCurrent = question.id === currentQuestionId;
  useTtc(question.id, ttc, setTtc, startTime, setStartTime, isCurrent);

  useEffect(() => {
    const otherTargetIndices = question.targets
      .map((target) => {
        const match = target.id.match(/^other-(\d+)$/);
        return match ? Number(match[1]) : 0;
      })
      .filter((index) => index > 0);

    setTargets(question.targets);
    setExpandedTargetId(null);
    setOtherInputValue("");
    setShowOtherInput(false);
    setWarningShown(false);
    setNextOtherIndex(otherTargetIndices.length > 0 ? Math.max(...otherTargetIndices) + 1 : 1);
  }, [question.id, incomingTargetsSignature]);

  const activeResponseData = useMemo(
    () => getActiveResponseData(value, question.id, targets),
    [question.id, targets, value]
  );

  const handleSubQuestionUpdate = (data: TResponseData) => {
    onChange({ ...activeResponseData, ...data });
  };

  const handleNext = () => {
    const updatedTtc = getUpdatedTtc(ttc, question.id, performance.now() - startTime);
    setTtc(updatedTtc);
    onSubmit(activeResponseData, updatedTtc);
  };

  const handleToggleTarget = (targetId: string) => {
    setExpandedTargetId((currentTargetId) => (currentTargetId === targetId ? null : targetId));
  };

  const handleStartAddingOther = () => {
    if (targets.length >= (question.maxTargets ?? 20)) {
      setWarningShown(true);
      setShowOtherInput(false);
      return;
    }

    setWarningShown(false);
    setShowOtherInput(true);
  };

  const handleAddOther = () => {
    const trimmedValue = otherInputValue.trim();

    if (!trimmedValue) {
      return;
    }

    if (targets.length >= (question.maxTargets ?? 20)) {
      setWarningShown(true);
      setShowOtherInput(false);
      return;
    }

    const newTargetId = `other-${nextOtherIndex}`;
    const newTarget: TSurveyRepeatingGroupTarget = {
      id: newTargetId,
      name: trimmedValue,
      displayData: { name: trimmedValue },
      isUnlisted: true,
    };

    setTargets((currentTargets) => [...currentTargets, newTarget]);
    setNextOtherIndex((currentIndex) => currentIndex + 1);
    setExpandedTargetId(newTarget.id);
    setOtherInputValue("");
    setShowOtherInput(false);
    setWarningShown(false);
  };

  const handleRemoveTarget = (targetId: string) => {
    setTargets((currentTargets) =>
      currentTargets.filter((target) => !(target.id === targetId && target.isUnlisted))
    );
    setExpandedTargetId((currentTargetId) => (currentTargetId === targetId ? null : currentTargetId));
    setWarningShown(false);

    const deletedKeys = Object.keys(activeResponseData).filter((key) =>
      key.startsWith(`${question.id}_${targetId}_`)
    );

    if (deletedKeys.length === 0) {
      return;
    }

    onChange(Object.fromEntries(deletedKeys.map((key) => [key, undefined])) as TResponseDataUpdate);
  };

  const renderSubQuestion = (
    target: TSurveyRepeatingGroupTarget,
    subQuestion: TSurveyRepeatingGroupSubQuestion
  ) => {
    const compositeKey = getCompositeKey(question.id, target.id, subQuestion.id);
    const currentValue = activeResponseData[compositeKey];

    if (subQuestion.type === "rating") {
      const ratingQuestion: TSurveyRatingQuestion = {
        ...subQuestion,
        id: compositeKey as TSurveyQuestionId,
        headline: replaceTemplateTagsInI18nString(subQuestion.headline, target) ?? subQuestion.headline,
        subheader: replaceTemplateTagsInI18nString(subQuestion.subheader, target),
        lowerLabel: replaceTemplateTagsInI18nString(subQuestion.lowerLabel, target) ?? subQuestion.lowerLabel,
        upperLabel: replaceTemplateTagsInI18nString(subQuestion.upperLabel, target) ?? subQuestion.upperLabel,
        buttonLabel: replaceTemplateTagsInI18nString(subQuestion.buttonLabel, target),
        backButtonLabel: replaceTemplateTagsInI18nString(subQuestion.backButtonLabel, target),
      };

      return (
        <div key={compositeKey} className="fb-repeating-group-child fb-mb-4">
          <RatingQuestion
            question={ratingQuestion}
            value={typeof currentValue === "number" ? currentValue : undefined}
            onChange={handleSubQuestionUpdate}
            onSubmit={(data) => handleSubQuestionUpdate(data)}
            onBack={() => {}}
            isFirstQuestion={true}
            isLastQuestion={false}
            languageCode={languageCode}
            ttc={{}}
            setTtc={() => {}}
            autoFocusEnabled={false}
            currentQuestionId={compositeKey as TSurveyQuestionId}
            isBackButtonHidden={true}
          />
        </div>
      );
    }

    const openTextQuestion: TSurveyOpenTextQuestion = {
      ...subQuestion,
      id: compositeKey as TSurveyQuestionId,
      headline: replaceTemplateTagsInI18nString(subQuestion.headline, target) ?? subQuestion.headline,
      subheader: replaceTemplateTagsInI18nString(subQuestion.subheader, target),
      placeholder: replaceTemplateTagsInI18nString(subQuestion.placeholder, target),
      buttonLabel: replaceTemplateTagsInI18nString(subQuestion.buttonLabel, target),
      backButtonLabel: replaceTemplateTagsInI18nString(subQuestion.backButtonLabel, target),
    };

    return (
      <div key={compositeKey} className="fb-repeating-group-child fb-mb-4">
        <OpenTextQuestion
          question={openTextQuestion}
          value={typeof currentValue === "string" ? currentValue : ""}
          onChange={handleSubQuestionUpdate}
          onSubmit={(data) => handleSubQuestionUpdate(data)}
          onBack={() => {}}
          isFirstQuestion={true}
          isLastQuestion={false}
          languageCode={languageCode}
          ttc={{}}
          setTtc={() => {}}
          autoFocusEnabled={false}
          currentQuestionId={compositeKey as TSurveyQuestionId}
          isBackButtonHidden={true}
        />
      </div>
    );
  };

  return (
    <ScrollableContainer>
      <div className="fb-w-full" data-testid={`repeating-group-question-${question.id}`}>
        <style>{`
          .fb-repeating-group-child button {
            display: none;
          }
        `}</style>

        <Headline
          headline={getLocalizedValue(question.headline, languageCode)}
          questionId={question.id}
          required={question.required}
        />
        {question.subheader && (
          <Subheader
            subheader={getLocalizedValue(question.subheader, languageCode)}
            questionId={question.id}
          />
        )}

        <div className="fb-mt-6 fb-space-y-3" data-testid={`repeating-group-targets-${question.id}`}>
          {targets.map((target) => {
            const headerId = `${question.id}-${target.id}-header`;
            const panelId = `${question.id}-${target.id}-panel`;
            const isExpanded = expandedTargetId === target.id;

            return (
              <div
                key={target.id}
                className="fb-overflow-hidden fb-rounded-custom fb-border fb-border-border"
                data-testid={`repeating-group-target-${target.id}`}>
                <div className="fb-flex fb-items-center fb-justify-between fb-gap-2 fb-bg-white fb-px-4 fb-py-3">
                  <button
                    type="button"
                    id={headerId}
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    data-testid={`repeating-group-toggle-${target.id}`}
                    className="fb-text-heading fb-flex fb-flex-1 fb-items-center fb-justify-between fb-gap-3 fb-text-left"
                    onClick={() => handleToggleTarget(target.id)}>
                    <span>{target.name}</span>
                    <span aria-hidden="true">{isExpanded ? "▼" : "▶"}</span>
                  </button>

                  {target.isUnlisted && (
                    <button
                      type="button"
                      data-testid={`repeating-group-remove-${target.id}`}
                      className="fb-text-sm fb-font-medium fb-text-red-600"
                      onClick={() => handleRemoveTarget(target.id)}
                      aria-label={`Remove ${target.name}`}>
                      Remove
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div
                    role="region"
                    id={panelId}
                    aria-labelledby={headerId}
                    data-testid={`repeating-group-panel-${target.id}`}
                    className="fb-bg-survey-bg fb-border-t fb-border-border fb-p-4">
                    {question.subQuestions.map((subQuestion) => renderSubQuestion(target, subQuestion))}
                  </div>
                )}
              </div>
            );
          })}

          <div className="fb-rounded-custom fb-border fb-border-dashed fb-border-border fb-bg-white fb-p-4">
            {!showOtherInput ? (
              <button
                type="button"
                data-testid="repeating-group-add-other"
                className="fb-text-heading fb-w-full fb-text-left"
                onClick={handleStartAddingOther}>
                Other...
              </button>
            ) : (
              <div className="fb-space-y-3">
                <label
                  className="fb-text-sm fb-font-medium fb-text-heading"
                  htmlFor={`${question.id}-other-name`}>
                  Add an unlisted target
                </label>
                <input
                  id={`${question.id}-other-name`}
                  data-testid="repeating-group-other-input"
                  type="text"
                  value={otherInputValue}
                  onInput={(event) => setOtherInputValue(event.currentTarget.value)}
                  placeholder="Enter a name"
                  className="fb-border-border fb-rounded-custom fb-block fb-w-full fb-border fb-p-2"
                />
                <div className="fb-flex fb-gap-2">
                  <button
                    type="button"
                    data-testid="repeating-group-other-confirm"
                    className="fb-bg-brand fb-rounded-custom fb-px-3 fb-py-2 fb-text-sm fb-font-medium fb-text-on-brand"
                    onClick={handleAddOther}>
                    Add target
                  </button>
                  <button
                    type="button"
                    data-testid="repeating-group-other-cancel"
                    className="fb-rounded-custom fb-border fb-border-border fb-px-3 fb-py-2 fb-text-sm"
                    onClick={() => {
                      setShowOtherInput(false);
                      setOtherInputValue("");
                    }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {warningShown && (
              <p
                className="fb-mt-3 fb-text-sm fb-font-medium fb-text-red-600"
                data-testid="repeating-group-max-warning">
                Maximum of {question.maxTargets ?? 20} evaluation targets reached.
              </p>
            )}
          </div>
        </div>

        <div className="fb-flex fb-w-full fb-flex-row-reverse fb-justify-between fb-pt-6">
          <SubmitButton
            buttonLabel={getLocalizedValue(question.buttonLabel, languageCode)}
            isLastQuestion={isLastQuestion}
            onClick={handleNext}
          />

          {!isFirstQuestion && !isBackButtonHidden && (
            <BackButton
              backButtonLabel={getLocalizedValue(question.backButtonLabel, languageCode)}
              onClick={() => {
                const updatedTtc = getUpdatedTtc(ttc, question.id, performance.now() - startTime);
                setTtc(updatedTtc);
                onBack();
              }}
            />
          )}
        </div>
      </div>
    </ScrollableContainer>
  );
}
