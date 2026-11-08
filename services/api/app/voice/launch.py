"""Launch gate per country (ADR-0006 §7): what must be signed off before real callers in a country.

A country is ready only when every check below has a named sign-off. Nothing is signed off today,
so ``ready(country)`` is False everywhere; the voice worker and any future telephony routing must
refuse live calls for a business in a country that is not ready.

Sign-offs are recorded here in code (reviewed in a pull request), not set at runtime, so a launch is
always a visible, reviewable change.
"""

from __future__ import annotations

from dataclasses import dataclass

from .regions import PROFILES

CHECKS: dict[str, str] = {
    "emergency_numbers": "Emergency and urgent-advice numbers and wording checked against an official source",
    "ai_disclosure": "AI-disclosure and recording-notice wording meets local law; legal review recorded",
    "data_transfer": "Data-processing regions and processors approved for this country (DPA, transfers)",
    "telephony": "Licensed number or SIP provider for this country contracted and tested",
    "emergency_call_flow": "A test call describing an emergency reaches the correct advice and hand-off",
    "language_tested": "Each language offered there has 'tested' evidence from recorded calls",
}


@dataclass(frozen=True)
class SignOff:
    check: str
    by: str  # a named person or role, e.g. "owner"
    on: str  # ISO date
    evidence: str  # link or document reference


# country -> sign-offs. Empty until a launch review happens; additions need the owner's approval.
SIGN_OFFS: dict[str, tuple[SignOff, ...]] = {}


def blockers(country: str) -> list[str]:
    """The checks still missing for a country, in a fixed order. Unknown countries miss everything,
    plus a profile."""
    done = {s.check for s in SIGN_OFFS.get(country.upper(), ()) if s.check in CHECKS and s.by and s.on and s.evidence}
    missing = [CHECKS[c] for c in CHECKS if c not in done]
    if country.upper() not in PROFILES:
        missing.insert(0, "No country profile (currency, emergency wording) exists yet")
    return missing


def ready(country: str) -> bool:
    return not blockers(country)


def status() -> list[dict]:
    """Every profiled country with its outstanding checks (for the dashboard and reports)."""
    return [{"country": c, "name": p.name, "ready": ready(c), "blockers": blockers(c)} for c, p in PROFILES.items()]
