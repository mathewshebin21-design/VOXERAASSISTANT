-- Local/dev bootstrap only (docker-compose). Production roles and passwords are
-- created by the platform's secret management, never committed.
-- CREATEDB/CREATEROLE mirror the owner role a hosted Postgres (e.g. Neon) provides; the
-- build-script test uses them to create a scratch database and its runtime role.
CREATE ROLE voxera_owner LOGIN CREATEDB CREATEROLE PASSWORD 'owner-dev-only';
CREATE ROLE voxera_app LOGIN PASSWORD 'app-dev-only';
CREATE DATABASE voxera OWNER voxera_owner;
CREATE DATABASE voxera_test OWNER voxera_owner;
