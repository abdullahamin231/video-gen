# Agent-context revamp

The main problem was the combination of large imported workflows, repeated instructions, generated role
coaching and runtime constraints that rewarded one implementation. A per-file size limit alone would not
fix the cumulative reading path or the loss of creative authority between writer and director.

## Changes

- Replaced 29 imported skills with three focused skills in one canonical `skills/` folder. Removed per-harness
  skill links/catalogs, upstream example libraries and unused workflow scripts. Retained source fetching.
- Replaced each five-document personality package with one short `PROFILE.md`. Removed standalone
  profile.json descriptors; the renderer's small adapter mapping lives in code. Project snapshots retain
  chosen intent and hashes as internal data, not another instruction package.
- Removed separate generic prompt files and embedded role coaching. Generated assignments carry role,
  paths, expected outputs, technical reference and findings. Shared transport/output contracts live once
  in the runbook. Sources and scripts are referenced rather than repeated in every assignment.
- Made native HTML the sole film authoring path. Removed the private object/verb language, composites,
  world renderer, hooks and bundled Manim/TeX wrappers. Agents own their composition files and assets.
  The root assembler supplies measured timing and fixed narration; capture cuts also emit native HTML.
- Removed the mandatory visual-plan stage, concept quotas, prescribed motion/sound vocabulary and automatic
  library-publication gate. Visual intent is free-form and can develop during direction.
- Kept the media operations that should be reliable: capture provenance/omissions, timing, source rights,
  mixing, rendering, review evidence, delivery verification and upload. These modules are infrastructure,
  not agent context. File count by itself is not a reason to merge or reimplement them.
- Kept Ming only, folded its CLI parser into the existing backend, and removed benchmarks and alternative
  narration engines. The backend retains shared acoustic reference, FIFO queue, cancellation, exact reviewed
  words and complete-output replacement. The production TTS guide is about 400 words.
- Removed historical creator studies, research image collections and obsolete setup/migration guidance.
  Git retains their history; they are not archived as another agent reading tree.

## Context measurements

The original inventory covered 440 Markdown files and approximately 963,000 tokens of available material
(character count divided by four). The consolidated source material is approximately 20,000 tokens across
about 37 files, including setup, maintainer references and this audit. These are estimates, not tokenizer
measurements or a claim that every original file was loaded on every turn.

The ordinary production reading path (root instructions, production skill, runbook, native composition
contract and selected explainer profile) is about 3,900 estimated tokens, before the brief and actual inputs.
Research, TTS, news and capture details are loaded only for the relevant task. No retained Markdown document
exceeds the requested 15,000-token ceiling; the largest is roughly 4,500 tokens using the conservative
UTF-8-bytes-divided-by-three estimate. The detailed original-file disposition is in context-inventory.tsv,
which is audit evidence rather than an instruction dependency.

## Renderer assessment

Freely authored compositions remove the need for a private visual library. A small integration layer still
has value: it prevents every agent from rebuilding media timing, audio verification and evidence capture.
The old inspector skipped native HTML scenes; the replacement inspects the actual assembled HyperFrames
player, captures those scenes and compares repeated timestamps after backward seeks. Integration tests
check both the frozen HTML evidence and real encoded MP4 scene pixels.

The pinned HyperFrames package currently exposes no public assembly API. Its snapshot assembler/player
integration is isolated in lib/native.mjs and needs verification when upgrading that dependency. Sampled
inspection does not prove readability, occlusion, factual clarity or motion quality; independent review
must inspect actual evidence and disclose unavailable playback/listening.

Reduced context and fewer design prescriptions create more room for reasoning. They do not by themselves
prove better films. That requires producing and reviewing representative videos under the new workflow.
No production video was commissioned or uploaded as part of this software revamp.

The new pipeline flowchart is in [agent-workflow.md](agent-workflow.md).
