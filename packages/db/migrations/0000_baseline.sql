-- Baseline: establishes the migration journal. Tables arrive with auth and tenancy (#3).
-- UUIDv7 primary keys are generated in the application (see packages/db/src/columns.ts).
SELECT 1;
