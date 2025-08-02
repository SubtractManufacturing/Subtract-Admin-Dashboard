import { useState, useRef, useEffect } from "react";

interface AudioPlayerProps {
  url: string;
  fileName: string;
  contentType: string;
}

export default function AudioPlayer({ url, fileName, contentType }: AudioPlayerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
    };
  }, []);

  const handleAudioLoad = () => {
    setLoading(false);
  };

  const handleAudioError = () => {
    setLoading(false);
    setError(true);
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative w-full h-full bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-8">
      <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-lg p-6 shadow-xl">
        {loading && !error && (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Loading audio...</p>
            </div>
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <svg className="mx-auto h-12 w-12 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Unable to play audio</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">Format may not be supported</p>
            </div>
          </div>
        )}
        
        {!error && (
          <>
            <div className="mb-4 text-center">
              <div className="flex items-center justify-center mb-4">
                <svg className="w-16 h-16 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
              <h3 className="text-gray-900 dark:text-white font-medium text-lg truncate">{fileName}</h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                {formatTime(currentTime)} / {formatTime(duration)}
              </p>
            </div>

            <audio
              ref={audioRef}
              src={url}
              className="w-full"
              controls
              controlsList="nodownload"
              onLoadedMetadata={handleAudioLoad}
              onError={handleAudioError}
              preload="metadata"
            >
              <source src={url} type={contentType} />
              <track kind="captions" />
              Your browser does not support the audio element.
            </audio>

            <div className="mt-4 flex items-center justify-center">
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-200"
                  style={{ width: `${(currentTime / duration) * 100 || 0}%` }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}