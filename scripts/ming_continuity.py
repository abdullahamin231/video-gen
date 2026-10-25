"""One acoustic identity for a complete Ming narration (including benchmarks)."""
from pathlib import Path

# Neutral, cue-free and bounded: performance directions must not choose the voice.
REFERENCE_TEXT = (
    'Your browser asks a server for information and receives a response.'
)
CONTINUITY_MODE = 'fixed-acoustic-reference-v1'


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
        fragments = self.model.prepare_text(text, 'IP', 'English', 24)
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
            # Upstream permits an unpunctuated clause to exceed max_length.
            # Bound those outliers too, rather than risk an unbounded decode.
            words = fragment.split()
            for start in range(0, len(words), 24):
                waveform = self.model.synthesize(
                    task='IP', text=' '.join(words[start:start + 24]),
                    controls={'ip': 'US_James'}, language_id='English',
                    prompt_wav_path=self.reference_path, prompt_text=REFERENCE_TEXT,
                    use_spk_emb=True, use_zero_spk_emb=False, raw_text=True,
                )
                if not waveform.numel() or not waveform.isfinite().all():
                    raise ValueError('Ming returned empty or invalid audio')
                yield waveform
