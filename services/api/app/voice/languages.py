"""Language registry and provider capabilities (ADR-0006).

Every claim here carries its evidence level, because a vendor saying "supports Hindi" is not the
same as VOXERA having heard a Hindi call work end to end:

- ``tested``      VOXERA ran its own scenarios on this provider and language, with recorded results.
- ``advertised``  the vendor's documentation lists it; VOXERA has not verified it.
- ``unverified``  plausible, but we found no vendor statement we could cite; treat as unsupported
                  unless a workspace explicitly allows unverified routes.
- ``unsupported`` known not to work.

Nothing is ``tested`` yet: no real-audio or real-model run has been approved (Sprint E). Locale
codes are BCP 47 (language-REGION). Regions are where a provider processes data, as we understand
its documentation; they decide routing under a workspace's data-residency policy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Support(str, Enum):
    tested = "tested"
    advertised = "advertised"
    unverified = "unverified"
    unsupported = "unsupported"

    @property
    def rank(self) -> int:
        return {"tested": 3, "advertised": 2, "unverified": 1, "unsupported": 0}[self.value]


class Kind(str, Enum):
    stt = "stt"  # speech to text
    llm = "llm"  # reasoning model
    tts = "tts"  # text to speech


@dataclass(frozen=True)
class Language:
    code: str  # BCP 47, e.g. "hi-IN"
    name: str  # English name
    native_name: str
    script: str  # ISO 15924
    rtl: bool = False
    dialect_notes: str = ""


@dataclass(frozen=True)
class Provider:
    id: str
    kind: Kind
    name: str
    regions: frozenset[str]  # where data is processed: "device", "uk", "eu", "us", "global"
    streaming: bool
    paid: bool
    languages: dict[str, Support] = field(default_factory=dict)  # by base language ("hi") or locale ("en-GB")
    voices: dict[str, tuple[str, ...]] = field(default_factory=dict)  # TTS only: locale -> voice ids
    note: str = ""
    # Integrated in VOXERA's code. Candidates are listed for evaluation (ADR-0006) and never routed to.
    integrated: bool = True

    def support(self, locale: str) -> Support:
        """Locale-specific entry first, then the base language."""
        return self.languages.get(locale) or self.languages.get(base(locale)) or Support.unsupported


def base(locale: str) -> str:
    return locale.split("-", 1)[0].lower()


A, U = Support.advertised, Support.unverified

LANGUAGES: dict[str, Language] = {
    lang.code: lang
    for lang in (
        Language("en-GB", "English (United Kingdom)", "English", "Latn"),
        Language("en-US", "English (United States)", "English", "Latn"),
        Language("en-IN", "English (India)", "English", "Latn"),
        Language("hi-IN", "Hindi", "हिन्दी", "Deva", dialect_notes="Callers often mix Hindi and English"),
        Language("ml-IN", "Malayalam", "മലയാളം", "Mlym", dialect_notes="Callers often mix Malayalam and English"),
        Language("ar-SA", "Arabic (Saudi Arabia)", "العربية", "Arab", rtl=True, dialect_notes="Gulf dialect"),
        Language("ar-AE", "Arabic (United Arab Emirates)", "العربية", "Arab", rtl=True, dialect_notes="Gulf dialect"),
        Language("ar-EG", "Arabic (Egypt)", "العربية", "Arab", rtl=True, dialect_notes="Egyptian dialect"),
    )
}

# Initial development targets (ADR-0006). A target is not a claim of production support.
DEVELOPMENT_TARGETS = ("en-GB", "hi-IN", "ml-IN", "ar-SA")

PROVIDERS: dict[str, Provider] = {
    p.id: p
    for p in (
        # --- speech to text ---
        Provider(
            "browser-stt",
            Kind.stt,
            "Browser speech recognition",
            frozenset({"device"}),
            True,
            False,
            {"en": A, "hi": A, "ml": A, "ar": A},
            note="Voice lab only. Chrome sends audio to Google's speech service, which lists these locales; other "
            "browsers differ. Not usable for phone calls (no browser on a call).",
        ),
        Provider(
            "deepgram",
            Kind.stt,
            "Deepgram (candidate)",
            frozenset({"us", "eu"}),
            True,
            True,
            {"en": A, "hi": A, "ar": U, "ml": U},
            integrated=False,
            note="Candidate server STT for calls. Not integrated, not contracted. Language list to confirm.",
        ),
        Provider(
            "google-stt",
            Kind.stt,
            "Google Cloud Speech-to-Text (candidate)",
            frozenset({"eu", "us", "global"}),
            True,
            True,
            {"en": A, "hi": A, "ml": A, "ar": A},
            integrated=False,
            note="Candidate server STT for calls. Not integrated, not contracted.",
        ),
        Provider(
            "standin-stt",
            Kind.stt,
            "Stand-in (tests)",
            frozenset({"device"}),
            True,
            False,
            {"en": U, "hi": U, "ml": U, "ar": U},
            note="Scripted text, no audio. Simulated results only.",
        ),
        # --- reasoning ---
        Provider(
            "anthropic",
            Kind.llm,
            "Anthropic Claude",
            frozenset({"us", "global"}),
            True,
            True,
            {"en": A, "hi": A, "ml": A, "ar": A},
            note="Default model unchanged. Data-processing region per Anthropic's terms; confirm before routing "
            "data restricted to the UK or EU.",
        ),
        Provider(
            "openai-compatible",
            Kind.llm,
            "OpenAI-compatible endpoint",
            frozenset({"global"}),
            True,
            True,
            {"en": A, "hi": U, "ml": U, "ar": U},
            note="Depends on the configured model and host.",
        ),
        Provider(
            "standin-llm",
            Kind.llm,
            "Stand-in (tests)",
            frozenset({"device"}),
            True,
            False,
            {"en": U, "hi": U, "ml": U, "ar": U},
            note="Scripted replies. Simulated results only.",
        ),
        # --- text to speech ---
        Provider(
            "browser-tts",
            Kind.tts,
            "Browser voice",
            frozenset({"device"}),
            False,
            False,
            {"en": A, "hi": U, "ml": U, "ar": U},
            note="Voice lab only. Voices depend on the device.",
        ),
        Provider(
            "kokoro",
            Kind.tts,
            "Kokoro-82M (on device)",
            frozenset({"device"}),
            False,
            False,
            {"en-GB": A, "en-US": A, "en": A, "hi": U},
            voices={"en-GB": ("bf_emma", "bf_isabella", "bm_george", "bm_lewis"), "en-US": ("af_heart", "af_bella")},
            note="Voice lab only today. Model card grades apply; British voices are rated B- to D.",
        ),
        Provider(
            "elevenlabs",
            Kind.tts,
            "ElevenLabs (eleven_flash_v2_5)",
            frozenset({"us", "global"}),
            True,
            True,
            {"en": A, "hi": A, "ar": A, "ml": U},
            note="Multilingual per vendor documentation; Malayalam not confirmed for this model.",
        ),
        Provider(
            "standin-tts",
            Kind.tts,
            "Stand-in (tests)",
            frozenset({"device"}),
            True,
            False,
            {"en": U, "hi": U, "ml": U, "ar": U},
            note="A short beep. Simulated results only.",
        ),
    )
}


def language(code: str) -> Language:
    try:
        return LANGUAGES[code]
    except KeyError:
        raise ValueError(f"Unknown language {code!r}") from None


def coverage() -> list[dict]:
    """Per language, the best evidence per kind of provider: what the registry claims, and on what basis."""
    out = []
    for lang in LANGUAGES.values():
        row: dict = {"code": lang.code, "name": lang.name, "native_name": lang.native_name, "rtl": lang.rtl}
        for kind in Kind:
            levels = [
                p.support(lang.code) for p in PROVIDERS.values() if p.kind is kind and not p.id.startswith("standin")
            ]
            row[kind.value] = max(levels, key=lambda s: s.rank, default=Support.unsupported).value
        row["development_target"] = lang.code in DEVELOPMENT_TARGETS
        out.append(row)
    return out
