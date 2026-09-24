-- Import presets from user-config/import-presets.json. The conversion is code,
-- not SQL: migrateSafely runs it on the migrated copy right after this
-- migration (src/server/data-migrations/). SQLite needs one statement here.
SELECT 1;
