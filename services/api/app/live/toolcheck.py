"""Validation of model-generated tool calls before anything runs.

Anthropic's strict tools already constrain arguments to the schema, but OpenAI-compatible
providers (Groq, Gemini, OpenRouter, Ollama…) do not guarantee it, and a stream can be
cut off mid-call. Every call — from any provider — is checked here against the tool's own
JSON schema: the name must be one of the tools offered for this endpoint, the arguments
must be a JSON object that matches the schema exactly (no unknown keys, all required keys,
right types, enum values, finite numbers, bounded string lengths and array sizes).
Only then is the tool executed. Each tool still validates meaning (dates, ownership,
consent) itself.
"""

import json
import math

MAX_STRING = 2000  # longest string argument any tool accepts
MAX_ITEMS = 100  # longest array argument any tool accepts
MAX_ARGS_BYTES = 20_000  # longest raw argument text accepted from a stream
_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, int | float) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


class ToolCallError(ValueError):
    """A tool call that must not run. The message is safe to show the model so it can retry."""


def _check(schema: dict, value: object, path: str, errors: list[str]) -> None:
    if len(errors) >= 5:
        return
    where = path or "arguments"
    kinds = schema.get("type")
    if kinds is not None:
        kinds = kinds if isinstance(kinds, list) else [kinds]
        if not any(_TYPES.get(k, lambda _v: False)(value) for k in kinds):
            errors.append(f"{where} must be {' or '.join(kinds)}")
            return
    if isinstance(value, float) and not math.isfinite(value):
        errors.append(f"{where} must be a finite number")
        return
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{where} must be one of {', '.join(map(str, schema['enum']))}")
        return
    if isinstance(value, str) and len(value) > MAX_STRING:
        errors.append(f"{where} is too long")
    elif isinstance(value, list):
        if len(value) > MAX_ITEMS:
            errors.append(f"{where} has too many items")
            return
        item = schema.get("items")
        if isinstance(item, dict):
            for i, v in enumerate(value):
                _check(item, v, f"{where}[{i}]", errors)
    elif isinstance(value, dict):
        props = schema.get("properties") or {}
        for k in schema.get("required") or []:
            if k not in value:
                errors.append(f"{where}.{k} is required")
        if schema.get("additionalProperties") is False:
            for k in value:
                if k not in props:
                    errors.append(f"{where} has an unknown field {k!r}")
        for k, v in value.items():
            if isinstance(props.get(k), dict):
                _check(props[k], v, f"{where}.{k}" if path else k, errors)


def _no_constants(token: str) -> object:
    raise ToolCallError(f"arguments contain {token}, which is not valid JSON")


def parse_args(raw: str) -> object:
    """Strict JSON for streamed arguments: rejects NaN/Infinity and oversized payloads."""
    if len(raw) > MAX_ARGS_BYTES:
        raise ToolCallError("arguments are too large")
    if not raw.strip():
        return {}
    try:
        return json.loads(raw, parse_constant=_no_constants)
    except json.JSONDecodeError as e:
        raise ToolCallError(f"arguments are not valid JSON ({e.msg})") from None


def validate_call(tools: dict[str, dict], name: object, args: object) -> dict:
    """Returns the arguments if the call may run; raises ToolCallError otherwise."""
    if not isinstance(name, str) or name not in tools:
        raise ToolCallError(f"unknown tool {str(name)[:60]!r}; use only the tools provided")
    if not isinstance(args, dict):
        raise ToolCallError("arguments must be a JSON object")
    errors: list[str] = []
    _check(tools[name].get("input_schema") or {"type": "object"}, args, "", errors)
    if errors:
        raise ToolCallError("; ".join(errors))
    return args
