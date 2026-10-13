# Audio + Script → Video Generator

Generate videos from audio + script using Remotion, Hyperframes, and Manim.

## Stack

- **[Remotion](https://www.remotion.dev/)** — React-based programmatic video creation
- **[Hyperframes](https://www.hyperframes.dev/)** — HTML/CSS/JS motion design and animation
- **[Manim](https://www.manim.community/)** — Mathematical animation engine (3Blue1Brown style)
- **Motion Design** — Atomic motion rules, scene blueprints, transitions

## Project Structure

```
video-gen/
├── src/                    # Remotion compositions (React/TypeScript)
│   ├── index.ts            # Entry point
│   ├── Root.tsx            # Composition registry
│   └── VideoGen.tsx        # Main video composition
├── scripts/                # Video generation pipeline scripts
├── configs/                # Design specs, palettes, typography
├── inputs/
│   ├── scripts/            # Input scripts (text/markdown)
│   └── audio/              # Input audio files
├── outputs/                # Rendered videos
├── .agents/skills/         # Project-level agent skills
└── .claude/skills/        # Claude Code skill symlinks
```

## Skills Available

| Skill | Description |
|-------|-------------|
| `remotion-best-practices` | Router for all Remotion skills |
| `remotion-create` | Create a new Remotion video |
| `remotion-render` | Export a Remotion video |
| `remotion-captions` | Transcribing, displaying and animating captions |
| `remotion-markup` | Content, animation and effects best practices |
| `remotion-to-hyperframes` | Port Remotion compositions to Hyperframes |
| `hyperframes-animation` | Motion rules, scene blueprints, transitions |
| `hyperframes-creative` | Design specs, palettes, typography, beat planning |
| `music-to-video` | Beat-synced video from audio |
| `manim-composer` | Plan scene-by-scene math/science visualizations |
| `manimce-best-practices` | Manim Community Edition best practices |
| `manimgl-best-practices` | ManimGL (3Blue1Brown) best practices |
| `manim-video` | Build reusable Manim explainers |
| `ai-video-generation` | AI video generation with Veo, Seedance, etc. |

## Getting Started

```bash
# Install dependencies
npm install

# Start Remotion Studio (preview)
npm run dev

# Render video
npm run render

# Render a still frame
npm run still
```

## Workflow

1. **Prepare inputs**: Add audio to `inputs/audio/` and script to `inputs/scripts/`
2. **Plan scenes**: Use `manim-composer` or `hyperframes-creative` to design scenes
3. **Build composition**: Create/update Remotion components in `src/`
4. **Add motion**: Apply `hyperframes-animation` rules and `remotion-markup` effects
5. **Render**: Export final video with `npm run render`

## License

MIT
