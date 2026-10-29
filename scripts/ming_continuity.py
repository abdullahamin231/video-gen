"""One acoustic identity for a complete Ming narration."""
from pathlib import Path
import re

# Neutral, cue-free and bounded: performance directions must not choose the voice.
REFERENCE_TEXT = (
    'Your browser asks a server for information and receives a response.'
)
CONTINUITY_MODE = 'fixed-acoustic-reference-v2'


def speech_fragments(text, limit=24):
    """Bound English requests without rewriting punctuation or orphaning quotes."""
    pending = []
    sentences = re.split(r'(?<=[.!?])\s+|(?<=[.!?]["”])\s+', text.strip())
    for sentence in sentences:
        words = sentence.split()
        if pending and len(pending) + len(words) > limit:
            yield ' '.join(pending)
            pending = []
        while len(words) >= limit:
            yield ' '.join(words[:limit])
            words = words[limit:]
        pending.extend(words)
    if pending:
        yield ' '.join(pending)


class MingNarrator:
    def __init__(self, model, reference_path):
        self.model = model
        self.reference_path = str(Path(reference_path).resolve())
        self.ready = False

    def synthesize(self, text):
        """Yield bounded fragments, each conditioned on the same reference.

        Explicit raw_text prevents synthesize from silently splitting again and
        resetting speaker conditioning. The reference is never returned as speech.
        Failure propagates; there is no unconditioned fallback.
        """
        fragments = speech_fragments(text)
        if not self.ready:
            reference = self.model.synthesize(
                task='IP', text=REFERENCE_TEXT, controls={'ip': 'US_James'},
                language_id='English', use_zero_spk_emb=True, raw_text=True,
                output_path=self.reference_path,
            )
            if reference.numel() < self.model.sample_rate * 2 or not reference.isfinite().all():
                raise ValueError('Ming voice reference is invalid or too short')
            # synthesize encodes/caches this prompt under its inference-mode
            # context on first use; do not encode it here with gradients enabled.
            self.ready = True
        for fragment in fragments:
            waveform = self.model.synthesize(
                # IP selects the reference voice once. Continuations use
                # acoustic cloning without a competing IP instruction:
                # combining both can make Ming stop before speaking.
                task='TTS', text=fragment, language_id='English',
                prompt_wav_path=self.reference_path, prompt_text=REFERENCE_TEXT + ' ',
                use_spk_emb=True, use_zero_spk_emb=False, raw_text=True,
            )
            if not waveform.numel() or not waveform.isfinite().all():
                raise ValueError('Ming returned empty or invalid audio')
            if waveform.abs().max().item() < 1e-4:
                raise ValueError('Ming returned silent audio for a spoken fragment')
            yield waveform
