# Craft of a spoken script

These are the habits that separate scripts people finish from scripts people skip. None is a rule to apply
everywhere; each is a tool to reach for when it fits.
Match genre, runtime and creator voice. Numeric examples below describe particular long-form explainers, not targets
for every script; a short tutorial or reported story may need a different rhythm and ending.

## Openings

The first thirty seconds decide whether anyone hears the rest. The channel we model (see
`docs/kaiexplains-script-study.md`) almost never opens on the topic. It opens on a moment the viewer recognises, lets
the narrator react to it like a person, and leaves a question the video then answers. For a long explainer, that cold
open usually makes five moves in about 150–200 words:

1. **A scene, not a topic.** One specific moment with the details a person would actually notice: the time, the object,
   the number on the screen, what you did while you waited. "So picture this. You just spent four thousand dollars on
   a laptop, you load the model, paste in your code and hit enter. And you wait. And three minutes later the first
   word shows up." Put the viewer in it ("you"), a real person from the sources ("this happened to a developer on
   Reddit"), or the creator, but only from their notes. "Picture this" earns its place only when the very next
   sentence is that specific; followed by a generality it is the weak "Imagine a world where...".
2. **A reaction with some personality.** One line where the narrator sounds like someone with a temper and a sense of
   humour, usually an exaggeration that makes the pain concrete: "which is not so much a speed as a medical condition",
   "I've microwaved meals faster than that". It must be about this situation; a joke that fits any video is filler.
3. **What everyone believes.** The explanation going round, with its size when the sources give it: "threads with
   thousands of upvotes all decided it was quantization". State it fairly; it should be a belief people really hold.
4. **The turn.** Why that belief is wrong, incomplete or missing the bigger thing: "That explanation is clean, and it's
   satisfying, and it's mostly wrong." This is the mystery the video pays off, so it must be true and the video must
   resolve it.
5. **The promise.** Within about the first minute, say plainly what the viewer will know by the end and who it is for:
   "So I want to show you where that number comes from, what it means day to day, and who should not buy this."

Scale it to the runtime: a short does the scene, the turn and the promise in three or four sentences. When there is
no common belief to turn (a neutral lesson, a how-to), open on the scene and go straight to the question. Other strong
starts still work when they fit better:

- **A concrete artifact with an odd detail.** Something that exists and can be shown, with the detail most people skim
  past. The video explains why that detail is there.
- **A comparison that breaks.** Two things that look alike, and the one way they are not. The break is the topic.
- **A number with stakes**, only when the number itself surprises and the stakes are immediately clear.

Weak openings: a definition, a history lesson, "In today's video" as the first line, a rhetorical question that any
video on the topic could ask ("Have you ever wondered...?"), "Imagine a world where...", and a stat chosen because it
is big rather than because it is strange. Do not reuse the reference channel's exact lines or its "two a.m." every
time; the moves are the pattern, the details must come from this topic.

## Structures

Pick the structure that matches how the understanding actually builds, not a template.

- **Build it up.** Start from the simplest working version and add each part only when a problem demands it. Each new
  part answers "why isn't the previous version enough?" Good for explaining systems.
- **Investigation.** A claim that seemed unlikely, then the checking: what was tested, what held, what didn't. The
  viewer's doubt drives the video.
- **Story.** One person or thing through a sequence of events, with the explanation delivered when the story needs it.
- **Argument.** The common view, the evidence against it, the better view, what follows. Needs a real opponent stated
  at full strength.
- **Consequences.** A change, then its effects in order of distance: first-order, then the ones people miss.

Prefer a structure the viewer can hold: name the parts of the idea as they appear, so by the end the viewer has a
model in their head ("the loop, the window, the gate") rather than a pile of findings. Evidence comes in where it
settles a point, not as the point.

An investigation or argument often benefits from a turn: a point after which the viewer sees the earlier material differently.
Place it where the evidence changes the understanding, not at a fixed percentage. Let it arrive as the question a viewer would
ask next, not as a device ("So the answer is just X, right? Well, except...").

Beats connect by questions. The end of each beat makes the next question obvious, and the next beat often opens by
asking it out loud: "So what breaks first?" "Then who pays for it?" The viewer feels pulled
forward instead of handed a list.

Give each beat one job. A beat that explains two things explains neither.

Weight the beats unequally. Pick the two or three points you care most about and spend real time on them; give the
others a sentence; drop the rest. Human scripts are lopsided because their writers care more about some things than
others. Even coverage, where every finding gets the same paragraph, reads as a machine summarising a folder.

## Voice

Decide who is talking before drafting: what they know, what they think, how they talk, and what they would never say.
Keep that person consistent for the whole script.

- **Be a person, not a reader.** The narrator speaks in the first person: what they think, what they noticed, what
  annoys them, what they would do. Reactions and opinions are always theirs to give. What they *did* ("I bought one",
  "I ran it for a week") must come from the creator's notes; without notes, put the viewer or a real person from the
  sources in the scene instead. Never invent an experience to sound human.
- **Have opinions and say them as opinions.** "I think this benchmark is measuring the wrong thing" is a person.
  "Some might argue" is nobody. Concede where the other side is right; it makes the stance believable.
- **Talk to the viewer as a peer.** "We" for shared experience, "you" for what happens to them. Assume they are smart
  and new to this.
- **Write for the screen as well as the ear.** This is a video. When the evidence is a real artifact (a line of
  code, a pricing page, a chart, a post), say so and show it: "you can see it right here", "let's pull up their
  repository", "as you can see from these numbers". Use these where the evidence matters and can actually be shown;
  scale their number to the runtime. Do not add empty screen references to meet a quota.
- **Own the ideas.** The sources are your research, not your cast. An expert explains what they understand; they
  don't keep telling you who said it. Name a source when the name itself is the point (a company conceding
  something about its own product, a measurement the viewer can check), and otherwise say it in your own words.
  Retain attribution needed to distinguish reported findings from your own tests or reasoning.
- **Use the creator's own material.** Their results, their earlier videos, their mistakes, when the notes provide
  them. This is the most human element in any script, and it can only come from the creator. Never invent it.
- **For an argument, choose a defensible position.** Let the explanation support it. A neutral lesson or tutorial can
  succeed by teaching a useful mental model or procedure; do not manufacture a controversial claim.
- **Name incentives when they explain the evidence.** Who benefits can be relevant in commentary or an investigation.
  Do not force every topic into a story about power or lock-in, or infer motive from incentives alone.
- **Let positions stand.** State an opinion and leave it there. A closing "that doesn't make them bad, and..."
  balancing clause softens every claim into nothing. Concede inside the argument, where it matters, not as a
  disclaimer at the end.
- **Be honest without performing it.** State what is uncertain in the sentence where it matters. Announcing your
  fairness ("Now, I want to be fair here") or your enthusiasm ("I love this one") reads as performance.

## Making ideas land

- **Mechanism over adjectives.** Don't say a thing is "powerful" or "expensive". Say what it does step by step, or what
  it costs and compared to what.
- **Few numbers, each with its consequence.** "Three times the price" means little; "three times the price, for the
  same result" means something. Keep the numbers a viewer would repeat to a friend and round them the way a person
  would ("about a fifth", "roughly fifteen times"). Check whether the listener can retain each figure and its meaning;
  a numerical tutorial may appropriately contain more than an essay. Precise figures can go on screen while the
  voice rounds them.
- **Concrete before abstract.** Show the case, then name the pattern. The name is easier to remember once the viewer
  has seen the thing it names.
- **Use analogies where they clarify.** Explain a hard idea through something everyone already
  understands from ordinary life: money, buildings, households, shops, sport, machines. A good analogy does work
  evidence can't, because the viewer can picture it. An extended metaphor is useful when its relationships remain
  accurate; stop when the viewer must learn the metaphor instead of the idea. A callback should add understanding.
- **Name the parts.** When explaining a system, give each part a short, plain name and use exactly that name every time.
- **Say the obvious objection before the viewer does**, then answer it.

## Rhythm

- Speech flows. Most spoken explanation comes in medium-to-long sentences chained with "and", "which", "because",
  "so": one clause hands the thought to the next, the way people reason aloud. Short sentences land a point after
  that chain; use them for emphasis, not as the default beat. Strings of four-word sentences ("Same model. Same
  prompt. Different bill.") can become mannered when repeated. Judge the rhythm by the chosen voice and genre,
  rather than a target percentage of short sentences.
- Spoken explanation leans on connectives at the start of sentences: "And", "So", "Now", "But", "Well", "Which".
  They can carry the logic aloud ("So that means...", "And that's why...") and give the listener a breath. Use them
  where the thought connects; inserting them to meet a frequency target creates another repetitive pattern.
- Put the important word at the end of the sentence, where the voice lands.
- Repeat key phrases deliberately. Writing avoids repetition; speech uses it so the listener can keep hold of the
  thread.
- Leave room. The script should feel slightly short on the page.
- Keep quotable one-liners rare. Sentences built to be clipped ("Which is a good sentence. But it's still a
  sentence.") are a writer's habit, not a speaker's. Two or three per script.
- Let some paragraphs end mid-thought and flow into the next. If most paragraphs close on a crafted one-liner, the
  script sounds written. Save the landing lines for the two or three moments that deserve them.
- Signpost through questions and content, not announcements. "Next part." "Here's the part most people miss." "My
  argument is simple." are scaffolding showing through.

## Endings

An artifact, scene, question or comparison from the opening can connect the middle and ending. Return to it when the
meaning changes; a script need not make exactly three scheduled visits to the same frame.

End on the implication: what follows from it, for the viewer or for the industry, stated as a specific consequence,
or an open worry the viewer takes away. A tutorial can instead finish with the completed result and useful next actions;
a story needs its resolution. Avoid a slogan that merely repeats the thesis.

Avoid: an unrelated checklist, an unnecessary summary of everything said, "So the next time you...", "The future is...", "Only time will tell", a
call to subscribe unless the user asked, and a tidy moral the video didn't earn.

## Before you call it done

- Could this script have been written without the sources? Then it's not specific enough.
- Could another channel have said the same thing in the same way? Then it has no voice.
- Is there a sentence where the narrator sounds more certain than the evidence? Fix it.
- Is there a minute where nothing new is learned? Cut it.
- Does it sound natural in the chosen voice, with the evidence attributed accurately?
