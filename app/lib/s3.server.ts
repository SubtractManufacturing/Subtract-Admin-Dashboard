import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const S3_ENDPOINT = process.env.S3_Endpoint
const S3_REGION = process.env.S3_Region || 'us-east-1'
const S3_ACCESS_KEY_ID = process.env.S3_Access_Key_ID
const S3_SECRET_ACCESS_KEY = process.env.S3_Secret_Access_Key
const S3_BUCKET = process.env.S3_Bucket || 'subtract-attachments'

// Create S3 client lazily to avoid initialization errors
let s3Client: S3Client | null = null

function getS3Client() {
  if (!s3Client) {
    if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
      throw new Error('S3 credentials not configured. Please set S3_Access_Key_ID and S3_Secret_Access_Key environment variables.')
    }
    
    s3Client = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: !!S3_ENDPOINT,
    })
  }
  return s3Client
}

export interface UploadParams {
  key: string
  buffer: Buffer
  contentType: string
  fileName: string
}

export interface UploadResult {
  key: string
  bucket: string
  fileName: string
  contentType: string
  size: number
}

export async function uploadFile(params: UploadParams): Promise<UploadResult> {
  const { key, buffer, contentType, fileName } = params

  if (!S3_BUCKET) {
    throw new Error('S3_Bucket environment variable is not configured')
  }

  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    Metadata: {
      originalFileName: fileName,
    },
  })

  try {
    await getS3Client().send(command)
  } catch (error) {
    if (error instanceof Error && 'Code' in error && error.Code === 'NoSuchBucket') {
      throw new Error(`S3 bucket '${S3_BUCKET}' does not exist. Please create the bucket or update the S3_Bucket environment variable.`)
    }
    throw error
  }

  return {
    key,
    bucket: S3_BUCKET,
    fileName,
    contentType,
    size: buffer.length,
  }
}

export async function deleteFile(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  })

  await getS3Client().send(command)
}

export async function getDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  })

  return getSignedUrl(getS3Client(), command, { expiresIn })
}

export async function getFileInfo(key: string) {
  const command = new HeadObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  })

  const response = await getS3Client().send(command)
  
  return {
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    lastModified: response.LastModified,
    metadata: response.Metadata,
  }
}

export function generateFileKey(orderId: number, fileName: string): string {
  const timestamp = Date.now()
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
  return `orders/${orderId}/${timestamp}-${sanitizedFileName}`
}