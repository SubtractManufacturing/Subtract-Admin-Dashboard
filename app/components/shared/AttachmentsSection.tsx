import { useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import Button from "./Button";
import FileViewerModal from "./FileViewerModal";
import { SectionCard } from "./SectionCard";
import { useDownload } from "~/hooks/useDownload";
import { formatFileSize, getFileType, isViewableFile } from "~/lib/file-utils";

type AttachmentItem = {
  id: string;
  fileName: string;
  contentType?: string | null;
  fileSize?: number | null;
  createdAt?: string | Date;
};

interface AttachmentsSectionProps {
  attachments: AttachmentItem[];
  entityType: string;
  entityId: string | number;
  readOnly?: boolean;
  className?: string;
  onDeleteOverride?: (attachmentId: string) => void;
}

export function AttachmentsSection({
  attachments,
  entityType,
  entityId,
  readOnly = false,
  className,
  onDeleteOverride,
}: AttachmentsSectionProps) {
  const { download } = useDownload();
  const uploadFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{
    url: string;
    fileName: string;
    contentType?: string;
    fileSize?: number;
    attachmentId: string;
  } | null>(null);

  const handleFileUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("entityType", String(entityType));
    formData.append("entityId", String(entityId));

    uploadFetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });

    event.target.value = "";
  };

  const handleDeleteAttachment = (attachmentId: string) => {
    if (!confirm("Are you sure you want to delete this attachment?")) return;

    if (onDeleteOverride) {
      onDeleteOverride(attachmentId);
      return;
    }

    const formData = new FormData();
    formData.append("intent", "deleteAttachment");
    formData.append("attachmentId", attachmentId);
    deleteFetcher.submit(formData, { method: "post" });
  };

  const handleViewFile = (attachment: AttachmentItem) => {
    const fileUrl = `/download/attachment/${attachment.id}?inline`;
    setSelectedFile({
      url: fileUrl,
      fileName: attachment.fileName,
      contentType: attachment.contentType || undefined,
      fileSize: attachment.fileSize || undefined,
      attachmentId: attachment.id,
    });
    setFileModalOpen(true);
  };

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return "--";
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  return (
    <>
      <SectionCard
        title="Attachments"
        className={className}
        actions={
          !readOnly && (
            <>
              <Button size="sm" onClick={handleFileUpload}>
                Upload File
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                style={{ display: "none" }}
                accept="*/*"
              />
            </>
          )
        }
      >
        {attachments && attachments.length > 0 ? (
          <div className="space-y-3">
            {attachments.map((attachment) => {
              const viewable = isViewableFile(
                attachment.fileName,
                attachment.contentType || undefined
              );

              return (
                <div
                  key={attachment.id}
                  className={`
                    flex items-center justify-between p-4 rounded-lg
                    transition-all duration-300 ease-out
                    ${
                      viewable
                        ? "bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer hover:scale-[1.02] hover:shadow-md focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:outline-none"
                        : "bg-gray-50 dark:bg-gray-700"
                    }
                  `}
                  onClick={viewable ? () => handleViewFile(attachment) : undefined}
                  onKeyDown={
                    viewable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleViewFile(attachment);
                          }
                        }
                      : undefined
                  }
                  role={viewable ? "button" : undefined}
                  tabIndex={viewable ? 0 : undefined}
                >
                  <div className="flex-1 pointer-events-none">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {attachment.fileName}
                      </p>
                      {viewable && (
                        <span className="text-xs bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                          {getFileType(
                            attachment.fileName,
                            attachment.contentType || undefined
                          ).type.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatFileSize(attachment.fileSize || 0)}
                      {attachment.createdAt
                        ? ` • Uploaded ${formatDate(attachment.createdAt)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        download(
                          `/download/attachment/${attachment.id}`,
                          attachment.fileName
                        );
                      }}
                      className="p-2 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/50 rounded transition-colors"
                      title="Download"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        fill="currentColor"
                        viewBox="0 0 16 16"
                      >
                        <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
                        <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
                      </svg>
                    </button>
                    {!readOnly && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteAttachment(attachment.id);
                        }}
                        className="p-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/50 rounded transition-colors"
                        title="Delete"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          fill="currentColor"
                          viewBox="0 0 16 16"
                        >
                          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                          <path
                            fillRule="evenodd"
                            d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">
            No attachments uploaded yet.
          </p>
        )}
      </SectionCard>

      {selectedFile && (
        <FileViewerModal
          isOpen={fileModalOpen}
          onClose={() => {
            setFileModalOpen(false);
            setSelectedFile(null);
          }}
          fileUrl={selectedFile.url}
          fileName={selectedFile.fileName}
          contentType={selectedFile.contentType}
          fileSize={selectedFile.fileSize}
          onDelete={
            !readOnly
              ? () => handleDeleteAttachment(selectedFile.attachmentId)
              : undefined
          }
          isDeleting={deleteFetcher.state === "submitting"}
        />
      )}
    </>
  );
}
