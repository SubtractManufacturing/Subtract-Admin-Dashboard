/**
 * Conversion Service Client
 * Handles communication with the optional mesh conversion API
 * Service is completely optional - app works without it
 */

export interface ConversionResponse {
  job_id: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  message?: string | null;
  output_file?: string | null; 
  error?: string | null;
}

export interface ConversionOptions {
  output_format?: "stl" | "obj" | "glb" | "gltf";
  deflection?: number;
  angular_deflection?: number;
  async_processing?: boolean;
}

export interface SupportedFormats {
  input_formats: string[];
  output_formats: string[];
  format_details: Record<string, {
    extensions: string[];
    description: string;
    variants?: string[];
  }>;
}

// Environment configuration
const CONVERSION_API_URL = process.env.CONVERSION_API_URL;
const CONVERSION_API_TIMEOUT = parseInt(process.env.CONVERSION_API_TIMEOUT || "60000");
const CONVERSION_POLLING_INTERVAL = parseInt(process.env.CONVERSION_POLLING_INTERVAL || "2000");

/**
 * Create a timeout wrapper for fetch requests
 * This is a workaround for AbortSignal.timeout() compatibility issues with @remix-run/web-fetch
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { ...fetchOptions } = options;

  // For now, just use regular fetch without timeout
  // The timeout was causing issues with the polyfill
  try {
    const response = await fetch(url, fetchOptions);
    return response;
  } catch (error) {
    console.error(`Request to ${url} failed:`, error);
    throw error;
  }
}

/**
 * Check if conversion service is configured
 */
export const isConversionEnabled = (): boolean => {
  return !!CONVERSION_API_URL;
};

/**
 * Check service health
 */
export async function checkConversionHealth(): Promise<boolean> {
  if (!isConversionEnabled()) return false;

  try {
    const response = await fetchWithTimeout(`${CONVERSION_API_URL}/health`, {
      timeout: 5000,
    });
    return response.ok;
  } catch (error) {
    console.log("Conversion service health check failed:", error);
    return false;
  }
}

/**
 * Get supported file formats
 */
export async function getSupportedFormats(): Promise<SupportedFormats | null> {
  if (!isConversionEnabled()) return null;

  try {
    const response = await fetchWithTimeout(`${CONVERSION_API_URL}/formats`, {
      timeout: 5000,
    });
    
    if (!response.ok) {
      console.error("Failed to get supported formats:", response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Error fetching supported formats:", error);
    return null;
  }
}

/**
 * Submit file for conversion
 */
export async function submitConversion(
  file: File | Buffer | Blob,
  filename: string,
  options: ConversionOptions = {}
): Promise<ConversionResponse | null> {
  if (!isConversionEnabled()) {
    console.log("Mesh conversion service not configured");
    return null;
  }

  try {
    const formData = new FormData();
    
    // Handle different file types
    if (file instanceof File) {
      formData.append("file", file);
    } else if (file instanceof Buffer) {
      const blob = new Blob([file]);
      formData.append("file", blob, filename);
    } else if (file instanceof Blob) {
      formData.append("file", file, filename);
    } else {
      console.error("Invalid file type for conversion");
      return null;
    }

    // Build query parameters
    const params = new URLSearchParams();
    if (options.output_format) {
      params.append("output_format", options.output_format);
    }
    if (options.deflection !== undefined) {
      params.append("deflection", options.deflection.toString());
    }
    if (options.angular_deflection !== undefined) {
      params.append("angular_deflection", options.angular_deflection.toString());
    }
    if (options.async_processing) {
      params.append("async_processing", "true");
    }

    const url = params.toString() 
      ? `${CONVERSION_API_URL}/convert?${params}`
      : `${CONVERSION_API_URL}/convert`;

    const response = await fetchWithTimeout(url, {
      method: "POST",
      body: formData,
      timeout: CONVERSION_API_TIMEOUT,
    });

    console.log(`Conversion API responded with status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Conversion failed:", response.status, errorText);
      return null;
    }

    // Read response text first to avoid stream issues
    const responseText = await response.text();
    console.log(`Conversion API response: ${responseText.substring(0, 200)}`);

    try {
      return JSON.parse(responseText);
    } catch (e) {
      console.error("Failed to parse conversion response:", e);
      return null;
    }
  } catch (error) {
    console.error("Conversion service error:", error);
    return null;
  }
}

/**
 * Check conversion job status
 */
export async function checkConversionStatus(
  jobId: string
): Promise<ConversionResponse | null> {
  if (!isConversionEnabled()) return null;

  try {
    const response = await fetchWithTimeout(`${CONVERSION_API_URL}/status/${jobId}`, {
      timeout: 5000,
    });
    
    if (!response.ok) {
      console.error("Failed to check status:", response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Error checking conversion status:", error);
    return null;
  }
}

/**
 * Download conversion result
 */
export async function downloadConversionResult(
  jobId: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  if (!isConversionEnabled()) return null;

  try {
    const response = await fetchWithTimeout(`${CONVERSION_API_URL}/download/${jobId}`, {
      timeout: CONVERSION_API_TIMEOUT,
    });
    
    if (!response.ok) {
      console.error("Failed to download result:", response.status);
      return null;
    }

    // Extract filename from Content-Disposition header
    const contentDisposition = response.headers.get("content-disposition");
    let filename = "converted_mesh.glb";
    
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1].replace(/['"]/g, "");
      }
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, filename };
  } catch (error) {
    console.error("Error downloading conversion result:", error);
    return null;
  }
}

/**
 * Poll for conversion completion
 */
export async function pollForCompletion(
  jobId: string,
  maxAttempts: number = 30
): Promise<ConversionResponse | null> {
  if (!isConversionEnabled()) return null;

  for (let i = 0; i < maxAttempts; i++) {
    const status = await checkConversionStatus(jobId);
    
    if (!status) {
      console.error(`Failed to check status for job ${jobId}`);
      return null;
    }

    if (status.status === "completed" || status.status === "failed") {
      return status;
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, CONVERSION_POLLING_INTERVAL));
  }

  console.error(`Conversion job ${jobId} timed out after ${maxAttempts} attempts`);
  return null;
}

/**
 * Detect file format type
 */
export function detectFileFormat(filename: string): "brep" | "mesh" | "unknown" {
  const extension = filename.toLowerCase().split(".").pop() || "";

  // BREP formats that need conversion
  const brepFormats = ["step", "stp", "iges", "igs", "brep"];

  // Mesh formats ready for viewing
  const meshFormats = ["stl", "obj", "gltf", "glb"];

  if (brepFormats.includes(extension)) return "brep";
  if (meshFormats.includes(extension)) return "mesh";
  return "unknown";
}

/**
 * Get recommended output format based on use case
 */
export function getRecommendedOutputFormat(): "glb" | "gltf" | "obj" | "stl" {
  // GLB is preferred for web viewing - binary format, efficient, supports materials
  return "glb";
}

/**
 * Validate file size for conversion
 */
export function validateFileSize(fileSize: number): { valid: boolean; message?: string } {
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  
  if (fileSize > MAX_FILE_SIZE) {
    return {
      valid: false,
      message: `File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024)}MB`
    };
  }
  
  return { valid: true };
}