-- Rename JobRecords.reviewCycle -> revisionCycle.
-- The column models the revision round (round 1 at plan approval, +1 per human-triggered
-- work episode), not a per-review-pass counter; the new name removes that ambiguity.
ALTER TABLE "JobRecords" RENAME COLUMN "reviewCycle" TO "revisionCycle";
