import unittest
from rc1_target import HOST, validate

REF = "refs/heads/codex/rc1-validation"
URL = f"postgresql+psycopg://owner:synthetic@{HOST}/neondb"


class TargetTests(unittest.TestCase):
    def test_valid(self):
        validate(REF, URL)

    def test_rejects_other_refs(self):
        for ref in ("", "refs/heads/staging", "refs/heads/claude/confident-shannon-7nb05f"):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                validate(ref, URL)

    def test_rejects_wrong_targets_and_overrides(self):
        for connection in (
            "", URL.replace(HOST, "production.example"),
            URL.replace("neondb", "postgres"), URL.replace("synthetic", ""),
            URL + "?host=production.example", URL + "#fragment",
            URL.replace(HOST, HOST + ":invalid"), URL.replace(HOST, HOST + ".evil.example"),
        ):
            with self.subTest(connection=connection), self.assertRaises(ValueError):
                validate(REF, connection)


if __name__ == "__main__":
    unittest.main()
