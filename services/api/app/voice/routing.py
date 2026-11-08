"""Provider-independent routing and language state (ADR-0006).

``select_route`` picks one speech-to-text, one reasoning and one text-to-speech provider for a
caller's language under a workspace's policy. The rules, in order:

1. **Policy first, never relaxed by a fallback.** A provider is only eligible if every region where
   it processes data is allowed by the workspace, it is not blocked, and (unless the workspace allows
   paid providers) it costs nothing. No fallback, including the language fallback, can reach an
   ineligible provider.
2. **Evidence.** Only ``tested`` or ``advertised`` support counts, unless the workspace explicitly
   allows ``unverified`` routes (for internal testing).
3. **Language fallback.** If no compliant route exists for the caller's language, the workspace's
   fallback language is tried, and the route says so (``language_fallback``) so the receptionist
   can tell the caller.
4. **Ranking.** Among eligible providers: better evidence, then streaming, then the workspace's
   preferred order, then free over paid. Ties keep registry order, so results are deterministic.

``LanguageState`` decides when a call changes language. A detector's guess alone is not enough:
it must be confident, the language must be one the workspace accepts, and it must be heard twice in
a row (one short greeting is not reliable). A manual choice by the caller always wins. Conversation
history is never touched by a switch, so context carries across languages.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .languages import LANGUAGES, PROVIDERS, Kind, Provider, Support, base

EVIDENCE = (Support.tested, Support.advertised)


class NoCompliantRoute(Exception):
    """No provider combination satisfies the workspace policy for the language (or its fallback)."""

    def __init__(self, language: str, gaps: dict[str, str]) -> None:
        self.language, self.gaps = language, gaps
        super().__init__(f"No compliant route for {language}: " + "; ".join(f"{k}: {v}" for k, v in gaps.items()))


@dataclass(frozen=True)
class VoicePolicy:
    """What a workspace allows. Persisting it per workspace needs a migration (not in this change)."""

    default_language: str = "en-GB"
    languages: tuple[str, ...] = ("en-GB",)  # languages the receptionist may speak with callers
    fallback_language: str | None = "en-GB"
    allowed_regions: frozenset[str] = frozenset({"device", "uk", "eu", "us", "global"})
    blocked_providers: frozenset[str] = frozenset()
    allow_paid: bool = False
    allow_unverified: bool = False
    prefer: tuple[str, ...] = ()  # provider ids, most preferred first

    def __post_init__(self) -> None:
        for code in (
            self.default_language,
            *self.languages,
            *([self.fallback_language] if self.fallback_language else []),
        ):
            if code not in LANGUAGES:
                raise ValueError(f"Unknown language {code!r}")
        if self.default_language not in self.languages:
            raise ValueError("The default language must be one of the workspace's languages")
        if self.fallback_language and self.fallback_language not in self.languages:
            raise ValueError("The fallback language must be one of the workspace's languages")


@dataclass(frozen=True)
class Route:
    language: str  # the language the call will actually be conducted in
    requested: str
    stt: str
    llm: str
    tts: str
    language_fallback: bool
    evidence: tuple[tuple[str, str], ...]  # (kind, support level used)
    reasons: tuple[str, ...]


def eligible(p: Provider, policy: VoicePolicy, available: frozenset[str] | None = None) -> str | None:
    """Why a provider may not be used under this policy, or None if it may."""
    if not p.integrated:
        return "not integrated (evaluation candidate)"
    if available is not None and p.id not in available:
        return "not configured in this deployment"
    if p.id in policy.blocked_providers:
        return "blocked by the workspace"
    if not p.regions <= policy.allowed_regions:
        return f"processes data in {', '.join(sorted(p.regions - policy.allowed_regions))}, not allowed"
    if p.paid and not policy.allow_paid:
        return "paid provider not enabled for this workspace"
    return None


def _rank(p: Provider, locale: str, policy: VoicePolicy) -> tuple:
    pref = policy.prefer.index(p.id) if p.id in policy.prefer else len(policy.prefer)
    return (-p.support(locale).rank, not p.streaming, pref, p.paid)


def _pick(
    kind: Kind, locale: str, policy: VoicePolicy, available: frozenset[str] | None
) -> tuple[Provider | None, str]:
    accepted = EVIDENCE + ((Support.unverified,) if policy.allow_unverified else ())
    candidates, why_not = [], []
    for p in PROVIDERS.values():
        if p.kind is not kind:
            continue
        if (reason := eligible(p, policy, available)) is not None:
            why_not.append(f"{p.id} {reason}")
        elif p.support(locale) not in accepted:
            why_not.append(f"{p.id} support is {p.support(locale).value}")
        else:
            candidates.append(p)
    if not candidates:
        return None, "; ".join(why_not) or "no provider of this kind"
    return min(candidates, key=lambda p: _rank(p, locale, policy)), ""


def _try(
    locale: str, policy: VoicePolicy, available: frozenset[str] | None
) -> tuple[dict[Kind, Provider], dict[str, str]]:
    chosen, gaps = {}, {}
    for kind in Kind:
        p, why = _pick(kind, locale, policy, available)
        if p is None:
            gaps[kind.value] = why
        else:
            chosen[kind] = p
    return chosen, gaps


def select_route(requested: str, policy: VoicePolicy, available: frozenset[str] | None = None) -> Route:
    """``available``: provider ids configured in this deployment (keys and caps set); None means all integrated."""
    if requested not in LANGUAGES:
        raise ValueError(f"Unknown language {requested!r}")
    attempts = [requested] if requested in policy.languages else []
    if policy.fallback_language and policy.fallback_language not in attempts:
        attempts.append(policy.fallback_language)
    first_gaps: dict[str, str] = {"language": f"{requested} is not one of the workspace's languages"}
    for i, locale in enumerate(attempts):
        chosen, gaps = _try(locale, policy, available)
        if not gaps:
            reasons = [] if locale == requested else [first_gaps_reason(requested, first_gaps)]
            return Route(
                language=locale,
                requested=requested,
                stt=chosen[Kind.stt].id,
                llm=chosen[Kind.llm].id,
                tts=chosen[Kind.tts].id,
                language_fallback=locale != requested,
                evidence=tuple((k.value, chosen[k].support(locale).value) for k in Kind),
                reasons=tuple(reasons),
            )
        if i == 0 and locale == requested:
            first_gaps = gaps
    raise NoCompliantRoute(requested, first_gaps)


def first_gaps_reason(requested: str, gaps: dict[str, str]) -> str:
    return f"{requested} unavailable ({'; '.join(f'{k}: {v}' for k, v in gaps.items())}); using the fallback language"


@dataclass
class LanguageState:
    """The language a call is being conducted in, and when to change it."""

    policy: VoicePolicy
    threshold: float = 0.80
    confirmations: int = 2  # consecutive confident detections of the same new language
    current: str = ""
    manual: bool = False
    _candidate: str | None = None
    _seen: int = 0
    history: list[tuple[str, str]] = field(default_factory=list)  # (event, language)

    def __post_init__(self) -> None:
        self.current = self.current or self.policy.default_language

    def choose(self, code: str) -> bool:
        """The caller picked a language (keypad or "Hindi, please"). Wins over detection."""
        if code not in self.policy.languages:
            return False
        self._switch(code, "manual")
        self.manual = True
        return True

    def observe(self, detected: str, confidence: float) -> bool:
        """One detector result for one caller utterance. Returns True if the call switched."""
        if self.manual:
            return False
        code = self._match(detected)
        if code is None or code == self.current or confidence < self.threshold:
            self._candidate, self._seen = None, 0
            return False
        if code != self._candidate:
            self._candidate, self._seen = code, 0
        self._seen += 1
        if self._seen >= self.confirmations:
            self._switch(code, "detected")
            return True
        return False

    def _match(self, detected: str) -> str | None:
        """Map a detector's code ("hi", "hi-IN") to one of the workspace's locales."""
        if detected in self.policy.languages:
            return detected
        same = [c for c in self.policy.languages if base(c) == base(detected)]
        return same[0] if same else None

    def _switch(self, code: str, how: str) -> None:
        self.current, self._candidate, self._seen = code, None, 0
        self.history.append((how, code))


def language_instruction(code: str) -> str | None:
    """The line added to the receptionist's per-turn context when a call is not in British English.
    The model replies directly in the caller's language; nothing is machine-translated in between."""
    if code == "en-GB":
        return None
    lang = LANGUAGES[code]
    return (
        f"The caller is speaking {lang.name}. Reply in {lang.name} ({lang.native_name}), in the same "
        "register, and switch back if they switch. Tool calls and their arguments stay in English."
    )
