# Rules-story design: Bradikinin frame-study specification

Based on downloaded, timestamped frames from three landscape episodes and one actual portrait Short, inspected on 25 October 2026. Evidence and limitations: docs/bradikinin-frame-study.md. Match this graphic language with original scripts, pictograms and identifiers. The reference clips/frames are analysis-only, never production assets.

This is a reusable visual system for the creator's overall look and feel across different stories, subjects and formats. Derive conventions shared by multiple references, then compose new scenes around the current story. No particular episode, object, room, shot sequence or rule count is a template that every film must reproduce. Keep project-specific assets, coordinates and shot decisions in that project's VISUALS.md and scene kit.

## Stage, colour and finish

The stage is almost black: decoded overview frames in all three landscape samples had median RGB [4,4,4]; the Short's median was [0,0,0]. Use #040404 as the reproducible starting background and near-white/white pictogram cores. Most of the frame stays dark, but the subject is large and recognisable. Do not mistake negative space for permission to use tiny disconnected icons.

The observed style is not strictly black/white/red. Red marks prohibition, danger, underlines and adverse device states. Restrained yellow marks attention, eyes, light, the viewer pointer and selected details; green checks mark apparent safety or compliance. Grayscale fills/shading differentiate bedding, devices and furniture. These accents have narrative roles; do not add a decorative multicolour palette. Exact accent hex values and font identities have not been recovered from compressed frames.

White figures have soft glow/halation and fine coloured edge separation. Use a crisp readable core plus a restrained halo; a small red/blue fringe can become stronger during a glitch. The finish includes subtle grain/dust and intermittent horizontal interference/tearing. It is not pristine flat SVG and not a permanently obscured VHS screen. Keep all noise/offsets deterministic and seek-safe. Size these treatments relative to the final frame so they remain subtle on a phone.

## Ominous atmosphere

Treat the near-black stage as a source of suspense. Establish enough ordinary room geometry to make the first disturbance legible, then let negative space, a blocked sightline, a partial silhouette or a small change in a familiar object suggest that something is wrong. Escalate by changing one clear state at a time: light recedes, a gap appears, a figure turns toward an unseen source, or a repeated pattern breaks. Hold on a readable image long enough for the implication to land before revealing the next detail.

Keep the menace controlled and story-specific. Use restrained red or yellow only when the danger, warning or attention in the story earns it. Reserve glitches and edge fringing for brief, motivated disruptions; constant distortion, generic horror overlays, gore, clutter and jump-scare flashes weaken the slow build and can hide the rule captions. Preserve clear silhouettes, readable commands and safe caption space throughout.

## Pictograms and scene composition

Use original simplified filled human/animal silhouettes, round heads, minimal face marks, recognisable limbs and object profiles. White outlines and dark interior panels work for devices and architectural details. Keep a consistent graphic hand across people, creatures, props and environments. Establish the geography the story needs; revisit it with stable object placement while posture, gaze, object state or relationships change. Choose locations and props from the story rather than always using the same bedroom or corridor.

Use establishing room tableaux, close-ups, comparison pairs, a diagram inside a device/recording frame, and dedicated rule title cards. The references are not only one or two isolated icons on an empty black canvas. Deliberate tight crops and large heads/objects are part of the vocabulary. Do not force a photo/card into every scene. An occasional exhibit photograph was observed in the dog episode, so photographs are not an absolute reference-style prohibition; use such an insert only when independently owned/cleared and directly useful. Never reuse the reference's photograph or captured interface.

## Numbered rule captions — mandatory

Every rule must display its number AND the actual instruction, for example `1. DO NOT DO X`. A number alone, a generic “warning”, or a paraphrase does not fulfil the user's requirement. Match the spoken rule and the pictured action/consequence exactly. Preserve approved words, negation, object and order; an affirmative rule must not acquire an invented “DO NOT”. Capitalisation and a numeral in place of a spoken number are display formatting only.

The observed title treatment is a large bold RULE label, a dark numeral inside a white rounded tile, a thin red underline and the full uppercase instruction beneath it. A small progress rail can show the active rule; use the actual story's rule count rather than always seven. The caption may be arranged as `RULE [1]` plus the exact command below rather than one literal line, provided both read as one numbered instruction. This can be a centred title beat or positioned within an establishing scene. The command must remain readable long enough for its delivery; do not replace the visual action with a long instruction slide for the whole rule.

Separately caption the spoken narration in short white uppercase chunks, generally one or two centred lines below the action. These are sentence/phrase captions, not bouncing per-word karaoke. Use actual alignment timestamps. At rule introduction the numbered instruction, spoken caption and rule rail must agree. During its demonstration, the spoken captions must describe the action actually visible at that moment. Reserve explicit stage/caption regions so they cannot collide.

The director/writer must list each rule's exact display text, spoken cue, visual state and caption time range in VISUALS.md. Builders implement those cues; reviewers check every rule introduction and its demonstration against the script, alignment and rendered frames. Missing or contradictory rule captions are blocking.

## Typography and archive furniture

Commands, title words and body captions use a heavy uppercase sans with a slightly wide/tracked appearance. Metadata is much smaller, dim, spaced uppercase text; the timecode uses evenly spaced digits. The actual font files are unidentified. Inter ExtraBold/Black with restrained tracking and an appropriate mono for timecodes are implementation approximations, not a verified font identification.

Landscape samples show a quiet original episode identifier top left, a tiny seven-cell progress rail around top centre, and a timecode top right. The main rule card can repeat a larger rail below the command. Keep that hierarchy: metadata is not the hero. Use our own file labels and identifiers, never the creator's logo, department name or watermark.

## Motion and timing

Compose a clear pictogram state, let its caption land, then make one specific change: posture, direction, prohibited action, device value, warning symbol or a close-up. Several related states may share a room. Short holds, clean cuts, controlled fades/typing, precise reframes and brief interference bursts all occur in the sampled sequences. Do not bounce every object into view or impose a scientific cause-and-effect metaphor on every phrase.

Use pacing to deepen unease: let a warning or impossible detail sit briefly in silence or room tone, then reveal the consequence with a deliberate cut or state change. Keep sound sparse and tied to visible or implied story events. Avoid a constant music bed or repeated impact stingers as a substitute for suspense; keep every spoken instruction intelligible.

In the dog sample at 35–36 seconds, a rule title holds before the room demonstration begins around 37 seconds. In the cat sample around 58–61 seconds, the title resolves and the command types in before cutting to the demonstration. Treat these as observed examples, not a mandatory timing grid for every rule. Voice/audio was not analysed in this frame study; do not claim measured sound timing or narrator identity from it.

## Portrait treatment for 1080×1920

Use the actual Short's composition as the portrait reference, not a shrunken 16:9 inset. Its large subject/action sits in the middle/upper-middle, with phrase captions underneath around the lower-middle; substantial black space remains below. The Short does not visibly preserve the landscape timecode or tiny rule rail in the sampled frames. Keep a small original episode label near the upper safe area; add numbering when required by our script without importing all landscape furniture.

Starting layout targets, inferred from the sampled portrait frames: episode label near 10–13% of frame height; primary action roughly 23–61%; captions roughly 64–74%, changing with the crop. These are adaptation guides, not universal measured bounds. Keep essential content inside the existing vertical safe zone and allow more room for multiline rule commands. Body captions around 44–56 px at 1080 width are a starting point; verify at phone size. Keep a close-up large, recompose wide room scenes vertically and preserve recognisable action.

Before a complete episode, use the normal prototype checkpoint to lock the soft-glow pictograms, a fully captioned rule introduction, its violation/consequence and the next rule transition. Later scenes must match the accepted treatment. A twist must visibly reinterpret an established subject. Preserve original approved narration and use the normal revision/checkpoint workflow for changes.

## Title and thumbnail packaging

The public channel repeatedly uses a specific everyday subject plus an impossible event, followed by a short uppercase instruction. A useful title shape is `If Your [everyday subject] Ever [anomaly]… [instruction]`; treat it as an observed channel convention, not mandatory copy or permission to reproduce an episode. The instruction must be supported by the approved script and preserve its wording and polarity. Keep the twist unresolved.

Build the thumbnail around one large original pictogram that makes the subject and anomaly instantly recognisable. Use bold uppercase command text with clear contrast and, where it helps, one red emphasis word. Keep the image simple at small size: near-black negative space, large white/gray subject, restrained story-colored accents, and only supporting details that clarify the danger. The headline can repeat or sharpen the title's instruction, but the package should not waste its limited space explaining the plot. Judge title and image as a pair: they should establish the same anomaly and give viewers a specific reason to click without contradicting or overpromising the film. Export and inspect the thumbnail at full video resolution and the matching feed size (180×320 for vertical, 320×180 for landscape, 320×320 for square). These are reusable design conventions inferred from the public channel's title and thumbnail patterns; exact source fonts and layout measurements remain unverified. All production lettering and artwork must be original.

## Reproducible asset drawing and prototype acceptance

White-on-black styling and captions alone do not satisfy this treatment. Build recognisable geometry and a deliberate composition before adding texture. A generic schematic/icon deck with glow is not an accepted substitute for the reference's graphic language.

Draw each principal subject as a reusable original SVG or compatible vector component. Identify its defining silhouette, proportions, functional parts and negative spaces; retain those features while removing secondary detail. People need coherent limbs and poses, animals need species-defining profiles, objects need recognisable working parts, and architecture needs readable openings and depth cues. Do not use an emoji, text glyph or arbitrary cluster of primitives as a finished principal asset. Simple shapes are valid building blocks when their combined contour is intentional and immediately recognisable at phone size.

Use a stable viewBox, named semantic parts and explicit transform origins. Define the story's required neutral, action and altered states in VISUALS.md, including attachment points, occlusion and which parts move. Reuse the same proportions and parts in establishing views and close-ups. Movement must preserve identity and believable connections unless a deliberate supernatural change is the narrated event. Inspect the plain unfiltered silhouette first, then apply the shared finish. Store reusable subject components and shared finish settings once so separate builders do not redraw the same subject inconsistently.

Before building, the director records a reference-to-design table in VISUALS.md: source URL and timestamp, observed drawing/layout convention, proposed original adaptation, asset/state and verification frame. Inspect frames across multiple episodes, including the matching output format when available. Compare silhouette construction, subject scale, environmental detail, type hierarchy, caption placement and state changes. Derive the shared treatment rather than tracing one frame or repeating one episode's staging. Separate recurring conventions from isolated devices and from our own implementation choices. If local study files are missing, report that evidence gap and use the documented measurements; do not claim direct inspection. Never import the reference images into production.

Each prototype must demonstrate its principal subject at close and establishing scales, a meaningful visual state change, a complete numbered instruction with matching action/captions when the script has rules, and a transition to the next beat. Choose these examples from the current story. Check frozen frames at the delivery resolution and a phone-sized display (approximately 360×640 for portrait). Require immediately recognisable subjects, consistent silhouettes, deliberate subject scale, clear environmental hierarchy, heavy uppercase instructions, phrase captions below the action and restrained glow/fringing/texture. Record asset paths, viewBoxes, font files/weights, layout coordinates, caption sizes, finish parameters and deterministic effect seeds in the visual plan or shared scene kit so another builder can reproduce the result. These implementation values are project choices, not recovered source measurements.

Review the drawing, framing, typography, caption placement, finish and state changes separately against the cited reference conventions. Fix a recognisability or composition failure at its source; stronger glow is not a geometry repair. If the user rejects visual resemblance, revise the prototype's art direction and return to their checkpoint before building the remaining film. Technical checks or an exhausted independent-review budget never imply user acceptance.
