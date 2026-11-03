"""Local stand-ins for the Anthropic Messages API, an OpenAI-compatible chat API (the format
Groq, Gemini, OpenRouter and Ollama share) and ElevenLabs TTS, for end-to-end tests.

They speak just enough of each wire format for VOXERA's adapters, so the whole live
path (browser → Next proxy → API → provider) can be exercised without keys or cost.
Usage: python scripts/fake_providers.py [port] [mp3 file]
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MP3 = b"ID3"
if len(sys.argv) > 2:
    with open(sys.argv[2], "rb") as f:
        MP3 = f.read()


def sse(events: list[dict]) -> bytes:
    return b"".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n".encode() for e in events)


def reply(blocks: list[dict], stop: str) -> bytes:
    start = {"id": "msg_fake", "type": "message", "role": "assistant", "model": "fake", "content": []}
    start |= {"stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 800, "output_tokens": 1}}
    evs: list[dict] = [{"type": "message_start", "message": start}]
    for i, b in enumerate(blocks):
        if b["type"] == "text":
            evs.append({"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}})
            for w in b["text"].split(" "):
                evs.append(
                    {"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": w + " "}}
                )
        else:
            block = {"type": "tool_use", "id": "toolu_fake", "name": b["name"], "input": {}}
            evs.append({"type": "content_block_start", "index": i, "content_block": block})
            delta = {"type": "input_json_delta", "partial_json": json.dumps(b.get("input", {}))}
            evs.append({"type": "content_block_delta", "index": i, "delta": delta})
        evs.append({"type": "content_block_stop", "index": i})
    evs.append(
        {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None}, "usage": {"output_tokens": 40}}
    )
    evs.append({"type": "message_stop"})
    return sse(evs)


def chat_reply(messages: list[dict]) -> bytes:
    """OpenAI-compatible streamed reply: list the services, then say them (like the Anthropic fake)."""
    last = messages[-1]
    if last.get("role") == "tool":
        services = json.loads(last["content"])
        names = ", ".join(s["name"] for s in services) or "no services listed"
        # Some open models think out loud in <think> tags; VOXERA must hide that from callers.
        parts = ["<think>The caller wants the list.</think>", *f"We offer {names}. Is there one you'd like?".split(" ")]
        chunks = [{"choices": [{"index": 0, "delta": {"content": w if w.startswith("<") else w + " "}}]} for w in parts]
        chunks.append({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})
    else:
        call = {
            "index": 0,
            "id": "call_fake",
            "type": "function",
            "function": {"name": "list_services", "arguments": "{}"},
        }
        chunks = [
            {"choices": [{"index": 0, "delta": {"tool_calls": [call]}}]},
            {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]},
        ]
    chunks.append({"choices": [], "usage": {"total_tokens": 900}})
    return b"".join(f"data: {json.dumps(c)}\n\n".encode() for c in chunks) + b"data: [DONE]\n\n"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        if self.path.endswith("/chat/completions"):
            self._send(200, "text/event-stream", chat_reply(body["messages"]))
        elif self.path.startswith("/v1/messages"):
            last = body["messages"][-1]["content"]
            said = next((m["content"] for m in reversed(body["messages"]) if isinstance(m["content"], str)), "")
            if (
                isinstance(last, list)
                and last
                and last[0].get("type") == "tool_result"
                and "outcome" in last[0]["content"]
            ):
                out = reply(
                    [{"type": "text", "text": "Of course. I'm putting you through to the team now."}], "end_turn"
                )
            elif isinstance(last, str) and "someone" in said.lower():
                args = {
                    "reason": "caller asked for a person",
                    "summary": f"Caller said: {said[:200]}",
                    "caller_name": None,
                    "caller_phone": None,
                    "urgent": False,
                }
                out = reply([{"type": "tool_use", "name": "transfer_to_staff", "input": args}], "tool_use")
            elif isinstance(last, list) and last and last[0].get("type") == "tool_result":
                services = json.loads(last[0]["content"])
                names = ", ".join(s["name"] for s in services) or "no services listed"
                answer = f"We offer {names}. Is there one you'd like to know more about?"
                out = reply([{"type": "text", "text": answer}], "end_turn")
            else:
                out = reply([{"type": "tool_use", "name": "list_services"}], "tool_use")
            self._send(200, "text/event-stream", out)
        elif "/v1/text-to-speech/" in self.path:
            self._send(200, "audio/mpeg", MP3)
        else:
            self._send(404, "application/json", b'{"error":"not found"}')

    def _send(self, code: int, ctype: str, data: bytes):
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8090), H).serve_forever()
