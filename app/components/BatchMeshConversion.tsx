import { useState } from "react";
import { useFetcher } from "@remix-run/react";

interface ConversionStats {
  pending?: number;
  queued?: number;
  in_progress?: number;
  completed?: number;
  failed?: number;
  skipped?: number;
}

interface BatchMeshConversionProps {
  selectedPartIds?: string[];
  onComplete?: () => void;
  className?: string;
}

interface ConversionResult {
  success: boolean;
  error?: string;
  meshUrl?: string;
  jobId?: string;
}

interface FetcherData {
  stats?: ConversionStats;
  results?: Record<string, ConversionResult>;
  message?: string;
  success?: boolean;
}

export function BatchMeshConversion({
  selectedPartIds,
  onComplete,
  className = "",
}: BatchMeshConversionProps) {
  const fetcher = useFetcher<FetcherData>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState<ConversionStats>({});
  const [results, setResults] = useState<Record<string, ConversionResult>>({});

  const handleConvertSelected = () => {
    if (!selectedPartIds || selectedPartIds.length === 0) {
      alert("Please select parts to convert");
      return;
    }

    setIsProcessing(true);
    const formData = new FormData();
    formData.append("action", "convert-selected");
    formData.append("partIds", JSON.stringify(selectedPartIds));

    fetcher.submit(formData, {
      method: "post",
      action: "/api/mesh-conversion/batch",
    });
  };

  const handleConvertPending = () => {
    setIsProcessing(true);
    const formData = new FormData();
    formData.append("action", "convert-pending");

    fetcher.submit(formData, {
      method: "post",
      action: "/api/mesh-conversion/batch",
    });
  };

  const handleGetStats = () => {
    const formData = new FormData();
    formData.append("action", "get-stats");

    fetcher.submit(formData, {
      method: "post",
      action: "/api/mesh-conversion/batch",
    });
  };

  // Update state when fetcher returns data
  if (fetcher.data) {
    if (fetcher.data.stats && JSON.stringify(stats) !== JSON.stringify(fetcher.data.stats)) {
      setStats(fetcher.data.stats);
    }

    if (fetcher.data.results && Object.keys(results).length === 0) {
      setResults(fetcher.data.results);
      setIsProcessing(false);
      if (onComplete) {
        onComplete();
      }
    }
  }

  const getTotalParts = () => {
    return Object.values(stats).reduce((sum, count) => sum + (count || 0), 0);
  };

  const getProgressPercentage = () => {
    const total = getTotalParts();
    if (total === 0) return 0;
    const completed = (stats.completed || 0) + (stats.failed || 0) + (stats.skipped || 0);
    return Math.round((completed / total) * 100);
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex gap-2">
        {selectedPartIds && selectedPartIds.length > 0 && (
          <button
            onClick={handleConvertSelected}
            disabled={isProcessing || fetcher.state !== "idle"}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            Convert Selected ({selectedPartIds.length})
          </button>
        )}

        <button
          onClick={handleConvertPending}
          disabled={isProcessing || fetcher.state !== "idle"}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          Convert All Pending
        </button>

        <button
          onClick={handleGetStats}
          disabled={fetcher.state !== "idle"}
          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          Refresh Stats
        </button>
      </div>

      {Object.keys(stats).length > 0 && (
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-3">Conversion Statistics</h3>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
            {stats.pending !== undefined && (
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-600">{stats.pending}</div>
                <div className="text-xs text-gray-500">Pending</div>
              </div>
            )}
            {stats.queued !== undefined && (
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">{stats.queued}</div>
                <div className="text-xs text-gray-500">Queued</div>
              </div>
            )}
            {stats.in_progress !== undefined && (
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{stats.in_progress}</div>
                <div className="text-xs text-gray-500">In Progress</div>
              </div>
            )}
            {stats.completed !== undefined && (
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
                <div className="text-xs text-gray-500">Completed</div>
              </div>
            )}
            {stats.failed !== undefined && (
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
                <div className="text-xs text-gray-500">Failed</div>
              </div>
            )}
            {stats.skipped !== undefined && (
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-400">{stats.skipped}</div>
                <div className="text-xs text-gray-500">Skipped</div>
              </div>
            )}
          </div>

          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="bg-green-600 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${getProgressPercentage()}%` }}
            />
          </div>
          <div className="text-center text-sm text-gray-600 mt-1">
            {getProgressPercentage()}% Complete
          </div>
        </div>
      )}

      {isProcessing && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <svg
              className="animate-spin h-5 w-5 text-blue-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-blue-700">Processing conversions...</span>
          </div>
        </div>
      )}

      {Object.keys(results).length > 0 && (
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-lg font-medium mb-3">Conversion Results</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {Object.entries(results).map(([partId, result]) => (
              <div key={partId} className="flex items-center justify-between p-2 border-b">
                <span className="text-sm font-mono">{partId}</span>
                <span
                  className={`text-sm ${
                    result.success ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {result.success ? "✅ Success" : `❌ ${result.error || "Failed"}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}