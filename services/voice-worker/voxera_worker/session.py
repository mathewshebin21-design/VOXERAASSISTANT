"""One call's session: turn-taking around the VOXERA brain, independent of any media framework.

The media layer (LiveKit Agents in ``livekit_agent.py``, or a test) owns audio, speech recognition,
speech output, end-of-turn detection and barge-in. It calls ``reply()`` once per caller turn and
speaks what comes back; if the caller interrupts, it cancels the iteration, and the brain request
is closed with it.

Rules from ADR-0005 implemented here:
- **Filler:** if no reply text arrives within ``filler_after`` seconds, say a short holding line once.
- **Per-turn deadline:** a turn that runs past ``turn_deadline`` seconds is abandoned with the
  recovery line (the API's own limit is 60 s; a caller will not wait that long).
- **Failures:** a failed turn gets the recovery line. After ``max_failures`` failures in a row the
  call stops using the brain and only takes a message (name, number, reason), deterministically.
- **Call limit:** after ``max_call_seconds`` the session closes politely.
- **Language:** the caller's language is tracked with confirmation (two confident detections, or
  the caller's own choice) and sent with each turn; history is never altered by a switch.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

from .brain import BrainClient, BrainError, TurnEvents

FILLER = "One moment, I'm just checking that."
RECOVERY = "Sorry, I'm having a little trouble with that. Could you say it again?"
MESSAGE_START = (
    "I'm sorry, I'm having trouble on my side. I'll take a message so the team can call you back. "
    "Could I take your name, please?"
)
MESSAGE_STEPS = ("And the best number to reach you on?", "And briefly, what is it about?")
MESSAGE_DONE = "Thank you. I've passed that on and the team will call you back as soon as they can."
CLOSING = "I'm sorry, we've reached the time limit for this call. The team will be happy to help if you call back."


@dataclass
class TurnRecord:
    caller: str
    reply: str = ""  # the brain's words only
    worker_line: str = ""  # filler, recovery, message-taking or closing line spoken by the worker
    outcome: str = "done"  # done | filler_then_done | failed | timeout | interrupted | message_mode | closed
    first_text_ms: int | None = None
    total_ms: int = 0
    tools: list[dict] = field(default_factory=list)
    language: str = ""
    server_metrics: dict = field(default_factory=dict)


@dataclass
class LanguageGate:
    """Same rule as the API's LanguageState (app/voice/routing.py), kept dependency-free here."""

    accepted: tuple[str, ...] = ("en-GB",)
    current: str = "en-GB"
    threshold: float = 0.8
    confirmations: int = 2
    manual: bool = False
    _candidate: str | None = None
    _seen: int = 0

    def choose(self, code: str) -> bool:
        if code not in self.accepted:
            return False
        self.current, self.manual, self._candidate, self._seen = code, True, None, 0
        return True

    def observe(self, detected: str | None, confidence: float) -> bool:
        if self.manual or not detected:
            return False
        code = next((c for c in self.accepted if c == detected or c.split("-")[0] == detected.split("-")[0]), None)
        if code is None or code == self.current or confidence < self.threshold:
            self._candidate, self._seen = None, 0
            return False
        if code != self._candidate:
            self._candidate, self._seen = code, 0
        self._seen += 1
        if self._seen >= self.confirmations:
            self.current, self._candidate, self._seen = code, None, 0
            return True
        return False


class CallSession:
    def __init__(
        self,
        brain: BrainClient,
        *,
        language: LanguageGate | None = None,
        filler_after: float = 1.5,
        turn_deadline: float = 12.0,
        max_failures: int = 2,
        max_call_seconds: float = 15 * 60,
        on_handoff: Callable[[dict], None] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.brain = brain
        self.language = language or LanguageGate()
        self.filler_after, self.turn_deadline = filler_after, turn_deadline
        self.max_failures, self.max_call_seconds = max_failures, max_call_seconds
        self.on_handoff = on_handoff
        self.clock = clock
        self.conversation_id = f"call-{uuid.uuid4().hex[:16]}"
        self.started = clock()
        self.history: list[dict] = []  # what the brain sees: {"role": "user"|"assistant", "text": ...}
        self.turns: list[TurnRecord] = []
        self.failures = 0
        self.message_mode = False
        self.message: list[str] = []  # caller answers collected in message mode
        self.handoffs: list[dict] = []
        self.closed = False

    # ---- one caller turn ---------------------------------------------------------------------

    async def reply(
        self, caller_text: str, detected_language: str | None = None, confidence: float = 0.0
    ) -> AsyncIterator[str]:
        """What to say back. Cancel the iteration to interrupt (barge-in); the brain request closes."""
        rec = TurnRecord(caller=caller_text)
        self.turns.append(rec)
        t0 = self.clock()
        try:
            if self.closed or self.clock() - self.started > self.max_call_seconds:
                self.closed, rec.outcome = True, "closed"
                yield await self._say(rec, CLOSING)
                return
            self.language.observe(detected_language, confidence)
            rec.language = self.language.current
            if self.message_mode:
                rec.outcome = "message_mode"
                yield await self._say(rec, self._message_step(caller_text))
                return
            self.history.append({"role": "user", "text": caller_text})
            async for piece in self._brain_turn(rec):
                yield piece
        except asyncio.CancelledError:
            rec.outcome = "interrupted"
            raise
        except GeneratorExit:
            rec.outcome = "interrupted"
            raise
        finally:
            rec.total_ms = int((self.clock() - t0) * 1000)
            # Only the brain's own words go back into its history: never the worker's recovery,
            # message-taking or closing lines, and nothing for a turn the brain did not answer.
            if rec.reply:
                spoken = rec.reply + (" …" if rec.outcome == "interrupted" else "")
                self.history.append({"role": "assistant", "text": spoken})

    async def _brain_turn(self, rec: TurnRecord) -> AsyncIterator[str]:
        events = TurnEvents()
        queue: asyncio.Queue[str | BaseException | None] = asyncio.Queue()

        async def pump() -> None:
            try:
                async for piece in self.brain.stream(self.history, self.conversation_id, rec.language, events):
                    await queue.put(piece)
                await queue.put(None)
            except BaseException as e:  # noqa: BLE001 — handed to the consumer
                await queue.put(e)

        task = asyncio.create_task(pump())
        deadline = self.clock() + self.turn_deadline
        said_filler = False
        try:
            while True:
                remaining = deadline - self.clock()
                if remaining <= 0:
                    raise TimeoutError
                wait = remaining if (said_filler or rec.reply) else min(remaining, self.filler_after)
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=wait)
                except TimeoutError:
                    if not said_filler and not rec.reply and self.clock() < deadline:
                        said_filler, rec.outcome = True, "filler_then_done"
                        yield await self._say(rec, FILLER)
                        continue
                    raise
                if item is None:
                    break
                if isinstance(item, BaseException):
                    raise item
                rec.reply += item
                yield item
            self.failures = 0
            rec.tools, rec.server_metrics, rec.first_text_ms = events.tools, events.metrics, events.first_text_ms
            if events.handoff:
                self.handoffs.append(events.handoff)
                if self.on_handoff:
                    self.on_handoff(events.handoff)
        except (BrainError, TimeoutError, OSError) as e:
            rec.outcome = "timeout" if isinstance(e, TimeoutError) else "failed"
            self.history.pop()  # the brain never answered this caller turn; keep history consistent
            self.failures += 1
            if self.failures >= self.max_failures:
                self.message_mode = True
                yield await self._say(rec, MESSAGE_START)
            else:
                yield await self._say(rec, RECOVERY)
        finally:
            task.cancel()

    async def _say(self, rec: TurnRecord, text: str) -> str:
        rec.worker_line += text
        return text

    def _message_step(self, answer: str) -> str:
        self.message.append(answer[:500])
        n = len(self.message)
        return MESSAGE_STEPS[n - 1] if n <= len(MESSAGE_STEPS) else MESSAGE_DONE

    # ---- reporting -----------------------------------------------------------------------------

    def summary(self) -> dict:
        firsts = [t.first_text_ms for t in self.turns if t.first_text_ms is not None]
        return {
            "conversation_id": self.conversation_id,
            "turns": len(self.turns),
            "outcomes": {o: sum(t.outcome == o for t in self.turns) for o in {t.outcome for t in self.turns}},
            "message_mode": self.message_mode,
            "message_fields_collected": len(self.message),
            "handoffs": len(self.handoffs),
            "language": self.language.current,
            "first_text_ms_max": max(firsts) if firsts else None,
        }
