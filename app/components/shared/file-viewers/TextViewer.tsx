import { useState, useEffect } from "react";
import { getFileExtension } from "~/lib/file-utils";

interface TextViewerProps {
  url: string;
  fileName: string;
}

export default function TextViewer({ url, fileName }: TextViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [content, setContent] = useState("");
  const [lineNumbers, setLineNumbers] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(false);
    
    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error('Failed to fetch');
        return response.text();
      })
      .then(text => {
        setContent(text);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [url]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
  };

  const toggleLineNumbers = () => {
    setLineNumbers(!lineNumbers);
  };

  const getLanguageClass = () => {
    const ext = getFileExtension(fileName);
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'json': 'json',
      'xml': 'xml',
      'sql': 'sql',
      'md': 'markdown',
      'yml': 'yaml',
      'yaml': 'yaml',
      'sh': 'bash',
      'bash': 'bash',
    };
    return languageMap[ext] || 'plaintext';
  };

  const lines = content.split('\n');

  return (
    <div className="relative w-full h-full bg-white dark:bg-gray-900 flex flex-col">
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-white dark:bg-gray-900">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Loading file...</p>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-900">
          <div className="text-center">
            <svg className="mx-auto h-12 w-12 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Unable to load file</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">{fileName}</p>
          </div>
        </div>
      )}
      
      {!error && !loading && (
        <>
          <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700 dark:text-gray-400">{fileName}</span>
              <span className="text-xs text-gray-600 dark:text-gray-400 px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded">
                {getLanguageClass()}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleLineNumbers}
                className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                title="Toggle line numbers"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </button>
              <button
                onClick={handleCopy}
                className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                title="Copy to clipboard"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-auto">
            <pre className="min-h-full p-4 text-sm text-gray-800 dark:text-gray-300 font-mono bg-white dark:bg-gray-900">
              <code className={`language-${getLanguageClass()}`}>
                {lines.map((line, i) => (
                  <div key={i} className="flex">
                    {lineNumbers && (
                      <span className="select-none text-gray-400 dark:text-gray-600 mr-4 min-w-[3rem] text-right">
                        {i + 1}
                      </span>
                    )}
                    <span className="flex-1 whitespace-pre">{line || ' '}</span>
                  </div>
                ))}
              </code>
            </pre>
          </div>
        </>
      )}
    </div>
  );
}