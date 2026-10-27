// Not every failed build is a film defect. Missing tools, broken modules, browser launches and full disks need an
// environment fix; sending them to the director wastes a creative agent and can push it to edit the film around a bug.
const INFRASTRUCTURE = [
  /Cannot find module/i,
  /MODULE_NOT_FOUND/,
  /spawn (?:ffmpeg|ffprobe|chrome|chromium|google-chrome|uv|python3?)(?:\.exe)? ENOENT/i,
  /(?:ffmpeg|ffprobe|chrome|chromium)[^\n]{0,40}(?:not found|ENOENT|executable)/i,
  /failed to launch (?:the )?(?:browser|chrom)/i,
  /browserType\.launch/i,
  /Target page, context or browser has been closed/i,
  /node_modules[\\/]hyperframes/i,
  /(?:EACCES|EPERM|ENOSPC)/,
  /(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND)/,
  /ModuleNotFoundError|ImportError[^\n]*(?:librosa|cv2|numpy)/i,
  /(?:uv|python3?|ffmpeg): (?:command )?not found/i,
];

export function classifyFailure(errors) {
  const all = (errors || []).map(String).filter(Boolean);
  const infrastructure = all.filter(error => INFRASTRUCTURE.some(pattern => pattern.test(error)));
  const film = all.filter(error => !infrastructure.includes(error));
  return {isInfrastructure: infrastructure.length > 0, infrastructure, film, errors: all};
}
