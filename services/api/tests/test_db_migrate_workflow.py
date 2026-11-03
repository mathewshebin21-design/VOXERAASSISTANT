"""The db-migrate workflow refuses production migrations from anything but the production branch.

Runs the guard's actual shell from .github/workflows/db-migrate.yml, so the test checks what
GitHub executes. Defence in depth only: GitHub enforces the `production` environment's own
deployment-branch rule and required reviewer server-side, and this workflow file can be edited
on a branch. See docs/pr1-review.md (finding M2) and the tracker's SF-1.
"""

import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

WORKFLOW = Path(__file__).resolve().parents[3] / ".github" / "workflows" / "db-migrate.yml"
PROD_REF = "refs/heads/claude/confident-shannon-7nb05f"
REPO = "mathewshebin21-design/VOXERAASSISTANT"
BASH = shutil.which("bash") or "/bin/bash"


def _wf() -> dict:
    return yaml.safe_load(WORKFLOW.read_text())


def _guards() -> list[dict]:
    jobs = _wf()["jobs"]
    return [jobs["authorize"]["steps"][0], jobs["migrate"]["steps"][0]]


def _run(
    step: dict,
    environment: str,
    ref: str,
    ref_type: str = "branch",
    event: str = "workflow_dispatch",
    repository: str = REPO,
):
    env = {
        "PATH": "/usr/bin:/bin",
        "ENVIRONMENT": environment,
        "REF": ref,
        "REF_TYPE": ref_type,
        "EVENT": event,
        "REPOSITORY": repository,
    }
    # The script is this repository's own workflow; test inputs reach it only through env vars.
    return subprocess.run([BASH, "-e", "-c", step["run"]], env=env, capture_output=True, text=True, timeout=10)  # noqa: S603


def test_both_guards_are_identical_and_read_github_context_through_env():
    a, b = _guards()
    assert a["run"] == b["run"]
    assert (
        a["env"]
        == b["env"]
        == {
            "ENVIRONMENT": "${{ inputs.environment }}",
            "REF": "${{ github.ref }}",
            "REF_TYPE": "${{ github.ref_type }}",
            "EVENT": "${{ github.event_name }}",
            "REPOSITORY": "${{ github.repository }}",
        }
    )
    # No ${{ }} interpolation inside the shell itself: inputs can't inject commands.
    assert "${{" not in a["run"]


def test_guard_runs_before_any_secret_checkout_or_install():
    jobs = _wf()["jobs"]
    auth, mig = jobs["authorize"], jobs["migrate"]
    # The authorize job asks for no environment and touches no secret or code.
    assert "environment" not in auth
    assert len(auth["steps"]) == 1 and "uses" not in auth["steps"][0]
    assert "secrets." not in yaml.safe_dump(auth)
    # migrate waits for it, keeps the protected environment, and guards again as its first step.
    assert mig["needs"] == "authorize"
    assert mig["environment"] == "${{ inputs.environment }}"
    first = mig["steps"][0]
    assert first["name"].startswith("Ref guard") and first["working-directory"] == "."
    assert mig["steps"][1]["uses"].startswith("actions/checkout@")
    # The secret appears only in the migration step, after the guard.
    with_secret = [i for i, s in enumerate(mig["steps"]) if "secrets." in yaml.safe_dump(s)]
    assert with_secret and min(with_secret) > 0


def test_migration_safety_checks_are_unchanged():
    wf = _wf()
    trigger = wf.get("on") or wf.get(True)  # PyYAML reads the bare key `on` as True
    assert set(trigger) == {"workflow_dispatch"}
    assert trigger["workflow_dispatch"]["inputs"]["environment"]["options"] == ["staging", "production"]
    assert wf["concurrency"] == "db-migrate-${{ inputs.environment }}"
    assert wf["permissions"] == {"contents": "read"}
    run = wf["jobs"]["migrate"]["steps"][-1]["run"]
    assert 'scripts/migrate.py --env "$ENVIRONMENT" --check' in run
    assert 'scripts/migrate.py --env "$ENVIRONMENT" --claim --confirm-host "$CONFIRM_HOST"' in run
    assert 'scripts/migrate.py --env "$ENVIRONMENT" --downgrade-to "$DOWNGRADE_TO" --yes' in run


@pytest.mark.parametrize("step_index", [0, 1])
def test_production_from_the_production_branch_is_allowed(step_index):
    r = _run(_guards()[step_index], "production", PROD_REF)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "production migration from refs/heads/claude/confident-shannon-7nb05f allowed" in r.stdout


@pytest.mark.parametrize("step_index", [0, 1])
@pytest.mark.parametrize(
    "ref, ref_type, event",
    [
        ("refs/heads/claude/agent-studio", "branch", "workflow_dispatch"),  # another branch (PR #2)
        ("refs/heads/claude/stoic-davinci-vvk3jg", "branch", "workflow_dispatch"),  # PR #1's branch
        ("refs/heads/staging", "branch", "workflow_dispatch"),
        ("refs/heads/main", "branch", "workflow_dispatch"),
        ("refs/heads/claude/confident-shannon-7nb05f-evil", "branch", "workflow_dispatch"),  # prefix lookalike
        ("refs/heads/x/claude/confident-shannon-7nb05f", "branch", "workflow_dispatch"),  # suffix lookalike
        ("claude/confident-shannon-7nb05f", "branch", "workflow_dispatch"),  # not a full ref
        ("refs/heads/Claude/Confident-Shannon-7nb05f", "branch", "workflow_dispatch"),  # case differs
        ("refs/heads/claude/confident-shannon-7nb05f ", "branch", "workflow_dispatch"),  # trailing space
        ("refs/pull/1/merge", "branch", "workflow_dispatch"),  # pull-request refs
        ("refs/pull/2/head", "branch", "workflow_dispatch"),
        ("refs/tags/claude/confident-shannon-7nb05f", "tag", "workflow_dispatch"),  # tag named like the branch
        (PROD_REF, "tag", "workflow_dispatch"),  # right name, wrong ref type
        (PROD_REF, "", "workflow_dispatch"),
        ("", "branch", "workflow_dispatch"),  # empty ref
        (PROD_REF, "branch", "push"),  # any non-manual trigger
        (PROD_REF, "branch", "pull_request"),
        (PROD_REF, "branch", "pull_request_target"),
        (PROD_REF, "branch", "workflow_call"),
        (PROD_REF, "branch", ""),
    ],
)
def test_production_from_anything_else_is_refused(step_index, ref, ref_type, event):
    r = _run(_guards()[step_index], "production", ref, ref_type, event)
    assert r.returncode == 1, r.stdout
    assert "::error::ref guard:" in r.stdout and "allowed" not in r.stdout


@pytest.mark.parametrize("environment", ["", "prod", "Production", "staging; production", "production "])
def test_unknown_environment_is_refused(environment):
    r = _run(_guards()[0], environment, PROD_REF)
    assert r.returncode == 1 and "unknown environment" in r.stdout


@pytest.mark.parametrize("ref", ["refs/heads/claude/agent-studio", "refs/heads/staging", PROD_REF])
def test_staging_is_unchanged_and_runs_from_any_branch(ref):
    r = _run(_guards()[0], "staging", ref)
    assert r.returncode == 0 and "staging migration" in r.stdout


def test_hostile_ref_text_is_not_executed(tmp_path):
    marker = tmp_path / "pwned"
    r = _run(_guards()[0], "production", f"refs/heads/$(touch {marker})", "branch")
    assert r.returncode == 1 and not marker.exists()


@pytest.mark.parametrize("step_index", [0, 1])
@pytest.mark.parametrize(
    "repository",
    [
        "someone-else/VOXERAASSISTANT",  # a fork
        "mathewshebin21-design/VOXERAASSISTANT-fork",
        "mathewshebin21-design/voxeraassistant",  # case differs
        "",
    ],
)
def test_production_from_another_repository_is_refused(step_index, repository):
    r = _run(_guards()[step_index], "production", PROD_REF, repository=repository)
    assert r.returncode == 1 and "only in mathewshebin21-design/VOXERAASSISTANT" in r.stdout
