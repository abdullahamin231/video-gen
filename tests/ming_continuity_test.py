"""No model downloads: exercise the conditioning contract with a recording fake."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from ming_continuity import MingNarrator, REFERENCE_TEXT, speech_fragments


class Waveform:
    def __init__(self, text=None):
        self.text = text

    def numel(self):
        return 240000

    def isfinite(self):
        return self

    def all(self):
        return True

    def abs(self):
        return self

    def max(self):
        return self

    def item(self):
        return 0.1


class Model:
    sample_rate = 24000

    def __init__(self):
        self.calls = []
        self.prompts = []

    def prepare_text(self, text, task, language, length):
        raise AssertionError('Do not use the lossy upstream punctuation splitter')

    def synthesize(self, **kwargs):
        self.calls.append(kwargs)
        if 'prompt_wav_path' in kwargs:
            self.prepare_prompt(kwargs['prompt_wav_path'], kwargs['use_spk_emb'])
        return Waveform(kwargs['text'])

    def prepare_prompt(self, path, use_spk_emb):
        if (path, use_spk_emb) not in self.prompts:
            self.prompts.append((path, use_spk_emb))


class ContinuityTests(unittest.TestCase):
    def test_all_fragments_and_segments_share_one_reference(self):
        model = Model()
        narrator = MingNarrator(model, '.cache/test-reference.wav')
        opening = ' '.join(f'word{i}' for i in range(30)) + '. Next thought.'
        chunks = [w.text for w in narrator.synthesize(opening)]
        self.assertEqual(' '.join(chunks), opening)
        self.assertEqual(len(chunks), 2)
        self.assertEqual([w.text for w in narrator.synthesize('[Sigh] Last thought.')],
                         ['[Sigh] Last thought.'])
        anchor, *speech = model.calls
        self.assertEqual(anchor['text'], REFERENCE_TEXT)
        self.assertEqual(anchor['task'], 'IP')
        self.assertEqual(anchor['controls'], {'ip': 'US_James'})
        self.assertTrue(anchor['use_zero_spk_emb'])
        self.assertTrue(anchor['raw_text'])
        self.assertEqual(len(model.prompts), 1)
        for call in speech:
            self.assertEqual(call['prompt_wav_path'], anchor['output_path'])
            self.assertEqual(call['prompt_text'], REFERENCE_TEXT + ' ')
            self.assertTrue(call['use_spk_emb'])
            self.assertFalse(call['use_zero_spk_emb'])
            self.assertTrue(call['raw_text'])
            self.assertEqual(call['task'], 'TTS')
            self.assertNotIn('controls', call)

    def test_long_unpunctuated_fragment_is_bounded_without_losing_words(self):
        text = ' '.join(f'word{i}' for i in range(150))
        model = Model()
        chunks = [w.text for w in MingNarrator(model, '.cache/test-reference.wav').synthesize(text)]
        self.assertEqual(' '.join(chunks), text)
        self.assertTrue(all(len(chunk.split()) <= 24 for chunk in chunks))
        self.assertEqual(len(chunks), 7)

    def test_story_quotes_and_clock_survive_fragmentation_without_empty_requests(self):
        text = ('At 1:13 every night, someone knocks on my apartment door. '
                'I ran for the stairwell. Behind me, my bedroom door creaked open. '
                'In the dark, my voice called from inside the closet: “That was only three.” '
                'And one from the other side of it.')
        chunks = list(speech_fragments(text))
        self.assertEqual(' '.join(chunks), text)
        self.assertTrue(all(any(c.isalnum() for c in chunk) for chunk in chunks))
        self.assertTrue(all(len(chunk.split()) <= 24 for chunk in chunks))

    def test_reference_failure_stops_instead_of_resetting_voice(self):
        model = Model()
        def fail(*args):
            raise ValueError('reference encoding failed')
        model.prepare_prompt = fail
        with self.assertRaisesRegex(ValueError, 'reference encoding failed'):
            list(MingNarrator(model, '.cache/test-reference.wav').synthesize('Speech.'))
        self.assertEqual(len(model.calls), 2)
        self.assertTrue(model.calls[-1]['use_spk_emb'])

    def test_empty_reference_stops(self):
        model = Model()
        class Empty(Waveform):
            def numel(self):
                return 0
        model.synthesize = lambda **kwargs: Empty()
        with self.assertRaisesRegex(ValueError, 'too short'):
            list(MingNarrator(model, '.cache/test-reference.wav').synthesize('Speech.'))

    def test_invalid_speech_stops_before_pcm_conversion(self):
        model = Model()
        class Invalid(Waveform):
            def all(self):
                return False
        model.synthesize = lambda **kwargs: Waveform() if 'output_path' in kwargs else Invalid()
        with self.assertRaisesRegex(ValueError, 'invalid audio'):
            list(MingNarrator(model, '.cache/test-reference.wav').synthesize('Speech.'))

    def test_silent_fragment_is_failure_not_successful_narration(self):
        model = Model()
        class Silent(Waveform):
            def item(self):
                return 1e-6
        model.synthesize = lambda **kwargs: Waveform() if 'output_path' in kwargs else Silent()
        with self.assertRaisesRegex(ValueError, 'silent audio'):
            list(MingNarrator(model, '.cache/test-reference.wav').synthesize('Opening words.'))


if __name__ == '__main__':
    unittest.main()
