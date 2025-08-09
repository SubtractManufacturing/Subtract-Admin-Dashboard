import { useState } from "react";

interface VideoPlayerProps {
  url: string;
  fileName: string;
  contentType: string;
}

export default function VideoPlayer({ url, contentType }: VideoPlayerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const handleVideoLoad = () => {
    setLoading(false);
  };

  const handleVideoError = () => {
    setLoading(false);
    setError(true);
  };

  return (
    <div className="relative w-full h-full bg-black flex flex-col">
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div>
            <p className="mt-2 text-sm text-gray-400">Loading video...</p>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p className="mt-2 text-sm text-gray-400">Unable to play video</p>
            <p className="mt-1 text-xs text-gray-500">Format may not be supported</p>
          </div>
        </div>
      )}
      {!error && (
        <video
          src={url}
          className="w-full h-full object-contain"
          controls
          controlsList="nodownload"
          onLoadedMetadata={handleVideoLoad}
          onError={handleVideoError}
          preload="metadata"
          style={{ maxHeight: '100%' }}
        >
          <source src={url} type={contentType} />
          <track kind="captions" />
          Your browser does not support the video tag.
        </video>
      )}
    </div>
  );
}