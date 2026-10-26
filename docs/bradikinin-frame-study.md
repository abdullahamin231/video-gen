# Bradikinin: downloaded frame study

25 October 2026. This replaces the earlier two-frame approximation with actual local reference downloads and timestamped visual inspection. The user explicitly authorised downloading and inspecting these references. All source footage is reference-only; none is imported into a production job or the asset library. This is a visual study; the selected downloads contain video only, and no listening review was performed.

## Sample and evidence

| Reference | Local source | Download size | Overview sampling |
| --- | --- | --- | --- |
| [Dog episode](https://www.youtube.com/watch?v=Vpw2D6LsIV0) | 1280×720, 272.73 s | about 9.4 MB | 19 frames, every 15 s |
| [Charging-phone episode](https://www.youtube.com/watch?v=1eKx2HunTbU) | 1280×720, 280.67 s | about 8.7 MB | 19 frames, every 15 s |
| [Sleeping-cat episode](https://www.youtube.com/watch?v=JGRGlHESsXw) | 1280×720, 396.90 s | about 13 MB | 20 frames, every 20 s |
| [Actual portrait cat Short](https://www.youtube.com/shorts/pac91pYEQWs) | 360×640, 25.03 s | about 284 KB | 9 frames, every 3 s |

In addition to these 67 overview samples, I inspected 56 sequence samples: dog 32–43 s at 1 s intervals, cat 52–63.5 s at 0.5 s intervals, and portrait Short 0–9.5 s at 0.5 s intervals. These include duplicate timestamps from the overview; they are 123 sampled images, not 123 unique shots. Explicit frame seeks avoid labelling a midpoint-selected frame as the beginning of an interval. Source hashes, selected metadata and sample timestamps are retained locally.

Raw downloads and full-size frame sets are under `.cache/video-gen/reference-studies/bradikinin-{dog,phone,cat,short}-20261025/`. Each includes source.json and overview.json. Dense sequence manifests are rule-boundary.json, title-transition.json and dense-opening.json. Contact-sheet labels show source seconds, not playback speed. The cached files are analysis material, never footage for our films.

Selected sheets:

- [Dog overview](../.cache/video-gen/reference-studies/bradikinin-dog-20261025/overview-sheet.jpg)
- [Phone overview](../.cache/video-gen/reference-studies/bradikinin-phone-20261025/overview-sheet.jpg)
- [Cat overview](../.cache/video-gen/reference-studies/bradikinin-cat-20261025/overview-sheet.jpg)
- [Portrait overview](../.cache/video-gen/reference-studies/bradikinin-short-20261025/overview-sheet.jpg)
- [Cat title/command transition](../.cache/video-gen/reference-studies/bradikinin-cat-20261025/title-transition-sheet.jpg)
- [Portrait opening sequence](../.cache/video-gen/reference-studies/bradikinin-short-20261025/dense-opening-sheet.jpg)

## What the old specification missed

1. **The finish is textured.** Soft white halation, fine coloured edge separation, sparse dust/grain and intermittent horizontal glitch/tearing are visible. Pure, sharp vector shapes miss a recognisable part of the look. Normal states remain readable; intense interference is temporary.
2. **There are important yellow and green accents.** Yellow appears in eyes, light, viewer pointers and attention details; green checks signal compliance/apparent safety. Red is not the only permitted accent. Devices and rooms also use grayscale surface shading.
3. **There is a specific rule-title grammar.** A heavy uppercase label, black numeral in a white rounded tile, thin red underline, full uppercase command and a seven-cell rail recur. Some rules appear as centred title beats; others share a large room composition.
4. **Captions carry the narration below the visual action.** They are short uppercase phrases, usually one or two lines. Rule commands can be repeated in the title treatment and the narration-caption rail. A rule number by itself is not the reference's complete treatment.
5. **The scene vocabulary is wider than isolated icons.** The sources use rooms, tight face/device close-ups, comparisons, interfaces represented as diagrams, recording/exhibit frames and repeated objects in changing relationships. The dog sample at 150 s also includes a photographic exhibit. That observation is not permission to reuse the photograph.
6. **Portrait has its own composition.** The actual Short uses a large figure/action, generous black area, captions immediately below the action and a small episode label. It does not simply preserve all landscape metadata inside a tiny 16:9 panel.

## Layout and timing observations

The cat rule introduction is especially clear. Around 58 s the prior scene drops away; a title becomes visible around 58.5 s, its command finishes resolving around 59 s, and the demonstration appears around 61.5 s. The 0.5 s sampling interval limits onset accuracy; these are approximate observations, not exact animation durations. A phrase caption is already present below the title during this transition. A type/reveal of the command is visible, rather than seven static instruction slides.

In the dog sequence, the rule card is visible at 35–36 s, the room demonstration begins around 37 s, and related states change at roughly 40 and 42 s. The room remains identifiable while the activity changes. A steady scene is therefore compatible with meaningful internal development.

The portrait sequence holds its initial room/face state across several phrase captions, changes the face around 3–4 s, shows prohibition and compliance symbols around 6.5–7.5 s, then widens the room around 8 s. It supports a caption → visible state/action relationship without forcing a new shot on every word. Audio synchronisation itself was not assessed; the production requirement below uses our actual narration alignment.

Approximate portrait layout guides from the sampled frames: episode label at 10–13% of height; main visual roughly 23–61%; phrase captions around 64–74%, depending on the shot/crop. Use the output's safe zones and legibility checks, not these ranges as universal hard bounds. The source Short is only 360×640, so upscaled frames cannot establish the original font file or precise glow kernel.

## Measurements

[Measurements and source hashes](research/bradikinin-frames-2026-10-25/measurements.json) record the uniform-overview pixel analysis. Landscape median background RGB was [4,4,4]; the Short's was [0,0,0]. Median dark-pixel share (mean RGB below 20) was 91.14% for dog, 78.38% for phone, 81.68% for cat and 82.66% for the Short. This does not mean subjects should be small: filled white silhouettes and black interiors can create large readable subjects with few bright pixels.

The existing frame-stats command produced the following *landscape* diagnostics at two-second sampling, excluding its first/last decoded frames:

| Reference | Ink median | Spread median | Near-blank samples |
| --- | --- | --- | --- |
| Dog | 7.3% | 70.5% | 1.5% |
| Phone | 12.2% | 72.7% | 2.2% |
| Cat | 15.3% | 70.5% | 2.6% |

The frame-stats helper currently scales to a 16:9 measurement plane. Its portrait result would be distorted and is not used to set portrait layout targets. The separate RGB overview measurements preserve the source aspect ratio. Coarse colour masks and sparse sampling can miss short accent flashes; a zero maximum in one overview is not evidence that a colour never appears.

## Required caption implementation

The user's additional instruction is: every numbered rule, such as “1. DO NOT DO X”, must have captions matching the video.

For each rule, the writer/director must specify the number, exact approved command, spoken cue, visual state and caption interval. Display the number together with the full instruction. The reference-style arrangement can be a RULE heading + number tile + command, or a compact numbered command accompanying the portrait action. Keep negation, actor, object and order consistent with the approved script. Do not turn an affirmative rule into a prohibition.

Add short phrase captions from actual narration alignment. A caption must describe the action visible at that moment, not the preceding/following rule. Keep the active rule rail consistent where present, make commands readable at phone size and reserve space so subtitles do not cover pictograms. Review every rule introduction and demonstration. Missing/contradictory captions are blocking. This explicit per-rule numbering requirement is our user's requirement; not every sampled Short contains a numbered title card.

## Production changes made

The rules-story package is now v2. DESIGN.md records the observed finish, accent roles, room/close-up vocabulary, exact command/caption treatment and portrait adaptation. EDITORIAL.md and REVIEW.md carry the caption requirement. TOOLS.md permits explicitly authorised reference-only studies while preserving the normal production ban on acquiring/reusing the creator's material. Existing projects retain their frozen v1 profile; new user direction reaches an active film through its normal revision/checkpoint workflow.

Long episodes have a seven-rule framework, but the sampled Short focuses on one incident and a few instructions. Future short-form briefs should not automatically compress an entire multi-minute seven-rule episode into a few seconds. An already approved seven-rule script stays intact unless the user approves a script revision.

## Reproduce

```bash
npm run video -- reference-study --url https://www.youtube.com/watch?v=Vpw2D6LsIV0 --name bradikinin-dog-20261025 --every 15
npm run video -- reference-study --video .cache/video-gen/reference-studies/bradikinin-cat-20261025/source.mp4 --name bradikinin-cat-20261025 --tag title-transition --start 52 --length 12 --every 0.5
```

The downloader environment and cache remain under .cache/video-gen. The utility never registers a production/library asset. Reference-only authorisation is not a licence for republication. Exact source fonts, uncompressed colour tokens, sound design, narrator identity and whole-channel consistency remain unverified.
