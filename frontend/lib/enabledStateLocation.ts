import type { AvailableState } from "../app/_Api";

export const findAvailableState = (states: AvailableState[], code: string) =>
  states.find((state) => state.code === String(code || "").trim().toUpperCase()) || null;

export const predictionMatchesState = (
  prediction: any,
  state: AvailableState | null,
): boolean => {
  if (!state) return false;
  const text = [
    prediction?.description,
    prediction?.structured_formatting?.secondary_text,
  ]
    .filter(Boolean)
    .join(", ");
  const escapedName = state.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedCode = state.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return (
    new RegExp(`(^|,|\\s)${escapedName}(?=,|\\s|$)`, "i").test(text) ||
    new RegExp(`(^|,|\\s)${escapedCode}(?=,|\\s|$)`, "i").test(text)
  );
};

export const addressComponentsMatchState = (
  components: any[],
  state: AvailableState | null,
): boolean => {
  if (!state) return false;
  const region = components.find(
    (item: any) =>
      Array.isArray(item?.types) && item.types.includes("administrative_area_level_1"),
  );
  const longName = String(region?.long_name || "").trim().toLowerCase();
  const shortName = String(region?.short_name || "").trim().toUpperCase();
  return longName === state.name.toLowerCase() || shortName === state.code;
};
