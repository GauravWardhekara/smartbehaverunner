# Bundled formatter for the Behave Runner VS Code extension.
# Emits one JSON object per line (NDJSON) on stdout for live step updates.
# Requires behave>=1.2.6 (Formatter API).

from __future__ import annotations

import json
import sys
import traceback
from typing import Any, Dict, Optional

from behave.formatter.base import Formatter


def _emit(obj: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _step_location(step: Any) -> str:
    loc = getattr(step, "location", None)
    if not loc:
        return ""
    filename = getattr(loc, "filename", "") or ""
    line = getattr(loc, "line", "") or ""
    return f"{filename}:{line}"


def _step_status(step: Any) -> str:
    """Return Behave's step status name (lowercase). Includes ``undefined`` when no step definition matches."""
    st = getattr(step, "status", None)
    if st is None:
        return "unknown"
    name = getattr(st, "name", None)
    if isinstance(name, str):
        return name.lower()
    return str(st).lower()


def _step_error_text(step: Any) -> Optional[str]:
    """Error message plus Python traceback when Behave captured an exception on the step."""
    parts: list[str] = []
    msg = getattr(step, "error_message", None)
    if msg:
        t = str(msg).strip()
        if t:
            parts.append(t)
    exc = getattr(step, "exception", None)
    if exc is not None:
        tb = getattr(exc, "__traceback__", None)
        if tb is not None:
            try:
                tb_text = "".join(
                    traceback.format_exception(type(exc), exc, tb)
                ).rstrip()
                if tb_text and tb_text not in "\n".join(parts):
                    parts.append(tb_text)
            except Exception:
                pass
        else:
            es = str(exc).strip()
            if es and all(es not in p for p in parts):
                parts.append(es)
    if not parts:
        return None
    return "\n\n".join(parts)


def _status_name(obj: Any) -> str:
    st = getattr(obj, "status", None)
    if st is None:
        return "unknown"
    name = getattr(st, "name", None)
    if isinstance(name, str):
        return name.lower()
    return str(st).lower()


def _scenario_location(scenario: Any) -> str:
    loc = getattr(scenario, "location", None)
    if not loc:
        return ""
    fn = getattr(loc, "filename", "") or ""
    line = getattr(loc, "line", "") or ""
    return f"{fn}:{line}"


class BehaveRunnerLiveFormatter(Formatter):
    """NDJSON stream on stdout; use as second formatter (stdout) alongside JSON file."""

    name = "behave_runner_live"
    description = "Live NDJSON stream for Behave Runner (VS Code)."

    def __init__(self, stream_opener, config):
        super().__init__(stream_opener, config)
        self._feature_name: Optional[str] = None
        self._scenario_name: Optional[str] = None
        self._feature_ref: Any = None
        self._scenario_ref: Any = None
        self._step_queue: list[Any] = []

    def _emit_feature_finished_if_any(self) -> None:
        if self._feature_ref is None:
            return
        _emit(
            {
                "event": "feature_finished",
                "feature": self._feature_name,
                "status": _status_name(self._feature_ref),
            }
        )
        self._feature_ref = None

    def _emit_scenario_finished_if_any(self) -> None:
        if self._scenario_ref is None:
            return
        _emit(
            {
                "event": "scenario_finished",
                "feature": self._feature_name,
                "scenario": self._scenario_name,
                "location": _scenario_location(self._scenario_ref),
                "status": _status_name(self._scenario_ref),
            }
        )
        self._scenario_ref = None

    def feature(self, feature):
        self._emit_scenario_finished_if_any()
        self._emit_feature_finished_if_any()
        self._feature_name = getattr(feature, "name", None) or ""
        self._feature_ref = feature
        self._step_queue.clear()

    def scenario(self, scenario):
        self._emit_scenario_finished_if_any()
        self._step_queue.clear()
        name = getattr(scenario, "name", None) or ""
        self._scenario_name = name
        self._scenario_ref = scenario
        location = _scenario_location(scenario)
        _emit(
            {
                "event": "scenario_started",
                "feature": self._feature_name,
                "scenario": name,
                "location": location,
            }
        )

    def background(self, background):
        # Background model precedes scenarios; keep output tied to following scenario(s).
        pass

    def step(self, step):
        self._step_queue.append(step)

    def match(self, _match):
        if not self._step_queue:
            return
        step = self._step_queue[0]
        keyword = getattr(step, "keyword", "") or ""
        step_name = getattr(step, "name", "") or ""
        _emit(
            {
                "event": "step_started",
                "feature": self._feature_name,
                "scenario": self._scenario_name,
                "location": _step_location(step),
                "keyword": keyword,
                "step": step_name,
            }
        )

    def result(self, step):
        if self._step_queue and self._step_queue[0] is step:
            self._step_queue.pop(0)
        try:
            keyword = getattr(step, "keyword", "") or ""
            step_name = getattr(step, "name", "") or ""
            _emit(
                {
                    "event": "step_finished",
                    "feature": self._feature_name,
                    "scenario": self._scenario_name,
                    "location": _step_location(step),
                    "keyword": keyword,
                    "step": step_name,
                    "status": _step_status(step),
                    "error": _step_error_text(step),
                }
            )
        except Exception as exc:  # noqa: BLE001 — keep Behave run alive
            _emit({"event": "formatter_error", "message": str(exc)})

    def eof(self):
        self._emit_scenario_finished_if_any()
        self._emit_feature_finished_if_any()

    def close(self):
        # Base `Formatter.close()` only closes the stream; some Behave versions or
        # failure paths never call `eof()`, leaving the Live panel without `feature_finished`.
        self.eof()
        super().close()
