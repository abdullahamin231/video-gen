# Sound: music, sound effects and the mix

Every film's soundtrack is the supplied narration plus, where they serve the film, sound effects and one licensed
music track. Agents cannot hear, so every step is measured and never judged by feel. Never write that the film
"sounds good": report the measurements and the five headphone checks the pipeline picks.

## The rules

1. **Music is licensed, never synthesized.** Use a track the person gave (`start --music <file>`), or one under
   Mixkit's free licence (`https://mixkit.co/free-stock-music/`, Stock Music Free License). Record where it came from
   and the licence named on its page. Non-commercial, no-derivatives, personal-use or editorial-only licences are
   refused by the pipeline.
2. **Find the beats with librosa, then check them against the kicks.** librosa sometimes locks onto the off-beat. The
   `music` command plots the waveform below 120 Hz against the beat grid, zoomed into a few bars where the low end
   hits most, and shifts the whole grid when the kicks sit between the lines. Look at the plot: red grid lines must
   sit on the low-end hits (orange marks; small pickup notes just before a hit are normal).
3. **Big moves land on the beat.** Scene cuts and titles appearing first, then camera moves, drops, stamps and
   transformations. The build reports which land within ±50 ms of a beat and the `trackStart` that lands the most.
   If you can change the animation, nudge its `at` offset onto the beat where the narration allows. If you can't
   (the cue is a spoken word), move where the music starts.
4. **Every cut and big move gets one ready-made sound effect** from the library: whoosh for movement and cuts, pop
   for things appearing, click for clicks and stamps, typing for typing, impact for heavy verdicts. The library's
   `sfx-*` bundles come first (`library-search --query "sfx whoosh"`). Do not make new sounds in code during a film.
   When no variant fits a move, leave the move silent and say why in the shot's `notes`. The build lists moves without a sound.
5. **The voice is the loudest thing.** Music drops while someone talks (it is ducked automatically under speech) and
   comes back up between sentences. Sound effects sit above the music but at least 6 dB under the voice while it
   speaks: the build measures each sound against the narration (K-weighted, like LUFS) and prints the volume that
   clears it. The whole mix aims at about **-16 LUFS** with **peaks at or under -4 dBFS** (true peak and sample
   peak, stereo and mono), so nothing clips after AAC compression or on a phone speaker. This is measured on the
   exported MP4 with ffmpeg's `ebur128`, never on the WAV.
6. **Evidence from the exported MP4.** For every cue the pipeline grabs one frame before and one after it and plots
   the waveform around it (`review/sound/cue-*.png`), plus the whole film (`review/sound/overview.png`). It picks
   five timestamps for the person to check with headphones, each because of a measured risk
   (`review/sound/listen.md`, copied into `review/delivery.json` as `headphoneChecks`).

## Tools

```bash
npm run video -- setup-audio      # checks ffmpeg/ffprobe, installs librosa (beat analysis, plots) in .cache/video-gen/audio-env (inside the repository)
```

If ffmpeg is missing, install it (`sudo apt install ffmpeg` or the platform's package) before anything else.
`setup-audio` stops with that instruction when it cannot find ffmpeg.

## Music in a film

```bash
npm run video -- music --job jobs/<slug> --src https://assets.mixkit.co/music/15/15.mp3 --name music/comical.mp3 \
  --title "Comical (Ahjay Stelino)" --source "https://mixkit.co/free-stock-music/tag/funny/" \
  --license "Mixkit Stock Music Free License"
```

It saves the track to `assets/music/` (and the library, with its licence), writes `assets/music/<name>.beats.json`
(tempo, the checked grid, the kick alignment before and after any shift) and `review/music/<name>-beats.png`.
Then add to `film.json`:

```json
"music": {
  "src": "assets/music/comical.mp3",
  "source": "https://mixkit.co/free-stock-music/tag/funny/ (Mixkit track 15, 'Comical' by Ahjay Stelino)",
  "license": "Mixkit Stock Music Free License",
  "trackStart": 0.031,
  "filmStart": 0
}
```

| field | meaning |
|---|---|
| `src`, `source`, `license` | required: the file, the page it came from, the licence named there |
| `trackStart` | seconds into the track that play at `filmStart` (move the music against the picture with this) |
| `filmStart`, `filmEnd` | when the music plays in the film (default: the whole film) |
| `level` | dB of the music under the voice's speech loudness between sentences (default -10) |
| `duck` | extra dB while the narrator speaks (default -12) |
| `fadeIn`, `fadeOut` | seconds (defaults 0.5 and 2) |

## Sound effects in a shot

```json
"sounds": [
  {"src": "assets/library/sfx-whoosh-fast/1.0.0/tight.wav", "at": "okay", "align": "peak", "volume": 0.12, "why": "camera punches in"},
  {"src": "assets/library/sfx-pop/1.0.0/01.wav", "at": "uh-0.05", "why": "the speech bubble pops up"}
]
```

`at` is a cue like an action's. `align`: `start` (the sound begins on the cue: clicks, pops, taps), `peak` (its
loudest moment hits the cue: whooshes, impacts, the landing of a drop) or `end` (it finishes on the cue: a riser
into a reveal, a whoosh that leads into a cut). `volume` (0–1, default 0.3) scales the file; every library file
peaks at -1 dBFS. `why` says what on screen makes the sound. Install a bundle with `library-use`; each has a
`sounds.json` listing its variants with length and loudest moment.

Build errors: a file that is missing or not a WAV, an unknown cue, a sound outside its scene or the film, a volume
outside 0–1, music without a licence or beat grid. Warnings (fix, or keep on purpose and say why in `notes`): a
sound that may mask the voice (with the volume that clears it), no `why`, hits closer than 0.12 s, a crowded scene,
cuts and big moves without a sound, and moves off the beat.

## The mix

`render` renders the picture with HyperFrames (`renders/picture.mp4`), then the pipeline mixes the soundtrack
(`lib/mix.mjs`): the narration untouched, sound effects at their places and volumes, the music levelled against the
voice and ducked under speech. One master gain aims at -16 LUFS without letting peaks pass -4 dB; the MP4 is
measured and the gain comes down until it fits. `review/mix.json` holds every number: integrated loudness, true and
sample peaks (stereo and mono), what limited the gain, moments where effects or music come within 3 dB of the voice,
and sound effects that do not clear the music. Verification compares the MP4 with `renders/mix.wav` (and reports the
narration-only correlation), so the delivered audio is exactly the declared mix.

## The sound library

Existing `sfx-*` bundles contain ready-made whooshes, swishes, swipes, risers, downlifters, zips, impacts,
sub drops, logo stings, clicks, taps, toggles, hover ticks, pops, notification dings, shimmers, key presses,
glitches and typing runs. Search with `library-search --query "sfx whoosh"`, inspect with `library-info`,
and copy a bundle into a job with `library-use`. Each bundle includes a `sounds.json` with variant lengths
and loudest moments. Bundles remain `draft` until a person has listened.
