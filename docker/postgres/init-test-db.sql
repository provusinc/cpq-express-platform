-- Runs once, when the Postgres volume is first initialised.
-- `cpq` (POSTGRES_DB) is created by the image; this adds the test database
-- used by the API test harness (TEST_DATABASE_URL).
CREATE DATABASE cpq_test;
