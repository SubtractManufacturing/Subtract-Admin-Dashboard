import { Part3DViewer } from '~/components/shared/Part3DViewer';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useFetcher } from '@remix-run/react';

interface CadVersion {
  id: string;
  version: number;
  isCurrentVersion: boolean;
  fileName: string;
  fileSize: number | null;
  uploadedByEmail: string | null;
  uploadedAt: string;
  notes: string | null;
  downloadUrl: string | null;
}

interface Part3DViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  partName?: string;
  modelUrl?: string;
  solidModelUrl?: string;
  partId?: string;
  quotePartId?: string;
  onThumbnailUpdate?: (thumbnailUrl: string) => void;
  autoGenerateThumbnail?: boolean;
  existingThumbnailUrl?: string;
  isQuotePart?: boolean;
  cadFileUrl?: string | null;
  canRevise?: boolean;
  currentVersion?: number;
  onRevisionComplete?: () => void;
}

export function Part3DViewerModal({
  isOpen,
  onClose,
  partName,
  modelUrl,
  solidModelUrl,
  partId,
  quotePartId,
  onThumbnailUpdate,
  autoGenerateThumbnail,
  existingThumbnailUrl,
  isQuotePart = false,
  cadFileUrl,
  canRevise = false,
  currentVersion = 1,
  onRevisionComplete
}: Part3DViewerModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [activeTab, setActiveTab] = useState<'history' | 'upload'>('history');
  const [revisionNotes, setRevisionNotes] = useState('');
  const [revisionFile, setRevisionFile] = useState<File | null>(null);
  const [versions, setVersions] = useState<CadVersion[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);

  const revisionFetcher = useFetcher();
  const restoreFetcher = useFetcher();

  const isUploading = revisionFetcher.state === 'submitting';
  const isRestoring = restoreFetcher.state === 'submitting';

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowVersionPanel(false);
      }
    };

    if (showVersionPanel) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showVersionPanel]);

  // Fetch version history when panel is opened
  const fetchVersionHistory = useCallback(async () => {
    if (!quotePartId) return;

    setIsLoadingVersions(true);
    try {
      const response = await fetch(`/quote-parts/${quotePartId}/versions`);
      if (response.ok) {
        const data = await response.json();
        setVersions(data.versions || []);
      }
    } catch (error) {
      console.error('Failed to fetch version history:', error);
    } finally {
      setIsLoadingVersions(false);
    }
  }, [quotePartId]);

  useEffect(() => {
    if (showVersionPanel && quotePartId) {
      fetchVersionHistory();
    }
  }, [showVersionPanel, quotePartId, fetchVersionHistory]);

  // Handle revision upload success
  useEffect(() => {
    if (revisionFetcher.state === 'idle' && revisionFetcher.data) {
      const data = revisionFetcher.data as { success?: boolean; error?: string };
      if (data.success) {
        setRevisionFile(null);
        setRevisionNotes('');
        setActiveTab('history');
        fetchVersionHistory();
        onRevisionComplete?.();
      }
    }
  }, [revisionFetcher.state, revisionFetcher.data, fetchVersionHistory, onRevisionComplete]);

  // Handle restore success
  useEffect(() => {
    if (restoreFetcher.state === 'idle' && restoreFetcher.data) {
      const data = restoreFetcher.data as { success?: boolean; error?: string };
      if (data.success) {
        fetchVersionHistory();
        onRevisionComplete?.();
      }
    }
  }, [restoreFetcher.state, restoreFetcher.data, fetchVersionHistory, onRevisionComplete]);

  useEffect(() => {
    if (!isOpen) return;

    const isNestedModal = document.body.style.overflow === 'hidden';
    const originalOverflow = !isNestedModal ? document.body.style.overflow : null;

    if (!isNestedModal) {
      document.body.style.overflow = 'hidden';
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (showVersionPanel) {
          setShowVersionPanel(false);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      if (!isNestedModal && originalOverflow !== null) {
        document.body.style.overflow = originalOverflow;
      }
    };
  }, [isOpen, onClose, showVersionPanel]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRevisionFile(file);
    }
  };

  const handleUploadRevision = () => {
    if (!revisionFile || !quotePartId) return;

    const formData = new FormData();
    formData.append('file', revisionFile);
    if (revisionNotes) {
      formData.append('notes', revisionNotes);
    }

    revisionFetcher.submit(formData, {
      method: 'POST',
      action: `/quote-parts/${quotePartId}/revise`,
      encType: 'multipart/form-data',
    });
  };

  const handleRestoreVersion = (versionId: string) => {
    if (!quotePartId) return;

    const formData = new FormData();
    formData.append('versionId', versionId);

    restoreFetcher.submit(formData, {
      method: 'POST',
      action: `/quote-parts/${quotePartId}/restore`,
    });
  };

  const handleDownloadVersion = (version: CadVersion) => {
    if (version.downloadUrl) {
      window.open(version.downloadUrl, '_blank');
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (!isOpen) return null;

  const hasCadFile = !!cadFileUrl || !!solidModelUrl;
  const displayVersion = versions.find(v => v.isCurrentVersion)?.version || currentVersion;

  // Type-safe error extraction from fetcher data
  const revisionError = revisionFetcher.data
    ? (revisionFetcher.data as { error?: string }).error
    : undefined;
  const restoreError = restoreFetcher.data
    ? (restoreFetcher.data as { error?: string }).error
    : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="relative w-[85vw] h-[85vh] bg-white dark:bg-gray-900 rounded-lg overflow-hidden shadow-2xl transition-colors duration-150"
      >
        {/* Close button - top right */}
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-20 p-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800/80 dark:hover:bg-gray-700 rounded-full transition-colors"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            fill="currentColor"
            viewBox="0 0 16 16"
            className="text-gray-600 dark:text-gray-300"
          >
            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
          </svg>
        </button>

        {/* Version Control Button - top right, next to close */}
        {quotePartId && (
          <div ref={dropdownRef} className="absolute top-2 right-14 z-20">
            <button
              onClick={() => setShowVersionPanel(!showVersionPanel)}
              className={`p-2 rounded-full transition-colors ${
                showVersionPanel
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-800/80 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}
              title="Version Control"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8.515 1.019A7 7 0 0 0 8 1V0a8 8 0 0 1 .589.022l-.074.997zm2.004.45a7.003 7.003 0 0 0-.985-.299l.219-.976c.383.086.76.2 1.126.342l-.36.933zm1.37.71a7.01 7.01 0 0 0-.439-.27l.493-.87a8.025 8.025 0 0 1 .979.654l-.615.789a6.996 6.996 0 0 0-.418-.302zm1.834 1.79a6.99 6.99 0 0 0-.653-.796l.724-.69c.27.285.52.59.747.91l-.818.576zm.744 1.352a7.08 7.08 0 0 0-.214-.468l.893-.45a7.976 7.976 0 0 1 .45 1.088l-.95.313a7.023 7.023 0 0 0-.179-.483zm.53 2.507a6.991 6.991 0 0 0-.1-1.025l.985-.17c.067.386.106.778.116 1.17l-1 .025zm-.131 1.538c.033-.17.06-.339.081-.51l.993.123a7.957 7.957 0 0 1-.23 1.155l-.964-.267c.046-.165.086-.332.12-.501zm-.952 2.379c.184-.29.346-.594.486-.908l.914.405c-.16.36-.345.706-.555 1.038l-.845-.535zm-.964 1.205c.122-.122.239-.248.35-.378l.758.653a8.073 8.073 0 0 1-.401.432l-.707-.707z"/>
                <path d="M8 1a7 7 0 1 0 4.95 11.95l.707.707A8.001 8.001 0 1 1 8 0v1z"/>
                <path d="M7.5 3a.5.5 0 0 1 .5.5v5.21l3.248 1.856a.5.5 0 0 1-.496.868l-3.5-2A.5.5 0 0 1 7 9V3.5a.5.5 0 0 1 .5-.5z"/>
              </svg>
            </button>

            {/* Version Control Dropdown Panel */}
            {showVersionPanel && (
              <div className="absolute top-full right-0 mt-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden transition-colors duration-150">
                {/* Tab Headers */}
                <div className="flex border-b border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => setActiveTab('history')}
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                      activeTab === 'history'
                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-750'
                    }`}
                  >
                    History
                  </button>
                  {canRevise && (
                    <button
                      onClick={() => setActiveTab('upload')}
                      className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === 'upload'
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-750'
                      }`}
                    >
                      Upload Revision
                    </button>
                  )}
                </div>

                {/* Tab Content */}
                <div className="max-h-72 overflow-y-auto">
                  {activeTab === 'history' && (
                    <div className="p-3">
                      {isLoadingVersions ? (
                        <div className="flex items-center justify-center py-6">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400 dark:border-gray-400"></div>
                        </div>
                      ) : versions.length === 0 ? (
                        <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-6">No version history</p>
                      ) : (
                        <div className="space-y-2">
                          {versions.map((v) => (
                            <div
                              key={v.id}
                              className={`p-2 rounded-lg transition-colors ${
                                v.isCurrentVersion
                                  ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700'
                                  : 'bg-gray-100 dark:bg-gray-700/50 hover:bg-gray-200 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm text-gray-800 dark:text-gray-200">v{v.version}</span>
                                  {v.isCurrentVersion && (
                                    <span className="text-xs bg-green-600 dark:bg-green-700 text-white dark:text-green-100 px-1.5 py-0.5 rounded">
                                      Current
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleDownloadVersion(v)}
                                    disabled={!v.downloadUrl}
                                    className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded transition-colors disabled:opacity-50"
                                    title="Download"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                                      <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                                      <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
                                    </svg>
                                  </button>
                                  {!v.isCurrentVersion && canRevise && (
                                    <button
                                      onClick={() => handleRestoreVersion(v.id)}
                                      disabled={isRestoring}
                                      className="p-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded transition-colors disabled:opacity-50"
                                      title="Restore"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                                        <path fillRule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/>
                                        <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/>
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="text-xs text-gray-600 dark:text-gray-400 truncate mt-1">
                                {v.fileName}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-500">
                                {formatFileSize(v.fileSize)} • {formatRelativeTime(v.uploadedAt)}
                              </div>
                              {v.notes && (
                                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 italic truncate">
                                  "{v.notes}"
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {restoreError && (
                        <div className="mt-2 p-2 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded text-red-600 dark:text-red-400 text-xs">
                          {restoreError}
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'upload' && canRevise && (
                    <div className="p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                        Current: v{displayVersion} → Will create v{displayVersion + 1}
                      </p>

                      {/* File Input */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".step,.stp,.iges,.igs,.brep"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className={`border border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors mb-3 ${
                          revisionFile
                            ? 'border-green-500 bg-green-100 dark:bg-green-900/20'
                            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 bg-gray-50 dark:bg-gray-700/30'
                        }`}
                      >
                        {revisionFile ? (
                          <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400 text-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                              <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
                            </svg>
                            <span className="truncate">{revisionFile.name}</span>
                          </div>
                        ) : (
                          <div className="text-gray-500 dark:text-gray-400 text-sm">
                            <p>Click to select file</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500">.step, .stp, .iges, .igs, .brep</p>
                          </div>
                        )}
                      </div>

                      {/* Notes */}
                      <textarea
                        value={revisionNotes}
                        onChange={(e) => setRevisionNotes(e.target.value)}
                        placeholder="Revision notes (optional)"
                        rows={2}
                        className="w-full px-2 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 mb-3 transition-colors"
                      />

                      {revisionError && (
                        <div className="mb-3 p-2 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded text-red-600 dark:text-red-400 text-xs">
                          {revisionError}
                        </div>
                      )}

                      <button
                        onClick={handleUploadRevision}
                        disabled={!revisionFile || isUploading}
                        className={`w-full px-3 py-2 rounded text-sm text-white transition-colors ${
                          !revisionFile || isUploading
                            ? 'bg-blue-400 dark:bg-blue-800 cursor-not-allowed opacity-50'
                            : 'bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500'
                        }`}
                      >
                        {isUploading ? 'Uploading...' : 'Upload & Convert'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3D Viewer Area - Full Height */}
        <div className="w-full h-full">
          {modelUrl ? (
            <Part3DViewer
              partName={partName}
              modelUrl={modelUrl}
              solidModelUrl={solidModelUrl}
              partId={partId}
              quotePartId={quotePartId}
              onThumbnailUpdate={onThumbnailUpdate}
              autoGenerateThumbnail={autoGenerateThumbnail}
              existingThumbnailUrl={existingThumbnailUrl}
              isQuotePart={isQuotePart}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400 transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                fill="currentColor"
                viewBox="0 0 16 16"
                className="mb-4 text-gray-400 dark:text-gray-600"
              >
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM4.5 7.5a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7z"/>
              </svg>
              <p className="text-lg mb-1">No 3D preview available</p>
              <p className="text-sm text-gray-400 dark:text-gray-500">Mesh conversion may be in progress or failed</p>
              {hasCadFile && (
                <p className="text-xs text-gray-400 dark:text-gray-600 mt-2">CAD file is available for download</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
