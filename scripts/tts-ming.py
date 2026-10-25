"""Ming narration worker, invoked only by npm run video -- tts."""
import argparse
import json
import sys
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
for name in ('source', 'model', 'plan', 'output'):
    parser.add_argument('--' + name, required=True)
args = parser.parse_args()
sys.path.insert(0, args.source)
import numpy as np
import soundfile as sf
import torch
torch.set_num_threads(8)
torch.set_num_interop_threads(1)
torch.manual_seed(1895)
from ming_tts import MingTTS
from ming_continuity import MingNarrator
model = MingTTS(args.model, device='cpu', text_normalization=False)
narrator = MingNarrator(model, Path(args.output).with_name('ming-voice-reference.wav'))
plan = json.loads(Path(args.plan).read_text())
# Keep the model loaded across all phrases. Files live in the wrapper's private cache directory.
with sf.SoundFile(args.output, mode='w', samplerate=24000, channels=1, subtype='PCM_16') as result:
    for index, segment in enumerate(plan['segments']):
        print(f"Ming phrase {index + 1}/{len(plan['segments'])}", flush=True)
        raw = str(Path(args.output).with_name(f'ming-phrase-{index}.wav'))
        converted = raw + '.paced.wav'
        waveform = torch.cat(list(narrator.synthesize(segment['text'])), dim=-1)
        sf.write(raw, waveform.squeeze(0).cpu().float().numpy(), model.sample_rate)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', f"atempo={segment['speed']}",
                        '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', converted], check=True)
        audio, _ = sf.read(converted, dtype='float32')
        if not len(audio) or not np.isfinite(audio).all():
            raise ValueError('Ming returned empty or invalid audio')
        result.write(audio)
        result.write(np.zeros(round(segment['pauseAfter'] * 24000), dtype='float32'))
        Path(raw).unlink()
        Path(converted).unlink()
