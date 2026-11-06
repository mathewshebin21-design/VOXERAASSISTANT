"""Read-only build behavior; no database or provider calls."""

import contextlib
import importlib.util
import io
import os
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app import rc1_preview

spec = importlib.util.spec_from_file_location(
    "rc1_build", Path(__file__).resolve().parents[1] / "scripts/vercel_build.py"
)
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class BuildTests(unittest.TestCase):
    def run_build(self, *, restricted=True, mismatch=None, revision="0007"):
        engine = MagicMock()
        connection = engine.connect.return_value.__enter__.return_value
        connection.execute.return_value.scalar.side_effect = [restricted, True, revision]
        with (
            patch.object(build.deploy_env, "expected", return_value="staging"),
            patch.object(build.deploy_env, "mismatch", return_value=mismatch),
            patch.object(build, "rc1_active", return_value=True),
            patch.object(build, "hosted_overrides", return_value={"migration_database_url": "synthetic-url"}),
            patch.object(build, "create_engine", return_value=engine) as factory,
            patch.object(build.ScriptDirectory, "from_config") as scripts,
        ):
            scripts.return_value.get_current_head.return_value = "0007"
            result = build.main()
        self.assertEqual(factory.call_args.kwargs["connect_args"]["options"], "-c default_transaction_read_only=on")
        engine.dispose.assert_called_once()
        for call in connection.execute.call_args_list:
            self.assertTrue(str(call.args[0]).startswith("SELECT "))
        return result

    def test_readonly_matching_database_passes(self):
        self.assertEqual(self.run_build(), 0)

    def test_unrestricted_role_refused(self):
        self.assertEqual(self.run_build(restricted=False), 1)

    def test_wrong_identity_refused(self):
        self.assertEqual(self.run_build(mismatch="production database"), 1)

    def test_wrong_schema_refused(self):
        self.assertEqual(self.run_build(revision="0008"), 1)

    def test_unclaimed_identity_refused(self):
        self.assertEqual(self.run_build(mismatch="unclaimed"), 1)


class RefusalTextTests(unittest.TestCase):
    """The hosted build log must say which RC-1 gate refused, and never print a value."""

    SECRET = "postgresql://owner:s3cr3t-value@ep-other.neon.tech/neondb"

    def refusal(self, error):
        out = io.StringIO()
        with patch.object(build, "main", side_effect=error), contextlib.redirect_stdout(out):
            self.assertEqual(build.run(), 1)
        return out.getvalue()

    def test_rc1_gate_is_named(self):
        for message in (
            "RC-1 forbids inherited database credentials and migration overrides",
            "RC-1 requires an independent JWT signing secret",
            "RC-1 VOXERA_DATABASE_URL must use the dedicated database, TLS and voxera_app",
        ):
            self.assertIn(message, self.refusal(build.ConfigError(message)))

    def test_real_guard_refusals_carry_no_values(self):
        env = {
            "VOXERA_DEPLOYMENT_PROFILE": "rc1-validation",
            "VERCEL_GIT_COMMIT_REF": rc1_preview.BRANCH,
            "VERCEL_ENV": "preview",
            "VOXERA_EXPECT_DB_ENV": "staging",
            "VOXERA_JWT_SECRET": "x" * 40,
            "VOXERA_DATABASE_URL": self.SECRET,
            "VOXERA_BUILD_DATABASE_URL": self.SECRET,
        }
        for extra in ({"DATABASE_URL": self.SECRET}, {}):
            with (
                patch.dict(os.environ, {**env, **extra}, clear=True),
                self.assertRaises(rc1_preview.ConfigError) as ctx,
            ):
                rc1_preview.configuration()
            text = self.refusal(ctx.exception)
            self.assertNotIn("s3cr3t", text)
            self.assertNotIn("ep-other", text)
            self.assertIn("RC-1", text)

    def test_other_errors_stay_generic(self):
        text = self.refusal(ValueError(self.SECRET))
        self.assertNotIn("s3cr3t", text)
        self.assertIn("database preflight failed", text)

    def test_rc1_errors_remain_value_errors(self):
        self.assertTrue(issubclass(build.ConfigError, ValueError))
