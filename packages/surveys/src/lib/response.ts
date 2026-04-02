import {
  type TResponseData,
  type TResponseDataUpdate,
  type TResponseDataValue,
} from "@formbricks/types/responses";

export const processResponseData = (responseData: TResponseDataValue | undefined): string => {
  switch (typeof responseData) {
    case "string":
      return responseData;

    case "number":
      return responseData.toString();

    case "object":
      if (Array.isArray(responseData)) {
        responseData = responseData
          .filter((item) => item !== null && item !== undefined && item !== "")
          .join("; ");
        return responseData;
      } else {
        const formattedString = Object.entries(responseData)
          .filter(([_, value]) => value !== "")
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n");
        return formattedString;
      }

    default:
      return "";
  }
};

export const applyResponseDataUpdate = (
  responseData: TResponseData,
  responseDataUpdate: TResponseDataUpdate
): TResponseData => {
  const updatedResponseData = { ...responseData };

  for (const [key, value] of Object.entries(responseDataUpdate)) {
    if (value === undefined) {
      delete updatedResponseData[key];
    } else {
      updatedResponseData[key] = value;
    }
  }

  return updatedResponseData;
};

export const getPrefixedResponseData = (responseData: TResponseData, prefix: string): TResponseData => {
  return Object.fromEntries(
    Object.entries(responseData).filter(([key]) => key.startsWith(prefix))
  ) as TResponseData;
};
