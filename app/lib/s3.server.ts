import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import https from 'https'

const S3_ENDPOINT = process.env.S3_ENDPOINT
const S3_REGION = process.env.S3_REGION || 'us-east-1'
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY
const S3_BUCKET = process.env.S3_BUCKET || 'subtract-attachments'

// Create S3 client lazily to avoid initialization errors
let s3Client: S3Client | null = null

export function getS3Client() {
  if (!s3Client) {
    if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
      throw new Error('S3 credentials not configured. Please set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY environment variables.')
    }

    s3Client = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: !!S3_ENDPOINT,
      requestHandler: new NodeHttpHandler({
        httpsAgent: new https.Agent({
          maxSockets: 25,
          keepAlive: false, // Disable keep-alive to avoid stale connections
          rejectUnauthorized: !S3_ENDPOINT || !S3_ENDPOINT.includes('localhost'),
          secureProtocol: 'TLSv1_2_method',
          // Additional SSL options to handle edge cases
          ciphers: 'HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA',
          honorCipherOrder: true,
        }),
        connectionTimeout: 15000,
        socketTimeout: 120000,
      }),
      maxAttempts: 3,
      retryMode: 'adaptive',
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

  // Retry logic for SSL errors
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await getS3Client().send(command)
      
      // Success - return result
      return {
        key,
        bucket: S3_BUCKET,
        fileName,
        contentType,
        size: buffer.length,
      }
    } catch (error) {
      lastError = error as Error
      
      if (error instanceof Error && 'Code' in error && error.Code === 'NoSuchBucket') {
        throw new Error(`S3 bucket '${S3_BUCKET}' does not exist. Please create the bucket or update the S3_Bucket environment variable.`)
      }
      
      // Check for SSL errors
      if (error instanceof Error && (
        error.message.includes('SSL') || 
        error.message.includes('sslv3') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT')
      )) {
        console.log(`S3 upload attempt ${attempt} failed with SSL error, retrying...`)
        
        // Reset the client to force a new connection
        if (attempt < 3) {
          s3Client = null
          // Wait before retry with exponential backoff
          await new Promise(resolve => setTimeout(resolve, attempt * 1000))
          continue
        }
      }
      
      // For non-SSL errors or last attempt, throw immediately
      throw error
    }
  }
  
  // If we get here, all retries failed
  throw lastError || new Error('Failed to upload to S3 after 3 attempts')
}

export async function deleteFile(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  })

  await getS3Client().send(command)
}

/**
 * Copy a file within S3 from source key to destination key
 */
export async function copyFile(sourceKey: string, destinationKey: string): Promise<void> {
  if (!S3_BUCKET) {
    throw new Error('S3_Bucket environment variable is not configured')
  }

  const command = new CopyObjectCommand({
    Bucket: S3_BUCKET,
    CopySource: `${S3_BUCKET}/${sourceKey}`,
    Key: destinationKey,
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

export async function downloadFile(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  })

  const response = await getS3Client().send(command)
  if (!response.Body) {
    throw new Error(`Failed to download ${key} from S3`)
  }

  const bytes = await response.Body.transformToByteArray()
  return Buffer.from(bytes)
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

/**
 * Upload a file to S3 and return the URL
 */
export async function uploadToS3(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string | null> {
  try {
    const fileName = key.split('/').pop() || 'file';
    
    await uploadFile({
      key,
      buffer,
      contentType,
      fileName,
    });

    // Return the S3 URL
    const baseUrl = S3_ENDPOINT || `https://s3.${S3_REGION}.amazonaws.com`;
    return `${baseUrl}/${S3_BUCKET}/${key}`;
  } catch (error) {
    console.error('Error uploading to S3:', error);
    return null;
  }
}

/**
 * Supabase Storage exposes an S3-compatible API where objects live at:
 *   {endpoint}/storage/v1/s3/{bucket}/{objectKey}
 * The object key for GetObject must be `{objectKey}` only (e.g. `quote-parts/...`),
 * not `storage/v1/s3/...` — otherwise signed URLs duplicate the path and return 404.
 */
function stripSupabaseStoragePrefix(path: string): string {
  let p = path.replace(/^\/+/, '');
  const prefix = `storage/v1/s3/${S3_BUCKET}/`;
  while (p.startsWith(prefix)) {
    p = p.slice(prefix.length);
  }
  return p;
}

function stripLeadingBucketIfPresent(key: string): string {
  if (key.startsWith(`${S3_BUCKET}/`)) {
    return key.slice(S3_BUCKET.length + 1);
  }
  return key;
}

/**
 * Extract S3 key from a URL or return as-is if already a key.
 * Handles presigned URLs, full S3 URLs, Supabase storage URLs, and plain keys.
 */
export function extractS3Key(urlOrKey: string): string {
  if (!urlOrKey.startsWith('http')) {
    let k = stripSupabaseStoragePrefix(urlOrKey);
    k = stripLeadingBucketIfPresent(k);
    return k;
  }

  try {
    const url = new URL(urlOrKey);
    const pathname = url.pathname;

    if (pathname.includes('/storage/v1/s3/')) {
      let k = stripSupabaseStoragePrefix(pathname);
      k = stripLeadingBucketIfPresent(k);
      return k;
    }

    const pathParts = pathname.split('/');
    const cleanParts = pathParts.filter(Boolean);

    if (cleanParts[0] === S3_BUCKET) {
      return cleanParts.slice(1).join('/');
    }

    return cleanParts.join('/');
  } catch {
    if (urlOrKey.includes(`${S3_BUCKET}/`)) {
      const parts = urlOrKey.split(`${S3_BUCKET}/`);
      return parts[1] || urlOrKey;
    }
    return urlOrKey;
  }
}

/**
 * Download a file from S3 and return as Buffer.
 * Accepts either an S3 key or a full URL (key is extracted automatically).
 */
export async function downloadFromS3(keyOrUrl: string): Promise<Buffer> {
  const key = extractS3Key(keyOrUrl);

  if (!key) {
    throw new Error(`Could not extract S3 key from: ${keyOrUrl}`);
  }

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  const response = await getS3Client().send(command);

  if (!response.Body) {
    throw new Error(`No content returned for S3 key: ${key}`);
  }

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}