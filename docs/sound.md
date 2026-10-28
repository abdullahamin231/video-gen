# Pipeline soundtrack

Narration is fixed. Music and effects are optional creative choices; silence does not require justification.
The pipeline mixes the soundtrack and verifies the encoded MP4 against it. Audio tags in native scene HTML
are not imported into this mix.

## Effects

Place effects in film.json `sounds`:

```json
{"sounds":[{"src":"assets/effects/click.wav","at":{"phrase":"the exact spoken words"},"volume":0.1,"why":"The switch closes"}]}
```

`at` resolves against the measured narration. It can use `wordId`, `occurrence`, `edge` and `offset`.
`align` is `start` (default), `peak` or `end`. `volume` is a linear gain from 0 to 1. Keep the file local
under assets/ and record source/licence in `assets/SOURCES.json`. Use `asset` or the library tools to bring
in cleared files. Build measures effects against speech; fix masking rather than trusting a chosen gain.

## Music

`music --job <job> --src <url|file> --name music/<name>.mp3 --source <page> --license <licence>` imports
and analyses a track. `setup-audio` installs the local analysis environment when needed.

```json
{"music":{"src":"assets/music/track.mp3","source":"source page","license":"licence","trackStart":0,"filmStart":0}}
```

Optional fields: `level` and `duck` (dB), `fadeIn`/`fadeOut` (seconds). Beat analysis is available for
edits where it helps; narrated action does not have to hit every beat. Source speech for actual-media news
belongs in `news.json`, not synthesized effects or the commentary recording.

Build writes `review/sounds.md`. Render writes `review/mix.json`, encoded verification and sound evidence.
The mix applies ducking and a master gain; loudness/peak targets are measured on the exported file. Inspect
masking findings and report measurement limits. Only claim listening when someone actually listened.
