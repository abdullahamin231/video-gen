# Speech rate and TTS

## Word budget

Words = minutes × speaking rate. Rates in practice:

| Delivery | Words per minute |
|---|---|
| Calm explainer, room for visuals | 140–160 |
| Typical conversational YouTube narration | 160–185 |
| Fast, dense commentary | 185–210 |

Default to 160 for a TTS voice unless the user gives a rate or the voice has been measured. Land within 5% of the
budget. A script that is too long gets spoken too fast or cut; a short one leaves dead air.

## Writing for the voice

Use the chosen narrator or TTS voice. Punctuation and pronunciation behavior vary by voice; do not rely on unsupported
SSML or emotion tags. When an audio render is part of the user's request, check its actual pronunciation and duration.

- Use sentence punctuation to make the spoken phrasing clear; validate the actual pauses when audio is available.
- Avoid dashes, semicolons, colons, parentheses and ellipses in narration; rewrite as separate sentences or commas.
- Questions get a rising intonation; use real questions only.
- Plain numbers can stay as digits. Write a number out only when the spoken form is ambiguous: "two to six times", "about
  forty cents", "twenty twenty-six", "twelve thousand". Plain small numbers are fine either way.
- Write symbols and units as words: percent, dollars, versus, per.
- Write acronyms and product names normally (API, GPT, AGENTS.md). Change the spelling only where a test render shows
  the voice saying it wrongly, and keep a note of those fixes; a script full of "G P T" and "dot M D" is harder for
  people to read and review.
- No Markdown, emoji, URLs, bullet points or headings.
