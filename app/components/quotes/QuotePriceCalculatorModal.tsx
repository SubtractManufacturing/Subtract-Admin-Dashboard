import { useState, useEffect, useCallback } from "react";
import { Form } from "@remix-run/react";
import type { QuotePart, QuoteLineItem } from "~/lib/db/schema";

interface QuotePriceCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  quoteParts: QuotePart[];
  quoteLineItems: QuoteLineItem[];
  quoteId: number;
  onSave: (calculation: any) => void;
  currentPartIndex?: number;
  onPartChange?: (index: number) => void;
}

const LEAD_TIME_OPTIONS = [
  { label: "3-5 Business Days", value: "3-5 Days", multiplier: 2.0 },
  { label: "5-7 Business Days", value: "5-7 Days", multiplier: 1.5 },
  { label: "7-12 Business Days", value: "7-12 Days", multiplier: 1.0 },
];

const THREAD_SIZES = {
  small: { label: "Small (< M3)", defaultRate: 0.90 },
  medium: { label: "Medium (M4-M8)", defaultRate: 0.75 },
  large: { label: "Large (> M8)", defaultRate: 1.10 },
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
}: QuotePriceCalculatorModalProps) {
  const [partIndex, setPartIndex] = useState(currentPartIndex);
  const currentPart = quoteParts[partIndex];
  const currentLineItem = quoteLineItems.find(li => li.quotePartId === currentPart?.id);

  // Form state
  const [toolpathGrandTotal, setToolpathGrandTotal] = useState("");
  const [leadTimeOption, setLeadTimeOption] = useState("7-12 Days");
  const [threadCounts, setThreadCounts] = useState({
    small: 0,
    medium: 0,
    large: 0,
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
  const [notes, setNotes] = useState("");

  // Set default tolerance multiplier based on part tolerance
  useEffect(() => {
    if (currentPart?.tolerance) {
      const tolerance = parseFloat(currentPart.tolerance);
      let defaultMultiplier = 1.0;

      if (tolerance >= 0.010) {
        defaultMultiplier = 0.95;
      } else if (tolerance >= 0.005) {
        defaultMultiplier = 1.0;
      } else if (tolerance >= 0.003) {
        defaultMultiplier = 1.2;
      } else {
        defaultMultiplier = 1.5;
      }

      setToleranceMultiplier(defaultMultiplier);
    }
  }, [currentPart]);

  // Calculate prices
  const calculatePrices = useCallback(() => {
    const toolpath = parseFloat(toolpathGrandTotal) || 0;
    const leadTime = LEAD_TIME_OPTIONS.find(opt => opt.value === leadTimeOption);
    const leadMultiplier = leadTime?.multiplier || 1.0;

    // Calculate thread costs
    const threadCost =
      (threadCounts.small * threadRates.small) +
      (threadCounts.medium * threadRates.medium) +
      (threadCounts.large * threadRates.large);

    // Calculate tooling markup
    const tooling = parseFloat(toolingCost) || 0;
    const toolingMarkup = tooling * 1.5;

    // Calculate prices
    const basePrice = toolpath + threadCost + toolingMarkup;
    const adjustedPrice = basePrice * leadMultiplier * complexityMultiplier * toleranceMultiplier;
    const finalPrice = adjustedPrice; // Can add finishing costs here later

    return {
      basePrice,
      adjustedPrice,
      finalPrice,
      threadCost,
      toolingMarkup,
      leadMultiplier,
    };
  }, [toolpathGrandTotal, leadTimeOption, threadCounts, threadRates, complexityMultiplier, toleranceMultiplier, toolingCost]);

  const prices = calculatePrices();

  const handleSave = () => {
    const calculation = {
      quoteId,
      quotePartId: currentPart?.id,
      quoteLineItemId: currentLineItem?.id,
      toolpathGrandTotal: parseFloat(toolpathGrandTotal) || 0,
      leadTimeOption,
      leadTimeMultiplier: LEAD_TIME_OPTIONS.find(opt => opt.value === leadTimeOption)?.multiplier || 1.0,
      smallThreadCount: threadCounts.small,
      smallThreadRate: threadRates.small,
      mediumThreadCount: threadCounts.medium,
      mediumThreadRate: threadRates.medium,
      largeThreadCount: threadCounts.large,
      largeThreadRate: threadRates.large,
      totalThreadCost: prices.threadCost,
      complexityMultiplier,
      toleranceMultiplier,
      toolingCost: parseFloat(toolingCost) || null,
      toolingMarkup: prices.toolingMarkup || null,
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
      // Reset form for new part
      resetForm();
    }
  };

  const resetForm = () => {
    setToolpathGrandTotal("");
    setLeadTimeOption("7-12 Days");
    setThreadCounts({ small: 0, medium: 0, large: 0 });
    setComplexityMultiplier(2.15);
    setToleranceMultiplier(1.0);
    setToolingCost("");
    setShowTooling(false);
    setNotes("");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Quote Price Calculator
              </h2>
              {currentPart && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Part {partIndex + 1} of {quoteParts.length}: {currentPart.partNumber} - {currentPart.partName}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Base Cost Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Toolpath Grand Total
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
              <input
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
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Lead Time
            </label>
            <div className="space-y-2">
              {LEAD_TIME_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center">
                  <input
                    type="radio"
                    value={option.value}
                    checked={leadTimeOption === option.value}
                    onChange={(e) => setLeadTimeOption(e.target.value)}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {option.label} ({option.multiplier}x)
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Thread Specifications */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Thread Specifications
              </label>
              <button
                type="button"
                onClick={() => setEditingThreadRates(!editingThreadRates)}
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                {editingThreadRates ? "Done" : "Edit Rates"}
              </button>
            </div>
            <div className="space-y-3">
              {Object.entries(THREAD_SIZES).map(([size, config]) => (
                <div key={size} className="flex items-center space-x-4">
                  <div className="flex-1">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {config.label}
                    </span>
                  </div>
                  <input
                    type="number"
                    value={threadCounts[size as keyof typeof threadCounts]}
                    onChange={(e) => setThreadCounts({
                      ...threadCounts,
                      [size]: parseInt(e.target.value) || 0
                    })}
                    className="w-20 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    placeholder="0"
                    min="0"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">×</span>
                  {editingThreadRates ? (
                    <div className="flex items-center">
                      <span className="mr-1">$</span>
                      <input
                        type="number"
                        value={threadRates[size as keyof typeof threadRates]}
                        onChange={(e) => setThreadRates({
                          ...threadRates,
                          [size]: parseFloat(e.target.value) || 0
                        })}
                        className="w-20 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        step="0.01"
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      ${threadRates[size as keyof typeof threadRates].toFixed(2)}
                    </span>
                  )}
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-20 text-right">
                    = ${(threadCounts[size as keyof typeof threadCounts] * threadRates[size as keyof typeof threadRates]).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Complexity Slider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Complexity Multiplier: {complexityMultiplier.toFixed(2)}x
            </label>
            <input
              type="range"
              min="1.5"
              max="3.1"
              step="0.05"
              value={complexityMultiplier}
              onChange={(e) => setComplexityMultiplier(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>Simple (1.5x)</span>
              <span>Standard (2.15x)</span>
              <span>Complex (3.1x)</span>
            </div>
          </div>

          {/* Tolerance Slider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Tolerance Multiplier: {toleranceMultiplier.toFixed(2)}x
              {currentPart?.tolerance && (
                <span className="ml-2 text-xs text-gray-500">
                  (Part tolerance: {currentPart.tolerance}")
                </span>
              )}
            </label>
            <input
              type="range"
              min="0.95"
              max="2.0"
              step="0.05"
              value={toleranceMultiplier}
              onChange={(e) => setToleranceMultiplier(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>Loose (0.95x)</span>
              <span>Standard (1.0x)</span>
              <span>Tight (1.4x)</span>
              <span>Ultra-tight (2.0x)</span>
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
              <div className="mt-2 ml-6">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              rows={2}
              placeholder="Any special considerations..."
            />
          </div>
        </div>

        {/* Pricing Summary */}
        <div className="bg-gray-50 dark:bg-gray-900 p-6 border-t border-gray-200 dark:border-gray-700">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Base Price:</span>
              <span className="font-medium">${prices.basePrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">
                × Lead Time ({prices.leadMultiplier}x)
              </span>
              <span className="font-medium">
                ${(prices.basePrice * prices.leadMultiplier).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">
                × Complexity ({complexityMultiplier.toFixed(2)}x)
              </span>
              <span className="font-medium">
                ${(prices.basePrice * prices.leadMultiplier * complexityMultiplier).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">
                × Tolerance ({toleranceMultiplier.toFixed(2)}x)
              </span>
              <span className="font-medium">
                ${prices.adjustedPrice.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-300 dark:border-gray-600">
              <span>Final Price:</span>
              <span>${prices.finalPrice.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-between">
          <button
            onClick={resetForm}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
          >
            Clear
          </button>
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
  );
}