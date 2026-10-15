"""Cue timing for Manim clips inside a VG film.

The pipeline renders each Manim object with VG_CUES set to {cue_name: seconds after the clip starts}.
Use CueScene instead of Scene and call self.wait_until("cue") between animations so the clip stays
synchronised with the narration. Background is transparent; the film's world shows through.
"""
import json
import os

from manim import Scene, config

CUES = json.loads(os.environ.get("VG_CUES", "{}"))
THEME = json.loads(os.environ.get("VG_THEME", "{}"))
COLORS = {
    "white": "#ece8df", "grey": "#8d96a5", "blue": "#6cb4d6", "yellow": "#e3c46b",
    "red": "#d9796b", "green": "#8cc084", "purple": "#a693d1", "teal": "#5fb8a8", "orange": "#e09a5f",
    **THEME.get("colors", {}),
}


class CueScene(Scene):
    """A Scene that can wait until a narration cue (seconds relative to the clip start)."""

    def cue(self, name):
        if name not in CUES:
            raise KeyError(f"unknown cue {name!r}; available: {sorted(CUES)}")
        return CUES[name]

    def wait_until(self, name, offset=0.0):
        target = self.cue(name) + offset
        remaining = target - self.renderer.time
        if remaining > 1 / config.frame_rate:
            self.wait(remaining)
