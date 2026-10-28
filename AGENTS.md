# video-gen

This repository turns a brief or supplied recording into a narration-synchronised video and thumbnail.
Agents own the writing, visual design and implementation. The pipeline handles measured timing,
rendering, review evidence and delivery. For software work, inspect and change the code normally.

For production, read `skills/video-production/SKILL.md`. For script work, read
`skills/script-writing/SKILL.md`. For composition authoring, read `skills/hyperframes/SKILL.md`.
Load technical references only for the task at hand; there is no required reading of the whole docs tree.

Work within the requested project. Keep assets and caches inside the repository. Preserve supplied
recordings and approved narration. Claims and reused media need evidence and provenance.
Use `npm run video -- ...` for production commands; do not edit dependencies or `video.config.json`
unless requested. Never manufacture review evidence, user approval or successful delivery.

A role given a brief completes that assignment itself; the host advances the pipeline and commissions
independent review. Reviewers do not approve their own production work. A tool limitation is a limitation,
not grounds to claim that an image was viewed or audio was heard.

On resuming, recover the saved production profile with `status --project <slug> --json`.
For new work, choose the treatment that matches the user's intent; `personalities/README.md` is the index.
The user's explicit direction takes precedence over a default personality.

Video and thumbnail dimensions match the saved canvas. After delivery and thumbnail selection,
the orchestrator uploads to abdupdates as unlisted unless the user opts out; use approved publishing
copy and `docs/publishing.md`. Send Discord notifications only when requested, through
`scripts/discord-notify.mjs` with one stable request ID per pending checkpoint. A ping is not approval.
