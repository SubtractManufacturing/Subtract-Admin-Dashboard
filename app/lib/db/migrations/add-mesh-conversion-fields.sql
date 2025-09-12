-- Add mesh conversion tracking fields to parts table
ALTER TABLE parts 
ADD COLUMN IF NOT EXISTS mesh_conversion_status TEXT DEFAULT 'pending' CHECK (mesh_conversion_status IN ('pending', 'queued', 'in_progress', 'completed', 'failed', 'skipped')),
ADD COLUMN IF NOT EXISTS mesh_conversion_error TEXT,
ADD COLUMN IF NOT EXISTS mesh_conversion_job_id TEXT,
ADD COLUMN IF NOT EXISTS mesh_conversion_started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS mesh_conversion_completed_at TIMESTAMP;

-- Create index for faster lookups by job_id
CREATE INDEX IF NOT EXISTS idx_parts_mesh_conversion_job_id ON parts(mesh_conversion_job_id) WHERE mesh_conversion_job_id IS NOT NULL;

-- Create index for finding pending conversions
CREATE INDEX IF NOT EXISTS idx_parts_mesh_conversion_status ON parts(mesh_conversion_status) WHERE mesh_conversion_status IN ('pending', 'queued', 'in_progress');