"""CPU benchmark worker. Launched only through npm run video -- tts --benchmark."""
import argparse
import json
import sys
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--model', required=True)
parser.add_argument('--script', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--metrics', required=True)
args = parser.parse_args()
sys.path.insert(0, args.source)
import torch
torch.set_num_threads(8)
torch.set_num_interop_threads(1)
torch.manual_seed(1895)
from ming_tts import MingTTS
from ming_continuity import MingNarrator, CONTINUITY_MODE
import soundfile as sf

started = time.perf_counter()
model = MingTTS(args.model, device='cpu', text_normalization=False)
loaded = time.perf_counter()
print('Ming model loaded on CPU', flush=True)
narrator = MingNarrator(model, Path(args.output).with_suffix('.reference.wav'))
try:
    waveform = torch.cat(list(narrator.synthesize(Path(args.script).read_text())), dim=-1)
    sf.write(args.output, waveform.squeeze(0).cpu().float().numpy(), model.sample_rate)
finally:
    Path(narrator.reference_path).unlink(missing_ok=True)
finished = time.perf_counter()
metrics = dict(continuityMode=CONTINUITY_MODE, modelLoadSeconds=loaded-started, synthesisSeconds=finished-loaded,
    nativeDurationSeconds=waveform.shape[-1]/model.sample_rate, sampleRate=model.sample_rate,
    torchVersion=torch.__version__, dtype=str(next(model.model.parameters()).dtype), threads=torch.get_num_threads())
Path(args.metrics).write_text(json.dumps(metrics, indent=2))
print(json.dumps(metrics), flush=True)
