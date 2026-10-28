# Titles and thumbnails

Make the topic and reason to watch understandable at feed size. The title and image should complement
each other and accurately represent a payoff in the film. Curiosity, benefit, tension or a concrete question
can work; negativity, secrecy, fixed word counts and a particular layout are not requirements.

Keep numbers, comparisons and implied outcomes supported. An editorial ranking is a prediction, not a
measured click-through result. Preserve approved wording; a thumbnail selection does not implicitly
approve a changed title or description. Obtain the publishing copy decision at the selection checkpoint.

## Format contract

Every variant, preview, chosen thumbnail and archive follows the saved video's exact width and height:
landscape 1920×1080, vertical 1080×1920; custom/square canvases keep their own dimensions. Compose for the
frame rather than stretching or letterboxing another orientation. Preview sizes preserve the same ratio.
The exporter derives dimensions from the job. Check readability in the actual feed-sized preview.

`thumbnails --job <job>` issues maker/reviewer briefs and tracks revisions and selection. Makers produce
`BRIEF.md` (Title, Headline, Description), editable `thumbnail.svg`, and exported PNG/preview via
`thumbnail-export`. The reviewer inspects both images and records `thumbnail-verdict` and ranking. When
the person requested selection, preserve their choice and feedback. `thumbnail-choose` archives the set.
