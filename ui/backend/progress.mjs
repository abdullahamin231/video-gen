// The whole job as one ordered list of steps: script → narration → the pipeline's own
// state machine (read from `npm run video -- status --json`) → thumbnail → verified delivery.
// Nothing here is reported by the agent; every status comes from files, processes or the pipeline.

function stepFrom(id, label, status, detail = '', extra = {}) { return { id, label, status, detail, ...extra }; }
const running = (agents, role) => agents.filter(agent => agent.role === role && ['running', 'starting', 'waiting'].includes(agent.status));
const finished = (agents, role) => agents.filter(agent => agent.role === role && agent.status === 'finished');
const ids = list => list.map(agent => agent.id);

// Read the review's disposition, never a mention of "pass" in its findings.
export function scriptDisposition(text) {
  // A labelled line ("Verdict: PASS. 0 blockers") may carry any text after the word; a bare line
  // ("PASS. Every claim checked") needs a full stop or dash after it, so prose like "Pass the..." is ignored.
  const clean = String(text || '').replace(/[*_`]+/g, '');
  const labelled = /^[ \t]*(?:#{1,6}[ \t]*)?(?:final[ \t]+)?(?:disposition|verdict|status|outcome)[ \t]*:[ \t]*(pass|revise|incomplete)\b.*$/gim;
  const bare = /^[ \t]*(?:#{1,6}[ \t]*)?(pass|revise|incomplete)\b(?:[ \t]*$|\.[ \t]*(?:$|.+$)|[ \t]*[—:–-][ \t]+.*$)/gim;
  const verdicts = [...clean.matchAll(labelled), ...clean.matchAll(bare)].sort((a, b) => a.index - b.index);
  return verdicts.at(-1)?.[1].toLowerCase() || '';
}

export function computeProgress(job, { files = [], archived = [] } = {}) {
  const agents = job.agents || [];
  const has = suffix => files.some(file => file.path === suffix);
  const scriptDir = job.scriptPath, jobDir = job.jobPath, thumb = `${jobDir}/thumbnail`;
  const commands = job.activeCommands || [];
  const commandRunning = name => commands.find(item => item.command === name);
  const pipeline = job.pipeline;
  const prepared = Boolean(pipeline && pipeline.state !== 'not prepared');
  const phases = [];

  // 1. Script and narration.
  const script = [];
  const scriptExists = has(`${scriptDir}/SCRIPT.md`);
  // A writer sent by `next` for the visual plan (briefs/visuals.md) belongs to the film's "visuals" step, not the script.
  const writers = running(agents, 'script-writer').filter(agent => !/\/briefs\/visuals\.md$/.test(agent.brief || '')), reviewers = running(agents, 'script-reviewer');
  const researchers = running(agents, 'script-researcher');
  if (!job.inputScript) {
    const saved = files.filter(f => f.path.startsWith(`${scriptDir}/sources/`)).length, indexed = has(`${scriptDir}/SOURCES.md`);
    script.push(stepFrom('sources', 'Gather the sources', researchers.length ? 'current' : indexed || scriptExists ? 'done' : job.status === 'running' ? 'current' : 'pending',
      researchers.length ? 'Researcher fetching sources' : indexed || scriptExists ? `${saved} saved sources` : 'Not started', { file: `${scriptDir}/SOURCES.md`, agents: ids(agents.filter(a => a.role === 'script-researcher')) }));
  }
  if (job.inputScript) script.push(stepFrom('script', 'Script supplied', scriptExists || prepared ? 'done' : 'current', scriptExists ? `${scriptDir}/SCRIPT.md` : `Copying ${job.inputScript}`, { file: `${scriptDir}/SCRIPT.md` }));
  else script.push(stepFrom('script', 'Write the script', writers.length ? 'current' : scriptExists ? 'done' : job.status === 'running' && has(`${scriptDir}/SOURCES.md`) && !researchers.length ? 'current' : 'pending',
    writers.length ? 'Script writer at work' : scriptExists ? `${scriptDir}/SCRIPT.md` : 'Not started', { file: `${scriptDir}/SCRIPT.md`, agents: ids(agents.filter(a => a.role === 'script-writer')) }));
  if (!job.inputScript) {
    const reviewed = has(`${scriptDir}/review.md`);
    const verdict = job.scriptReview;
    const passed = reviewed && verdict?.status === 'pass' && !verdict.stale;
    // After the review rounds run out, the pipeline continues with the last verdict; once narration or the film exists, the review is over.
    const movedOn = !reviewers.length && !writers.length && reviewed && !passed && (prepared || has(`${scriptDir}/narration.wav`));
    const status = reviewers.length ? 'current' : movedOn ? 'done' : reviewed && (writers.length || verdict?.stale || ['revise', 'incomplete'].includes(verdict?.status)) ? 'repair' : passed ? 'done' : reviewed || scriptExists && !writers.length ? 'current' : 'pending';
    script.push(stepFrom('script-review', 'Independent script review', status,
      reviewers.length ? 'Fresh reviewer at work' : movedOn ? `Continued after ${finished(agents, 'script-reviewer').length} review round(s) · last verdict ${verdict?.status || 'none'}` : reviewed ? (writers.length ? 'Writer addressing review findings' : verdict?.stale ? 'Script or research changed after review · re-check required' : verdict?.status ? `${verdict.status} · ${finished(agents, 'script-reviewer').length} review round(s)` : 'Review saved · no explicit verdict found') : '', { file: `${scriptDir}/review.md`, agents: ids(agents.filter(a => a.role === 'script-reviewer')) }));
  }
  if (job.gateScript) script.push(gateStep(job, 'script', 'Your script checkpoint'));
  if (job.audioPath) script.push(stepFrom('narration', 'Recording supplied', 'done', 'Kept unchanged'));
  else {
    const narration = has(`${scriptDir}/narration.wav`), tts = commandRunning('tts');
    const provider = (job.ttsStatus?.usedProvider || job.ttsProvider || 'kokoro') === 'gemini' ? 'Gemini' : 'Kokoro';
    const notice = job.ttsStatus?.fallback ? ' · Gemini usage limit reached; using Kokoro' : provider === 'Gemini' && job.ttsStatus?.model ? ` · ${job.ttsStatus.model}` : '';
    script.push(stepFrom('narration', `Narration (${provider})`, tts ? 'current' : narration ? 'done' : 'pending',
      `${tts ? 'Generating speech' : narration ? `${scriptDir}/narration.wav` : provider}${notice}`, { file: narration ? `${scriptDir}/narration.wav` : '' }));
  }
  phases.push({ id: 'script', label: 'Script & narration', steps: script });

  // 2. The film: the pipeline's own steps.
  let film;
  if (pipeline?.steps) {
    film = pipeline.steps.map(step => ({ ...step, agents: ids(agents.filter(agent => agent.step === step.id)) }));
    const starting = commandRunning('start') || commandRunning('prepare') || commandRunning('transcribe');
    if (!prepared && starting) film[0] = { ...film[0], status: 'current', detail: 'Transcribing and timing the narration' };
    const active = film.find(step => ['current', 'repair'].includes(step.status));
    const command = commands.find(item => ['build', 'render', 'review-pack', 'save-all', 'deliver', 'mix', 'plan-check'].includes(item.command));
    if (active && command) active.running = { command: command.command, startedAt: command.startedAt, agentId: command.agentId };
    // Your film reviews are pipeline steps (prototype-human, final-human); waiting on one is your turn.
    for (const step of film) if (/-human$/.test(step.id) && step.status === 'current') Object.assign(step, { status: 'waiting', detail: job.gate?.kind === step.id.split('-')[0] && !job.gate.decision ? 'Your turn: watch it and decide' : step.detail });
    // Jobs started before the pipeline knew about your review keep the older checkpoint step.
    if (job.gatePrototype && !film.some(step => step.id === 'prototype-human')) {
      const index = film.findIndex(step => step.id === 'prototype-review');
      if (index >= 0) film.splice(index + 1, 0, gateStep(job, 'prototype', 'Your prototype checkpoint', film[index].status === 'done'));
    }
  } else {
    const starting = commandRunning('start');
    film = [stepFrom('prepare', 'Narration timed to the script', starting ? 'current' : 'pending', starting ? 'Transcribing and timing the narration' : 'Job not created yet'),
      stepFrom('film', 'Plan, build, render and review the film', 'pending', 'Steps appear once the job exists')];
  }
  phases.push({ id: 'film', label: 'Film', steps: film, scenes: pipeline?.scenes || [], reviews: pipeline?.reviews || null, next: pipeline?.next || null, state: pipeline?.state || '' });

  // 3. Thumbnail (after the film qualifies).
  const filmDone = pipeline?.state === 'done';
  const makers = running(agents, 'thumbnail-maker'), thumbReviewers = running(agents, 'thumbnail-reviewer');
  const png = has(`${thumb}/thumbnail.png`), source = files.some(file => file.path.startsWith(`${thumb}/`) && /\.(svg|psd|ora|afdesign)$/.test(file.path));
  const preview = files.some(file => file.path.startsWith(`${thumb}/`) && file.path.endsWith('.png') && /320x180|feed|preview/i.test(file.path));
  const review = job.thumbnailReview;
  const archivedSet = archived.length > 0;
  const thumbs = job.thumbs, variants = thumbs?.variants || [];
  const usingVariants = variants.some(v => v.made || v.needsWork && has(`${v.dir}/BRIEF.md`)) || files.some(file => file.path.startsWith(`${thumb}/variants/`));
  let thumbnail;
  if (usingVariants) {
    const made = variants.filter(v => v.made && !v.needsWork), passed = variants.filter(v => v.review?.status === 'pass'), live = variants.filter(v => !v.failed);
    const waiting = job.gate?.kind === 'thumbnail' && !job.gate.decision;
    const redo = variants.filter(v => v.made && v.needsWork);
    thumbnail = [
      stepFrom('thumbnail-art', `${thumbs.count} thumbnail variants`, makers.length ? 'current' : made.length >= live.length ? 'done' : redo.length ? 'repair' : filmDone ? 'current' : 'pending',
        `${made.length}/${thumbs.count} made${redo.length ? ` · ${redo.map(v => v.id).join(', ')} being made again` : ''}${variants.some(v => v.failed) ? ` · ${variants.filter(v => v.failed).map(v => v.id).join(', ')} dropped` : ''}`,
        { agents: ids(agents.filter(a => a.role === 'thumbnail-maker')) }),
      stepFrom('thumbnail-review', 'Independent thumbnail review', thumbReviewers.length ? 'current' : passed.length && made.every(v => v.review) ? 'done' : made.length ? 'current' : 'pending',
        thumbReviewers.length ? 'Fresh reviewer at work' : `${passed.length} passed${made.filter(v => v.review?.status === 'blocked').length ? ` · ${made.filter(v => v.review?.status === 'blocked').length} blocked` : ''}`,
        { agents: ids(agents.filter(a => a.role === 'thumbnail-reviewer')) }),
      stepFrom('thumbnail-pick', thumbs.pick ? 'Your pick' : 'Pick (reviewer’s ranking)', waiting ? 'waiting' : thumbs.chosen && (!thumbs.pick || thumbs.chosen.by === 'you') ? 'done' : passed.length ? 'current' : 'pending',
        thumbs.chosen ? `${thumbs.chosen.variant} · “${thumbs.chosen.headline}”` : waiting ? 'Your turn: pick one or ask for changes' : ''),
      stepFrom('thumbnail-archive', 'Archived to library/thumbnails', archivedSet && thumbs.chosen ? 'done' : thumbs.chosen ? 'current' : 'pending', archivedSet && thumbs.chosen ? `library/thumbnails/${job.slug}/` : ''),
    ];
  } else thumbnail = [
    stepFrom('thumbnail-brief', 'Thumbnail brief', has(`${thumb}/BRIEF.md`) ? 'done' : filmDone ? 'current' : 'pending', has(`${thumb}/BRIEF.md`) ? `${thumb}/BRIEF.md` : '', { file: `${thumb}/BRIEF.md` }),
    stepFrom('thumbnail-art', 'Artwork and editable source', makers.length ? 'current' : png && source ? 'done' : has(`${thumb}/BRIEF.md`) ? 'current' : 'pending',
      [png && '1280×720 PNG', source && 'editable source', preview && 'feed preview'].filter(Boolean).join(' · '), { agents: ids(agents.filter(a => a.role === 'thumbnail-maker')), file: png ? `${thumb}/thumbnail.png` : '' }),
    stepFrom('thumbnail-review', 'Independent thumbnail review', thumbReviewers.length ? 'current' : review?.status === 'pass' ? 'done' : review?.status ? 'repair' : png ? 'current' : 'pending',
      thumbReviewers.length ? 'Fresh reviewer at work' : review?.status ? `${review.status}${review.findings ? ` · ${review.findings} finding(s)` : ''}` : '', { agents: ids(agents.filter(a => a.role === 'thumbnail-reviewer')), file: review ? `${thumb}/REVIEW.json` : '' }),
    stepFrom('thumbnail-archive', 'Archived to library/thumbnails', archivedSet ? 'done' : review?.status === 'pass' ? 'current' : 'pending', archivedSet ? `library/thumbnails/${job.slug}/` : ''),
  ];
  phases.push({ id: 'thumbnail', label: 'Thumbnail', steps: thumbnail });

  // 4. Delivery, checked by the server itself.
  const verified = job.status === 'complete';
  const failure = job.qualification && !job.qualification.ok ? job.qualification.error : '';
  phases.push({ id: 'delivery', label: 'Delivery', steps: [stepFrom('verified', 'Delivery verified by the runner', verified ? 'done' : failure ? 'repair' : 'pending', verified ? 'Film qualified · thumbnail reviewed and archived' : failure.slice(0, 300))] });

  // Between steps nothing is active; while the run is live, the next pending step is the one being started.
  if (job.status === 'running' && !phases.some(phase => phase.steps.some(step => ['current', 'repair', 'blocked', 'waiting'].includes(step.status)))) {
    const next = phases.flatMap(phase => phase.steps).find(step => step.status === 'pending');
    if (next) Object.assign(next, { status: 'current', detail: next.detail || 'Up next' });
  }
  const all = phases.flatMap(phase => phase.steps.map(step => ({ ...step, phase: phase.id })));
  const done = all.filter(step => ['done', 'skipped'].includes(step.status)).length;
  const current = all.find(step => ['current', 'repair', 'blocked', 'waiting'].includes(step.status)) || null;
  return { phases, done, total: all.length, current: current ? { phase: current.phase, id: current.id, label: current.label, status: current.status, detail: current.detail } : null };
}

function gateStep(job, kind, label, reached = true) {
  if (job.approvedGates?.includes(kind)) return stepFrom(`${kind}-gate`, label, 'done', 'Approved by you');
  if (job.gate?.kind === kind && !job.gate.decision) return stepFrom(`${kind}-gate`, label, 'waiting', 'Waiting for your decision');
  return stepFrom(`${kind}-gate`, label, 'pending', reached ? 'Enabled · the orchestrator presents it next' : 'Enabled · after review passes');
}

// A plain answer to "is it working?", from runner facts only.
export function computeHealth(job, events, now = Date.now()) {
  const items = [];
  const add = (level, text) => items.push({ level, text });
  const live = (job.agents || []).filter(agent => ['running', 'starting', 'waiting'].includes(agent.status));
  const last = events.at(-1);
  const quietFor = last ? now - Date.parse(last.at) : 0;
  const recentFailures = events.filter(event => event.type === 'tool' && event.status === 'failed' && now - Date.parse(event.at) < 10 * 60000);
  const fatal = [...events].reverse().find(event => event.type === 'error' && event.fatal !== false);
  const failedAgents = (job.agents || []).filter(agent => agent.role !== 'orchestrator' && agent.status === 'failed');
  const longCommand = (job.activeCommands || []).find(item => ['render', 'build', 'review-pack', 'start', 'tts'].includes(item.command));

  if (job.status === 'gate') add('attention', job.gate?.kind === 'question' ? 'The agent asked you a question' : 'Waiting for your checkpoint decision');
  if (['failed', 'interrupted'].includes(job.status) && job.error) add('error', job.error);
  if (job.status === 'needs_attention' && job.error) add('attention', job.error);
  if (job.pipelineError) add('warning', `Pipeline status unavailable: ${job.pipelineError}`);
  if (job.scriptReview?.stale) add('warning', 'Script or research changed after the independent review');
  const scriptRounds = finished(job.agents || [], 'script-reviewer').length;
  if (scriptRounds > 3) add('warning', `Script review exceeded two revision rounds (${scriptRounds} reviews)`);
  // A delivered thread is final: warnings from the pipeline's history (review rounds, repairs) no longer apply.
  const delivered = job.status === 'complete';
  if (!delivered && job.pipeline?.steps?.some(step => step.status === 'blocked')) add('error', `Pipeline blocked: ${job.pipeline.steps.find(step => step.status === 'blocked').detail}`);
  if (!delivered) for (const step of job.pipeline?.steps || []) if (step.status === 'repair') add('warning', `${step.label}: ${step.detail}`);
  const rounds = Math.max(job.pipeline?.reviews?.prototype?.rounds || 0, job.pipeline?.reviews?.final?.rounds || 0);
  if (!delivered && rounds >= 2) add('warning', `Independent review has failed ${rounds} rounds (after 3 rounds, continues with disclosed findings)`);
  if (job.status === 'running' && live.length && quietFor > (longCommand ? 30 : 8) * 60000)
    add('warning', `No activity for ${Math.round(quietFor / 60000)} min${longCommand ? ` while ${longCommand.command} runs` : ''}`);
  if (recentFailures.length >= 4) add('warning', `${recentFailures.length} tool calls failed in the last 10 min`);
  if (!delivered && failedAgents.length) add('warning', `${failedAgents.length} sub-agent run(s) failed: ${failedAgents.slice(-3).map(agent => agent.task || agent.role).join('; ')}`);
  const helpers = (job.agents || []).reduce((sum, agent) => sum + (agent.usage?.helperAgents || 0), 0);
  const attempts = (job.agents || []).filter(agent => agent.builtinAgentCalls);
  if (helpers) add('warning', `${helpers} untracked helper agent${helpers === 1 ? '' : 's'} started through a CLI's own sub-agent tool (their tokens are counted)`);
  else if (attempts.length) add('warning', `${attempts.length} agent${attempts.length === 1 ? '' : 's'} tried a CLI's own sub-agent tool: ${attempts.slice(-3).map(agent => agent.task || agent.role).join('; ')}`);
  if (fatal && job.status === 'running' && now - Date.parse(fatal.at) < 10 * 60000) add('warning', `Recent provider error: ${String(fatal.text).slice(0, 160)}`);

  const order = ['error', 'attention', 'warning'];
  const level = order.find(name => items.some(item => item.level === name))
    || (job.status === 'complete' ? 'complete' : ['running'].includes(job.status) ? 'ok' : 'idle');
  const headline = items.find(item => item.level === level)?.text
    || (level === 'complete' ? 'Delivered and verified'
      : level === 'ok' ? `${live.length} agent${live.length === 1 ? '' : 's'} working`
      : { queued: 'Waiting for a runner slot', paused: 'Paused at the next step', cancelled: 'Cancelled' }[job.status] || 'Idle');
  return { level, headline, items, lastEventAt: last?.at || null };
}
