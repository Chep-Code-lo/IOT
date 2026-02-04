-- Update existing database to add is_deleted column
ALTER TABLE activity_history 
ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE AFTER metadata,
ADD INDEX idx_is_deleted (is_deleted);

-- Set all existing records as not deleted
UPDATE activity_history SET is_deleted = FALSE WHERE is_deleted IS NULL;
