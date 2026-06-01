-- Task #142: Open motion voting to all owners in good standing.
-- Adds an `audience` column to motions so a motion can declare whether it
-- is decided by the board (default, preserves existing behavior) or by
-- every owner currently in good standing.
ALTER TABLE "motions" ADD COLUMN IF NOT EXISTS "audience" text NOT NULL DEFAULT 'board';
