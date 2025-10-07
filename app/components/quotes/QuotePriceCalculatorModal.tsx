import { useState, useEffect, useCallback, useRef } from "react";
import type {
  QuotePart,
  QuoteLineItem,
  QuotePriceCalculation,
} from "~/lib/db/schema";

interface QuotePriceCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  quoteParts: QuotePart[];
  quoteLineItems: QuoteLineItem[];
  quoteId: number;
  onSave: (calculation: Record<string, unknown>) => void;
  currentPartIndex?: number;
  onPartChange?: (index: number) => void;
  existingCalculations?: QuotePriceCalculation[];
}

const LEAD_TIME_OPTIONS = [
  { label: "3-5 Business Days", value: "3-5 Days", multiplier: 2.0 },
  { label: "5-7 Business Days", value: "5-7 Days", multiplier: 1.5 },
  { label: "7-12 Business Days", value: "7-12 Days", multiplier: 1.0 },
];

const THREAD_SIZES = {
  small: { label: "Small (< M3)", defaultRate: 0.9 },
  medium: { label: "Medium (M4-M8)", defaultRate: 0.75 },
  large: { label: "Large (> M8)", defaultRate: 1.1 },
};

export default function QuotePriceCalculatorModal({
  isOpen,
  onClose,
  quoteParts,
  quoteLineItems,
  quoteId,
  onSave,
  currentPartIndex = 0,
  onPartChange,
  existingCalculations = [],
}: QuotePriceCalculatorModalProps) {
  const [partIndex, setPartIndex] = useState(currentPartIndex);
  const modalContentRef = useRef<HTMLDivElement>(null);

  // Reset to first part when modal opens
  useEffect(() => {
    if (isOpen) {
      setPartIndex(currentPartIndex);
    }
  }, [isOpen, currentPartIndex]);

  // Lock body scroll when modal is open and focus modal
  useEffect(() => {
    if (isOpen) {
      // Store original body style
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = "hidden";

      // Focus the modal content to enable keyboard events
      setTimeout(() => {
        modalContentRef.current?.focus();
      }, 100);

      // Cleanup function to restore scroll
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [isOpen]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  const currentPart = quoteParts[partIndex];
  const currentLineItem = quoteLineItems.find(
    (li) => li.quotePartId === currentPart?.id
  );

  // Find existing calculation for current part
  const existingCalculation = existingCalculations.find(
    (calc) =>
      calc.quotePartId === currentPart?.id ||
      (currentLineItem && calc.quoteLineItemId === currentLineItem.id)
  );

  // Form state
  const [toolpathGrandTotal, setToolpathGrandTotal] = useState("");
  const [leadTimeOption, setLeadTimeOption] = useState("7-12 Days");
  const [threadCounts, setThreadCounts] = useState({
    small: "",
    medium: "",
    large: "",
  });
  const [threadRates, setThreadRates] = useState({
    small: THREAD_SIZES.small.defaultRate,
    medium: THREAD_SIZES.medium.defaultRate,
    large: THREAD_SIZES.large.defaultRate,
  });
  const [complexityMultiplier, setComplexityMultiplier] = useState(2.15);
  const [toleranceMultiplier, setToleranceMultiplier] = useState(1.0);
  const [toolingCost, setToolingCost] = useState("");
  const [showTooling, setShowTooling] = useState(false);
  const [editingThreadRates, setEditingThreadRates] = useState(false);
  const [editingLeadTimes, setEditingLeadTimes] = useState(false);
  const [leadTimeMultipliers, setLeadTimeMultipliers] = useState({
    "3-5 Days": 2.0,
    "5-7 Days": 1.5,
    "7-12 Days": 1.0,
  });
  const [notes, setNotes] = useState("");

  // Reset form function
  const resetForm = useCallback(() => {
    setToolpathGrandTotal("");
    setLeadTimeOption("7-12 Days");
    setThreadCounts({ small: "", medium: "", large: "" });
    setThreadRates({
      small: THREAD_SIZES.small.defaultRate,
      medium: THREAD_SIZES.medium.defaultRate,
      large: THREAD_SIZES.large.defaultRate,
    });
    setLeadTimeMultipliers({
      "3-5 Days": 2.0,
      "5-7 Days": 1.5,
      "7-12 Days": 1.0,
    });
    setComplexityMultiplier(2.15);
    setToleranceMultiplier(1.0);
    setToolingCost("");
    setShowTooling(false);
    setNotes("");
    setEditingThreadRates(false);
    setEditingLeadTimes(false);
  }, []);

  // Load existing calculation or set defaults when part changes
  useEffect(() => {
    if (existingCalculation) {
      // Load existing calculation values
      setToolpathGrandTotal(existingCalculation.toolpathGrandTotal || "");
      setLeadTimeOption(existingCalculation.leadTimeOption || "7-12 Days");
      // If there's a saved leadTimeMultiplier, update the state for that option
      if (existingCalculation.leadTimeMultiplier && existingCalculation.leadTimeOption) {
        setLeadTimeMultipliers(prev => ({
          ...prev,
          [existingCalculation.leadTimeOption]: existingCalculation.leadTimeMultiplier
        }));
      }
      setThreadCounts({
        small: existingCalculation.smallThreadCount?.toString() || "",
        medium: existingCalculation.mediumThreadCount?.toString() || "",
        large: existingCalculation.largeThreadCount?.toString() || "",
      });
      setThreadRates({
        small: parseFloat(existingCalculation.smallThreadRate || "0.90"),
        medium: parseFloat(existingCalculation.mediumThreadRate || "0.75"),
        large: parseFloat(existingCalculation.largeThreadRate || "1.10"),
      });
      setComplexityMultiplier(
        parseFloat(existingCalculation.complexityMultiplier || "2.15")
      );
      setToleranceMultiplier(
        parseFloat(existingCalculation.toleranceMultiplier || "1.0")
      );
      setToolingCost(existingCalculation.toolingCost || "");
      setShowTooling(!!existingCalculation.toolingCost);
      setNotes(existingCalculation.notes || "");
    } else if (currentPart) {
      // Reset to defaults for new calculation
      resetForm();

      // Set default tolerance multiplier based on part tolerance
      if (currentPart.tolerance) {
        const tolerance = parseFloat(currentPart.tolerance);
        let defaultMultiplier = 1.0;

        if (tolerance >= 0.01) {
          defaultMultiplier = 0.75;
        } else if (tolerance >= 0.005) {
          defaultMultiplier = 1.0;
        } else if (tolerance >= 0.003) {
          defaultMultiplier = 1.2;
        } else {
          defaultMultiplier = 1.5;
        }

        setToleranceMultiplier(defaultMultiplier);
      }
    }
  }, [currentPart, existingCalculation, resetForm]);

  // Calculate prices
  const calculatePrices = useCallback(() => {
    const toolpath = parseFloat(toolpathGrandTotal) || 0;
    const leadMultiplier = leadTimeMultipliers[leadTimeOption as keyof typeof leadTimeMultipliers] || 1.0;

    // Calculate thread costs
    const threadCost =
      (parseInt(threadCounts.small) || 0) * threadRates.small +
      (parseInt(threadCounts.medium) || 0) * threadRates.medium +
      (parseInt(threadCounts.large) || 0) * threadRates.large;

    // Calculate tooling markup
    const tooling = showTooling ? (parseFloat(toolingCost) || 0) : 0;
    const toolingMarkup = tooling * 1.5;

    // Calculate prices
    const basePrice = toolpath + threadCost;
    const adjustedPrice =
      basePrice * leadMultiplier * complexityMultiplier * toleranceMultiplier;
    const finalPrice = adjustedPrice + toolingMarkup; // Add tooling after multipliers

    return {
      basePrice,
      adjustedPrice,
      finalPrice,
      threadCost,
      toolingMarkup,
      leadMultiplier,
    };
  }, [
    toolpathGrandTotal,
    leadTimeOption,
    leadTimeMultipliers,
    threadCounts,
    threadRates,
    complexityMultiplier,
    toleranceMultiplier,
    showTooling,
    toolingCost,
  ]);

  const prices = calculatePrices();

  const handleSave = () => {
    const calculation = {
      quoteId,
      quotePartId: currentPart?.id,
      quoteLineItemId: currentLineItem?.id,
      toolpathGrandTotal: parseFloat(toolpathGrandTotal) || 0,
      leadTimeOption,
      leadTimeMultiplier: leadTimeMultipliers[leadTimeOption as keyof typeof leadTimeMultipliers] || 1.0,
      smallThreadCount: parseInt(threadCounts.small) || 0,
      smallThreadRate: threadRates.small,
      mediumThreadCount: parseInt(threadCounts.medium) || 0,
      mediumThreadRate: threadRates.medium,
      largeThreadCount: parseInt(threadCounts.large) || 0,
      largeThreadRate: threadRates.large,
      totalThreadCost: prices.threadCost,
      complexityMultiplier,
      toleranceMultiplier,
      toolingCost: showTooling ? (parseFloat(toolingCost) || null) : null,
      toolingMarkup: showTooling ? (prices.toolingMarkup || null) : null,
      basePrice: prices.basePrice,
      adjustedPrice: prices.adjustedPrice,
      finalPrice: prices.finalPrice,
      notes,
    };

    onSave(calculation);
  };

  const handleNextPart = () => {
    handleSave();
    if (partIndex < quoteParts.length - 1) {
      const newIndex = partIndex + 1;
      setPartIndex(newIndex);
      onPartChange?.(newIndex);
      // Form will be reset or populated by the useEffect
    }
  };

  // Handle Enter key to save and close
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && e.target instanceof HTMLElement) {
      // Don't trigger on textarea (which allows Enter for new lines)
      if (e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        if (toolpathGrandTotal) {
          handleSave();
          onClose();
        }
      }
    }
  };

  // Handle backdrop click to close modal
  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if clicking the backdrop itself, not the modal content
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
      role="presentation"
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={modalContentRef}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Quote Price Calculator
              </h2>
              {currentPart && (
                <div className="mt-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Part {partIndex + 1} of {quoteParts.length}
                  </p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {currentPart.partName}
                  </p>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Base Cost Input */}
          <div>
            <label htmlFor="toolpath-grand-total" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Toolpath Grand Total
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                $
              </span>
              <input
                id="toolpath-grand-total"
                type="number"
                value={toolpathGrandTotal}
                onChange={(e) => setToolpathGrandTotal(e.target.value)}
                className="pl-8 w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                placeholder="0.00"
                step="0.01"
              />
            </div>
          </div>

          {/* Lead Time Selection */}
          <fieldset>
            <div className="flex justify-between items-center mb-2">
              <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Lead Time
              </legend>
              <button
                type="button"
                onClick={() => setEditingLeadTimes(!editingLeadTimes)}
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                {editingLeadTimes ? "Done" : "Edit Multipliers"}
              </button>
            </div>
            <div className="space-y-2">
              {LEAD_TIME_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center justify-between">
                  <div className="flex items-center">
                    <input
                      type="radio"
                      value={option.value}
                      checked={leadTimeOption === option.value}
                      onChange={(e) => setLeadTimeOption(e.target.value)}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {option.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {editingLeadTimes ? (
                      <>
                        <input
                          type="number"
                          value={leadTimeMultipliers[option.value as keyof typeof leadTimeMultipliers]}
                          onChange={(e) => setLeadTimeMultipliers({
                            ...leadTimeMultipliers,
                            [option.value]: parseFloat(e.target.value) || 0
                          })}
                          className="w-16 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-center"
                          step="0.1"
                          min="0"
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-400">x</span>
                      </>
                    ) : (
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        ({leadTimeMultipliers[option.value as keyof typeof leadTimeMultipliers]}x)
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Thread Specifications */}
          <fieldset>
            <div className="flex justify-between items-center mb-2">
              <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Thread Specifications
              </legend>
              <button
                type="button"
                onClick={() => setEditingThreadRates(!editingThreadRates)}
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                {editingThreadRates ? "Done" : "Edit Rates"}
              </button>
            </div>
            <div className="space-y-2">
              {Object.entries(THREAD_SIZES).map(([size, config]) => (
                <div key={size} className="flex items-center justify-between">
                  <div className="flex-1">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {config.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={threadCounts[size as keyof typeof threadCounts]}
                      onChange={(e) =>
                        setThreadCounts({
                          ...threadCounts,
                          [size]: e.target.value,
                        })
                      }
                      className="w-14 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-center"
                      placeholder="0"
                      min="0"
                    />
                    <span className="text-sm text-gray-500 dark:text-gray-400">×</span>
                    {editingThreadRates ? (
                      <div className="flex items-center">
                        <span className="text-gray-500 text-sm">$</span>
                        <input
                          type="number"
                          value={threadRates[size as keyof typeof threadRates]}
                          onChange={(e) =>
                            setThreadRates({
                              ...threadRates,
                              [size]: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-14 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-center"
                          step="0.01"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        ${threadRates[size as keyof typeof threadRates].toFixed(2)}
                      </span>
                    )}
                    <span className="text-sm text-gray-500 dark:text-gray-400 mx-1">=</span>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-14 text-right">
                      ${(
                        (parseInt(threadCounts[size as keyof typeof threadCounts]) || 0) *
                        threadRates[size as keyof typeof threadRates]
                      ).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </fieldset>

          {/* Complexity Slider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Complexity Multiplier: {complexityMultiplier.toFixed(2)}x
            </label>
            <input
              type="range"
              min="1.15"
              max="3.15"
              step="0.05"
              value={complexityMultiplier}
              onChange={(e) =>
                setComplexityMultiplier(parseFloat(e.target.value))
              }
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>Simple (1.15x)</span>
              <span>Standard (2.15x)</span>
              <span>Complex (3.15x)</span>
            </div>
          </div>

          {/* Tolerance Slider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Tolerance Multiplier: {toleranceMultiplier.toFixed(2)}x
              {currentPart?.tolerance && (
                <span className="ml-2 text-xs text-gray-500">
                  (Part tolerance: {currentPart.tolerance}&quot;)
                </span>
              )}
            </label>
            <input
              type="range"
              min="0.75"
              max="2.0"
              step="0.05"
              value={toleranceMultiplier}
              onChange={(e) =>
                setToleranceMultiplier(parseFloat(e.target.value))
              }
              className="w-full"
            />
            <div className="relative h-5 mt-1">
              <span
                className="absolute text-xs text-gray-500 dark:text-gray-400"
                style={{ left: "0%" }}
              >
                Loose (0.75x)
              </span>
              <span
                className="absolute text-xs text-gray-500 dark:text-gray-400"
                style={{ left: "20%", transform: "translateX(-50%)" }}
              >
                Standard (1.0x)
              </span>
              <span
                className="absolute text-xs text-gray-500 dark:text-gray-400"
                style={{ left: "52%", transform: "translateX(-50%)" }}
              >
                Tight (1.4x)
              </span>
              <span
                className="absolute text-xs text-gray-500 dark:text-gray-400"
                style={{ right: "0%" }}
              >
                Ultra-tight (2.0x)
              </span>
            </div>
          </div>

          {/* Non-Inventory Tooling */}
          <div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={showTooling}
                onChange={(e) => setShowTooling(e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Non-Inventory Tooling Required
              </span>
            </label>
            {showTooling && (
              <div className="mt-1 ml-6">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                    $
                  </span>
                  <input
                    type="number"
                    value={toolingCost}
                    onChange={(e) => setToolingCost(e.target.value)}
                    className="pl-8 w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    placeholder="0.00"
                    step="0.01"
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  1.5x markup = ${prices.toolingMarkup.toFixed(2)}
                </p>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="calculation-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Notes (Optional)
            </label>
            <textarea
              id="calculation-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm"
              rows={2}
              placeholder="Describe how you got here..."
            />
          </div>
        </div>

        {/* Footer with Pricing and Actions */}
        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          {/* Compact Pricing Summary */}
          <div className="px-6 py-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs border-b border-gray-200 dark:border-gray-700">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Base:</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">${prices.basePrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Lead ({prices.leadMultiplier}x):</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">${(prices.basePrice * prices.leadMultiplier).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Complex ({complexityMultiplier.toFixed(2)}x):</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">${(prices.basePrice * prices.leadMultiplier * complexityMultiplier).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Tolerance ({toleranceMultiplier.toFixed(2)}x):</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">${prices.adjustedPrice.toFixed(2)}</span>
            </div>
            {showTooling && prices.toolingMarkup > 0 && (
              <div className="flex justify-between col-span-2">
                <span className="text-gray-500 dark:text-gray-400">+ Tooling:</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">${prices.toolingMarkup.toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="px-6 py-4 flex justify-between items-center">
            <div className="flex items-center gap-4">
              <button
                onClick={resetForm}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                Clear
              </button>
              <div className="text-left">
                <div className="text-xs text-gray-500 dark:text-gray-400">Final Price</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">${prices.finalPrice.toFixed(2)}</div>
              </div>
            </div>
            <div className="space-x-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                Cancel
              </button>
              {partIndex < quoteParts.length - 1 ? (
                <button
                  onClick={handleNextPart}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  disabled={!toolpathGrandTotal}
                >
                  Next Part →
                </button>
              ) : (
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  disabled={!toolpathGrandTotal}
                >
                  Save & Close
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
