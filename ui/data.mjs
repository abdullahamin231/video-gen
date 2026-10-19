// These are intentionally fictional fixtures, never repository/job status.
export const providers = {
  Codex: { mark: '✳', models: ['Default model', 'Custom model…'], main: 'Default model', sub: 'Default model', color: 'mint' },
  Claude: { mark: '✺', models: ['Default model', 'Custom model…'], main: 'Default model', sub: 'Default model', color: 'peach' },
  OpenCode: { mark: '⌘', models: ['Default model', 'Custom model…'], main: 'Default model', sub: 'Default model', color: 'lavender' },
};

export const stages = [
  { name: 'Research & script', detail: 'Sources, script, independent review', file: 'SCRIPT.md' },
  { name: 'Narration & alignment', detail: 'Recording, transcription, timing', file: 'alignment.json' },
  { name: 'Creative direction', detail: 'Design theme, storyboard, briefs', file: 'film.json' },
  { name: 'Build prototype', detail: 'Context and most demanding scene', file: 'shots/03-power-grid.json' },
  { name: 'Prototype review', detail: 'Independent review before full build', file: 'review/prototype/' },
  { name: 'Build remaining scenes', detail: 'Scene builders and build checks', file: 'shots/' },
  { name: 'Render & final review', detail: 'Mix, render, independent verification', file: 'review/delivery.json' },
  { name: 'Thumbnail & delivery', detail: 'Thumbnail, independent review, archive', file: 'thumbnail/thumbnail.png' },
];

export function seedJobs() {
  return [
    {
      id: 'power', title: 'The hidden cost of AI', subtitle: 'An explainer on the infrastructure behind AI',
      prompt: 'Make a 3-minute explainer about the hidden energy cost of AI. Keep it visual and easy to follow. Think bold typography, electric green, and a strong opening hook. Include a thumbnail.',
      provider: 'Codex', main: 'Default model', sub: 'Default model', format: '16:9', duration: '3 min', status: 'running', stage: 3,
      time: '12m 34s', started: '14:32', current: 'shots/03-power-grid.json', role: 'Director', check: true, gateScript: false, gatePrototype: true, sample: true,
      events: [], messages: [], completedAt: null,
    },
    {
      id: 'internet', title: 'How the internet finds you', subtitle: 'From a URL to a server, in 90 seconds',
      prompt: 'Create a 90-second visual explainer of what happens when you type a URL. Use a friendly, diagram-led style and stop after the storyboard so I can review it.',
      provider: 'Claude', main: 'Default model', sub: 'Default model', format: '16:9', duration: '90 sec', status: 'gate', stage: 2,
      time: '6m 08s', started: '13:48', current: 'STORYBOARD.md', role: 'Director', check: true, gateScript: true, gatePrototype: true, sample: true,
      events: [], messages: [], completedAt: null,
    },
    {
      id: 'attention', title: 'Attention, explained', subtitle: 'The idea that changed language models',
      prompt: 'Make a 2-minute explainer about attention in language models. Use simple diagrams with a dark background. Create a video and a bold thumbnail.',
      provider: 'OpenCode', main: 'Default model', sub: 'Default model', format: '16:9', duration: '2 min', status: 'complete', stage: 8,
      time: '24m 12s', started: 'Yesterday', current: 'thumbnail/thumbnail.png', role: 'Reviewer', check: true, gateScript: false, gatePrototype: true, sample: true,
      events: [], messages: [], completedAt: 'Yesterday, 17:24',
    },
    {
      id: 'cities', title: 'Cities after dark', subtitle: 'A short story about urban light',
      prompt: 'Create a 60-second vertical video about the way cities use light after dark. Use abstract maps and cinematic typography.',
      provider: 'Claude', main: 'Default model', sub: 'Default model', format: '9:16', duration: '60 sec', status: 'blocked', stage: 5,
      time: '18m 40s', started: 'Yesterday', current: 'shots/04-night-map.json', role: 'Builder', check: false, gateScript: false, gatePrototype: false, sample: true,
      events: [], messages: [], completedAt: null,
    },
  ];
}

export const fileContents = {
  'shots/03-power-grid.json': '{\n  "id": "03-power-grid",\n  "kind": "world",\n  "notes": "Prototype: follow power from grid to compute",\n  "objects": [\n    { "id": "grid", "type": "group" },\n    { "id": "data-center", "type": "group" }\n  ],\n  "cues": {\n    "grid_reveal": "behind every answer",\n    "compute_reveal": "a physical machine"\n  }\n}\n',
  'film.json': '{\n  "title": "The hidden cost of AI",\n  "theme": {\n    "name": "Electric infrastructure",\n    "description": "A physical world behind digital answers",\n    "bg": "#101512",\n    "colours": { "accent": "#c4f58b" }\n  },\n  "scenes": [\n    { "id": "01-hook", "owner": "director" },\n    { "id": "02-context", "owner": "director" },\n    { "id": "03-power-grid", "owner": "director" },\n    { "id": "04-scale", "owner": "builder" }\n  ]\n}',
  'SCRIPT.md': '# The hidden cost of AI\n\n## Opening\nEvery answer begins somewhere physical.\nBehind the blinking cursor is a machine.\nBehind the machine is a building.\nAnd behind the building is a power grid.\n\n[Sample copy for the interface. Not a researched script.]',
  'STORYBOARD.md': '# Storyboard\n\n01 — The question\nA URL becomes an address card.\n\n02 — Find the address\nThe card travels through a DNS lookup diagram.\n\n03 — Make the connection\nA request moves between browser and server.\n\n04 — Bring it home\nThe response resolves into a complete page.\n\n[Illustrative storyboard for the UI prototype.]',
  'briefs/director.md': '# Creative direction\n\nGoal: reveal the physical infrastructure behind a digital interaction.\n\nBuild the prototype and its prerequisite context first.\nUse one consistent visual theme.\nSubmit the prototype for independent review before building later scenes.\n\n[Illustrative brief, not a pipeline instruction.]',
  'alignment.json': '{\n  "example": true,\n  "source": "Sample narration",\n  "words": [\n    { "word": "Every", "start": 0.0, "end": 0.3 },\n    { "word": "answer", "start": 0.3, "end": 0.8 }\n  ]\n}',
  'review/delivery.json': '{\n  "example": true,\n  "qualification": "Illustrative only",\n  "reviewers": ["visual", "story", "technical"],\n  "limitations": [\n    "No actual MP4 was rendered or reviewed.",\n    "No audio measurements exist in this prototype."\n  ]\n}',
  'shots/04-night-map.json': '{\n  "id": "04-night-map",\n  "example": true,\n  "build": {\n    "status": "blocked",\n    "error": "Referenced asset is missing",\n    "asset": "assets/city-grid.svg"\n  }\n}',
};
