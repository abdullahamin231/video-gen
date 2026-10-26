# Financial and political news edits

Both news personalities use the `news-edit` adapter. Use actual cleared footage with original commentary and brief supporting article/document or real-data inserts, following the selected DESIGN.md. Technical support for stills does not make a page/card slideshow an acceptable news treatment. Cartoons and invented documentary imagery are excluded. Source speech remains distinct from commentary. Both orientations require burned-in subtitles and an SRT sidecar. An actual cleared presenter recording can appear in a circular bottom-left inset; politics uses it when available, never invents one.

## Inputs and source selection

Research primary records and dated reporting before writing. `SCRIPT.md` contains **our commentary only**; do not synthesize quotations as if they were source audio. Record planned source excerpts separately in `VISUALS.md`. Use normal script review, approval, one whole-narration TTS invocation (including Ming continuity), or the supplied recording. Start/prepare through `npm run video -- ...` normally; the script project's frozen profile travels into its film job.

Select relevant media and obtain rights evidence before acquisition. CNBC and similar references describe an editorial format, not permission to copy broadcasts. The adapter intentionally has no commercial recorder or automatic web downloader. Bring cleared originals into the repository using an authorised acquisition route, then ingest them. A missing source/permission causes an actionable source blocker, not an unsupported-news blocker. A factual citation and permission to reproduce a photo, video or page are separate records.

In the prepared job, create `news-sources.json`:

```json
{
  "version": 1,
  "sources": [{
    "id": "event", "kind": "video",
    "url": "https://rights-holder.example/event", "holder": "Rights holder",
    "date": "2026-10-26", "attribution": "Source name / event date / speaker",
    "rights": {
      "basis": "permission", "reuse": true, "edit": true,
      "evidence": "inputs/event-permission.md",
      "authorization": "The user's explicit authorization for this third-party acquisition"
    },
    "transcript": {
      "reviewed": true, "reviewer": "editor id",
      "note": "Compared the full original speech and timestamps with the recording.",
      "speechRanges": [{"start": 10.1, "end": 11.8}],
      "words": [{"text": "Actual", "start": 10.1, "end": 10.7}, {"text": "quotation.", "start": 10.8, "end": 11.8}]
    }
  }],
  "claims": [{
    "id": "event-record", "text": "The claim actually supported by the record",
    "type": "reporting",
    "evidence": [{"url": "https://primary-record.example/record", "date": "2026-10-26", "context": "Event, period, exact passage, limitations and relevant corrections"}]
  }]
}
```

`kind` is `image`, `video` or `audio`. Rights basis is `owned`, `licensed`, `public-domain` or `permission`. All require local nonempty permission evidence, reuse and editing permission. Licensed/permitted third-party media also needs explicit user authorization; optional `expires` must be current. Evidence must document applicable distribution, edits, attribution and any limits; do not set booleans merely because material is public. Government hosting alone does not establish public-domain status. Our source policy requires documented clearance; it does not decide fair use automatically. See [Copyright Office guidance](https://www.copyright.gov/help/faq/faq-fairuse.html) and [Library of Congress reuse guidance](https://www.loc.gov/legal/security-copyright-and-privacy/understanding-copyright/).

Use the source's event date and label archival footage in context. Claims may be `reporting`, `opinion`, `quotation`, `allegation` or `disputed`; every claim needs attributable dated evidence. Financial numbers require their period, units, currency, as-of time and reported/forecast distinction in the claim context. Political quotations and allegations require speaker, context and dispute status. Opinion must be identified as such and its factual premises sourced. Never invent market values, a clip, or a person's identity.

Retain permission evidence in `inputs/`, then:

```bash
npm run video -- news-ingest --job jobs/<slug> --source event --file assets/cleared/event.mp4
```

Input must already be inside this checkout. Ingestion checks rights before copying, freezes bytes under `assets/news/`, records asset/evidence SHA-256 and preserves originals. Changed bytes require a new source id. Build rejects stale ingestion/evidence. Still/article views use the same ingestion path and clearance requirements. A source citation does not permit screenshotting an entire commercial article.

## Editorial timeline

Write `news.json`. All clocks are seconds; no speed changes. Example with a two-second commentary recording and a source excerpt starting ten seconds into its original:

```json
{
  "version": 1, "title": "Approved news title", "duration": 4, "prototype": "analysis",
  "scenes": [
    {"id": "analysis", "at": 0, "duration": 2, "source": "event", "in": 10,
     "silentBroll": true, "silentReason": "Contextual B-roll, not a quotation",
     "context": "Event date, speaker and archival status", "treatment": "Original commentary over the actual source", "claims": ["event-record"]},
    {"id": "quote", "at": 2, "duration": 2, "source": "event", "in": 10,
     "context": "Original speaker in context", "treatment": "Retain the original quotation and audio", "claims": ["event-record"]}
  ],
  "audio": [
    {"id": "comment", "source": "commentary", "in": 0, "out": 2, "at": 0, "speaker": "Editor", "claims": ["event-record"]},
    {"id": "quotation", "source": "event", "in": 10, "out": 12, "at": 2, "speaker": "Original speaker", "claims": ["event-record"]}
  ]
}
```

An image scene omits `in`. Scenes must cover the edit exactly, in order, without gaps. Default `fit: "contain"` preserves context; `cover` requires `cropReason`. Optional `position: [50,50]` chooses crop focus in percent. Attribution/event context occupies a separate top rail. Use moving footage and meaningful cuts as the main picture; still/record inserts support one readable point under the selected DESIGN.md. Optional source-backed overlays/charts should be prepared as cleared original local visuals and cited; a generic animated explainer is not a fallback. `treatment` is descriptive and `position` is a fixed crop focus; neither executes animation. A correctly authored, cleared supporting video can carry a pre-rendered treatment.

Audio uses original source ranges. Commentary is the prepared `assets/narration.wav`; every aligned commentary word must appear exactly once. Originals are unchanged. `npm run video -- news-transcribe --job jobs/<slug> --source <id>` measures local ASR word times
on the original source clock (optional `--model` and `--language`). It writes an unreviewed draft;
compare every audible word/speaker with the original, fix words/speechRanges, then record
`reviewed:true`, `reviewer` and a substantive `note`. ASR is not proof of completeness. Models and
caches stay under this repository `.cache/`; first use needs `uv` and model download access, no credentials.
A reviewed transcript is preserved unless explicitly replaced with `--replace true`.

Retained video speech needs matching audio `at/in/out`. Silent contextual B-roll requires explicit `silentBroll` and `silentReason`; do not use it to silently replace a quotation. Speech tracks cannot overlap, so source speech and commentary remain intelligible and distinguishable. Audio trims use `atrim`, reset timestamps, then sample-based delay onto the edit clock, following the [FFmpeg filter contract](https://ffmpeg.org/ffmpeg-filters.html).

A presenter is optional. Add `presenter: {source, identity, authorizedIdentity:true, context, at, in, duration}` only for an actual cleared video recording. Its speech must also have a matching audio segment, or explicit `silentBroll/silentReason` for a silent inset. The circular mask sits above the subtitle rail at bottom left. Never present a still portrait as lip-synced speech. Independent review must verify identity, context and that the inset does not obscure important source material.

## Required subtitles and acceptance

Commentary word times come from normal preparation/alignment. Source transcripts use **original-file time**, before trimming; include every speaker and complete `speechRanges`. Review transcript accuracy against the recording and document that review. The adapter offsets retained words by `timeline at + word time - source in`. Cuts through words, missing commentary, missing/unreviewed source transcripts, invalid speech coverage, overlaps and subtitle overflow block the build. Timestamp/coverage checks cannot infer omitted words from sound; transcript accuracy remains a mandatory editorial/listening check.

Build writes `assets/news-captions.json`, `assets/subtitles.srt` and the complete `assets/news-mix.wav`. Subtitles distinguish commentary from source speech and identify speakers. Caption grouping is short, uses high contrast and stays inside phone-safe rails for vertical output. Credits remain separate. Review full and phone-size frames and check source lower thirds, context and inset collisions.

```bash
npm run video -- news-check --job jobs/<slug>
npm run video -- plan-check --job jobs/<slug>
npm run video -- build --job jobs/<slug>
npm run video -- next --job jobs/<slug>
```

Normal asset archiving, prototype/final independent reviews and requested human approvals remain in place. Review packs use the **full edit mix**, not the shorter commentary recording. News repair briefs return to the news editor. The final render uses HyperFrames through the normal wrapper and muxes the reviewed speech mix.

`verify` checks encoded size/fps/duration/audio, waveform fidelity against the full mix, subtitle raster samples at onset/middle/end and adjacent frames, and actual-media raster samples against the reviewed edit. `review/news-verification.json` is bound to the exact video and source hashes. Missing/stale subtitle verification blocks `qualifyDelivery` even when review was waived or its round budget exhausted. It cannot be waived as an editorial finding. Inspect final render sync and listen to original/source speech; never claim signal tests prove intelligibility or factual accuracy.

```bash
npm run video -- render --job jobs/<slug>
npm run video -- verify --job jobs/<slug>
npm run video -- deliver --job jobs/<slug>
```

Delivery still requires normal independent review disposition, production report and human checkpoints. SRT is written to `assets/subtitles.srt` and `renders/subtitles.srt` as a delivered local sidecar; captions are also burned into the MP4. Thumbnail generation/export/review/pick/archive follows the video orientation: vertical 1080×1920 and `preview-180x320.png`; landscape default 1920×1080 and `preview-320x180.png`. Exact saved video dimensions remain authoritative for legacy/custom frames, with an aspect-matched preview. No stretching or letterboxing a landscape design into portrait. Normal unlisted-upload policy applies only to an authorised production run, never to software fixtures.

## Resume an existing news project

Do not edit or replace its frozen `production-profile.json`. The renderer recognises the existing `news-edit` capability while preserving the profile hash and creative identity. Catalog updates apply to new projects; explicit current user directions take precedence over old frozen prose. Resume in the checkout containing the implementation and project assets:

```bash
npm run video -- status --project <slug> --json
npm run video -- next --project <slug>
```

The next step may need narration/preparation or a news editor to supply cleared sources and `news.json`. Missing media rights are real prerequisites. This software change does not authorize resuming a waiting film or acquiring commercial references. After code is integrated into its working checkout, its orchestrator can follow these commands normally without an unimplemented-news-adapter blocker.

## Software verification

`node --test tests/news.test.mjs` runs isolated original calibration media through actual HyperFrames MP4 renders for financial landscape and political portrait, plus source/rights/timing/subtitle failures and thumbnail-format checks. Calibration cards and tones are not documentary footage or spoken-news demonstrations. Keep fixtures under checkout `.cache/`; they are never uploaded. These technical checks do not claim an independently approved news film.
