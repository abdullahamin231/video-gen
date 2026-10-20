// The target duration is part of the prompt ("a 3-minute explainer", "90 seconds", "1 min 30 sec"), not a form field.
// Shared by the browser (live hint, submit check) and the server (the authoritative check), so both read it the same way.
export const MIN_SECONDS = 10, MAX_SECONDS = 3600;

// No "a"/"an": "a second version" is not a duration.
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90 };
const NUMBER = `(\\d+(?:\\.\\d+)?|${Object.keys(WORDS).sort((a, b) => b.length - a.length).join('|')})`;
// No bare h/m/s: "80s synth music" is not 80 seconds.
const UNIT = '(hours?|hrs?|minutes?|mins?|seconds?|secs?)';
// "3 minutes", "3-minute", "3min", optionally followed by "30 seconds" / "and a half".
const AMOUNT = new RegExp(`\\b${NUMBER}[\\s-]*${UNIT}(?:[\\s,-]*(?:and[\\s-]+)?(?:(\\d+)[\\s-]*(seconds?|secs?)|(a[\\s-]+half)))?\\b`, 'i');
// "2:30" read as minutes:seconds, only when it says it is long ("2:30 long", "2:30 video", "runtime 2:30").
const CLOCK = /\b(\d{1,2}):([0-5]\d)\b(?=\s*(?:long|min|video|explainer|reel|short|runtime|length|duration))|\b(?:runtime|length|duration)\s*(?:of\s*)?(\d{1,2}):([0-5]\d)\b/i;

// "an hour", "half an hour" (but not "a minute": "take a minute to…" is too common in prose).
const HOUR = /\b(half an hour|an hour)\b/i;

const value = text => WORDS[text.toLowerCase()] ?? Number(text);
const scale = unit => /^h/i.test(unit) ? 3600 : /^m/i.test(unit) ? 60 : 1;

/** Seconds named in the text, or null. The first mention wins ("a 5-minute video with a 10-second hook" → 300). */
export function parseDuration(text) {
  const source = String(text || '');
  const amount = AMOUNT.exec(source), clock = CLOCK.exec(source), hour = HOUR.exec(source);
  const amountAt = amount ? amount.index : Infinity, clockAt = clock ? clock.index : Infinity, hourAt = hour ? hour.index : Infinity;
  if (hour && hourAt < amountAt && hourAt < clockAt) return /^half/i.test(hour[1]) ? 1800 : 3600;
  if (clock && clockAt < amountAt) {
    const [m, s] = clock[1] ? [clock[1], clock[2]] : [clock[3], clock[4]];
    return Number(m) * 60 + Number(s);
  }
  if (!amount) return null;
  const unit = scale(amount[2]);
  let seconds = value(amount[1]) * unit;
  if (amount[3]) seconds += Number(amount[3]);
  if (amount[5]) seconds += unit / 2;
  return Math.round(seconds);
}

export const formatDuration = seconds => seconds >= 60 ? `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} s` : ''}` : `${seconds} s`;

/** The duration from the prompt, or an error a person can act on. */
export function durationFromPrompt(text) {
  const seconds = parseDuration(text);
  if (seconds == null) return { error: 'Say how long the video should be in your description, e.g. “a 3-minute explainer” or “90 seconds”.' };
  if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) return { seconds, error: `The description asks for ${formatDuration(seconds)}; the target must be between ${MIN_SECONDS} seconds and ${MAX_SECONDS / 60} minutes.` };
  return { seconds };
}
