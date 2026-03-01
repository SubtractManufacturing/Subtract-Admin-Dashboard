/**
 * Formats a tolerance input value to include the ± prefix when the value
 * is numeric. If the user types plain text (e.g., "+/-0.005"), the symbol
 * is left off. If the field is cleared, only "±" remains as a seed.
 *
 * Used identically across all tolerance inputs in the app.
 */
export function formatToleranceValue(value: string): string {
  const cleanValue = value.replace(/±/g, "");
  const hasText = /[^0-9.\-\s]/.test(cleanValue);

  if (hasText) {
    return cleanValue;
  }

  if (cleanValue.trim() === "") {
    return "±";
  }

  return "±" + cleanValue;
}

/**
 * Returns the initial value to show when a tolerance input first receives
 * focus and is currently empty.
 */
export function initToleranceOnFocus(currentValue: string): string {
  return currentValue ? currentValue : "±";
}
