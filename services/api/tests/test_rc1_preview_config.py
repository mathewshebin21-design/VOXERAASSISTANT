"""No-network RC-1 credential boundary regression tests."""

import os
import unittest
from unittest.mock import patch

from app.platform import hosted_overrides, migration_owner_url
from app.rc1_preview import BRANCH, HOST, LEGACY_KEYS, configuration


class RC1PreviewTests(unittest.TestCase):
    def setUp(self):
        self.env = {
            "VERCEL_ENV": "preview",
            "VERCEL_GIT_COMMIT_REF": BRANCH,
            "VOXERA_DEPLOYMENT_PROFILE": "rc1-validation",
            "VOXERA_EXPECT_DB_ENV": "staging",
            "VOXERA_JWT_SECRET": "synthetic-independent-jwt-secret-123456789",
            "VOXERA_DATABASE_URL": f"postgresql://voxera_app:synthetic@{HOST}/neondb?sslmode=require",
            "VOXERA_BUILD_DATABASE_URL": f"postgresql://voxera_app:synthetic@{HOST}/neondb?sslmode=require",
        }

    def test_restricted_credentials_are_not_derived(self):
        with patch.dict(os.environ, self.env, clear=True):
            config = hosted_overrides()
            self.assertIn("voxera_app:synthetic@", config["database_url"])
            self.assertEqual(config["jwt_secret"], self.env["VOXERA_JWT_SECRET"])

    def test_settings_use_validated_driver_urls(self):
        from app.config import get_settings

        get_settings.cache_clear()
        try:
            with patch.dict(os.environ, self.env, clear=True):
                settings = get_settings()
                self.assertTrue(settings.database_url.startswith("postgresql+psycopg://voxera_app:"))
                self.assertTrue(settings.migration_database_url.startswith("postgresql+psycopg://voxera_app:"))
        finally:
            get_settings.cache_clear()

    def test_migration_owner_access_refused(self):
        with patch.dict(os.environ, self.env, clear=True), self.assertRaises(ValueError):
            migration_owner_url()

    def test_every_inherited_alias_rejected(self):
        for key in LEGACY_KEYS:
            with self.subTest(key=key), patch.dict(os.environ, {**self.env, key: "sensitive-sentinel"}, clear=True):
                with self.assertRaises(ValueError) as error:
                    configuration()
                self.assertNotIn("sensitive-sentinel", str(error.exception))

    def test_empty_aliases_do_not_supply_credentials(self):
        with patch.dict(os.environ, {**self.env, **dict.fromkeys(LEGACY_KEYS, "")}, clear=True):
            self.assertIsNotNone(configuration())

    def test_wrong_or_missing_identity_refused(self):
        for key, values in {
            "VERCEL_ENV": ["production", "development", ""],
            "VERCEL_GIT_COMMIT_REF": ["staging", "codex/other", ""],
            "VOXERA_DEPLOYMENT_PROFILE": ["", "other"],
            "VOXERA_EXPECT_DB_ENV": ["", "production"],
            "VOXERA_APP_ROLE": ["neondb_owner"],
            "VOXERA_JWT_SECRET": ["", "short", "dev-only" * 8],
        }.items():
            for value in values:
                with (
                    self.subTest(key=key, value=value),
                    patch.dict(os.environ, {**self.env, key: value}, clear=True),
                    self.assertRaises(ValueError),
                ):
                    configuration()

    def test_url_mismatches_refused_without_leaking_values(self):
        good = self.env["VOXERA_DATABASE_URL"]
        bad = [
            "",
            good.replace(HOST, "production.example"),
            good.replace("voxera_app", "neondb_owner"),
            good.replace("/neondb", "/other"),
            good.replace("sslmode=require", "sslmode=disable"),
            good + "&host=production.example",
            good + "&sslmode=disable",
            good + "#fragment",
            good.replace("synthetic", ""),
            good.replace(".tech/", ".tech:6543/"),
            good.replace("postgresql:", "https:"),
        ]
        for key in ("VOXERA_DATABASE_URL", "VOXERA_BUILD_DATABASE_URL"):
            for value in bad:
                with self.subTest(key=key, value=value), patch.dict(os.environ, {**self.env, key: value}, clear=True):
                    with self.assertRaises(ValueError) as error:
                        configuration()
                    self.assertNotIn("synthetic", str(error.exception))
                    self.assertNotIn("production.example", str(error.exception))
                    self.assertIn("failed: ", str(error.exception))

    def test_url_refusal_names_the_failed_rule(self):
        good = self.env["VOXERA_DATABASE_URL"]
        for value, rule in (
            (good.replace(HOST, "production.example"), "host"),
            (good.replace("voxera_app", "neondb_owner"), "user voxera_app"),
            (good.replace("/neondb", "/other"), "path /neondb"),
            (good.replace("sslmode=require", "sslmode=disable"), "sslmode require or verify-full"),
            (good + "&options=x", "only sslmode and channel_binding parameters"),
            (good.replace(".tech/", ".tech:6543/"), "port"),
            (good.replace("synthetic", ""), "password"),
            (f"'{good}'", "surrounding whitespace or quotes"),
            (f" {good}\n", "surrounding whitespace or quotes"),
            (f"psql '{good}'", "scheme"),
            ("", "scheme"),
        ):
            env = {**self.env, "VOXERA_DATABASE_URL": value}
            with self.subTest(rule=rule), patch.dict(os.environ, env, clear=True):
                with self.assertRaises(ValueError) as error:
                    configuration()
                self.assertIn(rule, str(error.exception))
                self.assertNotIn("synthetic", str(error.exception))

    def test_empty_url_is_not_reported_as_quoted(self):
        env = {**self.env, "VOXERA_DATABASE_URL": ""}
        with patch.dict(os.environ, env, clear=True), self.assertRaises(ValueError) as error:
            configuration()
        self.assertNotIn("quotes", str(error.exception))

    def test_neon_connection_string_with_channel_binding_accepted(self):
        good = self.env["VOXERA_DATABASE_URL"]
        env = {**self.env, "VOXERA_DATABASE_URL": good + "&channel_binding=require"}
        with patch.dict(os.environ, env, clear=True):
            self.assertIsNotNone(configuration())

    def test_existing_production_and_shared_staging_behavior_preserved(self):
        for target in ("production", "preview", "development"):
            with (
                self.subTest(target=target),
                patch.dict(
                    os.environ,
                    {
                        "VERCEL_ENV": target,
                        "VERCEL_GIT_COMMIT_REF": "staging",
                        "DATABASE_URL": "postgresql://owner:synthetic@legacy.example/db",
                    },
                    clear=True,
                ),
            ):
                self.assertIsNone(configuration())
                self.assertIn("owner:synthetic@legacy.example", hosted_overrides()["migration_database_url"])

    def test_local_without_database_unchanged(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(hosted_overrides(), {})

    def test_remediation_branch_cannot_use_inherited_database(self):
        with (
            patch.dict(
                os.environ,
                {
                    "VERCEL_ENV": "preview",
                    "VERCEL_GIT_COMMIT_REF": "codex/rc1-runtime-preview",
                    "DATABASE_URL": "postgresql://owner:synthetic@shared.example/db",
                },
                clear=True,
            ),
            self.assertRaises(ValueError),
        ):
            hosted_overrides()
