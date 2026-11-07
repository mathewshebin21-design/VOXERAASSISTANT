import unittest
from rc1_check import verify_identity


class IdentityTests(unittest.TestCase):
    def test_empty(self):
        self.assertIn("unclaimed", verify_identity("neondb", 0, None, None))

    def test_claimed_staging(self):
        self.assertIn("0007", verify_identity("neondb", 10, "staging", "0007"))

    def test_rejects_mismatch(self):
        for state in [("other", 0, None, None), ("neondb", 10, "production", "0007"), ("neondb", 10, "staging", "0008"), ("neondb", 1, None, None)]:
            with self.subTest(state=state), self.assertRaises(ValueError):
                verify_identity(*state)
