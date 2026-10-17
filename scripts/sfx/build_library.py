"""Render earshot forge's delivered sound effects into library bundle candidates (one bundle per category).

Run through the pipeline: `npm run video -- sfx-library` (it uses the earshot venv from `setup-earshot`, then
publishes the bundles with the library CLI). Every sound is made in code by a forge recipe from the parameters in
earshot's seed banks; no recorded audio is involved. With --check each sound is also heard by earshot (CLAP + AudioSet)
against a plain description of its kind, and the verdict is stored with it.

usage: python -I build_library.py <staging dir> <earshot commit> [--check]
"""
import glob, json, os, sys, types

import numpy as np
import soundfile as sf
from earshot.forge import load_recipe
from earshot.forge.search import render
from earshot.forge.dsp import SR

# What each kind should sound like (what earshot is asked) and what it must not be mistaken for.
KINDS = {
    'whoosh': ('a whoosh transition sound effect', ['a wind gust', 'a jet engine', 'static noise'], 'transition'),
    'swish': ('a quick swish through the air', ['a whip crack', 'static noise'], 'transition'),
    'swipe': ('a soft swipe of cloth or paper', ['static noise', 'rain'], 'transition'),
    'riser': ('a rising riser building tension', ['a siren', 'a jet engine'], 'build'),
    'downlifter': ('a falling downlifter sweep', ['a siren', 'a jet engine'], 'build'),
    'zip': ('a quick tonal zip pitch sweep', ['a zipper', 'a laser gun'], 'transition'),
    'impact': ('a deep cinematic boom impact', ['a door slam', 'thunder', 'a gunshot'], 'impact'),
    'sub_drop': ('a deep sub bass drop', ['an engine', 'thunder'], 'impact'),
    'logo_sting': ('a short logo reveal sting sound', ['a doorbell', 'an alarm'], 'reveal'),
    'click': ('a user interface click', ['a gunshot', 'a clock tick'], 'ui'),
    'tap': ('a soft tap on a touch screen', ['a knock on a door', 'a gunshot'], 'ui'),
    'toggle': ('a small switch being flipped', ['a gunshot', 'a door latch'], 'ui'),
    'hover_tick': ('a tiny soft interface tick', ['a clock tick', 'a beep'], 'ui'),
    'pop_in': ('a soft pop as an element appears', ['a gunshot', 'a knock'], 'ui'),
    'pop': ('a short pop sound', ['a gunshot', 'a balloon burst'], 'ui'),
    'notify': ('a short notification ding', ['an alarm', 'a doorbell'], 'tonal'),
    'shimmer': ('a sparkling magical shimmer', ['static noise', 'rain'], 'tonal'),
    'glitch': ('a digital glitch stutter', ['static noise', 'a modem'], 'digital'),
    'typing_key': ('a single keyboard key press', ['a gunshot', 'a clock tick'], 'keyboard'),
    'typing_run': ('fast typing on a keyboard', ['rain', 'a clock ticking'], 'keyboard'),
}
USE = {  # where a sound of this family usually belongs in an explainer
    'transition': 'scene changes, things sliding or flying in, camera moves',
    'build': 'tension before a reveal (align "end" on the reveal cue) or a release after it',
    'impact': 'a verdict, a stamp, a heavy landing, the key number arriving (align "peak")',
    'reveal': 'a logo or title resolving, the final payoff',
    'ui': 'buttons, toggles, items popping in, cursor hovers (align "start" on the contact)',
    'tonal': 'a notification, a success, a sparkle on something new',
    'digital': 'errors, corrupted data, a system breaking',
    'keyboard': 'typing into a box, a key press',
}


def kind_of(cat):
    base = cat[4:] if cat.startswith('pro_') else cat
    for k in sorted(KINDS, key=len, reverse=True):
        if base.startswith(k):
            return k
    raise KeyError(cat)


def slug(text):
    return ''.join(c if c.isalnum() else '-' for c in text.lower()).strip('-').replace('--', '-')


def main():
    out, commit, check = sys.argv[1], sys.argv[2], '--check' in sys.argv
    seeds = os.path.join(os.path.dirname(load_recipe('whoosh').__file__), '..', 'seeds')
    bundles = {}
    for bank in sorted(glob.glob(os.path.join(seeds, '*.json'))):
        recipe = os.path.basename(bank)[:-5]
        rec = load_recipe(recipe)
        for e in json.load(open(bank))['entries']:
            cat = e.get('delivered')
            if not cat:
                continue
            fn = rec
            member = e.get('member') or 'x'
            if recipe == 'typing' and 'run' in member:
                fn = types.SimpleNamespace(__name__=rec.__name__, render=rec.render_run)
            x = render(fn, {**(getattr(rec, 'DEFAULTS', {}) or {}), **e['params']}, int(e.get('seed') or 0))
            if x is None:
                print(f'skip {cat}/{member}: render failed', flush=True)
                continue
            b = bundles.setdefault(cat, {'recipe': recipe, 'context': (e.get('context') or '').split(' | ')[0], 'sounds': []})
            name = slug(member.replace(cat + '_', '').replace('pro_', '')) or 'take'
            if any(s['file'] == f'{name}.wav' for s in b['sounds']):
                name = f"{name}-{len(b['sounds']) + 1}"
            d = os.path.join(out, 'sfx-' + slug(cat))
            os.makedirs(d, exist_ok=True)
            sf.write(os.path.join(d, f'{name}.wav'), x, SR, subtype='PCM_24')
            mono = x.mean(axis=1) if x.ndim > 1 else x
            n = int(0.05 * SR)
            env = [float(np.sqrt(np.mean(mono[i:i + n] ** 2) + 1e-12)) for i in range(0, len(mono), n)]
            b['sounds'].append({'file': f'{name}.wav', 'character': member, 'seconds': round(len(mono) / SR, 3),
                                'peakSeconds': round((int(np.argmax(env)) + 0.5) * 0.05, 3), 'seed': e.get('seed')})
            print(f'rendered {cat}/{name}', flush=True)
    if check:
        from earshot import api
        from earshot.forge import polish
        pr = polish.PolishRef(designed=True)
        for cat, b in bundles.items():
            q, alts, _ = KINDS[kind_of(cat)]
            for s in b['sounds']:
                f = os.path.join(out, 'sfx-' + slug(cat), s['file'])
                m = api.match(f, q, alts=alts)
                x, _sr = sf.read(f)
                c = pr.check(x)
                s['earshot'] = {'asked': q, 'verdict': m['verdict'], 'z': m['z'], 'artifacts': c['hard']}
                print(f"checked {cat}/{s['file']}: {m['verdict']}", flush=True)
    for cat, b in bundles.items():
        k = kind_of(cat)
        q, _, family = KINDS[k]
        bid = 'sfx-' + slug(cat)
        heard = [s.get('earshot', {}).get('verdict') for s in b['sounds']]
        good = sum(v in ('strong', 'plausible') for v in heard)
        designed = cat.startswith('pro_')
        listing = ', '.join(f"{s['file'][:-4]} ({s['seconds']:.2f} s" + (f", {s['earshot']['verdict']}" if 'earshot' in s else '') + ')'
                            for s in b['sounds'])
        title = f"Sound effects: {cat.replace('_', ' ')} ({len(b['sounds'])} variants)"
        desc = (f"{len(b['sounds'])} code-made {cat.replace('_', ' ')} sound effects ({b['context'] or q}). "
                f"{'Modelled on the designed effects of professional launch films. ' if designed else ''}"
                f"Good for {USE[family]}. Variants: {listing}."
                + (f" earshot heard {good} of {len(heard)} as {q} (strong or plausible)." if check else ''))
        tags = sorted({'sound', 'sfx', 'audio', 'effect', family, *cat.replace('pro_', '').split('_'), *(['designed'] if designed else []),
                       *[w for s in b['sounds'] for w in s['character'].replace(cat + '_', '').split('_') if w.isalpha() and len(w) > 2]})
        first = b['sounds'][0]['file']
        manifest = {
            'schemaVersion': 1, 'id': bid, 'version': '1.0.0', 'kind': 'asset', 'title': title, 'description': desc, 'tags': tags,
            'entry': first, 'files': [s['file'] for s in b['sounds']] + ['sounds.json'],
            'usage': (f"Run library-use --item {bid}@1.0.0, pick a variant from sounds.json (length, loudest moment, earshot verdict), "
                      f"then add it to the shot's \"sounds\": {{\"src\": \"assets/library/{bid}/1.0.0/{first}\", \"at\": \"<cue>\", "
                      f"\"align\": \"start|peak|end\", \"volume\": 0.3, \"why\": \"<what on screen makes this sound>\"}}. "
                      "Each file peaks at -1 dBFS; the build warns when a sound would mask the narration."),
            'origin': {'source': f"earshot forge 0.2.0 ({'https://github.com/Leonxlnx/earshot'} @ {commit}), recipe {b['recipe']}, "
                                 f"delivered final '{cat}' re-rendered from its seed bank",
                       'license': 'MIT (earshot); synthesized in code, contains no recorded audio'},
            'review': {'status': 'draft', 'evidence': []},
        }
        d = os.path.join(out, bid)
        json.dump({'category': cat, 'recipe': b['recipe'], 'asked': q, 'sounds': b['sounds']}, open(os.path.join(d, 'sounds.json'), 'w'), indent=1)
        json.dump(manifest, open(os.path.join(d, 'artifact.json'), 'w'), indent=2)
    print(f'{len(bundles)} bundles, {sum(len(b["sounds"]) for b in bundles.values())} sounds in {out}')


if __name__ == '__main__':
    main()
