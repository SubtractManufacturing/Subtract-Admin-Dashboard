import { useEffect, useState, useCallback, useRef } from "react";
import { useFetcher } from "@remix-run/react";

export interface MeshConversionState {
  status: string | null;
  error: string | null;
  jobId: string | null;
  meshUrl: string | null;
  progress: number;
  isPolling: boolean;
}

interface UseMeshConversionOptions {
  partId: string;
  autoStart?: boolean;
  pollingInterval?: number;
  onComplete?: (meshUrl: string) => void;
  onError?: (error: string) => void;
}

interface ConversionStatus {
  status: string | null;
  error: string | null;
  jobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface ConversionResult {
  success: boolean;
  error?: string;
  meshUrl?: string;
  jobId?: string;
}

interface FetcherData {
  conversion?: ConversionStatus;
  part?: {
    meshUrl?: string;
  };
  stats?: Record<string, number>;
  results?: Record<string, ConversionResult>;
}

/**
 * Hook for managing mesh conversion state and operations
 */
export function useMeshConversion({
  partId,
  autoStart = false,
  pollingInterval = 2000,
  onComplete,
  onError,
}: UseMeshConversionOptions) {
  const fetcher = useFetcher<FetcherData>();
  const [state, setState] = useState<MeshConversionState>({
    status: null,
    error: null,
    jobId: null,
    meshUrl: null,
    progress: 0,
    isPolling: false,
  });
  
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);

  // Update refs when callbacks change
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
  }, [onComplete, onError]);

  const startPolling = useCallback(() => {
    if (!pollingIntervalRef.current) {
      setState(prev => ({ ...prev, isPolling: true }));
      
      pollingIntervalRef.current = setInterval(() => {
        fetcher.load(`/api/mesh-conversion/${partId}`);
      }, pollingInterval);
    }
  }, [partId, pollingInterval, fetcher]);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      setState(prev => ({ ...prev, isPolling: false }));
    }
  }, []);

  const startConversion = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "convert");
    
    fetcher.submit(formData, {
      method: "post",
      action: `/api/mesh-conversion/${partId}`,
    });

    setState(prev => ({ ...prev, status: "queued" }));
  }, [partId, fetcher]);

  // Load initial status
  useEffect(() => {
    if (partId) {
      fetcher.load(`/api/mesh-conversion/${partId}`);
    }
  }, [partId, fetcher]);

  // Handle fetcher data updates
  useEffect(() => {
    if (fetcher.data) {
      const { conversion, part } = fetcher.data;
      
      if (conversion) {
        setState(prev => ({
          ...prev,
          status: conversion.status,
          error: conversion.error,
          jobId: conversion.jobId,
          meshUrl: part?.meshUrl || prev.meshUrl,
          progress: calculateProgress(conversion.status),
        }));

        // Handle completion
        if (conversion.status === "completed" && part?.meshUrl) {
          stopPolling();
          if (onCompleteRef.current) {
            onCompleteRef.current(part.meshUrl);
          }
        }

        // Handle error
        if (conversion.status === "failed" && conversion.error) {
          stopPolling();
          if (onErrorRef.current) {
            onErrorRef.current(conversion.error);
          }
        }

        // Start polling for active conversions
        if (conversion.status === "in_progress" || conversion.status === "queued") {
          startPolling();
        }
      }
    }
  }, [fetcher.data, startPolling, stopPolling]);

  // Auto-start conversion if enabled
  useEffect(() => {
    if (autoStart && state.status === "pending" && fetcher.state === "idle") {
      startConversion();
    }
  }, [autoStart, state.status, fetcher.state, startConversion]);

  const retryConversion = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "retry");
    
    fetcher.submit(formData, {
      method: "post",
      action: `/api/mesh-conversion/${partId}`,
    });

    setState(prev => ({ 
      ...prev, 
      status: "queued",
      error: null,
    }));
  }, [partId, fetcher]);

  const checkStatus = useCallback(() => {
    fetcher.load(`/api/mesh-conversion/${partId}`);
  }, [partId, fetcher]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    state,
    isLoading: fetcher.state === "loading",
    isSubmitting: fetcher.state === "submitting",
    startConversion,
    retryConversion,
    checkStatus,
    stopPolling,
  };
}

/**
 * Calculate progress percentage based on status
 */
function calculateProgress(status: string | null): number {
  switch (status) {
    case "pending":
      return 0;
    case "queued":
      return 10;
    case "in_progress":
      return 50;
    case "completed":
      return 100;
    case "failed":
      return 0;
    default:
      return 0;
  }
}

/**
 * Hook for batch mesh conversion operations
 */
export function useBatchMeshConversion() {
  const fetcher = useFetcher<FetcherData>();
  const [stats, setStats] = useState<Record<string, number>>({});
  const [results, setResults] = useState<Record<string, ConversionResult>>({});
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.stats) {
        setStats(fetcher.data.stats);
      }
      
      if (fetcher.data.results) {
        setResults(fetcher.data.results);
        setIsProcessing(false);
      }
    }
  }, [fetcher.data]);

  const convertSelected = useCallback((partIds: string[]) => {
    if (partIds.length === 0) {
      console.error("No parts selected for conversion");
      return;
    }

    setIsProcessing(true);
    setResults({});
    
    const formData = new FormData();
    formData.append("action", "convert-selected");
    formData.append("partIds", JSON.stringify(partIds));

    fetcher.submit(formData, {
      method: "post",
      action: "/api/mesh-conversion/batch",
    });
  }, [fetcher]);

  const convertPending = useCallback(() => {
    setIsProcessing(true);
    setResults({});
    
    const formData = new FormData();
    formData.append("action", "convert-pending");

    fetcher.submit(formData, {
      method: "post",
      action: "/api/mesh-conversion/batch",
    });
  }, [fetcher]);

  const refreshStats = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "get-stats");

    fetcher.submit(formData, {
      method: "post",
      action: "/api/mesh-conversion/batch",
    });
  }, [fetcher]);

  return {
    stats,
    results,
    isProcessing,
    isLoading: fetcher.state === "loading",
    convertSelected,
    convertPending,
    refreshStats,
  };
}