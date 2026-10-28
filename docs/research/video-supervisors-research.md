# Financial, political and tech-blogging video research

Research date: 23 October 2026. Research and proposed architecture only: no production, pipeline changes, model installation, footage downloads or recordings.

**Design update (26 October 2026):** The presentation-style and document/photo formats proposed below are
superseded by the footage-led [financial](../../personalities/news-financial/DESIGN.md) and
[political](../../personalities/news-political/DESIGN.md) design instructions.

## Recommendation

Keep three production supervisors: the existing scientific/technical explainer, a financial briefing supervisor, and a political commentary supervisor. Keep tech-product blogging as a separate research track until its format and evidence workflow are settled. A product review is different from explaining a technical concept, even when both concern technology.

Share the production machinery, but give each supervisor its own editorial instructions, visual vocabulary, asset permissions, narration direction, thumbnail rules and review criteria. These should be versioned production profiles, rather than a handful of color/layout presets.

## Financial videos

Start with an original narrated financial briefing. Use clean presentation-style scenes: one claim or question per scene, large numbers, original charts, short sourced quotations, cleared photographs, comparison tables and occasional presenter commentary. No cartoon characters or illustrated metaphors. A circular presenter at bottom left is optional; reserve space so it cannot cover chart labels, source captions or subtitles.

Suggested story sequence: what changed → the underlying numbers → competing explanations → implications and uncertainty → what to watch next. The commentary must add analysis instead of simply reading headlines. Distinguish reported facts, interpretation and forecasts. Show the date, period, units, currency and source on charts; distinguish nominal from inflation-adjusted values and actual results from estimates where relevant. These are proposed editorial rules, not findings about the reference channel.

The supplied [FinVid reference](https://www.youtube.com/watch?v=dN1RHfd86F4) is titled “CNBC, Fox, Yahoo & Schwab Today On NVIDIA Stock, Micron Stock, SpaceX, Meta Earnings - NVDA Update.” Its description identifies those networks and its chapters include named broadcast segments. The title, description and chapter list were inspected through the browser; the entire 56-minute program was not reviewed. No broadcast footage was downloaded or recorded. Its rights arrangements cannot be inferred from public availability.

That clip-roundup approach does not meet the user's requirement if the clips are unlicensed. Borrow the idea of a topical roundup with analysis; build the visual material ourselves or obtain explicit rights.

Use direct primary data where possible. [BLS](https://www.bls.gov/opub/copyright-information.htm) says its publications are public domain except previously copyrighted photos and illustrations. [BEA](https://www.bea.gov/index.php/help/faq/145) says its website information is public domain unless otherwise stated. Redraw charts from permitted data rather than copying commercial chart interfaces. Market data needs a provider agreement that permits the intended public display; a personal API subscription is not enough by itself.

[FRED's legal terms](https://fred.stlouisfed.org/legal/) distinguish series permissions and impose additional prohibited-use conditions, including AI-related restrictions. Do not assume everything on FRED is unrestricted or automatically feed FRED content into an agent pipeline. Prefer the originating agency when its terms permit the workflow. Company filings can supply facts, but photographs, designed pages and third-party material within them still need their own assessment.

## Political videos

Start with a document-and-photo commentary format: a specific event or claim, original explanation, a timeline, cleared portraits/location photographs, vote counts or other original charts, and short document quotations with dates and sources. Articles should be research inputs. Summarize in our own words and link them; full-page recordings and article screenshots are not a rights-free substitute for broadcast footage.

Suggested story sequence: what happened → what the primary record says → what relevant parties say → analysis → what remains unverified or unresolved. Distinguish allegations, established facts, quotations and the presenter's opinion. Preserve the context of a quotation or edited clip, and avoid presenting unrelated archival imagery as current footage.

The circular head at bottom left can be an owned presenter recording or an authorized synthetic presenter. Give the presenter dedicated space, and enlarge it for original commentary when useful. Do not make a politician appear to say invented lines, or use generated imagery as documentary evidence. YouTube requires disclosure for qualifying realistic [altered or synthetic content](https://support.google.com/youtube/answer/14328491?hl=en-au).

Clips can be a later, separately enabled mode using owned, explicitly licensed or verified public-domain recordings. Obtain the original source file instead of a broadcaster's packaged version, whose graphics, music and editing can introduce separate rights. Government hosting alone is insufficient: the [Library of Congress](https://www.loc.gov/legal/security-copyright-and-privacy/understanding-copyright/) explains that qualifying federal employee works are generally public domain in the US, but collections also contain third-party works. The [Federal Reserve Board](https://www.federalreserve.gov/disclaimer.htm) identifies third-party exceptions. [UK Parliament clips](https://www.parliament.uk/site-information/copyright-parliament/pru-licence-agreements/downloading--sharing-terms--conditions/) have specific conditions; check intended use rather than assuming all parliamentary footage is unrestricted.

## Rights and platform constraints

The practical default should be: owned, explicitly licensed for the intended monetized publication, or verified public domain. Copyrighted material can be licensed; the material to exclude is material we lack permission or an applicable basis to use. If the user wants to exclude even licensed commercial stock, the owned/public-domain route remains viable.

Do not base routine production on a fair-use assumption. Commentary, attribution, cropping, a presenter overlay and short duration do not guarantee protection. [YouTube's fair-use guidance](https://support.google.com/youtube/answer/9783148?hl=en) explains that claims can occur even for short uses and that fair use is case-specific. A Content ID claim is not automatically an account ban, but no workflow can guarantee freedom from claims or removal requests.

Copyright clearance and monetization eligibility are separate. [YouTube's monetization policies](https://support.google.com/youtube/answer/1311392?hl=en) flag minimally narrated slideshows, repetitive templates and reused content lacking substantive original value. Presentation-style visuals remain useful when the actual reporting, narration and analysis are original and substantial.

Proposed asset ledger: local file/hash, original URL, rights holder, license/permission evidence, commercial-use and editing permissions, required attribution, access date, restrictions, and any clip in/out times. Keep a separate claim ledger for factual evidence. A source that supports a fact does not automatically grant permission to display its imagery. Missing clearance should cause substitution or omission, not an automatic download. Apply this to thumbnails and music too.

## Local video models for tech blogging

Two different jobs need different tools: generating a presenter and generating supporting shots. None of the following has been installed or benchmarked here; reported speeds are vendor claims, not our measurements.

| Candidate | Suitable role | Practical limitation / recommendation |
| --- | --- | --- |
| [MuseTalk 1.5](https://github.com/TMElyralab/MuseTalk) | Lip-sync an owned presenter video to narration; useful for a small circular head | Modifies the face region rather than creating a complete host performance. The project reports 30+ fps on a V100, not a universal end-to-end speed guarantee. Commercial model use is allowed under its published terms, with dependency licenses checked separately; supplied test media are research-only. First low-complexity presenter candidate. |
| [InfiniteTalk](https://github.com/MeiGen-AI/InfiniteTalk) | Audio-driven image/video animation with more of the body participating | Longer sequences and streaming are supported; continuity and quality still need testing. Apache-2.0 project/model terms, plus base-model/dependency checks. Comparison baseline rather than an assumed best current model. |
| [LongCat-Video-Avatar 1.5](https://github.com/meituan-longcat/LongCat-Video) | Newer avatar candidate for fuller presenter performance | The InfiniteTalk repository points to it as an upgrade. Official examples include distilled/int8 inference using two processes/GPUs. MIT weights; verify the complete stack. Benchmark against MuseTalk before renting hardware for sustained use; do not infer a consumer-GPU minimum. |
| [Wan2.2 TI2V-5B](https://github.com/Wan-Video/Wan2.2) | Short supporting text/image-to-video shots | Official 720-class recipe requires at least 24 GB VRAM with offload and CPU text encoder; its exact landscape size is 1280×704. Apache-2.0. A sensible first supporting-shot candidate on a rented 24 GB GPU. Larger A14B variants have an official single-GPU floor of 80 GB. |
| [LTX-2 family](https://github.com/Lightricks/LTX-2) | Alternative supporting shots with audio-video capabilities | Current README recommends LTX-2.5. The quick-start bundle is roughly 66 GiB on disk, not a VRAM requirement. CPU/disk offload and fp8 options exist. [Current license](https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x) has use restrictions and a paid-license requirement for entities at or above $10 million annual revenue, aggregated across affiliates. Do not assume older model-license summaries apply. |

Practical starting hypothesis: MuseTalk for a presenter insert; Wan2.2 5B for optional illustrative shots; original recordings and actual measurements for product review evidence. Benchmark LongCat Avatar if a fuller synthetic host is important. These are candidates by task fit, not a verified visual-quality ranking.

Self-hosted does not mean cost-free: GPU time, model storage, setup, failed generations and review all count. A rented GPU running our own stack is self-hosting, but is not physically local to this machine. Compare cost per accepted minute, including rerolls, rather than advertised generation cost. Do not quote rental prices without selecting a provider, region, GPU and current offer.

No generative model can establish a real phone's battery life, durability or benchmark performance. Use owned hands-on footage, real measurements or attributed third-party findings; never portray simulated tests as our testing. Likewise, software comparisons such as Sim AI versus n8n should use actual permitted screen recordings and reproducible workflows. MKBHD and Joanna Stern can inform pacing and test-driven storytelling, not supply footage, identity or voice.

## Wiring profiles into T3 later

The proposed three profiles are `explainer`, `financial`, and `political`. The not-yet-enabled tech-blogging profile could later become `tech-review`. “Create a financial video” selects the financial profile. “Explain how a transistor works” selects the existing explainer. “Review this phone” must not silently fall into that explainer profile; it identifies the research-only tech-review workflow. “Make a news video” needs the subject to distinguish financial and political coverage. Explicit user selection wins; mixed topics require a clear primary treatment.

Proposed instruction packages contain: editorial rules, script structure, scene types, source/rights policy, presenter and voice direction, title/thumbnail rules, and reviewer rubric. Reusable scenes for the new profiles would include original chart, photo with attribution, quotation card, timeline, comparison and cleared video excerpt. Restrict presenter placement consistently. Keep the script, prototype, final and thumbnail checkpoints.

Resolve a profile once at project creation and persist its ID, version and frozen instructions with the project. Include them in every researcher/writer/director/builder/reviewer/thumbnail brief, including retries and repair rounds. A fresh T3 thread should recover this state from disk. Do not rely on a supervisor's conversation memory. Resolve editorial profile separately from provider/model selection: `chat.config.json` currently controls role-model choices, not these styles.

Repository findings: `lib/briefs.mjs` repeatedly says no photos and requires drawings; `docs/SCENE_SPEC.md` defines the normal image primitive as SVG/no photos. `lib/assets.mjs` can import raster/video formats, defaults to blocking remote raster downloads, and already records source/license/hash metadata. `lib/project.mjs` generates delegated role tasks; `docs/t3-orchestrator.md` defines the current T3 orchestration. These are integration points to inspect during implementation, not proof that a profile switch already exists or that all media playback needs are solved.

Implementation would need profile-aware brief generation and quality checks, explicit cleared-media import rules, and validation of media timing and presenter composition. Simply adding three Markdown files would leave the existing contradictory instructions in force. Add routing/persistence tests and profile-specific prototype examples when implementation is authorized.

## Thumbnail and voice direction to retain

Keep the user's existing explainer UI and script work as the baseline. Voice performance needs a separate audition and human listening pass; model-generated media does not solve narration delivery by itself.

Thumbnail direction: curiosity, stakes and an unresolved question, rather than giving away the answer. Avoid reflexively naming the mechanism (“YOUR PHP EXPOSED”) when that spoils the reveal. “THE BIGGEST HACK OF THE DECADE” needs evidence for that superlative; a mystery hook still has to be truthful. Financial/political packaging should create curiosity about the evidence or consequence without false crisis claims. This research makes no thumbnail changes.
