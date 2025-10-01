import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";

interface ConversionResponse {
  job_id: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  message?: string | null;
  output_file?: string | null; 
  error?: string | null;
}

interface ConversionStatus {
  status: string | null;
  error: string | null;
  jobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  liveStatus?: ConversionResponse | null;
}

interface FetcherData {
  conversion?: ConversionStatus;
  part?: {
    id: string;
    name?: string;
    hasModelFile: boolean;
    hasMeshFile: boolean;
    meshUrl: string | null;
  };
  serviceAvailable?: boolean;
  error?: string;
}

interface MeshConversionStatusProps {
  partId: string;
  partName?: string;
  initialStatus?: ConversionStatus;
  onMeshReady?: (meshUrl: string) => void;
  className?: string;
}

export function MeshConversionStatus({
  partId,
  initialStatus,
  onMeshReady,
  className = "",
}: MeshConversionStatusProps) {
  const fetcher = useFetcher<FetcherData>();
  const [status, setStatus] = useState<ConversionStatus>(
    initialStatus || {
      status: null,
      error: null,
      jobId: null,
      startedAt: null,
      completedAt: null,
    }
  );
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  // Update status when fetcher returns data
  useEffect(() => {
    if (fetcher.data?.conversion) {
      const newStatus = fetcher.data.conversion;
      setStatus(newStatus);

      // Notify parent if mesh is ready
      if (newStatus.status === "completed" && fetcher.data.part?.meshUrl && onMeshReady) {
        onMeshReady(fetcher.data.part.meshUrl);
      }

      // Stop polling if completed or failed
      if (newStatus.status === "completed" || newStatus.status === "failed") {
        if (pollingInterval) {
          clearInterval(pollingInterval);
          setPollingInterval(null);
        }
      }
    }
  }, [fetcher.data, onMeshReady, pollingInterval]);

  // Start polling when status is in progress
  useEffect(() => {
    if (status.status === "in_progress" || status.status === "queued") {
      // Poll every 2 seconds
      const interval = setInterval(() => {
        fetcher.load(`/mesh-conversion/${partId}`);
      }, 2000);

      setPollingInterval(interval);

      return () => {
        clearInterval(interval);
      };
    }
  }, [status.status, partId, fetcher]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  const handleStartConversion = () => {
    const formData = new FormData();
    formData.append("action", "convert");
    fetcher.submit(formData, {
      method: "post",
      action: `/mesh-conversion/${partId}`,
    });
  };

  const handleRetryConversion = () => {
    const formData = new FormData();
    formData.append("action", "retry");
    fetcher.submit(formData, {
      method: "post",
      action: `/mesh-conversion/${partId}`,
    });
  };

  if (!status.status || status.status === "skipped") {
    return null;
  }

  const getStatusIcon = () => {
    switch (status.status) {
      case "pending":
        return "⏳";
      case "queued":
      case "in_progress":
        return "⚙️";
      case "completed":
        return "✅";
      case "failed":
        return "❌";
      default:
        return "❓";
    }
  };

  const getStatusText = () => {
    switch (status.status) {
      case "pending":
        return "Pending conversion";
      case "queued":
        return "Queued for conversion";
      case "in_progress":
        return "Converting to mesh...";
      case "completed":
        return "Mesh ready";
      case "failed":
        return "Conversion failed";
      default:
        return status.status;
    }
  };

  const getStatusColor = () => {
    switch (status.status) {
      case "pending":
        return "text-gray-500";
      case "queued":
      case "in_progress":
        return "text-blue-500";
      case "completed":
        return "text-green-500";
      case "failed":
        return "text-red-500";
      default:
        return "text-gray-500";
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className={`text-sm ${getStatusColor()}`}>
        {getStatusIcon()} {getStatusText()}
      </span>

      {status.status === "pending" && (
        <button
          onClick={handleStartConversion}
          className="text-xs text-blue-600 hover:text-blue-800 underline"
          disabled={fetcher.state !== "idle"}
        >
          Start conversion
        </button>
      )}

      {status.status === "failed" && (
        <>
          {status.error && (
            <span className="text-xs text-red-500" title={status.error}>
              ({status.error.length > 50 ? status.error.slice(0, 50) + "..." : status.error})
            </span>
          )}
          <button
            onClick={handleRetryConversion}
            className="text-xs text-blue-600 hover:text-blue-800 underline"
            disabled={fetcher.state !== "idle"}
          >
            Retry
          </button>
        </>
      )}

      {(status.status === "in_progress" || status.status === "queued") && (
        <div className="inline-block">
          <svg
            className="animate-spin h-4 w-4 text-blue-500"
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
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        </div>
      )}
    </div>
  );
}

export function MeshConversionBadge({ status }: { status: string | null }) {
  if (!status || status === "skipped") return null;

  const getBadgeClass = () => {
    const base = "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium";
    switch (status) {
      case "pending":
        return `${base} bg-gray-100 text-gray-800`;
      case "queued":
      case "in_progress":
        return `${base} bg-blue-100 text-blue-800`;
      case "completed":
        return `${base} bg-green-100 text-green-800`;
      case "failed":
        return `${base} bg-red-100 text-red-800`;
      default:
        return `${base} bg-gray-100 text-gray-800`;
    }
  };

  const getLabel = () => {
    switch (status) {
      case "pending":
        return "Pending";
      case "queued":
        return "Queued";
      case "in_progress":
        return "Converting";
      case "completed":
        return "Mesh Ready";
      case "failed":
        return "Failed";
      default:
        return status;
    }
  };

  return <span className={getBadgeClass()}>{getLabel()}</span>;
}