# News tools and readiness

The real-media news-edit adapter is documented in docs/news.md. Research source facts independently of
media permission. Select actual relevant images, article/record views and permitted clips. Retain dated claim
evidence and separate local rights evidence before acquisition. Ingest only repository-local supplied/cleared,
owned, licensed or public-domain originals with `npm run video -- news-ingest`. There is no commercial recorder
or automatic reference downloader. An attribution or CNBC example never proves reuse rights.

Write news-sources.json and news.json: actual-media scenes, original source in/out, commentary/source-audio
tracks, reviewed source word transcripts and speech ranges, claim ids and context. The full supplied commentary
recording stays unchanged; every commentary word is retained exactly once. Use normal preparation/alignment;
TTS, when authorised, remains one invocation with Ming continuity. Never synthesize original source speakers.

Subtitles are required for every audible speaker. Build derives edit-clock captions and SRT, checks gaps,
overlap, split words, missing source transcripts, stale rights and overflow, and creates the full speech mix.
Normal plan-check/build/render/review/deliver commands dispatch to this adapter. Review evidence uses the full
edit mix. Final encoded audio/subtitle/media verification is required for delivery and cannot be waived by an
editorial review disposition. See docs/news.md for exact schema, failure repair and resume commands.
