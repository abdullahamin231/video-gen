"""Sound evidence from the exported MP4: for every cue, the frame before and after it and the waveform around it.

Everything is read from the delivered file (frames and audio decoded by ffmpeg), never from the WAV mix.
Writes <out>/cue-NNN.png (before | after, waveform +-1.5 s with the cue, beats and other cues marked) and
<out>/overview.png (the whole film's waveform, cue and beat markers, the music's gain under speech).

usage: python -I cue_sheet.py <video.mp4> <cues.json> <out dir>
cues.json: {"fps": 30, "duration": s, "cues": [{"t", "label"}], "beats": [film seconds]}
"""
import json, os, subprocess, sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

SR = 16000


def audio(video):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', video, '-map', '0:a:0', '-ac', '1', '-ar', str(SR),
                          '-f', 'f32le', 'pipe:1'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32)


def frame(video, t, path):
    subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-ss', f'{max(0, t):.3f}', '-i', video, '-frames:v', '1',
                    '-vf', 'scale=480:-2', path], check=True)
    return plt.imread(path)


def main():
    video, cues_file, out = sys.argv[1:4]
    spec = json.load(open(cues_file))
    os.makedirs(out, exist_ok=True)
    fps, cues, beats = spec['fps'], spec['cues'], np.asarray(spec.get('beats') or [])
    x = audio(video)
    t = np.arange(len(x)) / SR
    tmp = os.path.join(out, '_frame.png')
    for i, c in enumerate(cues):
        before, after = c['t'] - 1 / fps, c['t'] + 1 / fps
        fig = plt.figure(figsize=(12, 6.2))
        a1, a2 = fig.add_subplot(2, 2, 1), fig.add_subplot(2, 2, 2)
        a1.imshow(frame(video, before, tmp)); a1.set_title(f'before {before:.3f} s'); a1.axis('off')
        a2.imshow(frame(video, after, tmp)); a2.set_title(f'after {after:.3f} s'); a2.axis('off')
        w = fig.add_subplot(2, 1, 2)
        z = (t >= c['t'] - 1.5) & (t <= c['t'] + 1.5)
        w.plot(t[z], x[z], lw=0.4, color='#334')
        w.axvline(c['t'], color='red', lw=1.6, label='this cue')
        for o in cues:
            if o is not c and abs(o['t'] - c['t']) <= 1.5:
                w.axvline(o['t'], color='orange', lw=0.8)
        for b in beats[(beats >= c['t'] - 1.5) & (beats <= c['t'] + 1.5)]:
            w.axvline(b, color='green', lw=0.6, ls='--')
        w.set_xlim(c['t'] - 1.5, c['t'] + 1.5); w.set_ylim(-1, 1)
        w.set_title(f"{c['t']:.2f} s  {c['label']}   (red: cue, orange: other cues, green dashed: beats; decoded from the MP4)")
        fig.tight_layout(); fig.savefig(os.path.join(out, f'cue-{i:03d}.png'), dpi=72); plt.close(fig)
    os.remove(tmp) if os.path.exists(tmp) else None
    fig, ax = plt.subplots(figsize=(18, 4))
    step = max(1, len(x) // 40000)
    ax.plot(t[::step], x[::step], lw=0.3, color='#334')
    for c in cues:
        ax.axvline(c['t'], color='red', lw=0.6)
    for b in beats:
        ax.axvline(b, color='green', lw=0.2, alpha=0.5)
    ax.set_xlim(0, spec['duration']); ax.set_ylim(-1, 1)
    ax.set_title('whole film, decoded from the MP4: red = sound cues and cuts, green = beats')
    fig.tight_layout(); fig.savefig(os.path.join(out, 'overview.png'), dpi=72); plt.close(fig)
    print(f'{len(cues)} cue sheets + overview in {out}')


if __name__ == '__main__':
    main()
