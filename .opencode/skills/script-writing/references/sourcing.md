# Gathering the sources

This is the script researcher's job. It runs on the weak model, before the writer starts, and does all the fetching:
the writer on the strong model only reads what you save and never opens a link itself. If a source is missing,
truncated or wrongly attributed here, the script inherits the gap. Gather, do not write: no script, no angle, no
opinion on what the video should say.

## Inputs

The host gives you the user's brief (links, files, notes or just a topic), the script folder
`jobs/scripts/<slug>/`, and sometimes a list of evidence requests from the writer. Create the folder if needed. Write
only inside it.

## Steps

1. **Fetch every supplied source.** For each link run
   `node .opencode/skills/script-writing/scripts/fetch.mjs <url> jobs/scripts/<slug>/sources/NN-<short-name>.md`
   (`NN` = 01, 02, … in the order the user gave them). It handles ordinary pages and Reddit posts with their top
   comments. If the page is script-rendered or the file comes back thin, use your harness's fetch tool or a browser
   and save the text yourself in the same format. For a supplied local file, copy its text into a source file. For a
   GitHub repository, save the README and each file that matters (source, config, docs, changelog) as its own source.
2. **Check each extraction is complete.** Compare it with the page: title, every section, tables, code, the end of the
   article, the comments that matter. A nonempty file is not proof. Re-fetch another way when something is missing;
   if you still cannot get it, say exactly what is missing in `SOURCES.md`.
3. **Follow secondary sources to primary evidence.** When an article reports a measurement, study, filing, benchmark,
   announcement or quote, find and save the original (the paper, the dataset page, the company post, the code, the
   official docs). Save it as its own numbered source and note which secondary source pointed to it. If the original
   is paywalled or gone, record that; never pretend a secondary account is the original.
4. **Topic only, or thin material.** When the brief names a topic but few or no sources, search the web and save the
   sources a careful journalist would use: primary documents first, then reputable reporting, then one or two
   community threads where real users discuss it. Prefer recent material when the topic moves fast, and include
   sources that disagree. Scale to the likely length: about 3–6 sources for a short, 6–12 for a long explainer.
   Never invent a URL; save only what you actually opened.
5. **Answer the writer's evidence requests** when the host passes them: fetch what was asked, add new numbered
   sources, and update `SOURCES.md`. Do not edit the writer's files.

## Source file format

Each `sources/NN-<short-name>.md` starts with this header, then the full extracted text, unedited and unsummarised:

```
# <title as published>
URL: <exact URL fetched>
Publisher/author: <who>
Date: <published or updated date, or "unknown">
Kind: primary | secondary | community | supplied file
Fetched: <YYYY-MM-DD> via <fetch.mjs | browser | harness fetch>
```

Copy text verbatim. Never paraphrase, translate, trim, or "clean up" numbers and quotes: the writer quotes these
files word for word on screen.

## SOURCES.md

Write `jobs/scripts/<slug>/SOURCES.md`, the index the writer starts from:

- **Brief**: the user's request as given, copied verbatim, with any duration, format and creator notes.
- **Sources**: one entry per file: file path, URL, kind, one or two plain sentences on what it covers, whether the
  extraction is complete (and what is missing if not), and which primary sources it cites (saved as which file, or why not).
- **Primary evidence not available**: each central claim whose original you could not reach, and why.
- **Disagreements noticed**: where two sources give different numbers or accounts, with both file paths. Do not
  resolve them; the writer does.
- **Evidence requests answered**: on a follow-up round, each request and the file that answers it, or why it could not
  be answered.

Do not rank facts, choose an angle or draft lines: that is the writer's work.

## Reply

End with: the number of sources saved, any incomplete extractions, primary evidence you could not reach, and the path
to `SOURCES.md`, in under 150 words.
