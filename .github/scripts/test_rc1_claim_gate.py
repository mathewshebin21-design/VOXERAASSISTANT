import unittest
from rc1_claim_gate import verify_confirmation
from rc1_target import HOST


class ConfirmationTests(unittest.TestCase):
    def test_exact_approval(self):
        verify_confirmation('a' * 40, 'a' * 40, HOST)

    def test_rejects_missing_stale_or_wrong_target_approval(self):
        for source, approved, host in [('', '', HOST), ('a'*40, '', HOST), ('a'*40, 'b'*40, HOST), ('a'*40, 'a'*40, 'production.example'), ('a'*7, 'a'*7, HOST)]:
            with self.subTest(source=source, approved=approved, host=host), self.assertRaises(ValueError):
                verify_confirmation(source, approved, host)
