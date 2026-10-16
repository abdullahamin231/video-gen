# AI tells

Patterns that are far more common in model output than in human writing. Humans use every one of them occasionally,
so the problem is density: one "here's the thing" in eight minutes is a person, one per paragraph is a model. Fix
anything that repeats or clusters without serving the script. These are editing prompts, not proof of authorship or
universal bans. Preserve useful genre and creator choices. The lint script (`scripts/lint.mjs`) counts some per minute.

Rule numbers in brackets refer to the `unslop` editing rules these come from.

## Words and phrases

- **AI vocabulary** [7]: delve, crucial, pivotal, landscape, realm, tapestry, testament, underscore, showcase,
  intricate, vibrant, enduring, foster, garner, interplay, robust, seamless, leverage, utilize, unlock, elevate,
  empower, navigate (abstract), journey (abstract), game-changer, cutting-edge, ever-evolving. Also the softer
  narration adverbs: quietly, simply, unusually frank, genuinely, fundamentally. Use the plain word.
- **Fancy "is"** [8]: serves as, stands as, acts as, boasts, represents. Say "is" or "has".
- **Chatbot and presenter stock phrases** [20]: "In today's video", "Let's dive in", "Let's break it down", "buckle
  up", "without further ado", "Great question", "Here's where it gets interesting", "the plot thickens", "spoiler
  alert", "And that's not all".
- **Filler and throat-clearing** [23]: "It's important to note that", "It's worth mentioning", "In order to", "When it
  comes to", "At the end of the day", "In essence", "Essentially".
- **Hedging stacks** [24]: "could potentially", "may possibly", "arguably might". Hedge once, where the source hedges.
- **Vague attribution** [5]: "experts say", "many believe", "studies show". Name who, or cut.
- **Abstract jargon nouns** [26]: paradigm, ecosystem (abstract), north star, flywheel, synergy, modality.

## Sentence shapes

- **Reversal formula** [9]: "It's not X. It's Y.", "This isn't just X, it's Y.", "Not because X, but because Y."
  Once per script can be strong. More reads as a template.
- **Participial tails** [3]: ", highlighting the...", ", making it...", ", ensuring that...", ", reflecting...". Split
  into two sentences with a real subject and verb.
- **Groups of three** [10]: lists of exactly three adjectives or three parallel clauses, again and again. Use the
  real number of items.
- **Rhetorical question at every section start.** Questions as transitions are good; every beat opening with one is a
  pattern.
- **Punchline at every paragraph end.** A short landing line works when it's rare. Especially the aphorism kind:
  "Same model, better words." "It doesn't shrink. It moves."
- **Staccato strings.** Repeated short sentences can turn into a habit. Use them where the chosen voice needs emphasis.
- **Announced structure.** "Next part.", "Here's the part most people miss.", "My argument in this video is simple.",
  "Let's start with...", "Now, let's talk about...". Move by questions and content instead.
- **Colon and dash reveals** [13, 14]: "The answer: ...", "And the result — ...". Write the sentence. TTS also reads
  dashes badly.
- **Uniform rhythm**: every sentence 15 to 20 words, every paragraph the same length. Vary deliberately.
- **Synonym cycling** [11]: calling one thing by three names to avoid repetition. Pick one name and keep it.

## Content habits

- **Generic claims** [27]: a sentence that would fit unchanged in another video on another topic. Replace with the
  specific case or cut.
- **Mannered flourishes** [32]: aphorisms, personified abstractions ("innovation never sleeps"), poetic verbs.
  Plain metaphors that do explanatory work are fine; decorative ones are not. Fragments for spoken emphasis are fine.
- **Summary paragraphs.** Restating what was just said at the end of each section, or of the whole video.
- **Generic endings** [25]: "The future looks bright", "Only time will tell", "One thing is certain", "So the next
  time you...".
- **Research digest.** Every claim tagged with who said it ("X puts it well", "Y calls this", "Z found"). See
  "Own the ideas" in `craft.md`.
- **Performed fairness or enthusiasm.** "I want to be fair here", "I like this one a lot", "a line I keep thinking
  about", "Here's a rule I'd steal".
- **Scripted reactions.** "Here's the detail that bothered me most", "this one surprised me", "and this is where it
  gets wild". Show the reaction by what you dwell on.
- **Engineered twists.** "So the answer is just X, right? Well..." / "That's where I'd have stopped, except...".
- **Number dumps.** Exact figures in every paragraph (52.8 to 66.5, 268 thousand versus 72 thousand). Round, keep the
  ones that matter, put the rest on screen.
- **Strained metaphor.** An extended image that distorts the subject or takes more explanation than the subject itself.
- **Even coverage.** Every finding gets the same-sized paragraph.
- **Slogan ending.** A two-line aphorism that restates the thesis.
- **Mirrored pairs.** "With only A, you get X. With only B, you get Y." Symmetry can clarify a comparison;
  repeating it mechanically flattens the argument.
- **Dutiful counterpoint sections.** A paragraph of steelman, then a paragraph of pushback, placed because balance
  seemed required. Include a counterpoint only where it genuinely changes the argument, and fold it into the beat
  it belongs to.
- **Both-sides closer.** Ending a strong claim with a balancing disclaimer.
- **Action-list ending.** Telling the viewer what to check or do next, unless the video is a tutorial.
- **Balanced to a fault.** Every claim followed by "but on the other hand". Take a position, then concede what is
  true.
- **Exposition the viewer didn't need.** Defining terms the audience knows, background before the hook, explaining
  the joke.
- **Inflated stakes.** "This changes everything", "revolutionary", "the biggest shift in decades", unless a source
  says so and you attribute it.
