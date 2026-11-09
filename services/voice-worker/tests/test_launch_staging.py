"""No-network contract tests for a staging-only, SIP-disabled container entrypoint."""

from __future__ import annotations

import os
import sys

import pytest

from voxera_worker.launch_staging import main, staging_errors


@pytest.fixture
def valid_env():
    return {
        "VOXERA_WORKER_ENV": "staging",
        "VOXERA_SIP_ENABLED": "false",
        "VOXERA_API_URL": "https://staging-api.example.test",
        "VOXERA_STAGING_API_HOST": "staging-api.example.test",
        "LIVEKIT_URL": "wss://staging-livekit.example.test",
        "VOXERA_STAGING_LIVEKIT_HOST": "staging-livekit.example.test",
        "LIVEKIT_API_KEY": "test-key-not-real",
        "LIVEKIT_API_SECRET": "secret-only-for-test",
        "VOXERA_WORKER_TOKEN_CMD": "echo unused",
    }


def test_explicit_staging_configuration_is_accepted_without_contacting_providers(valid_env):
    assert staging_errors(valid_env) == []


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("VOXERA_WORKER_ENV", "production"),
        ("VOXERA_SIP_ENABLED", "true"),
        ("VOXERA_SIP_ENABLED", "TRUE"),
        ("VOXERA_API_URL", "https://voxera-api-two.vercel.app"),
        ("VOXERA_API_URL", "https://voxera-api-ai-e399.vercel.app"),
        ("VOXERA_API_URL", "http://staging-api.example.test"),
        ("VOXERA_API_URL", "https://staging-api.example.test.evil.invalid"),
        ("VOXERA_API_URL", "https://user:pass@staging-api.example.test"),
        ("VOXERA_API_URL", "https://staging-api.example.test/v1/auth"),
        ("VOXERA_API_URL", "https://staging-api.example.test?test=true"),
        ("LIVEKIT_URL", "ws://staging-livekit.example.test"),
        ("LIVEKIT_URL", "wss://another-livekit.example.test"),
        ("VOXERA_WORKER_TOKEN_CMD", ""),
        ("VOXERA_WORKER_TOKEN", "static-token-not-allowed"),
        ("LIVEKIT_API_SECRET", ""),
    ],
)
def test_staging_preflight_refuses_dangerous_configuration(valid_env, key, value):
    env = {**valid_env, key: value}
    assert staging_errors(env), f"{key} must not be accepted"


@pytest.mark.parametrize(
    "key",
    [
        "VOXERA_WORKER_ENV",
        "VOXERA_SIP_ENABLED",
        "VOXERA_STAGING_API_HOST",
        "VOXERA_STAGING_LIVEKIT_HOST",
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
        "VOXERA_WORKER_TOKEN_CMD",
    ],
)
def test_missing_required_settings_refused(valid_env, key):
    del valid_env[key]
    assert staging_errors(valid_env)


def test_cli_check_reports_no_secrets(monkeypatch, capsys, valid_env):
    for key, value in valid_env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("VOXERA_SIP_ENABLED", "true")
    monkeypatch.setattr(sys, "argv", ["launch_staging", "check"])
    assert main() == 2
    result = capsys.readouterr()
    assert "staging SIP" in result.err
    assert valid_env["LIVEKIT_API_SECRET"] not in result.err
    assert valid_env["VOXERA_WORKER_TOKEN_CMD"] not in result.err


def test_cli_check_succeeds_without_network(monkeypatch, capsys, valid_env):
    for key, value in valid_env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("VOXERA_WORKER_TOKEN", raising=False)
    monkeypatch.setattr(sys, "argv", ["launch_staging", "check"])
    assert main() == 0
    assert "no network connection" in capsys.readouterr().out


def test_start_execs_real_agent_only_after_preflight(monkeypatch, valid_env):
    for key, value in valid_env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("VOXERA_WORKER_TOKEN", raising=False)
    monkeypatch.setattr(sys, "argv", ["launch_staging", "start"])
    calls = []

    def fake_exec(path, argv):
        calls.append((path, argv))
        raise RuntimeError("exec called, test stopped before connecting")

    monkeypatch.setattr(os, "execv", fake_exec)
    with pytest.raises(RuntimeError, match="exec called"):
        main()
    assert calls == [(sys.executable, [sys.executable, "-m", "voxera_worker.livekit_agent", "start"])]
