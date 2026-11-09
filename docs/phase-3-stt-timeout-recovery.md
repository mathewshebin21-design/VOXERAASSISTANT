# Phase 3 — Missing speech transcription recovery

**Status:** non-production implementation and offline tests only. This is stacked on draft PR #39. No real media session, call, paid provider or production environment is changed.

## Why this exists

When VAD detects user speech but STT never produces a final transcript, LiveKit emits the user_transcription_timeout event if AgentSession has an explicit transcription_timeout. VOXERA previously did not enable this, so a caller could encounter silence when STT stalls.

## Behavior

- AgentSession configures transcription_timeout to 4 seconds. This is the time following detected speech before LiveKit emits the event; it is a provisional target, **not a measured call latency**.
- On the first consecutive missing transcript, say a short canned repeat request, without invoking the VOXERA brain or storing a fabricated transcript.
- A non-empty **final** transcript resets the consecutive timeout counter. Partial or blank messages do not.
- On the second consecutive timeout, mark the call as failed with reason "speech transcription unavailable", offer the existing polite closing line using TTS, then request shutdown. Shutdown is bounded to 3 seconds even if TTS hangs or fails.
- If the first fallback TTS cannot be queued at all, fail closed immediately.
- Add non-PII error markers to the call's event recorder. The shutdown callback finalizes the call record and its status is failed, not completed.
- Duplicate/late timeout events are ignored after a call closes.

## Scope and limitations

This does not test acoustic echo cancellation, distinguish coughing from actual caller speech, or measure STT quality, first audio, interruptions or real TTS failures. Real media quality remains gated by provider selection, budget caps, isolation, and jurisdiction reviews.

Code uses LiveKit's public events and AgentSession.say mechanism; offline tests fake them. It does not add an LLM or directly call any speech vendor. The staging container continues to reject media enablement and SIP.

## Release and acceptance

- Review the implementation and run worker CI, including the actual LiveKit package constructor and event tests.
- Check that existing call-record and credential mismatch behavior is unchanged.
- Independently approve the staged audio test environment before activating the media inference flag.
- Continue to require explicit approval for any production merge or release.
