"""Country profiles for what the receptionist says: currency, emergency and urgent-advice numbers.

The business's country comes from the workspace locale (``workspace_settings.locale``, e.g. "en-GB"
→ GB), which already exists, so no migration is needed.

**Safety:** emergency numbers are life-critical. Every entry is public information as we understand
it and is marked ``verified=False`` until checked against an official source for a launch in that
country (ADR-0006 §7). A country without a profile gets generic wording ("your local emergency
number") rather than a guessed number.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RegionProfile:
    country: str  # ISO 3166-1 alpha-2
    name: str  # in a sentence: "the United Kingdom"
    currency: str  # ISO 4217
    currency_words: str  # how a price is said: "forty-five pounds"
    emergency: str  # what to tell a caller in an emergency
    urgent_advice: str | None  # a non-emergency medical line, if there is a well-known one
    verified: bool = False


PROFILES: dict[str, RegionProfile] = {
    p.country: p
    for p in (
        RegionProfile(
            "GB", "the United Kingdom", "GBP", "pounds", "call 999", "call NHS 111 for urgent medical advice"
        ),
        RegionProfile("IN", "India", "INR", "rupees", "call 112", None),
        RegionProfile("AE", "the United Arab Emirates", "AED", "dirhams", "call 999, or 998 for an ambulance", None),
        RegionProfile("SA", "Saudi Arabia", "SAR", "riyals", "call 911, or 997 for an ambulance", None),
        RegionProfile(
            "EG", "Egypt", "EGP", "Egyptian pounds", "call 123 for an ambulance, or 122 for the police", None
        ),
        RegionProfile("US", "the United States", "USD", "dollars", "call 911", None),
    )
}

GENERIC = RegionProfile("ZZ", "", "", "", "call your local emergency number", None)


def country_of(locale: str | None) -> str | None:
    if not locale or "-" not in locale:
        return None
    return locale.split("-", 1)[1].upper()


def profile_for(locale: str | None) -> RegionProfile:
    return PROFILES.get(country_of(locale) or "", GENERIC)


def emergency_sentence(p: RegionProfile) -> str:
    advice = f", or {p.urgent_advice}" if p.urgent_advice else ""
    return f"tell them that in an emergency they should {p.emergency}{advice}"
