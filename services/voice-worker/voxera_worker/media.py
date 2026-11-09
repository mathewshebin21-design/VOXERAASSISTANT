"""Explicit, opt-in LiveKit speech pipeline configuration.

This module performs local validation only; it never calls inference providers.
The deployment gate rejects speech enablement on staging until owner approval of
real provider billing, residency, and safety checks.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

_MODEL = re.compile(r"^[a-z][a-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_.-]*(?::[A-Za-z0-9_-]+)?$")
_VOICE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


class MediaConfigError(ValueError):
    """Missing or unapproved media configuration (safe, no secrets in message)."""


@dataclass(frozen=True)
class MediaSettings:
    stt_model: str
    tts_model: str
    tts_voice: str


def speech_settings(env: Mapping[str, str]) -> MediaSettings:
    """No implicit provider selections: refuse unless a deliberate opt-in is present."""
    if env.get("VOXERA_MEDIA_ENABLED") != "true":
        raise MediaConfigError("speech media is disabled")
    if env.get("VOXERA_MEDIA_PROVIDER") != "livekit-inference":
        raise MediaConfigError("unsupported speech media provider")
    stt_model = env.get("VOXERA_STT_MODEL", "")
    tts_model = env.get("VOXERA_TTS_MODEL", "")
    voice = env.get("VOXERA_TTS_VOICE", "")
    if not _MODEL.fullmatch(stt_model) or len(stt_model) > 128:
        raise MediaConfigError("invalid or missing STT model")
    if not _MODEL.fullmatch(tts_model) or len(tts_model) > 128:
        raise MediaConfigError("invalid or missing TTS model")
    if not _VOICE.fullmatch(voice):
        raise MediaConfigError("invalid or missing TTS voice")
    return MediaSettings(stt_model=stt_model, tts_model=tts_model, tts_voice=voice)
