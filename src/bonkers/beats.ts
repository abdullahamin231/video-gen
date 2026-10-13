/**
 * Beat map — synced to the actual narration (faster-whisper word timings,
 * first 60s of inputs/audio/source.mp3). Times in seconds.
 * Frames = round(sec * 30).
 */
export const FPS = 30;
export const F = (s: number) => Math.round(s * FPS);

/** Master cut between the two scenes (zoom-through). */
export const SCENE_CUT = 35.3;

export const B = {
  /* ---------------- SCENE 1 ---------------- */
  s1Start: 0.0,
  towerDraw: 0.15, // "Picture this… run AI locally" — PC tower traces on
  towerLabel: 2.7, // "…AI locally" — LOCAL AI label
  chipDev: 4.2, // "maybe because you're a developer"
  subCard: 6.1, // "tired of paying 20 bucks a month"
  subStrike: 7.7, // strikethrough slashes the $20
  ownChip: 9.7, // "the idea of owning your own thing"
  searchIn: 12.4, // "so you do what any reasonable person does"
  searchType: 13.8, // types "GPUs"
  pricesBeat: 15.9, // "and then you see the prices" — camera punch
  shelf: 17.0, // server shelf rises
  dgx: 18.4, // DGX Spark $6,950 slam
  rtx: 21.5, // RTX 5090 $2,000+ slam
  rack: 27.3, // 8-card rack $120,000 slam (count-up)
  brain: 30.4, // "your brain just stops" — pink brain
  prompt: 32.3, // "I just want to run a model" — ONE MODEL box
  rocket: 33.8, // "not trying to land on the moon" — rocket escapes

  /* ---------------- SCENE 2 ---------------- */
  s2Start: 35.3,
  calendar: 35.4, // "that was me about 3 weeks ago"
  rabbit: 37.3, // "deep in this local AI rabbit hole"
  cheapest: 41.0, // "cheapest real setup"
  sheet: 45.2, // "I built a spreadsheet"
  ebay: 47.0, // "obsessive about eBay listings at midnight"
  doomScroll: 49.6, // "doom scrolling with extra steps"
  specSheet: 52.4, // "reading spec sheets like entertainment"
  youtube: 54.4, // "a video showed up … June Yamog"
  clickbait: 55.7, // CLICKBAIT stamp slams
  question: 56.7, // morphs to "?"
  speed2x: 57.2, // "×2" playback icon
  chips: 57.4, // four V100 (2017) + DGX Spark slam in
  river: 57.9, // HERO — token rivers race, 2.5×
  hero25: 58.7, // big "2.5×" punch
  end: 60.0,
};

/** Impact shakes: {at (sec), strength (px)} */
export const S1_SHAKE = [
  {at: B.pricesBeat, strength: 22},
  {at: B.dgx, strength: 26},
  {at: B.rtx, strength: 26},
  {at: B.rack, strength: 40},
  {at: B.rocket, strength: 16},
];
export const S2_SHAKE = [
  {at: B.calendar, strength: 14},
  {at: B.clickbait, strength: 34},
  {at: B.speed2x, strength: 18},
  {at: B.chips, strength: 30},
  {at: B.hero25, strength: 46},
];
