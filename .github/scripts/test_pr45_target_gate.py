import unittest
from pr45_target_gate import validate, SOURCE_SHA, REF, HOST, PROJECT, BRANCH


class GateTests(unittest.TestCase):
    def env(self):
        url = "postgresql://neondb_owner:synthetic-test-only@" + HOST + "/neondb?sslmode=require"
        return dict(GITHUB_REF=REF, APPROVED_SOURCE_SHA=SOURCE_SHA,
                    VALIDATION_PROJECT_ID=PROJECT, VALIDATION_BRANCH_ID=BRANCH,
                    DATABASE_URL=url, DATABASE_URL_UNPOOLED=url)

    def test_exact_target(self):
        validate(self.env())

    def test_pooled_runtime(self):
        env = self.env()
        env["DATABASE_URL"] = env["DATABASE_URL"].replace(".c-2", "-pooler.c-2")
        validate(env)

    def test_identity_mismatches(self):
        for key in ("GITHUB_REF", "APPROVED_SOURCE_SHA", "VALIDATION_PROJECT_ID", "VALIDATION_BRANCH_ID"):
            with self.subTest(key=key):
                env = self.env()
                env[key] = "incorrect"
                with self.assertRaises(ValueError):
                    validate(env)

    def test_missing_connections(self):
        for key in ("DATABASE_URL", "DATABASE_URL_UNPOOLED"):
            env = self.env()
            env.pop(key)
            with self.assertRaises(ValueError):
                validate(env)

    def test_connection_overrides_and_malformed_values(self):
        url = self.env()["DATABASE_URL"]
        invalid = [
            url.replace(HOST, "shared-staging.example.test"),
            url.replace(HOST, HOST + ".attacker.example"),
            url.replace("/neondb?", "/other?"),
            url.replace("neondb_owner:", "voxera_app:"),
            url.replace(":synthetic-test-only@", "@"),
            url.replace("sslmode=require", "sslmode=disable"),
            url + "&sslmode=disable", url + "&host=production.example",
            url + "&service=production", url + "&options=-c%20search_path%3Dother",
            url + "&channel_binding=disable", url + "#ignored",
            url.replace(HOST, HOST + ":invalid"), url.replace(HOST, HOST + ":5433"),
            url.replace("postgresql:", "https:"), "not-a-url", url + "&broken",
        ]
        for value in invalid:
            for key in ("DATABASE_URL", "DATABASE_URL_UNPOOLED"):
                with self.subTest(case=invalid.index(value), key=key):
                    env = self.env()
                    env[key] = value
                    with self.assertRaises(ValueError):
                        validate(env)

    def test_pooled_owner_is_refused(self):
        env = self.env()
        env["DATABASE_URL_UNPOOLED"] = env["DATABASE_URL_UNPOOLED"].replace(".c-2", "-pooler.c-2")
        with self.assertRaises(ValueError):
            validate(env)


if __name__ == "__main__":
    unittest.main()
