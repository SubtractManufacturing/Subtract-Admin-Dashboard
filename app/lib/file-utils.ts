export type FileType = 'pdf' | 'image' | 'video' | 'audio' | 'text' | 'unknown';

export interface FileTypeInfo {
  type: FileType;
  canView: boolean;
  icon?: string;
}

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'];
const TEXT_EXTENSIONS = ['txt', 'md', 'json', 'xml', 'csv', 'log', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg'];
const CODE_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'scala', 'r', 'lua', 'pl', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'html', 'css', 'scss', 'sass', 'less', 'sql', 'graphql', 'dockerfile', 'makefile'];
const PDF_EXTENSIONS = ['pdf'];

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/x-icon'];
const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
const AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/ogg', 'audio/aac', 'audio/mp4', 'audio/flac'];
const TEXT_MIME_TYPES = ['text/plain', 'text/markdown', 'application/json', 'text/xml', 'application/xml', 'text/csv', 'text/yaml', 'application/x-yaml'];
const PDF_MIME_TYPES = ['application/pdf'];

export function getFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function getFileTypeFromExtension(fileName: string): FileType {
  const ext = getFileExtension(fileName);
  
  if (PDF_EXTENSIONS.includes(ext)) return 'pdf';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (TEXT_EXTENSIONS.includes(ext) || CODE_EXTENSIONS.includes(ext)) return 'text';
  
  return 'unknown';
}

export function getFileTypeFromMimeType(mimeType: string): FileType {
  const normalizedType = mimeType.toLowerCase();
  
  if (PDF_MIME_TYPES.includes(normalizedType)) return 'pdf';
  if (IMAGE_MIME_TYPES.includes(normalizedType)) return 'image';
  if (VIDEO_MIME_TYPES.includes(normalizedType)) return 'video';
  if (AUDIO_MIME_TYPES.includes(normalizedType)) return 'audio';
  if (TEXT_MIME_TYPES.includes(normalizedType) || normalizedType.startsWith('text/')) return 'text';
  
  return 'unknown';
}

export function getFileType(fileName: string, mimeType?: string): FileTypeInfo {
  let type: FileType = 'unknown';
  
  // Try MIME type first if available
  if (mimeType) {
    type = getFileTypeFromMimeType(mimeType);
  }
  
  // Fall back to extension if MIME type didn't match
  if (type === 'unknown') {
    type = getFileTypeFromExtension(fileName);
  }
  
  return {
    type,
    canView: type !== 'unknown'
  };
}

export function isViewableFile(fileName: string, mimeType?: string): boolean {
  const fileInfo = getFileType(fileName, mimeType);
  return fileInfo.canView;
}

export function getFileIcon(fileType: FileType): string {
  switch (fileType) {
    case 'pdf':
      return '📄';
    case 'image':
      return '🖼️';
    case 'video':
      return '🎬';
    case 'audio':
      return '🎵';
    case 'text':
      return '📝';
    default:
      return '📎';
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function isLargeFile(bytes: number): boolean {
  const MAX_SIZE = 100 * 1024 * 1024; // 100MB
  return bytes > MAX_SIZE;
}