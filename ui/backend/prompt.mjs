import {inferPersonality} from '../../lib/personalities.mjs';
import {taskPrompt} from '../../lib/prompts.mjs';
export function roleNote(role, provider) {
  return '\n' + taskPrompt(role, {provider, contract: 'docs/orchestrator.md'});
}
export function orchestratorPrompt(job, {resume = false} = {}) {
  const audio = job.audioPath || `${job.scriptPath}/narration.wav`;
  const startCommand = `npm run video -- start --name ${job.slug} --audio ${audio} --script ${job.scriptPath}/SCRIPT.md --profile <id> --format ${job.format}${job.gateFinal ? ' --human-review final' : ''}${job.thumbnails ? ` --thumbnails ${job.thumbnails}` : ''} --pick-thumbnail ${job.gateThumbnail !== false}`;
  return taskPrompt('orchestrator', {contract: 'docs/orchestrator.md', resume, userBrief: job.prompt, thread: job.id, scriptPath: job.scriptPath,
    jobPath: job.jobPath, format: job.format, duration: job.duration || null, inputScript: job.inputScript || null,
    audioPath: job.audioPath || null, ttsProvider: job.ttsProvider || 'kokoro',
    checkpoints: {script: Boolean(job.gateScript), final: Boolean(job.gateFinal), thumbnail: job.gateThumbnail !== false},
    inferredProfile: inferPersonality(job.prompt), startCommand});
}
