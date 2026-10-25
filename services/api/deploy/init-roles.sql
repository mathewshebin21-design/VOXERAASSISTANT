-- Local/dev bootstrap only (docker-compose). Production roles and passwords are
-- created by the platform's secret management, never committed.
CREATE ROLE voxera_owner LOGIN PASSWORD 'owner-dev-only';
CREATE ROLE voxera_app LOGIN PASSWORD 'app-dev-only';
CREATE DATABASE voxera OWNER voxera_owner;
CREATE DATABASE voxera_test OWNER voxera_owner;
