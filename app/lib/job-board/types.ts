export const DISCORD_MAX_POST_CHARS = 2000;
export const DISCORD_MAX_FILES_PER_MESSAGE = 10;

export type JobBoardMessageGroup =
  | "text"
  | "thumbnails"
  | "cad"
  | "drawings"
  | "attachments";

export type JobBoardPostFile = {
  fileName: string;
  s3Key: string;
  partId?: string;
  attachmentId?: string;
};

export type JobBoardPlannedMessage = {
  group: JobBoardMessageGroup;
  content?: string;
  files: JobBoardPostFile[];
};

export type JobBoardPartInput = {
  partId: string;
  partName: string | null;
  quantity: number;
  thumbnailS3Key: string | null;
  currentCad: { s3Key: string; fileName: string } | null;
  drawings: { attachmentId: string; s3Key: string; fileName: string }[];
};

export type JobBoardAttachmentInput = {
  attachmentId: string;
  fileName: string;
  s3Key: string;
};

export type JobBoardOrderInput = {
  orderNumber: string;
  ndaRequired: boolean;
  deliveryDate: Date | null;
  leadTime: number | null;
  parts: JobBoardPartInput[];
  attachments: JobBoardAttachmentInput[];
};

export type JobBoardSentMessageRecord = {
  messageId: string;
  group: JobBoardMessageGroup;
  fileNames: string[];
};

export type PostedToJobBoardMetadata = {
  webhookId: string;
  webhookUrl: string;
  postText: string;
  messages: JobBoardSentMessageRecord[];
};

export const JOB_BOARD_EVENT_TYPES = {
  POSTED: "posted_to_job_board",
  MARKED_AS_SENT: "job_board_marked_as_sent",
} as const;
