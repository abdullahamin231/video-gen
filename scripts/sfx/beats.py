"""Beat grid of a music track, checked against its kick drums.

librosa's beat tracker sometimes locks onto the off-beat. This finds the beats, then measures where the low end
(< 120 Hz, the kick) actually hits: it slides the whole grid over one beat period and keeps the shift whose grid
lines sit on the most low-end energy. The plot shows the < 120 Hz waveform with the original grid (grey, dashed) and
the final grid (red) over the whole track and zoomed into three 4-bar windows, so an agent can look and confirm.

usage: python -I beats.py <audio file> <out beats.json> <out plot.png>
"""
import json, sys

import librosa
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from scipy import signal


def main():
    src, out_json, out_png = sys.argv[1:4]
    y, sr = librosa.load(src, sr=22050, mono=True)
    duration = len(y) / sr
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units='time')
    tempo = float(np.atleast_1d(tempo)[0])
    beats = np.asarray(beats, float)
    if len(beats) < 8:
        raise SystemExit(f'only {len(beats)} beats found: this track has no steady beat to cut to')
    period = float(np.median(np.diff(beats)))
    low = signal.sosfiltfilt(signal.butter(4, 120, 'low', fs=sr, output='sos'), y)
    hop = int(0.005 * sr)
    env = np.sqrt(np.convolve(low ** 2, np.ones(hop * 4) / (hop * 4), mode='same'))[::hop]   # 5 ms low-end RMS
    t_env = np.arange(len(env)) * hop / sr
    # kicks: onsets of the low end (< 120 Hz), the drum or bass hits the grid should sit on
    o_env = librosa.onset.onset_strength(y=low, sr=sr, hop_length=hop)
    kicks = librosa.onset.onset_detect(onset_envelope=o_env, sr=sr, hop_length=hop, units='time', backtrack=False)
    kicks = np.asarray([k for k in kicks if np.interp(k, t_env, env) > np.percentile(env, 60)], float)
    def score(shift):
        return float(np.interp(beats + shift, t_env, env, left=0, right=0).sum())

    shifts = np.arange(-period / 2, period / 2, 0.005)
    scores = np.array([score(s) for s in shifts])
    best = float(shifts[int(np.argmax(scores))])
    applied = best if abs(best) > 0.03 else 0.0          # under 30 ms is within a frame: leave the grid alone
    grid = beats + applied
    grid = grid[(grid >= 0) & (grid <= duration)]

    def offsets(g):
        if not len(kicks):
            return None
        d = np.array([kicks[np.argmin(np.abs(kicks - b))] - b for b in g])
        d = d[np.abs(d) < period / 2]
        return {'medianMs': round(float(np.median(np.abs(d))) * 1000, 1) if len(d) else None,
                'onBeat': round(float(np.mean(np.abs(d) < 0.035)), 3) if len(d) else 0.0}

    before, after = offsets(beats), offsets(grid)
    report = {'file': src, 'duration': round(duration, 3), 'tempo': round(tempo, 2), 'period': round(period, 4),
              'shiftApplied': round(applied, 4), 'offBeatLock': abs(abs(best) - period / 2) < 0.06,
              'kickAlignment': {'before': before, 'after': after}, 'beats': [round(float(b), 4) for b in grid],
              'kicks': [round(float(k), 4) for k in kicks], 'plot': out_png,
              'note': 'beats are seconds into the track; the film maps them with music.trackStart / music.filmStart'}
    # plot: whole track + three 4-bar zooms of the < 120 Hz waveform
    fig, axes = plt.subplots(4, 1, figsize=(16, 13))
    t = np.arange(len(low)) / sr
    step = max(1, len(low) // 20000)
    axes[0].plot(t[::step], low[::step], lw=0.5, color='#335')
    axes[0].set_title(f'{src.split("/")[-1]}: < 120 Hz waveform, {tempo:.1f} BPM, grid shifted {applied * 1000:+.0f} ms '
                      f'(kick offset {before and before["medianMs"]} -> {after and after["medianMs"]} ms)')
    for b in grid:
        axes[0].axvline(b, color='r', lw=0.3, alpha=0.5)
    # zoom where the low end hits most often (three windows that do not overlap), so the check sees real kicks
    span = 16 * period
    starts = np.arange(0, max(span, duration - span), period * 4)
    dens = sorted(((int(((kicks >= a) & (kicks < a + span)).sum()), float(a)) for a in starts), reverse=True)
    picks = []
    for n_k, a in dens:
        if all(abs(a - p) >= span for p in picks):
            picks.append(a)
        if len(picks) == 3:
            break
    picks = sorted(picks + [duration * f for f in (0.25, 0.5, 0.75)][:3 - len(picks)])
    for ax, a in zip(axes[1:], picks):
        z = (t >= a) & (t <= a + 16 * period)
        ax.plot(t[z], low[z], lw=0.7, color='#335')
        if applied:
            for b in beats[(beats >= a) & (beats <= a + 16 * period)]:
                ax.axvline(b, color='grey', ls='--', lw=1.2)
        for b in grid[(grid >= a) & (grid <= a + 16 * period)]:
            ax.axvline(b, color='r', lw=1.5, alpha=0.8)
        kz = kicks[(kicks >= a) & (kicks <= a + 16 * period)]
        top = np.abs(low[z]).max() if z.any() else 1
        ax.plot(kz, np.full(len(kz), top * 1.05), 'v', color='orange', ms=8, label='low-end onsets')
        ax.set_title(f'16 beats from {a:.1f} s: red = beat grid' + (', grey dashed = librosa before the shift' if applied else '') + ', orange = low-end onsets (kicks / bass hits)')
        ax.set_xlim(a, a + 16 * period)
    axes[-1].set_xlabel('seconds into the track')
    fig.tight_layout()
    fig.savefig(out_png, dpi=80)
    json.dump(report, open(out_json, 'w'), indent=1)
    print(json.dumps({k: v for k, v in report.items() if k not in ('beats', 'kicks')}, indent=1))


if __name__ == '__main__':
    main()
