// The channel theme: one design theme every film starts from, so the channel is recognisable from any frame.
// video.config.json "channelTheme" names the file (null switches it off). `start` copies it into the job, so a job
// keeps the theme it was planned with even if the channel's file changes later. A film may depart from it; it says
// why in theme "channelDepartures".
import {readFile} from 'node:fs/promises';
import path from 'node:path';

export const CHANNEL_THEME_FILE = 'inputs/channel-theme.json';

/** The configured channel theme as {file, theme}, or null when none is configured. Throws on a broken file. */
export async function loadChannelTheme(root, config) {
  if (!config?.channelTheme) return null;
  const file = path.resolve(root, config.channelTheme);
  let theme;
  try { theme = JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { throw new Error(`channelTheme ${config.channelTheme}: ${e.code === 'ENOENT' ? 'file not found' : 'not valid JSON: ' + e.message}. Fix it or set "channelTheme": null in video.config.json.`); }
  if (!theme || typeof theme !== 'object' || !theme.name || !theme.bg || !theme.colors) throw new Error(`channelTheme ${config.channelTheme}: needs at least "name", "bg" and "colors" (the film.json theme format).`);
  return {file, theme};
}

/** The channel theme copied into a job, or null. */
export async function jobChannelTheme(job) {
  try { return JSON.parse(await readFile(path.join(job, CHANNEL_THEME_FILE), 'utf8')); } catch { return null; }
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** Where a film's theme differs from the channel's background, colours and fonts. */
export function channelDifferences(theme, channel) {
  if (!theme || !channel) return [];
  const out = [];
  if (!same(theme.bg, channel.bg)) out.push(`bg ${theme.bg} (channel ${channel.bg})`);
  for (const [k, v] of Object.entries(channel.colors || {})) if (!same(theme.colors?.[k], v)) out.push(`colors.${k} ${theme.colors?.[k] ?? 'missing'} (channel ${v})`);
  for (const [k, v] of Object.entries(channel.fonts || {})) if (!same(theme.fonts?.[k], v)) out.push(`fonts.${k} ${theme.fonts?.[k] ?? 'missing'} (channel ${v})`);
  return out;
}

/** Warnings for plan-check: a departure from the channel theme is allowed, but it has to be deliberate. */
export function channelThemeWarnings(theme, channel) {
  const diff = channelDifferences(theme, channel);
  if (!diff.length) return [];
  const why = typeof theme?.channelDepartures === 'string' && theme.channelDepartures.trim();
  return why ? [] : [`film.json theme departs from the channel theme (${CHANNEL_THEME_FILE}) in ${diff.slice(0, 6).join('; ')}${diff.length > 6 ? `; and ${diff.length - 6} more` : ''}. Viewers recognise the channel by its look: copy the channel theme, or keep the change and say why in theme "channelDepartures".`];
}
