"""Read-only build behavior; no database or provider calls."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("rc1_build", Path(__file__).resolve().parents[1] / "scripts/vercel_build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class BuildTests(unittest.TestCase):
    def run_build(self, *, restricted=True, mismatch=None, revision="0007"):
        engine = MagicMock()
        connection = engine.connect.return_value.__enter__.return_value
        connection.execute.return_value.scalar.side_effect = [restricted, True, revision]
        with patch.object(build.deploy_env, "expected", return_value="staging"), patch.object(build.deploy_env, "mismatch", return_value=mismatch), patch.object(build, "rc1_active", return_value=True), patch.object(build, "hosted_overrides", return_value={"migration_database_url": "synthetic-url"}), patch.object(build, "create_engine", return_value=engine) as factory, patch.object(build.ScriptDirectory, "from_config") as scripts:
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
