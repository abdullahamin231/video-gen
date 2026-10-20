/* VG kit: turns a compiled film spec into one seek-safe SVG world and one paused GSAP timeline.
 * Loaded by every job (assets/kit/kit.js). Requires gsap + DrawSVG, MorphSVG and MotionPath plugins.
 * Determinism: no clocks, no unseeded randomness, no callbacks. Every tween is created from tracked
 * state with explicit from/to values, so the timeline renders the same frame for any seek order. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const VG = window.VG = window.VG || {};
  VG.components = VG.components || {};
  VG.hooks = VG.hooks || {};
  VG.component = (name, def) => { VG.components[name] = def; };
  VG.hook = (scene, fn) => { (VG.hooks[scene] = VG.hooks[scene] || []).push(fn); };

  // Fallback tokens only. Every film declares its own theme in film.json ("theme"), which is merged over these:
  // bg, fg, colors, fonts, stroke, corner, fillOpacity, shadow, label/text/value type settings, eases, defaults.
  const THEME = {
    bg: '#10141a',
    fg: null, // default colour of strokes and text; falls back to colors.white
    stroke: 3,
    corner: 0,
    fillOpacity: 0.18,
    shadow: {dx: 0, dy: 10, blur: 14, color: '#000000', opacity: 0.45},
    fonts: {sans: 'Inter', serif: 'Source Serif 4', mono: 'JetBrains Mono'},
    colors: {white: '#ece8df', grey: '#8d96a5', dim: '#3b4452', faint: '#232a34', blue: '#6cb4d6', yellow: '#e3c46b',
      red: '#d9796b', green: '#8cc084', purple: '#a693d1', teal: '#5fb8a8', orange: '#e09a5f', bg: '#10141a'},
    sizes: {label: 32, value: 48, title: 64},
    text: {weight: 500},
    label: {},
    value: {font: 'mono'},
    eases: {},
    defaults: {},
  };
  VG.defaultTheme = THEME;
  const EASES = {smooth: 'power2.inOut', out: 'power3.out', in: 'power2.in', linear: 'none', sine: 'sine.inOut', slow: 'power4.inOut',
    pop: 'back.out(1.7)', snap: 'power4.out', settle: 'elastic.out(1, 0.55)', drop: 'bounce.out'};
  VG.eases = EASES;

  // ---------- small utilities ----------
  VG.rng = seed => { let a = (seed >>> 0) || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const r3 = v => Math.round(v * 1000) / 1000;
  const dm = m => new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
  const ctm = el => dm(el.getCTM());
  const fnFrom = src => typeof src === 'function' ? src : new Function('x', 'Math', `"use strict"; return (${src})(x);`).bind(null);
  function compileFn(src) { const f = new Function('Math', `"use strict"; return (${src});`)(Math); if (typeof f !== 'function') throw new Error(`fn must be a JS arrow function string, got: ${src}`); return f; }
  void fnFrom;

  function mount(container, film) {
    const theme = deepMerge(JSON.parse(JSON.stringify(THEME)), film.theme || {});
    const W = film.width, H = film.height;
    const tl = gsap.timeline({paused: true});
    const objs = new Map();
    const log = [];
    const fg = theme.fg ? (theme.colors[theme.fg] || theme.fg) : theme.colors.white;
    const col = c => c == null ? fg : (theme.colors[c] || c);
    // A theme may redefine any named ease (e.g. "out": "back.out(1.4)") so every entrance in the film shares one personality.
    const ease = e => { const name = e || 'smooth'; return theme.eases[name] ? (EASES[theme.eases[name]] || theme.eases[name]) : (EASES[name] || name); };
    const FALLBACK = {sans: 'sans-serif', serif: 'serif', mono: 'monospace', display: 'sans-serif'};
    const fontStack = key => { const v = theme.fonts[key || 'sans'] ?? key; if (!v) return null; return /[,'"]/.test(v) ? v : `'${v}', ${FALLBACK[key] || 'sans-serif'}`; };

    function svg(tag, attrs = {}, parent) {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
      if (parent) parent.appendChild(el);
      return el;
    }
    // ---------- stage ----------
    container.innerHTML = '';
    const root = svg('svg', {viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'vg-stage', 'font-family': fontStack('sans')});
    root.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden';
    container.appendChild(root);
    const defs = svg('defs', {}, root);
    svg('rect', {x: -W * 4, y: -H * 4, width: W * 9, height: H * 9, fill: col(theme.bg)}, root);
    const camT = svg('g', {transform: `translate(${W / 2} ${H / 2})`}, root);
    const camS = svg('g', {class: 'vg-cam-scale'}, camT);
    const camP = svg('g', {class: 'vg-cam-pan'}, camS);
    const world = svg('g', {class: 'vg-world'}, camP);
    const screen = svg('g', {class: 'vg-screen'}, root);
    // HTML media layer mirrors the camera with CSS transforms.
    const media0 = document.createElement('div'); media0.className = 'vg-media';
    media0.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;pointer-events:none`;
    const mT = document.createElement('div'); mT.style.cssText = `position:absolute;left:0;top:0;transform:translate(${W / 2}px,${H / 2}px)`;
    const mS = document.createElement('div'); mS.style.cssText = 'position:absolute;left:0;top:0';
    const mP = document.createElement('div'); mP.style.cssText = 'position:absolute;left:0;top:0';
    mT.appendChild(mS); mS.appendChild(mP); media0.appendChild(mT); container.appendChild(media0);

    const cam = {x: W / 2, y: H / 2, zoom: 1, rotate: 0, ...(film.camera ? {x: film.camera.center?.[0] ?? W / 2, y: film.camera.center?.[1] ?? H / 2, zoom: film.camera.zoom ?? 1, rotate: film.camera.rotate ?? 0} : {})};
    gsap.set(camS, {scale: cam.zoom, rotation: cam.rotate, svgOrigin: '0 0'});
    gsap.set(camP, {x: -cam.x, y: -cam.y});
    gsap.set(mS, {scale: cam.zoom, rotation: cam.rotate, transformOrigin: '0px 0px'});
    gsap.set(mP, {x: -cam.x, y: -cam.y});

    // ---------- state tracking (the source of seek safety) ----------
    const STATE = new WeakMap();
    function state(el) { let s = STATE.get(el); if (!s) STATE.set(el, s = {}); return s; }
    function current(el, key, fallback) { const s = state(el); return key in s ? s[key] : fallback; }
    /** Tween el from its tracked state to `to`. Keys: x,y,scale,scaleX,scaleY,rotation,opacity,autoAlpha,drawSVG,morphSVG,
     *  textContent and attr.* / style keys. defaults supplies the start value when the key was never tracked. */
    const conflicts = []; let currentSource = '';
    function claim(el, keys, t, dur) { // two tweens animating the same property at once render differently depending on seek order
      const s = state(el); s.__busy = s.__busy || {};
      for (const k of keys) {
        const b = s.__busy[k];
        if (b && t < b.end - 0.02 && b.src !== currentSource) {
          const who = el.closest?.('.vg-obj')?.dataset.vgId || (el.classList?.contains('vg-cam-scale') || el.classList?.contains('vg-cam-pan') ? 'camera' : 'an element'), key = `${currentSource}|${b.src}|${who}`;
          if (!conflicts.some(c => c.key === key)) conflicts.push({key, text: `${currentSource} starts at ${r3(t)}s while ${b.src} is still animating ${who} (until ${r3(b.end)}s). Start it later or shorten the earlier action`});
        }
        s.__busy[k] = {end: t + dur, src: currentSource};
      }
    }
    function tween(el, to, t, dur, ez, defaults = {}, extra = {}) {
      // Interpolating "none"/0 to a dash pattern can produce microscopic dashes
      // near the first frame and hang SVG rasterization. Pattern changes are discrete;
      // opacity/geometry in the same action still use their requested duration.
      if ('attr.stroke-dasharray' in to) {
        const {'attr.stroke-dasharray': dash, ...rest} = to;
        if (Object.keys(rest).length) tween(el, rest, t, dur, ez, defaults, extra);
        to = {'attr.stroke-dasharray': dash}; dur = 0.001; ez = 'steps(1)';
      }
      claim(el, Object.keys(to), t, dur);
      const s = state(el), from = {}, end = {};
      for (const [k, v] of Object.entries(to)) {
        const start = k in s ? s[k] : (k in defaults ? defaults[k] : naturalStart(el, k));
        if (k.startsWith('attr.')) { (from.attr = from.attr || {})[k.slice(5)] = start; (end.attr = end.attr || {})[k.slice(5)] = v; }
        else { from[k] = start; end[k] = v; }
        s[k] = v;
      }
      if (el instanceof SVGElement && ('scale' in to || 'rotation' in to || 'scaleX' in to || 'scaleY' in to)) { from.svgOrigin = end.svgOrigin = el.__origin || '0 0'; }
      tl.fromTo(el, from, {...end, ...extra, duration: Math.max(0.001, dur), ease: ease(ez), immediateRender: false}, Math.max(0, t));
    }
    function naturalStart(el, k) {
      if (k === 'opacity' || k === 'autoAlpha') return 1;
      if (k === 'scale' || k === 'scaleX' || k === 'scaleY') return 1;
      if (k === 'x' || k === 'y' || k === 'rotation') return 0;
      if (k === 'drawSVG') return '0% 100%';
      if (k === 'morphSVG') return el.getAttribute('d');
      if (k.startsWith('attr.')) { const v = el.getAttribute(k.slice(5)); return v == null ? (k === 'attr.stroke-dasharray' ? 'none' : 0) : (isNaN(+v) ? v : +v); }
      return 0;
    }
    function setNow(el, props) {
      const gsapProps = {};
      for (const [k,v] of Object.entries(props)) {
        if (k.startsWith('attr.')) (gsapProps.attr ||= {})[k.slice(5)] = v;
        else gsapProps[k] = v;
      }
      gsap.set(el, gsapProps);
      const s = state(el); for (const [k, v] of Object.entries(props)) if (k !== 'svgOrigin' && k !== 'transformOrigin') s[k] = v;
    }

    // ---------- object construction ----------
    const shadows = new Map(); // one SVG filter per distinct shadow setting
    function shadowFilter(spec) {
      const s = {...theme.shadow, ...(spec === true ? {} : spec)}, key = JSON.stringify(s);
      if (!shadows.has(key)) {
        const id = `vg-shadow-${shadows.size}`, f = svg('filter', {id, x: '-30%', y: '-30%', width: '160%', height: '160%', 'color-interpolation-filters': 'sRGB'}, defs);
        svg('feDropShadow', {dx: s.dx ?? 0, dy: s.dy ?? 0, stdDeviation: s.blur ?? 0, 'flood-color': col(s.color ?? '#000000'), 'flood-opacity': s.opacity ?? 1}, f);
        shadows.set(key, id);
      }
      return `url(#${shadows.get(key)})`;
    }
    // knockout: makes a plain white or black studio background transparent (a luminance key, no model needed).
    // "white" | "black" | {"key": "white", "tolerance": 0.06, "softness": 0.08}. Subject areas as light (or dark) as
    // the background disappear too, so use it for subjects that contrast with their background.
    function knockoutFilter(spec) {
      const o = typeof spec === 'string' ? {key: spec} : spec, white = (o.key ?? 'white') !== 'black', t = o.tolerance ?? 0.06, soft = Math.max(0.005, o.softness ?? 0.08), key = JSON.stringify([white, t, soft]);
      if (!shadows.has(key)) {
        const id = `vg-knockout-${shadows.size}`, f = svg('filter', {id, x: 0, y: 0, width: 1, height: 1, 'color-interpolation-filters': 'sRGB'}, defs), q = 1 / (3 * soft);
        const alpha = white ? `${-q} ${-q} ${-q} 0 ${r3((1 - t) / soft)}` : `${q} ${q} ${q} 0 ${r3(-t / soft)}`;
        svg('feColorMatrix', {type: 'matrix', values: `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  ${alpha}`, result: 'keyed'}, f);
        svg('feComposite', {in: 'keyed', in2: 'SourceAlpha', operator: 'in'}, f);
        shadows.set(key, id);
      }
      return `url(#${shadows.get(key)})`;
    }
    const ctx = {svg, col, theme, W, H, objs, defs, world, screen, rng: VG.rng, compileFn, fontStack, shadowFilter, knockoutFilter};
    function makeShell(o, parent) {
      const outer = svg('g', {id: `vg-${o.id}`, class: 'vg-obj', 'data-vg-id': o.id, 'data-vg-type': o.type}, parent);
      const rs = svg('g', {class: 'vg-rs'}, outer);
      const body = svg('g', {class: 'vg-body'}, rs);
      return {outer, rs, body};
    }
    function strokeAttrs(o, fallbackColor = null) {
      return {stroke: o.stroke === false ? 'none' : col(o.color ?? fallbackColor), 'stroke-width': o.width ?? theme.stroke,
        fill: o.fill ? col(o.fill === true ? (o.color ?? fallbackColor) : o.fill) : 'none',
        'fill-opacity': o.fill ? (o.fillOpacity ?? theme.fillOpacity) : null, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-dasharray': o.dash ? String(o.dash) : null};
    }
    function textAttrs(o, size) {
      const T = theme.text || {};
      return {'font-size': size, 'font-weight': o.weight ?? T.weight ?? 500, fill: col(o.color ?? T.color),
        'font-family': fontStack(o.font || T.font || 'sans'), 'text-anchor': o.anchor === 'start' ? 'start' : o.anchor === 'end' ? 'end' : 'middle',
        'dominant-baseline': 'central', 'letter-spacing': (o.tracking ?? T.tracking) != null ? (o.tracking ?? T.tracking) : null, 'font-style': o.italic ? 'italic' : null};
    }
    function textNode(parent, o, str, size) {
      const t = svg('text', {x: 0, y: 0, ...textAttrs(o, size)}, parent);
      const lines = String(o.upper ?? theme.text?.upper ? String(str).toUpperCase() : str).split('\n');
      lines.forEach((line, li) => {
        const span = svg('tspan', {x: 0, dy: li === 0 ? `${-(lines.length - 1) * 0.6}em` : '1.2em', class: 'vg-line'}, t);
        // Characters become tspans so write() can reveal them one by one.
        for (const ch of line) { const c = svg('tspan', {class: 'vg-ch'}, span); c.textContent = ch; }
      });
      return t;
    }
    function arrowHead(parent, x1, y1, x2, y2, o) {
      const len = o.tip ?? Math.max(16, (o.width ?? theme.stroke) * 6), wid = len * 0.72;
      const a = Math.atan2(y2 - y1, x2 - x1), c = Math.cos(a), s = Math.sin(a);
      const bx = x2 - c * len, by = y2 - s * len;
      const d = `M${r3(x2)} ${r3(y2)} L${r3(bx - s * wid / 2)} ${r3(by + c * wid / 2)} L${r3(bx + s * wid / 2)} ${r3(by - c * wid / 2)} Z`;
      return svg('path', {d, fill: col(o.color), stroke: col(o.color), 'stroke-width': 1, 'stroke-linejoin': 'round', class: 'vg-head'}, parent);
    }
    function bracePath(x1, y1, x2, y2, depth) {
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = uy, ny = -ux;
      const p = (u, v) => `${r3(x1 + ux * u + nx * v)} ${r3(y1 + uy * u + ny * v)}`;
      const h = depth, m = L / 2;
      return `M${p(0, 0)} C${p(0, h * 0.6)} ${p(h * 0.4, h * 0.5)} ${p(h, h * 0.5)} L${p(m - h, h * 0.5)} C${p(m - h * 0.3, h * 0.5)} ${p(m, h * 0.7)} ${p(m, h)} ` +
        `C${p(m, h * 0.7)} ${p(m + h * 0.3, h * 0.5)} ${p(m + h, h * 0.5)} L${p(L - h, h * 0.5)} C${p(L - h * 0.4, h * 0.5)} ${p(L, h * 0.6)} ${p(L, 0)}`;
    }
    function axesApi(o) {
      const [w, h] = o.size || [800, 500];
      const [x0, x1] = o.x || [0, 10], [y0, y1] = o.y || [0, 10];
      const c2p = (x, y) => [r3((x - x0) / (x1 - x0) * w - w / 2), r3(-((y - y0) / (y1 - y0) * h - h / 2))];
      return {w, h, x0, x1, y0, y1, c2p, plot: null};
    }
    function graphD(api, fn, domain, samples, clampY) {
      const [a, b] = domain || [api.x0, api.x1], n = samples || 160, pts = [];
      for (let i = 0; i <= n; i++) {
        const x = a + (b - a) * i / n; let y = fn(x);
        if (!Number.isFinite(y)) continue;
        if (clampY !== false) y = Math.max(api.y0 - (api.y1 - api.y0) * 0.05, Math.min(api.y1 + (api.y1 - api.y0) * 0.05, y));
        pts.push(api.c2p(x, y));
      }
      return 'M' + pts.map(p => `${p[0]} ${p[1]}`).join(' L');
    }
    function pointsD(points, closed) { return 'M' + points.map(p => `${r3(p[0])} ${r3(p[1])}`).join(' L') + (closed ? ' Z' : ''); }

    // ---------- composite objects: the explainer vocabulary ----------
    // source card, hanging tag, verdict stamp, hero number, gauge, spec sheet, chip. Each is drawn from the theme's
    // tokens ("paper" and "ink" colours when the theme names them, else white and the background), so it belongs to
    // whatever look the film has. Text keeps per-character spans, so write and type work on every part.
    const hasColour = n => Object.prototype.hasOwnProperty.call(film.theme?.colors || {}, n);
    const paperOf = o => col(o.paper ?? (hasColour('paper') ? 'paper' : 'white'));
    const inkOf = o => col(o.ink ?? (hasColour('ink') ? 'ink' : theme.bg));
    const displayFont = () => (theme.fonts.display ? 'display' : 'sans');
    function measure(str, attrs) {
      const t = svg('text', {...attrs, x: 0, y: 0, visibility: 'hidden'}, root); t.textContent = str;
      const w = t.getComputedTextLength(); t.remove(); return w;
    }
    function wrapLines(text, maxW, attrs) {
      const out = [];
      for (const para of String(text).split('\n')) {
        let line = '';
        for (const word of para.split(/\s+/).filter(Boolean)) {
          const next = line ? `${line} ${word}` : word;
          if (line && measure(next, attrs) > maxW) { out.push(line); line = word; } else line = next;
        }
        out.push(line);
      }
      return out;
    }
    function charLines(parent, lines, attrs, x, y0, lh) {
      const t = svg('text', {...attrs, 'text-anchor': 'start'}, parent);
      lines.forEach((line, i) => {
        const span = svg('tspan', {x: r3(x), y: r3(y0 + i * lh), class: 'vg-line'}, t);
        for (const ch of line) { const c = svg('tspan', {class: 'vg-ch'}, span); c.textContent = ch; }
      });
      return t;
    }
    // Marker rectangles behind the characters of `phrase` inside a text built by charLines.
    function highlightBehind(group, textEl, lines, phrase, size, colour) {
      const full = lines.join(' '), at = phrase ? full.toLowerCase().indexOf(String(phrase).toLowerCase()) : -1;
      if (at < 0) return false;
      let offset = 0, chars = 0;
      lines.forEach(line => {
        const a = Math.max(at, offset), b = Math.min(at + phrase.length, offset + line.length);
        if (b > a) {
          const first = textEl.getExtentOfChar(chars + a - offset), last = textEl.getExtentOfChar(chars + b - 1 - offset), cy = first.y + first.height / 2;
          svg('rect', {x: r3(first.x - size * 0.12), y: r3(cy - size * 0.62), width: r3(last.x + last.width - first.x + size * 0.24), height: r3(size * 1.24), fill: colour}, group);
        }
        offset += line.length + 1; chars += line.length;
      });
      return true;
    }
    function chipNode(parent, text, {size = 28, color, filled = false, font = 'mono', at = [0, 0]} = {}) {
      const g = svg('g', {transform: `translate(${r3(at[0])} ${r3(at[1])})`, class: 'vg-chip'}, parent);
      const str = String(text).toUpperCase(), attrs = textAttrs({font, weight: 700}, size), tw = measure(str, attrs);
      const ph = size * 1.7, pw = tw + size * 1.3;
      const pill = svg('rect', {x: r3(-pw / 2), y: r3(-ph / 2), width: r3(pw), height: r3(ph), rx: r3(ph / 2),
        fill: filled ? col(color) : col(theme.bg), stroke: col(color), 'stroke-width': Math.max(2, theme.stroke * 0.7)}, g);
      const label = textNode(g, {font, weight: 700, color: filled ? theme.bg : color, upper: true}, str, size);
      return {g, pill, label, width: pw, height: ph};
    }

    const COMPOSITES = {
      // A real source on screen: a post, article line, README or table, retyped exactly, the key phrase marked, and
      // a chip naming where it comes from.
      card(o, k) {
        const w = o.width ?? 640, size = o.size ?? 32, pad = o.padding ?? Math.round(size * 0.95), lh = size * 1.38;
        const A = {...textAttrs({font: o.font ?? 'sans', weight: o.weight ?? 500}, size), fill: inkOf(o)};
        const lines = wrapLines(o.text ?? '', w - 2 * pad, A);
        const ts = o.titleSize ?? Math.max(28, Math.round(size * 0.82)), head = o.title ? ts * 1.75 : 0;
        const h = pad * 2 + head + lines.length * lh - (lh - size);
        const parts = {};
        parts.paper = svg('rect', {x: -w / 2, y: r3(-h / 2), width: w, height: r3(h), rx: o.corner ?? theme.corner ?? 0, fill: paperOf(o),
          stroke: o.outline ? col(o.outline === true ? null : o.outline) : 'none', 'stroke-width': theme.stroke}, k.body);
        if (o.title) parts.title = charLines(k.body, [String(o.title).toUpperCase()], {...textAttrs({font: o.titleFont ?? 'mono', weight: 700}, ts), fill: inkOf(o), 'fill-opacity': 0.62}, -w / 2 + pad, -h / 2 + pad + ts / 2, 0);
        parts.highlight = svg('g', {class: 'vg-highlight'}, k.body);
        parts.text = charLines(k.body, lines, A, -w / 2 + pad, -h / 2 + pad + head + size / 2, lh);
        if (o.highlight && !highlightBehind(parts.highlight, parts.text, lines, o.highlight, size, col(o.highlightColor ?? 'yellow')))
          throw new Error(`card ${o.id}: "highlight" must be words that occur in its "text" ("${o.highlight}" does not)`);
        if (o.source) { const c = chipNode(k.body, o.source, {size: o.sourceSize ?? 28, color: o.sourceColor, at: [0, h / 2 + 22 + (o.sourceSize ?? 28) * 0.85]}); parts.source = c.g; }
        return {parts};
      },
      // A price or size tag hanging from a pin on a string; "swing" sways it from the pin.
      tag(o, k) {
        const size = o.size ?? 44, font = o.font ?? displayFont(), str = String(o.text ?? '');
        const A = {...textAttrs({font, weight: o.weight ?? 800}, size), fill: col(o.ink ?? theme.bg)}, tw = measure(str, A);
        const bw = tw + size * 1.1, bh = size * 1.7, len = o.string ?? 80, parts = {};
        if (len > 0) {
          parts.string = svg('line', {x1: 0, y1: r3(-bh / 2 - len), x2: 0, y2: r3(-bh / 2), stroke: col(o.stringColor), 'stroke-width': Math.max(2, theme.stroke * 0.6), 'stroke-linecap': 'round'}, k.body);
          parts.pin = svg('circle', {cx: 0, cy: r3(-bh / 2 - len), r: Math.max(5, size * 0.14), fill: col(o.stringColor)}, k.body);
        }
        parts.body = svg('rect', {x: r3(-bw / 2), y: r3(-bh / 2), width: r3(bw), height: r3(bh), rx: o.corner ?? Math.min(10, theme.corner ?? 6), fill: col(o.color ?? 'yellow'), stroke: 'none'}, k.body);
        parts.text = textNode(k.body, {font, weight: o.weight ?? 800, color: o.ink ?? theme.bg}, str, size);
        return {parts};
      },
      // A rubber-stamp verdict: bordered uppercase word(s), tilted. Arrive with "stamp".
      verdict(o, k) {
        const size = o.size ?? 72, font = o.font ?? 'mono', str = String(o.text ?? '').toUpperCase(), c = o.color ?? 'red';
        const tracking = o.tracking ?? size * 0.04, A = textAttrs({font, weight: 800, tracking}, size), tw = measure(str, A), padX = size * 0.45, padY = size * 0.32;
        const g = svg('g', {transform: `rotate(${o.tilt ?? -7})`}, k.body), bw = tw + padX * 2, bh = size + padY * 2;
        const border = svg('rect', {x: r3(-bw / 2), y: r3(-bh / 2), width: r3(bw), height: r3(bh), rx: Math.max(4, size * 0.08), fill: o.fill ? col(o.fill) : col(theme.bg), 'fill-opacity': o.fill ? 1 : 0.85,
          stroke: col(c), 'stroke-width': Math.max(5, size * 0.09)}, g);
        const text = textNode(g, {font, weight: 800, color: c, tracking}, str, size);
        return {parts: {border, text}};
      },
      // The one big number (or word) a beat is about, with a small unit under it. "count" rolls it.
      hero(o, k) {
        const size = o.size ?? 180, font = o.font ?? displayFont(), anchor = o.anchor ?? 'middle', parts = {};
        const t = svg('text', {x: 0, y: 0, ...textAttrs({font, weight: o.weight ?? 800, color: o.color ?? 'yellow', anchor, tracking: o.tracking ?? -size * 0.02}, size), class: 'vg-counter'}, k.body);
        t.textContent = o.text != null ? String(o.text) : o.value == null ? (o.placeholder ?? '—') : formatNum(o.value, o);
        parts.text = t;
        if (o.unit) {
          const us = o.unitSize ?? Math.max(28, Math.round(size * 0.18));
          parts.unit = textNode(k.body, {font: o.unitFont ?? 'mono', weight: 700, color: o.unitColor ?? 'grey', anchor, upper: true, tracking: us * 0.08}, o.unit, us);
          parts.unit.setAttribute('transform', `translate(0 ${r3(size * 0.56 + us * 0.9)})`);
        }
        return {parts, api: {format: v => formatNum(v, o)}};
      },
      // A container on a shelf with a scale beside it, filled to a level: memory, budget, capacity. "fill" changes it.
      gauge(o, k) {
        const [w, h] = o.size || [360, 440], max = o.max ?? 100, step = o.step ?? max / 4, unit = o.unit ? ` ${o.unit}` : '', inset = Math.max(8, theme.stroke * 2.5);
        const c = col(o.color ?? 'blue'), parts = {}, ls = o.labelSize ?? 28;
        parts.well = svg('rect', {x: -w / 2, y: -h / 2, width: w, height: h, fill: col('faint'), 'fill-opacity': 0.9, stroke: 'none'}, k.body);
        parts.frame = svg('path', {d: `M${-w / 2} ${-h / 2} V${h / 2} H${w / 2} V${-h / 2}`, fill: 'none', stroke: c, 'stroke-width': Math.max(4, theme.stroke * 1.4), 'stroke-linejoin': 'round', 'stroke-linecap': 'round'}, k.body);
        parts.shelf = svg('rect', {x: r3(-w * 0.58), y: r3(h / 2 + 6), width: r3(w * 1.16), height: 16, rx: 3, fill: paperOf(o)}, k.body);
        const scale = svg('g', {class: 'vg-scale'}, k.body), sx = w / 2 + 26;
        svg('line', {x1: sx, y1: -h / 2, x2: sx, y2: h / 2, stroke: col('grey'), 'stroke-width': 2}, scale);
        const levelY = v => r3(h / 2 - inset - Math.max(0, Math.min(v, max * 1.08)) / max * (h - inset * 2));
        for (let v = 0; v <= max + 1e-9; v += step) {
          const y = levelY(v), top = Math.abs(v - max) < 1e-9;
          svg('line', {x1: sx, y1: y, x2: sx + (top ? 18 : 12), y2: y, stroke: col(top ? null : 'grey'), 'stroke-width': 2}, scale);
          const t = svg('text', {x: sx + 28, y, ...textAttrs({font: 'mono', weight: top ? 700 : 500, color: top ? null : 'grey', anchor: 'start'}, ls)}, scale);
          t.textContent = `${formatNum(v, {decimals: o.decimals ?? 0})}${top ? unit : ''}`;
        }
        parts.scale = scale;
        const v0 = o.value ?? 0, y0 = levelY(v0), fw = w - inset * 2;
        parts.fill = svg('rect', {x: r3(-fw / 2), y: y0, width: r3(fw), height: r3(Math.max(0, h / 2 - inset - y0)), fill: col(o.fill ?? (hasColour('paper') ? 'paper' : 'white')), stroke: 'none'}, k.body);
        parts['fill-label'] = svg('text', {x: 0, y: r3((y0 + h / 2 - inset) / 2), ...textAttrs({font: 'mono', weight: 700, color: o.fillInk ?? theme.bg}, o.fillLabelSize ?? 30)}, k.body);
        parts['fill-label'].textContent = o.fillLabel ?? '';
        if (o.limit != null) {
          const y = levelY(o.limit);
          parts.limit = svg('line', {x1: r3(-w / 2 - 14), y1: y, x2: r3(w / 2 + 14), y2: y, stroke: col(o.limitColor ?? 'red'), 'stroke-width': 4, 'stroke-dasharray': '14 10'}, k.body);
        }
        if (o.title) { parts.title = textNode(k.body, {font: 'mono', weight: 700, upper: true}, o.title, o.titleSize ?? 30); parts.title.setAttribute('transform', `translate(0 ${r3(h / 2 + 62)})`); }
        return {parts, api: {levelY, bottom: h / 2 - inset, label: o.fillLabel ?? ''}};
      },
      // A paper sheet of key → value rows with dotted leaders: a model card, a spec list, a bill.
      sheet(o, k) {
        const w = o.width ?? 560, size = o.size ?? 30, pad = o.padding ?? 30, lh = size * 1.6, rows = (o.rows || []).map(r => Array.isArray(r) ? r : [r.key, r.value]);
        const ts = o.titleSize ?? Math.max(28, Math.round(size * 0.9)), head = o.title ? ts * 2 : 0, h = pad * 2 + head + rows.length * lh - (lh - size);
        const ink = inkOf(o), parts = {}, top = -h / 2 + pad + head;
        parts.paper = svg('rect', {x: -w / 2, y: r3(-h / 2), width: w, height: r3(h), rx: o.corner ?? theme.corner ?? 0, fill: paperOf(o)}, k.body);
        if (o.title) {
          parts.title = charLines(k.body, [String(o.title).toUpperCase()], {...textAttrs({font: 'mono', weight: 700}, ts), fill: ink, 'fill-opacity': 0.62}, -w / 2 + pad, -h / 2 + pad + ts / 2, 0);
          svg('line', {x1: -w / 2 + pad, y1: r3(-h / 2 + pad + ts * 1.35), x2: w / 2 - pad, y2: r3(-h / 2 + pad + ts * 1.35), stroke: ink, 'stroke-opacity': 0.25, 'stroke-width': 2}, k.body);
        }
        const marks = new Set([].concat(o.highlight ?? []));
        rows.forEach(([key, value], i) => {
          const y = top + size / 2 + i * lh, g = svg('g', {class: 'vg-row'}, k.body), A = {...textAttrs({font: o.font ?? 'mono', weight: 500}, size), fill: ink};
          if (marks.has(i)) svg('rect', {x: r3(-w / 2 + pad * 0.5), y: r3(y - size * 0.7), width: r3(w - pad), height: r3(size * 1.4), fill: col(o.highlightColor ?? 'yellow')}, g);
          const kt = charLines(g, [String(key)], A, -w / 2 + pad, y, 0), vt = charLines(g, [String(value)], {...A, 'font-weight': 700}, 0, y, 0);
          const vw = measure(String(value), {...A, 'font-weight': 700}), kw = measure(String(key), A);
          vt.firstChild.setAttribute('x', r3(w / 2 - pad - vw));
          const l0 = -w / 2 + pad + kw + 12, l1 = w / 2 - pad - vw - 12;
          if (l1 > l0 + 10) svg('line', {x1: r3(l0), y1: r3(y + size * 0.28), x2: r3(l1), y2: r3(y + size * 0.28), stroke: ink, 'stroke-opacity': 0.35, 'stroke-width': 2, 'stroke-dasharray': '2 8', 'stroke-linecap': 'round'}, g);
          void kt; parts[`row-${i}`] = g;
        });
        return {parts};
      },
      // A small rounded label: a source, a tag, a model name, a status.
      chip(o, k) { const c = chipNode(k.body, o.text ?? '', {size: o.size ?? 28, color: o.color, filled: !!o.filled, font: o.font ?? 'mono'}); return {parts: {pill: c.pill, text: c.label}}; },
    };
    const COMPOSITE_VERBS = {
      gauge: {
        // {"do": "fill", "target": "<gauge>", "to": 94, "label": "≈ 94 GB", "color": "red"}
        fill(kit, inst, a, t, dur) {
          const api = inst.api, f = inst.parts.fill, lab = inst.parts['fill-label'], y = api.levelY(a.to), hgt = r3(Math.max(0, api.bottom - y));
          tween(f, {'attr.y': y, 'attr.height': hgt}, t, dur, a.ease || 'out');
          tween(lab, {'attr.y': r3((y + api.bottom) / 2)}, t, dur, a.ease || 'out');
          if (a.color) tween(f, {'attr.fill': col(a.color)}, t, dur * 0.6, 'smooth');
          if (a.label != null) {
            const from = current(lab, '__label', api.label);
            tl.fromTo(lab, {textContent: from}, {textContent: String(a.label), duration: 0.001, immediateRender: false}, t + dur * 0.5);
            state(lab).__label = String(a.label);
          }
        },
      },
    };

    const BUILD = {
      ...COMPOSITES,
      group(o, k) { for (const child of o.children || []) build({...child, scene: o.scene}, k.body, o); return {}; },
      circle(o, k) { return {parts: {shape: svg('circle', {cx: 0, cy: 0, r: o.r ?? 60, ...strokeAttrs(o)}, k.body)}}; },
      dot(o, k) { return {parts: {shape: svg('circle', {cx: 0, cy: 0, r: o.r ?? 9, fill: col(o.color), stroke: 'none'}, k.body)}}; },
      ellipse(o, k) { const [rx, ry] = o.radii || [80, 50]; return {parts: {shape: svg('ellipse', {cx: 0, cy: 0, rx, ry, ...strokeAttrs(o)}, k.body)}}; },
      rect(o, k) { const [w, h] = o.size || [200, 120]; return {parts: {shape: svg('rect', {x: -w / 2, y: -h / 2, width: w, height: h, rx: o.corner ?? theme.corner ?? 0, ...strokeAttrs(o)}, k.body)}}; },
      square(o, k) { return BUILD.rect({...o, size: [o.side ?? 120, o.side ?? 120]}, k); },
      arc(o, k) {
        const r = o.r ?? 80, a0 = (o.from ?? 0) * Math.PI / 180, a1 = (o.to ?? 90) * Math.PI / 180;
        const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0, sweep = a1 > a0 ? 1 : 0;
        const d = `M${r3(Math.cos(a0) * r)} ${r3(-Math.sin(a0) * r)} A${r} ${r} 0 ${large} ${sweep ? 0 : 1} ${r3(Math.cos(a1) * r)} ${r3(-Math.sin(a1) * r)}`;
        return {parts: {shape: svg('path', {d, ...strokeAttrs(o)}, k.body)}};
      },
      line(o, k) { const [a, b] = [o.from, o.to]; return {parts: {shape: svg('line', {x1: a[0], y1: a[1], x2: b[0], y2: b[1], ...strokeAttrs(o)}, k.body)}}; },
      arrow(o, k) {
        const [a, b] = [o.from, o.to], len = o.tip ?? Math.max(16, (o.width ?? theme.stroke) * 6), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const ex = b[0] - (b[0] - a[0]) / L * len * 0.8, ey = b[1] - (b[1] - a[1]) / L * len * 0.8;
        const shaft = svg('line', {x1: a[0], y1: a[1], x2: r3(ex), y2: r3(ey), ...strokeAttrs(o)}, k.body);
        const head = arrowHead(k.body, a[0], a[1], b[0], b[1], o);
        const parts = {shaft, head};
        if (o.double) parts.tail = arrowHead(k.body, b[0], b[1], a[0], a[1], o);
        return {parts};
      },
      path(o, k) { return {parts: {shape: svg('path', {d: o.d, ...strokeAttrs(o)}, k.body)}}; },
      polyline(o, k) { return {parts: {shape: svg('path', {d: pointsD(o.points, false), ...strokeAttrs(o)}, k.body)}}; },
      polygon(o, k) { return {parts: {shape: svg('path', {d: pointsD(o.points, true), ...strokeAttrs(o)}, k.body)}}; },
      brace(o, k) {
        const [a, b] = [o.from, o.to], depth = o.depth ?? 22;
        const shape = svg('path', {d: bracePath(a[0], a[1], b[0], b[1], depth), ...strokeAttrs(o)}, k.body);
        return {parts: {shape}, anchor: (() => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [(a[0] + b[0]) / 2 + dy / L * depth * 2.2, (a[1] + b[1]) / 2 - dx / L * depth * 2.2]; })()};
      },
      text(o, k) { return {parts: {text: textNode(k.body, o, o.text ?? '', o.size ?? theme.sizes.label)}}; },
      counter(o, k) {
        const V = theme.value || {};
        const t = svg('text', {x: 0, y: 0, ...textAttrs({...o, font: o.font || V.font || 'mono', weight: o.weight ?? V.weight, color: o.color ?? V.color}, o.size ?? theme.sizes.value), class: 'vg-counter'}, k.body);
        t.textContent = o.value == null ? (o.placeholder ?? '—') : formatNum(o.value, o);
        return {parts: {text: t}, api: {format: v => formatNum(v, o)}};
      },
      tex(o, k) {
        if (!o.svg) throw new Error(`tex ${o.id}: missing compiled svg (run the pipeline build)`);
        const doc = new DOMParser().parseFromString(o.svg, 'image/svg+xml').documentElement;
        const [vx, vy, vw, vh] = doc.getAttribute('viewBox').split(/\s+/).map(Number);
        const scale = (o.size ?? 48) / 1000;
        const g = svg('g', {transform: `scale(${scale}) translate(${r3(-vx - vw / 2)} ${r3(-vy - vh / 2)})`, color: col(o.color), fill: 'currentColor', class: 'vg-tex'}, k.body);
        for (const child of [...doc.childNodes]) g.appendChild(document.importNode(child, true));
        const parts = {};
        // Wrap each \cssId term in an untransformed <g> so the kit can move it without fighting MathJax's own transforms.
        for (const el of [...g.querySelectorAll('[id]')]) { const key = el.id; el.removeAttribute('id'); const w = svg('g', {class: 'vg-part', 'data-part': key}); el.parentNode.insertBefore(w, el); w.appendChild(el); parts[key] = w; }
        g.querySelectorAll('path').forEach(p => { p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', 0); });
        return {parts};
      },
      axes(o, k) {
        const api = axesApi(o), {w, h, c2p} = api, c = col(o.color ?? 'grey'), parts = {};
        const gGrid = svg('g', {class: 'vg-grid'}, k.body);
        const step = (lo, hi, s) => { const out = []; if (!s) return out; const n0 = Math.ceil(lo / s - 1e-9), n1 = Math.floor(hi / s + 1e-9); for (let n = n0; n <= n1; n++) out.push(r3(n * s)); return out; };
        const xs = step(api.x0, api.x1, o.x?.[2]), ys = step(api.y0, api.y1, o.y?.[2]);
        if (o.grid) {
          for (const x of xs) { const [px] = c2p(x, 0); svg('line', {x1: px, y1: -h / 2, x2: px, y2: h / 2, stroke: col('faint'), 'stroke-width': 1.5}, gGrid); }
          for (const y of ys) { const [, py] = c2p(0, y); svg('line', {x1: -w / 2, y1: py, x2: w / 2, y2: py, stroke: col('faint'), 'stroke-width': 1.5}, gGrid); }
        }
        parts.grid = gGrid;
        const ox = Math.min(Math.max(0, api.x0), api.x1), oy = Math.min(Math.max(0, api.y0), api.y1);
        const [, yAxisY] = c2p(0, oy), [xAxisX] = c2p(ox, 0);
        parts['x-axis'] = svg('line', {x1: -w / 2, y1: yAxisY, x2: w / 2 + 14, y2: yAxisY, stroke: c, 'stroke-width': o.width ?? 2.5, 'stroke-linecap': 'round'}, k.body);
        if (!o.numberline) parts['y-axis'] = svg('line', {x1: xAxisX, y1: h / 2, x2: xAxisX, y2: -h / 2 - 14, stroke: c, 'stroke-width': o.width ?? 2.5, 'stroke-linecap': 'round'}, k.body);
        const ticks = svg('g', {class: 'vg-ticks'}, k.body), labels = svg('g', {class: 'vg-ticklabels'}, k.body);
        const fmt = v => o.tickFormat ? compileFn(o.tickFormat)(v) : String(+v.toFixed(4));
        const ts = o.tickLabelSize ?? 28;
        for (const x of xs) { const [px] = c2p(x, 0); svg('line', {x1: px, y1: yAxisY - 8, x2: px, y2: yAxisY + 8, stroke: c, 'stroke-width': 2}, ticks); if (o.tickLabels !== false && (o.tickLabels === 'all' || x !== ox || o.numberline)) { const t = svg('text', {x: px, y: yAxisY + 26, ...textAttrs({color: 'grey'}, ts)}, labels); t.textContent = fmt(x); } }
        if (!o.numberline) for (const y of ys) { const [, py] = c2p(0, y); svg('line', {x1: xAxisX - 8, y1: py, x2: xAxisX + 8, y2: py, stroke: c, 'stroke-width': 2}, ticks); if (o.tickLabels !== false && y !== oy) { const t = svg('text', {x: xAxisX - 18, y: py, ...textAttrs({color: 'grey', anchor: 'end'}, ts)}, labels); t.textContent = fmt(y); } }
        parts.ticks = ticks; parts['tick-labels'] = labels;
        if (o.labels?.x) { const t = svg('text', {x: w / 2 + 24, y: yAxisY, ...textAttrs({color: 'grey', anchor: 'start'}, o.labelSize ?? 32)}, k.body); t.textContent = o.labels.x; parts['x-label'] = t; }
        if (o.labels?.y) { const t = svg('text', {x: xAxisX, y: -h / 2 - 44, ...textAttrs({color: 'grey'}, o.labelSize ?? 32)}, k.body); t.textContent = o.labels.y; parts['y-label'] = t; }
        api.plot = svg('g', {class: 'vg-plot'}, k.body);
        return {parts, api};
      },
      numberline(o, k) { return BUILD.axes({...o, numberline: true, size: [o.length ?? 1200, 2], x: o.range || [0, 10, 1], y: [0, 1]}, k); },
      plane(o, k) {
        // A transformable coordinate grid. Lines are stored in data coordinates for applyMatrix.
        const api = axesApi(o), {w, h, c2p} = api, parts = {}, lines = [];
        const s = o.step || 1, gl = svg('g', {class: 'vg-plane'}, k.body);
        const span = o.extend ?? 3;
        for (let x = Math.ceil((api.x0 - span) / s) * s; x <= api.x1 + span + 1e-9; x += s) lines.push({a: [r3(x), api.y0 - span], b: [r3(x), api.y1 + span], axis: Math.abs(x) < 1e-9});
        for (let y = Math.ceil((api.y0 - span) / s) * s; y <= api.y1 + span + 1e-9; y += s) lines.push({a: [api.x0 - span, r3(y)], b: [api.x1 + span, r3(y)], axis: Math.abs(y) < 1e-9});
        for (const L of lines) {
          const [p1, p2] = [c2p(...L.a), c2p(...L.b)];
          L.el = svg('line', {x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: L.axis ? col(o.axisColor) : col(o.color ?? 'blue'), 'stroke-width': L.axis ? 2.5 : 1.5, 'stroke-opacity': L.axis ? 1 : (o.lineOpacity ?? 0.55)}, gl);
        }
        const clip = svg('clipPath', {id: `vg-clip-${o.id}`}, defs); svg('rect', {x: -w / 2, y: -h / 2, width: w, height: h}, clip);
        if (o.clip !== false) gl.setAttribute('clip-path', `url(#vg-clip-${o.id})`);
        parts.lines = gl; api.lines = lines; api.matrix = [[1, 0], [0, 1]];
        api.plot = svg('g', {class: 'vg-plot'}, k.body);
        return {parts, api};
      },
      graph(o, k, parentApi) {
        const api = parentApi; if (!api?.c2p) throw new Error(`graph ${o.id} needs "of": an axes/plane id`);
        const fn = compileFn(o.fn);
        const shape = svg('path', {d: graphD(api, fn, o.domain, o.samples, o.clamp), ...strokeAttrs({...o, color: o.color ?? 'blue'})}, k.body);
        return {parts: {shape}, api: {fn, domain: o.domain || [api.x0, api.x1], axes: api}};
      },
      area(o, k, parentApi) {
        const api = parentApi, fn = compileFn(o.fn), [a, b] = o.domain || [api.x0, api.x1], base = o.base ?? Math.max(api.y0, Math.min(api.y1, 0));
        const top = graphD(api, fn, [a, b], o.samples || 120).slice(1), p0 = api.c2p(a, base), p1 = api.c2p(b, base);
        const shape = svg('path', {d: `M${p0[0]} ${p0[1]} L${top} L${p1[0]} ${p1[1]} Z`, fill: col(o.color ?? 'blue'), 'fill-opacity': o.fillOpacity ?? 0.25, stroke: 'none'}, k.body);
        return {parts: {shape}, api: {fn, axes: api}};
      },
      vector(o, k, parentApi) {
        const api = parentApi || {c2p: (x, y) => [x, y]}, from = o.from || [0, 0];
        const p0 = api.c2p(...from), p1 = api.c2p(...o.to);
        const len = Math.max(16, (o.width ?? 4) * 5), L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        const ex = p1[0] - (p1[0] - p0[0]) / L * len * 0.8, ey = p1[1] - (p1[1] - p0[1]) / L * len * 0.8;
        const shaft = svg('path', {d: `M${p0[0]} ${p0[1]} L${r3(ex)} ${r3(ey)}`, ...strokeAttrs({...o, width: o.width ?? 4, color: o.color ?? 'yellow'})}, k.body);
        const head = arrowHead(k.body, p0[0], p0[1], p1[0], p1[1], {...o, tip: len, color: o.color ?? 'yellow'});
        return {parts: {shaft, head}, api: {axes: api, from, to: o.to.slice()}};
      },
      bars(o, k, parentApi) {
        const api = parentApi; if (!api?.c2p) throw new Error(`bars ${o.id} needs "of": an axes id`);
        const parts = {}, els = [], bw = o.barWidth ?? 0.6;
        (o.values || []).forEach((v, i) => {
          const x = (o.xs ? o.xs[i] : i + 1), [xl, yb] = api.c2p(x - bw / 2, Math.max(api.y0, 0)), [xr, yt] = api.c2p(x + bw / 2, v);
          const c = Array.isArray(o.colors) ? o.colors[i % o.colors.length] : (o.color ?? 'blue');
          const r = svg('rect', {x: Math.min(xl, xr), y: Math.min(yt, yb), width: Math.abs(xr - xl), height: Math.abs(yb - yt), fill: col(c), 'fill-opacity': o.fillOpacity ?? 0.35, stroke: col(c), 'stroke-width': 2.5}, k.body);
          r.__origin = `${r3((xl + xr) / 2)} ${r3(yb)}`; parts[`bar-${i}`] = r; els.push(r);
        });
        return {parts, api: {axes: api, bw, els, values: (o.values || []).slice(), xs: o.xs}};
      },
      network(o, k) {
        const parts = {}, nodes = {};
        for (const e of o.edges || []) {
          const [a, b] = Array.isArray(e) ? e : [e.from, e.to], A = (o.nodes || []).find(n => n.id === a), B = (o.nodes || []).find(n => n.id === b);
          if (!A || !B) throw new Error(`network ${o.id}: edge ${a}-${b} references a missing node`);
          const el = svg('line', {x1: A.at[0], y1: A.at[1], x2: B.at[0], y2: B.at[1], stroke: col(e.color ?? o.edgeColor ?? 'grey'), 'stroke-width': e.width ?? 2.5, 'stroke-linecap': 'round'}, k.body);
          parts[`${a}-${b}`] = el;
        }
        for (const n of o.nodes || []) {
          const g = svg('g', {transform: `translate(${n.at[0]} ${n.at[1]})`}, k.body);
          svg('circle', {cx: 0, cy: 0, r: n.r ?? o.r ?? 26, fill: col(o.bg ?? 'bg'), stroke: col(n.color ?? o.color), 'stroke-width': o.width ?? theme.stroke}, g);
          if (n.label != null) { const t = svg('text', {x: 0, y: (n.labelBelow ? (n.r ?? o.r ?? 26) + 30 : 0), ...textAttrs({color: n.color ?? o.color}, n.size ?? o.labelSize ?? 28)}, g); t.textContent = n.label; }
          parts[n.id] = g; nodes[n.id] = n;
        }
        return {parts, api: {nodes}};
      },
      particles(o, k) {
        const rand = VG.rng(o.seed ?? 7), [cx, cy] = [0, 0], [w, h] = o.size || [600, 400], parts = {}, pts = [];
        for (let i = 0; i < (o.count ?? 40); i++) {
          const p = o.points?.[i] || [cx + (rand() - 0.5) * w, cy + (rand() - 0.5) * h];
          const c = Array.isArray(o.colors) ? o.colors[i % o.colors.length] : (o.color ?? 'blue');
          const el = svg('circle', {cx: 0, cy: 0, r: o.r ?? 7, fill: col(c), stroke: 'none'}, k.body);
          setNow(el, {x: p[0], y: p[1]}); parts[`p${i}`] = el; pts.push({el, x: p[0], y: p[1]});
        }
        return {parts, api: {pts, rand, size: [w, h]}};
      },
      image(o, k) {
        const [w, h] = o.size || [400, 300], parts = {};
        // frame: present a photo as a card/print in the theme's line and corner style instead of cutting it out.
        const F = o.frame ? (o.frame === true ? {} : o.frame) : null, pad = F ? (F.padding ?? 16) : 0, corner = F ? (F.corner ?? theme.corner ?? 0) : 0;
        if (F) parts.frame = svg('rect', {x: -w / 2 - pad, y: -h / 2 - pad, width: w + 2 * pad, height: h + 2 * pad, rx: corner + (corner ? pad / 2 : 0),
          fill: col(F.fill ?? 'faint'), stroke: F.stroke === false ? 'none' : col(F.color), 'stroke-width': F.width ?? theme.stroke}, k.body);
        const img = svg('image', {href: o.src, x: -w / 2, y: -h / 2, width: w, height: h, preserveAspectRatio: o.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}, k.body);
        if (corner && F) { const clip = svg('clipPath', {id: `vg-clip-${o.id}`}, defs); svg('rect', {x: -w / 2, y: -h / 2, width: w, height: h, rx: corner}, clip); img.setAttribute('clip-path', `url(#vg-clip-${o.id})`); }
        if (o.knockout) img.setAttribute('filter', knockoutFilter(o.knockout));
        parts.shape = img;
        return {parts};
      },
      svg(o, k) { const g = svg('g', {class: 'vg-raw'}, k.body); g.innerHTML = o.markup || ''; const parts = {}; for (const el of g.querySelectorAll('[id]')) { parts[el.id] = el; el.setAttribute('data-part', el.id); el.removeAttribute('id'); } return {parts}; },
    };
    function formatNum(v, o) {
      const d = o.decimals ?? 0; let s = Number(v).toFixed(d);
      if (o.comma !== false) { const [i, f] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : ''); }
      return `${o.prefix ?? ''}${s}${o.suffix ?? ''}`;
    }

    function build(o, parentEl, parentObj) {
      // Theme defaults per object type (e.g. every rect gets the film's corner, fill and shadow) keep one look across scenes.
      const D = theme.defaults || {};
      if (D['*'] || D[o.type]) o = {...(D['*'] || {}), ...(D[o.type] || {}), ...o};
      const parentApi = parentObj?.api || (o.of ? objs.get(o.of)?.api : null);
      if (o.of && !objs.has(o.of)) throw new Error(`${o.id}: "of" references unknown object ${o.of}`);
      const container = o.of ? objs.get(o.of).api.plot : (parentEl || (o.layer === 'screen' ? screen : world));
      if (o.type === 'video' || o.type === 'manim') return buildMedia(o);
      const shell = makeShell(o, container);
      const def = BUILD[o.type] ? {build: BUILD[o.type], verbs: COMPOSITE_VERBS[o.type]} : VG.components[o.type];
      if (!def) throw new Error(`Unknown object type "${o.type}" for ${o.id}`);
      const inst = {id: o.id, type: o.type, spec: o, scene: o.scene, ...shell, parts: {}, api: {}, children: []};
      objs.set(o.id, inst);
      const out = (def.build.call(def, o, {...ctx, body: shell.body, inst, tween, setNow, state, current, tl, objs, build: (child, parent) => build({...child, scene: o.scene}, parent || shell.body, inst)}, parentApi)) || {};
      Object.assign(inst.parts, out.parts || {}); Object.assign(inst.api, out.api || {}); inst.verbs = def.verbs || {};
      let at = o.at ? (parentApi?.c2p && o.of ? parentApi.c2p(...o.at) : o.at) : [0, 0];
      if (out.anchor) at = out.anchor;
      if (['line', 'arrow', 'polyline', 'polygon', 'path', 'brace', 'network'].includes(o.type) && !o.at) {
        // Geometry authored in world coordinates: recentre so scale/rotate act about the object's middle.
        const b = shell.body.getBBox(); const c = [b.x + b.width / 2, b.y + b.height / 2];
        shell.body.setAttribute('transform', `translate(${r3(-c[0])} ${r3(-c[1])})`); at = c; inst.recentred = c;
      }
      inst.home = at.slice();
      setNow(shell.outer, {x: at[0], y: at[1]});
      shell.rs.__origin = '0 0';
      if (o.scale != null) setNow(shell.rs, {scale: o.scale, svgOrigin: '0 0'});
      if (o.rotate != null) setNow(shell.rs, {rotation: o.rotate, svgOrigin: '0 0'});
      setNow(shell.outer, {autoAlpha: o.visible ? (o.opacity ?? 1) : 0});
      if (o.opacity != null && o.visible) setNow(shell.outer, {autoAlpha: o.opacity});
      if (o.shadow) shell.rs.setAttribute('filter', shadowFilter(o.shadow));
      if (o.label) buildLabel(inst, typeof o.label === 'string' ? {text: o.label} : o.label);
      return inst;
    }
    function buildLabel(inst, L) {
      L = {...(theme.label || {}), ...L};
      const b = inst.rs.getBBox(), gap = L.gap ?? 18, side = L.side || 'bottom', size = L.size ?? theme.sizes.label;
      const pos = {top: [b.x + b.width / 2, b.y - gap - size * 0.55], bottom: [b.x + b.width / 2, b.y + b.height + gap + size * 0.55],
        left: [b.x - gap, b.y + b.height / 2], right: [b.x + b.width + gap, b.y + b.height / 2], center: [b.x + b.width / 2, b.y + b.height / 2]}[side];
      const id = `${inst.id}-label`, spec = {id, type: 'text', text: L.text, size, color: L.color, weight: L.weight,
        anchor: side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle', at: [pos[0] + (L.dx || 0), pos[1] + (L.dy || 0)], scene: inst.scene, visible: true, font: L.font, tracking: L.tracking, upper: L.upper};
      const shell = makeShell(spec, inst.outer);
      const t = textNode(shell.body, spec, spec.text, size);
      const lab = {id, type: 'text', spec, scene: inst.scene, ...shell, parts: {text: t}, api: {}, verbs: {}, labelOf: inst.id};
      setNow(shell.outer, {x: spec.at[0], y: spec.at[1]}); shell.rs.__origin = '0 0';
      objs.set(id, lab); inst.label = lab;
    }
    function buildMedia(o) {
      const [w, h] = o.size || [960, 540], at = o.at || [W / 2, H / 2];
      const wrap = document.createElement('div');
      wrap.id = `vg-${o.id}`; wrap.className = 'vg-obj vg-media-obj'; wrap.dataset.vgId = o.id; wrap.dataset.vgType = o.type;
      wrap.style.cssText = `position:absolute;left:${at[0] - w / 2}px;top:${at[1] - h / 2}px;width:${w}px;height:${h}px`;
      const v = document.getElementById(`vg-${o.id}-video`) || document.createElement('video');
      v.id = `vg-${o.id}-video`; if (!v.getAttribute('src')) v.src = o.src; v.muted = true; v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      v.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
      if (o.mediaStart != null && !v.hasAttribute('data-start')) { v.setAttribute('data-start', o.mediaStart); v.setAttribute('data-duration', o.mediaDuration); v.setAttribute('data-track-index', o.track ?? 40); v.setAttribute('data-volume', 0); }
      wrap.appendChild(v); mP.appendChild(wrap);
      const inst = {id: o.id, type: o.type, spec: o, scene: o.scene, outer: wrap, rs: wrap, body: wrap, parts: {video: v}, api: {}, verbs: {}, media: true, home: at.slice()};
      setNow(wrap, {autoAlpha: o.visible ? 1 : 0});
      objs.set(o.id, inst); return inst;
    }

    // ---------- targets ----------
    function resolve(ref) {
      const [id, ...rest] = String(ref).split('.'), inst = objs.get(id);
      if (!inst) throw new Error(`Unknown target "${ref}"`);
      if (!rest.length) return {inst, el: inst.outer, whole: true};
      const key = rest.join('.'), el = inst.parts[key];
      if (!el) throw new Error(`Object ${id} has no part "${key}". Parts: ${Object.keys(inst.parts).join(', ') || '(none)'}`);
      return {inst, el, part: key, whole: false};
    }
    const targetsOf = a => (Array.isArray(a.target) ? a.target : a.target != null ? [a.target] : []).flatMap(r => {
      if (String(r).endsWith('.*')) { const inst = objs.get(String(r).slice(0, -2)); if (!inst) throw new Error(`Unknown target "${r}"`); return Object.keys(inst.parts).map(k => resolve(`${inst.id}.${k}`)); }
      return [resolve(r)];
    });
    // Elements owned by the object itself: children attached with "of" and labels are separate objects with their own verbs.
    const own = (el, list) => { const owner = el.closest?.('.vg-obj') || el; return list.filter(e => e.closest('.vg-obj') === owner); };
    const strokeEls = el => own(el, [...(el.matches?.('path,line,polyline,polygon,circle,rect,ellipse') ? [el] : []), ...el.querySelectorAll('path,line,polyline,polygon,circle,rect,ellipse')].filter(e => !e.closest('clipPath') && !e.classList.contains('vg-fx')));
    const textEls = el => own(el, [...(el.matches?.('text') ? [el] : []), ...el.querySelectorAll('text')]);
    function show(target, t) { // instant visibility for the wrapper (and the parent chain for parts)
      const el = target.whole ? target.inst.outer : target.inst.outer;
      if (current(el, 'autoAlpha', 0) < 0.999) tween(el, {autoAlpha: target.inst.spec.opacity ?? 1}, t, 0.001, 'none', {autoAlpha: 0});
    }
    function worldBox(inst) { // world-space bbox from tracked state (seek independent)
      if (inst.media) { const s = inst.spec, [w, h] = s.size || [960, 540], at = s.at || [W / 2, H / 2]; return {x: at[0] - w / 2, y: at[1] - h / 2, w, h}; }
      const b = inst.rs.getBBox(), sc = current(inst.rs, 'scale', 1), x = current(inst.outer, 'x', 0), y = current(inst.outer, 'y', 0);
      let ox = 0, oy = 0;
      if (inst.spec.of) { const p = objs.get(inst.spec.of), pb = worldBox(p), pc = [current(p.outer, 'x', 0), current(p.outer, 'y', 0)]; void pb; ox = pc[0]; oy = pc[1]; }
      return {x: ox + x + b.x * sc, y: oy + y + b.y * sc, w: b.width * sc, h: b.height * sc};
    }

    // ---------- verbs ----------
    const DUR = {create: 1, draw: 1, write: 1, fadeIn: 0.6, fadeOut: 0.5, show: 0.001, hide: 0.001, move: 0.9, scale: 0.8, rotate: 0.8, transform: 0.9, morph: 0.9,
      color: 0.5, set: 0.6, count: 1.2, camera: 1.4, indicate: 0.8, circumscribe: 1.2, flash: 0.6, trace: 1.5, retarget: 1, applyMatrix: 1.6, flow: 1.6, arrange: 1,
      simulate: 2, focus: 0.5, unfocus: 0.5, play: 0.001, pulse: 0.6, grow: 0.8, uncreate: 0.8,
      drop: 0.7, pop: 0.5, stamp: 0.35, swing: 1.6, strike: 0.4, type: 1, shake: 0.5};
    VG.defaultDurations = DUR;
    const lag = (a, n) => a.stagger ?? (n > 1 ? Math.min(0.12, (a.dur * 0.5) / n) : 0);
    // An instant preset and the tween that animates away from it must not start at the same instant on the same
    // property: GSAP would resolve them in a different order when seeking backwards. The preset goes 2 ms earlier.
    const PRE = 0.002, preT = t => Math.max(0, t - PRE), mainT = t => Math.max(t, PRE);

    const VERBS = {
      create(a, T) { // draw outlines, then let fills arrive
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length); show(tg, t);
          if (!tg.whole) tween(tg.el, {opacity: 1}, t, 0.001, 'none', {opacity: 0});
          const strokes = strokeEls(tg.el), texts = textEls(tg.el), d = a.dur;
          strokes.forEach((s, j) => {
            const sl = Math.min(0.06, d * 0.3 / Math.max(1, strokes.length)), st = t + j * sl;
            const drawn = s.getAttribute('stroke') && s.getAttribute('stroke') !== 'none' && s.getAttribute('stroke-width') !== '0';
            const fo = s.getAttribute('fill') && s.getAttribute('fill') !== 'none' ? +(s.getAttribute('fill-opacity') ?? 1) : null;
            // Hide every stroke and fill the moment the object appears, so staggered parts never flash fully drawn first.
            if (drawn) { tween(s, {drawSVG: '0% 0%'}, preT(t), 0.001, 'none'); tween(s, {drawSVG: '0% 100%'}, mainT(st), d * 0.75, 'smooth'); }
            if (fo != null) { tween(s, {'attr.fill-opacity': 0}, preT(t), 0.001, 'none'); tween(s, {'attr.fill-opacity': fo}, st + d * 0.45, d * 0.5, 'out'); }
          });
          texts.forEach(tx => writeText(tx, t + d * 0.3, d * 0.7));
          if (tg.inst.label && tg.whole) VERBS.fadeIn({...a, t: t + d * 0.6, dur: 0.5}, [{inst: tg.inst.label, el: tg.inst.label.outer, whole: true}]);
          log.push({t, d, verb: 'create', id: tg.inst.id + (tg.part ? '.' + tg.part : '')});
        });
      },
      write(a, T) {
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length); show(tg, t);
          if (!tg.whole) tween(tg.el, {opacity: 1}, t, 0.001, 'none', {opacity: 0});
          const texts = textEls(tg.el);
          if (texts.length) texts.forEach(tx => writeText(tx, t, a.dur));
          const glyphs = [...tg.el.querySelectorAll('.vg-tex path, .vg-tex rect')].concat(tg.el.matches?.('path') ? [tg.el] : []);
          glyphs.forEach((p, j) => {
            const st = t + j * (a.dur * 0.6 / Math.max(1, glyphs.length));
            tween(p, {'attr.stroke-width': 0}, st, a.dur * 0.5, 'out', {'attr.stroke-width': 14});
            tween(p, {drawSVG: '0% 100%'}, st, a.dur * 0.35, 'smooth', {drawSVG: '0% 0%'});
            tween(p, {'attr.fill-opacity': 1}, st + a.dur * 0.2, a.dur * 0.35, 'out', {'attr.fill-opacity': 0});
          });
          if (!texts.length && !glyphs.length) VERBS.fadeIn(a, [tg]);
          if (tg.inst.label && tg.whole) VERBS.fadeIn({...a, t: t + a.dur * 0.6, dur: 0.5}, [{inst: tg.inst.label, el: tg.inst.label.outer, whole: true}]);
          log.push({t, d: a.dur, verb: 'write', id: tg.inst.id + (tg.part ? '.' + tg.part : '')});
        });
      },
      fadeIn(a, T) {
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), el = tg.el, key = tg.whole ? 'autoAlpha' : 'opacity';
          const to = {[key]: a.opacity ?? (tg.whole ? tg.inst.spec.opacity ?? 1 : 1)};
          if (a.shift) { const x = current(el, 'x', 0), y = current(el, 'y', 0); tween(el, {x: x - a.shift[0], y: y - a.shift[1]}, preT(t), 0.001, 'none'); tween(el, {x, y}, mainT(t), a.dur, a.ease || 'out'); }
          if (a.from_scale != null) { const rs = tg.whole ? tg.inst.rs : el; const sc = current(rs, 'scale', 1); tween(rs, {scale: a.from_scale}, preT(t), 0.001, 'none'); tween(rs, {scale: sc}, mainT(t), a.dur, a.ease || 'out'); }
          tween(el, to, t, a.dur, a.ease || 'out', {[key]: 0});
          log.push({t, d: a.dur, verb: 'fadeIn', id: tg.inst.id + (tg.part ? '.' + tg.part : '')});
        });
      },
      fadeOut(a, T) {
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), el = tg.el, key = tg.whole ? 'autoAlpha' : 'opacity';
          if (a.shift) { const x = current(el, 'x', 0), y = current(el, 'y', 0); tween(el, {x: x + a.shift[0], y: y + a.shift[1]}, t, a.dur, a.ease || 'in'); }
          tween(el, {[key]: 0}, t, a.dur, a.ease || 'in');
          log.push({t, d: a.dur, verb: 'fadeOut', id: tg.inst.id + (tg.part ? '.' + tg.part : '')});
        });
      },
      uncreate(a, T) { T.forEach((tg, i) => { const t = a.t + i * lag(a, T.length); strokeEls(tg.el).forEach(s => tween(s, {drawSVG: '0% 0%'}, t, a.dur, 'smooth', {drawSVG: '0% 100%'})); tween(tg.el, {[tg.whole ? 'autoAlpha' : 'opacity']: 0}, t + a.dur * 0.7, a.dur * 0.3, 'in'); log.push({t, d: a.dur, verb: 'uncreate', id: tg.inst.id}); }); },
      show(a, T) { T.forEach(tg => { if (tg.whole) show(tg, a.t); else tween(tg.el, {opacity: 1}, a.t, 0.001, 'none', {opacity: 0}); log.push({t: a.t, d: 0, verb: 'show', id: tg.inst.id}); }); },
      hide(a, T) { T.forEach(tg => { tween(tg.el, {[tg.whole ? 'autoAlpha' : 'opacity']: 0}, a.t, 0.001, 'none'); log.push({t: a.t, d: 0, verb: 'hide', id: tg.inst.id}); }); },
      move(a, T) {
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), el = tg.el, x0 = current(el, 'x', 0), y0 = current(el, 'y', 0);
          if (a.along) {
            const pts = pathPoints(a.along, tg, 60);
            tween(el, {x: pts.at(-1)[0], y: pts.at(-1)[1]}, t, 0.001, 'none'); // record end state
            state(el).x = x0; state(el).y = y0;
            tl.fromTo(el, {x: x0, y: y0}, {keyframes: pts.map(p => ({x: p[0], y: p[1]})), duration: a.dur, ease: ease(a.ease || 'smooth'), immediateRender: false}, t);
            state(el).x = pts.at(-1)[0]; state(el).y = pts.at(-1)[1];
          } else {
            let to = a.to; if (a.by) to = [x0 + a.by[0], y0 + a.by[1]];
            if (a.to && tg.inst.spec.of && !tg.part) to = objs.get(tg.inst.spec.of).api.c2p(...a.to);
            if (!to) throw new Error(`move ${tg.inst.id}: needs "to", "by" or "along"`);
            if (a.arc) { // curved travel through a raised midpoint
              const mx = (x0 + to[0]) / 2, my = (y0 + to[1]) / 2, dx = to[0] - x0, dy = to[1] - y0, k = a.arc;
              const mid = [mx - dy * k, my + dx * k];
              tl.fromTo(el, {x: x0, y: y0}, {keyframes: [{x: mid[0], y: mid[1]}, {x: to[0], y: to[1]}], duration: a.dur, ease: ease(a.ease || 'smooth'), immediateRender: false}, t);
              state(el).x = to[0]; state(el).y = to[1];
            } else tween(el, {x: to[0], y: to[1]}, t, a.dur, a.ease);
          }
          log.push({t, d: a.dur, verb: 'move', id: tg.inst.id + (tg.part ? '.' + tg.part : ''), detail: `→ ${JSON.stringify(a.to || a.by || a.along)}`});
        });
      },
      scale(a, T) {
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), el = tg.whole ? tg.inst.rs : tg.el;
          if (!tg.whole && !el.__origin) { const b = el.getBBox(); el.__origin = `${r3(b.x + b.width / 2)} ${r3(b.y + b.height / 2)}`; }
          if (Array.isArray(a.to)) tween(el, {scaleX: a.to[0], scaleY: a.to[1]}, t, a.dur, a.ease); else tween(el, {scale: a.to}, t, a.dur, a.ease);
          log.push({t, d: a.dur, verb: 'scale', id: tg.inst.id + (tg.part ? '.' + tg.part : ''), detail: `×${JSON.stringify(a.to)}`});
        });
      },
      grow(a, T) { T.forEach((tg, i) => { const t = a.t + i * lag(a, T.length), el = tg.whole ? tg.inst.rs : tg.el; if (!el.__origin) { const b = el.getBBox(); el.__origin = a.from === 'bottom' ? `${r3(b.x + b.width / 2)} ${r3(b.y + b.height)}` : a.from === 'left' ? `${r3(b.x)} ${r3(b.y + b.height / 2)}` : `${r3(b.x + b.width / 2)} ${r3(b.y + b.height / 2)}`; } show(tg, t); if (!tg.whole) tween(tg.el, {opacity: 1}, t, 0.001, 'none', {opacity: 0}); const ax = a.from === 'left' ? 'scaleX' : a.from === 'bottom' ? 'scaleY' : 'scale'; tween(el, {[ax]: 1}, t, a.dur, a.ease || 'out', {[ax]: 0.001}); log.push({t, d: a.dur, verb: 'grow', id: tg.inst.id + (tg.part ? '.' + tg.part : '')}); }); },
      rotate(a, T) {
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), el = tg.whole ? tg.inst.rs : tg.el;
          if (!tg.whole && !el.__origin) { const b = el.getBBox(); el.__origin = `${r3(b.x + b.width / 2)} ${r3(b.y + b.height / 2)}`; }
          if (a.about) el.__origin = `${a.about[0]} ${a.about[1]}`;
          const r0 = current(el, 'rotation', 0); tween(el, {rotation: a.by != null ? r0 + a.by : a.to}, t, a.dur, a.ease);
          log.push({t, d: a.dur, verb: 'rotate', id: tg.inst.id + (tg.part ? '.' + tg.part : ''), detail: `${a.by != null ? 'by ' + a.by : 'to ' + a.to}°`});
        });
      },
      color(a, T) {
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), c = col(a.to), which = a.prop || 'both';
          strokeEls(tg.el).forEach(s => { if (which !== 'fill' && s.getAttribute('stroke') && s.getAttribute('stroke') !== 'none') tween(s, {'attr.stroke': c}, t, a.dur, a.ease); if (which !== 'stroke' && s.getAttribute('fill') && s.getAttribute('fill') !== 'none' && !s.closest('.vg-tex')) tween(s, {'attr.fill': c}, t, a.dur, a.ease); });
          textEls(tg.el).forEach(s => tween(s, {'attr.fill': c}, t, a.dur, a.ease));
          tg.el.querySelectorAll('.vg-tex').forEach(g => tween(g, {'attr.color': c}, t, a.dur, a.ease));
          if (tg.el.classList?.contains('vg-tex')) tween(tg.el, {'attr.color': c}, t, a.dur, a.ease);
          log.push({t, d: a.dur, verb: 'color', id: tg.inst.id + (tg.part ? '.' + tg.part : ''), detail: a.to});
        });
      },
      set(a, T) { T.forEach((tg, i) => { const t = a.t + i * lag(a, T.length), to = {}; for (const [k, v] of Object.entries(a.props || {})) to[/^(x|y|scale|rotation|opacity)$/.test(k) ? k : 'attr.' + k] = typeof v === 'string' && theme.colors[v] ? col(v) : v; const el = (('scale' in to || 'rotation' in to) && tg.whole) ? tg.inst.rs : tg.el; tween(el, to, t, a.dur, a.ease); log.push({t, d: a.dur, verb: 'set', id: tg.inst.id + (tg.part ? '.' + tg.part : ''), detail: JSON.stringify(a.props)}); }); },
      count(a, T) {
        T.forEach(tg => {
          const textEl = tg.inst.parts.text, o = tg.inst.spec, fmt = v => formatNum(v, o);
          show(tg, a.t);
          const from = a.from ?? current(textEl, '__num', o.value ?? 0);
          if (current(textEl, '__num', null) == null && o.value == null) { // placeholder → first number
            tl.fromTo(textEl, {textContent: o.placeholder ?? '—'}, {textContent: fmt(from), duration: 0.001, immediateRender: false}, a.t);
          }
          const proxy = {v: from};
          tl.fromTo(textEl, {textContent: from}, {textContent: a.to, duration: a.dur, ease: ease(a.ease || 'out'), immediateRender: false,
            modifiers: {textContent: v => fmt(a.snap === false ? v : Math.round(v / (a.step || 1)) * (a.step || 1))}}, a.t);
          void proxy; state(textEl).__num = a.to;
          log.push({t: a.t, d: a.dur, verb: 'count', id: tg.inst.id, detail: `${fmt(from)} → ${fmt(a.to)}`});
        });
      },
      camera(a) {
        let x = a.center ? a.center[0] : cam.x, y = a.center ? a.center[1] : cam.y, z = a.zoom ?? cam.zoom, r = a.rotate ?? cam.rotate;
        if (a.focus) {
          const ids = Array.isArray(a.focus) ? a.focus : [a.focus]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const id of ids) { const inst = objs.get(id); if (!inst) throw new Error(`camera focus: unknown object ${id}`); const b = worldBox(inst); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
          const pad = a.padding ?? 0.12; x = (x0 + x1) / 2; y = (y0 + y1) / 2;
          if (a.zoom == null) z = Math.min(W * (1 - 2 * pad) / Math.max(1, x1 - x0), H * (1 - 2 * pad) / Math.max(1, y1 - y0));
        }
        const e = a.ease || 'smooth';
        tween(camS, {scale: z, rotation: r}, a.t, a.dur, e, {scale: cam.zoom, rotation: cam.rotate});
        tween(camP, {x: -x, y: -y}, a.t, a.dur, e, {x: -cam.x, y: -cam.y});
        tween(mS, {scale: z, rotation: r}, a.t, a.dur, e, {scale: cam.zoom, rotation: cam.rotate});
        tween(mP, {x: -x, y: -y}, a.t, a.dur, e, {x: -cam.x, y: -cam.y});
        log.push({t: a.t, d: a.dur, verb: 'camera', id: 'camera', detail: `center (${Math.round(cam.x)},${Math.round(cam.y)}) zoom ${r3(cam.zoom)} → center (${Math.round(x)},${Math.round(y)}) zoom ${r3(z)}${a.focus ? ' focus ' + a.focus : ''}`});
        Object.assign(cam, {x, y, zoom: z, rotate: r});
      },
      indicate(a, T) {
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), el = tg.whole ? tg.inst.rs : tg.el;
          if (!tg.whole && !el.__origin) { const b = el.getBBox(); el.__origin = `${r3(b.x + b.width / 2)} ${r3(b.y + b.height / 2)}`; }
          const s0 = current(el, 'scale', 1); tween(el, {scale: s0 * (a.scale ?? 1.15)}, t, a.dur / 2, 'smooth'); tween(el, {scale: s0}, t + a.dur / 2, a.dur / 2, 'smooth');
          if (a.color !== false) { const c = col(a.color ?? 'yellow'); textEls(tg.el).concat(strokeEls(tg.el)).forEach(s => { const k = s.tagName === 'text' ? 'attr.fill' : 'attr.stroke'; const c0 = current(s, k, s.getAttribute(k.slice(5))); if (!c0 || c0 === 'none') return; tween(s, {[k]: c}, t, a.dur / 2, 'smooth', {[k]: c0}); tween(s, {[k]: c0}, t + a.dur / 2, a.dur / 2, 'smooth'); }); }
          log.push({t, d: a.dur, verb: 'indicate', id: tg.inst.id + (tg.part ? '.' + tg.part : '')});
        });
      },
      circumscribe(a, T) {
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), b = worldBox(tg.inst), pad = a.padding ?? 16, parent = tg.inst.spec.layer === 'screen' ? screen : world;
          const shape = a.shape === 'circle'
            ? svg('ellipse', {cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2 + pad * 1.6, ry: b.h / 2 + pad * 1.6, fill: 'none', stroke: col(a.color ?? 'yellow'), 'stroke-width': 3}, parent)
            : svg('rect', {x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, rx: 6, fill: 'none', stroke: col(a.color ?? 'yellow'), 'stroke-width': 3}, parent);
          setNow(shape, {autoAlpha: 0});
          tween(shape, {autoAlpha: 1}, t, 0.001, 'none'); tween(shape, {drawSVG: '0% 100%'}, t, a.dur * 0.55, 'smooth', {drawSVG: '0% 0%'});
          if (!a.keep) tween(shape, {drawSVG: '100% 100%'}, t + a.dur * 0.6, a.dur * 0.4, 'smooth');
          log.push({t, d: a.dur, verb: 'circumscribe', id: tg.inst.id});
        });
      },
      flash(a, T) {
        T.forEach(tg => {
          const b = worldBox(tg.inst), cx = b.x + b.w / 2, cy = b.y + b.h / 2, R = Math.max(b.w, b.h) / 2 + 20, n = 10;
          for (let i = 0; i < n; i++) { const ang = i / n * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang); const ln = svg('line', {x1: cx + c * R, y1: cy + s * R, x2: cx + c * (R + 40), y2: cy + s * (R + 40), stroke: col(a.color ?? 'yellow'), 'stroke-width': 3, 'stroke-linecap': 'round'}, world); setNow(ln, {autoAlpha: 0}); tween(ln, {autoAlpha: 1}, a.t, 0.001, 'none'); tween(ln, {drawSVG: '0% 100%'}, a.t, a.dur * 0.5, 'out', {drawSVG: '0% 0%'}); tween(ln, {drawSVG: '100% 100%'}, a.t + a.dur * 0.5, a.dur * 0.5, 'in'); }
          log.push({t: a.t, d: a.dur, verb: 'flash', id: tg.inst.id});
        });
      },
      pulse(a, T) { // a ring expanding out of a subject: an event happened here
        T.forEach(tg => { const b = worldBox(tg.inst), R = Math.max(b.w, b.h) / 2; const ring = svg('circle', {cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: R, fill: 'none', stroke: col(a.color ?? 'yellow'), 'stroke-width': 3}, world); ring.__origin = `${b.x + b.w / 2} ${b.y + b.h / 2}`; setNow(ring, {autoAlpha: 0}); tween(ring, {autoAlpha: 1}, a.t, 0.001, 'none'); tween(ring, {scale: 1.6}, a.t, a.dur, 'out', {scale: 1}); tween(ring, {autoAlpha: 0}, a.t + a.dur * 0.3, a.dur * 0.7, 'out'); log.push({t: a.t, d: a.dur, verb: 'pulse', id: tg.inst.id}); });
      },
      transform(a, T) {
        const into = resolve(a.into);
        T.forEach(src => transformInto(src, into, a));
      },
      trace(a, T) { // move a dot along a graph between data x values, optionally drawing the curve with it
        const g = objs.get(a.along); if (!g?.api?.fn) throw new Error(`trace: "along" must be a graph id`);
        const [xa, xb] = a.range || g.api.domain, n = Math.max(12, Math.round(a.dur * 30));
        const pts = []; for (let i = 0; i <= n; i++) { const x = xa + (xb - xa) * i / n; pts.push(g.api.axes.c2p(x, g.api.fn(x))); }
        T.forEach(tg => {
          const el = tg.el, x0 = current(el, 'x', pts[0][0]), y0 = current(el, 'y', pts[0][1]);
          show(tg, a.t);
          claim(el, ['x', 'y'], a.t, a.dur);
          tl.fromTo(el, {x: x0, y: y0}, {keyframes: pts.map(p => ({x: p[0], y: p[1]})), duration: a.dur, ease: ease(a.ease || 'smooth'), immediateRender: false}, a.t);
          state(el).x = pts.at(-1)[0]; state(el).y = pts.at(-1)[1];
        });
        if (a.draw) { const d0 = (xa - g.api.domain[0]) / (g.api.domain[1] - g.api.domain[0]) * 100, d1 = (xb - g.api.domain[0]) / (g.api.domain[1] - g.api.domain[0]) * 100; show({inst: g, whole: true}, a.t); tween(g.parts.shape, {drawSVG: `0% ${r3(d1)}%`}, a.t, a.dur, a.ease || 'smooth', {drawSVG: `0% ${r3(d0)}%`}); }
        log.push({t: a.t, d: a.dur, verb: 'trace', id: T.map(t => t.inst.id).join(','), detail: `along ${a.along} x ${xa}→${xb}`});
      },
      retarget(a, T) { // change a graph's function, a vector's tip or bar values in place
        T.forEach(tg => {
          const inst = tg.inst, api = inst.api;
          if (inst.type === 'graph') { const fn = compileFn(a.fn); api.fn = fn; if (a.domain) api.domain = a.domain; if (current(inst.parts.shape, 'drawSVG', '0% 100%') !== '0% 100%') tween(inst.parts.shape, {drawSVG: '0% 100%'}, a.t - 0.002, 0.001, 'none'); tween(inst.parts.shape, {morphSVG: graphD(api.axes, fn, api.domain, inst.spec.samples, inst.spec.clamp)}, a.t, a.dur, a.ease); }
          else if (inst.type === 'vector') retargetVector(inst, a.to, a.t, a.dur, a.ease);
          else if (inst.type === 'bars') { a.values.forEach((v, i) => { const el = api.els[i]; if (!el) return; const x = api.xs ? api.xs[i] : i + 1, [, yb] = api.axes.c2p(x, Math.max(api.axes.y0, 0)), [, yt] = api.axes.c2p(x, v); tween(el, {'attr.y': Math.min(yt, yb), 'attr.height': Math.abs(yb - yt)}, a.t + i * (a.stagger ?? 0), a.dur, a.ease); api.values[i] = v; }); }
          else if (inst.type === 'counter') VERBS.count({...a, to: a.to}, [tg]);
          else if (inst.verbs.retarget) inst.verbs.retarget(kitFor(inst), inst, a, a.t, a.dur);
          else throw new Error(`retarget is not supported for ${inst.type} (${inst.id})`);
          log.push({t: a.t, d: a.dur, verb: 'retarget', id: inst.id, detail: JSON.stringify(a.fn || a.to || a.values)});
        });
      },
      applyMatrix(a, T) { // linear transformation of a plane and everything plotted on it
        const [[m00, m01], [m10, m11]] = a.matrix, M = (x, y) => [m00 * x + m01 * y, m10 * x + m11 * y];
        T.forEach(tg => {
          const inst = tg.inst, api = inst.api;
          if (inst.type !== 'plane') throw new Error('applyMatrix targets a plane');
          for (const L of api.lines) { const p1 = api.c2p(...M(...L.a)), p2 = api.c2p(...M(...L.b)); tween(L.el, {'attr.x1': p1[0], 'attr.y1': p1[1], 'attr.x2': p2[0], 'attr.y2': p2[1]}, a.t, a.dur, a.ease); }
          for (const child of objs.values()) {
            if (child.spec.of !== inst.id) continue;
            if (child.type === 'vector') { child.api.base = child.api.base || child.api.to.slice(); retargetVector(child, M(...child.api.base), a.t, a.dur, a.ease); }
            else if (child.type === 'graph') { const f = child.api.fn, pts = []; const [d0, d1] = child.api.domain; for (let i = 0; i <= 120; i++) { const x = d0 + (d1 - d0) * i / 120; pts.push(api.c2p(...M(x, f(x)))); } tween(child.parts.shape, {morphSVG: pointsD(pts)}, a.t, a.dur, a.ease); }
            else if (child.spec.at) { const p = api.c2p(...M(...child.spec.at)); tween(child.outer, {x: p[0], y: p[1]}, a.t, a.dur, a.ease); }
          }
          log.push({t: a.t, d: a.dur, verb: 'applyMatrix', id: inst.id, detail: JSON.stringify(a.matrix)});
        });
      },
      flow(a, T) { // tokens travel along a path-like object; the path itself stays put
        T.forEach(tg => {
          const n = a.count ?? 5, spacing = a.spacing ?? 0.18, travel = Math.max(0.2, a.dur - spacing * (n - 1));
          const pts = pathPoints(tg.inst.id + (tg.part ? '.' + tg.part : ''), null, 50);
          const parent = tg.inst.spec.layer === 'screen' ? screen : world;
          for (let i = 0; i < n; i++) {
            const dot = a.shape === 'square' ? svg('rect', {x: -(a.r ?? 8), y: -(a.r ?? 8), width: (a.r ?? 8) * 2, height: (a.r ?? 8) * 2, fill: col(a.color ?? 'yellow')}, parent) : svg('circle', {cx: 0, cy: 0, r: a.r ?? 8, fill: col(a.color ?? 'yellow')}, parent);
            const t = a.t + i * spacing; setNow(dot, {x: pts[0][0], y: pts[0][1], autoAlpha: 0});
            tween(dot, {autoAlpha: 1}, t, 0.12, 'out');
            tl.fromTo(dot, {x: pts[0][0], y: pts[0][1]}, {keyframes: pts.map(p => ({x: p[0], y: p[1]})), duration: travel, ease: ease(a.ease || 'sine'), immediateRender: false}, t);
            state(dot).x = pts.at(-1)[0]; state(dot).y = pts.at(-1)[1];
            tween(dot, {autoAlpha: 0}, t + travel - 0.12, 0.12, 'in');
          }
          log.push({t: a.t, d: a.dur, verb: 'flow', id: tg.inst.id, detail: `${n} tokens`});
        });
      },
      arrange(a, T) { // move members into a layout: row, column, grid, circle, line, points or along another object
        const L = a.layout || {type: 'row'}, n = T.length, gap = L.gap ?? 120, c = L.center || [W / 2, H / 2];
        let pos = [];
        if (L.type === 'row') pos = T.map((_, i) => [c[0] + (i - (n - 1) / 2) * gap, c[1]]);
        else if (L.type === 'column') pos = T.map((_, i) => [c[0], c[1] + (i - (n - 1) / 2) * gap]);
        else if (L.type === 'grid') { const cols = L.cols ?? Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), gy = L.gapY ?? gap; pos = T.map((_, i) => [c[0] + ((i % cols) - (cols - 1) / 2) * gap, c[1] + (Math.floor(i / cols) - (rows - 1) / 2) * gy]); }
        else if (L.type === 'circle') pos = T.map((_, i) => { const ang = (L.start ?? -90) * Math.PI / 180 + i / n * Math.PI * 2; return [c[0] + Math.cos(ang) * (L.r ?? 300), c[1] + Math.sin(ang) * (L.r ?? 300)]; });
        else if (L.type === 'line') pos = T.map((_, i) => [L.from[0] + (L.to[0] - L.from[0]) * (n === 1 ? 0.5 : i / (n - 1)), L.from[1] + (L.to[1] - L.from[1]) * (n === 1 ? 0.5 : i / (n - 1))]);
        else if (L.type === 'points') pos = L.points;
        else if (L.type === 'along') { const pts = pathPoints(L.of, null, Math.max(2, n * 4)); pos = T.map((_, i) => pts[Math.min(pts.length - 1, Math.round(i / Math.max(1, n - 1) * (pts.length - 1)))]); }
        else if (L.type === 'scatter') { const rand = VG.rng(L.seed ?? 3), [w, h] = L.size || [800, 500]; pos = T.map(() => [c[0] + (rand() - 0.5) * w, c[1] + (rand() - 0.5) * h]); }
        else throw new Error(`arrange: unknown layout ${L.type}`);
        T.forEach((tg, i) => { const p = pos[i % pos.length]; if (!p) return; const el = tg.el; let to = p; if (!tg.whole && tg.inst.type === 'particles') to = [p[0] - current(tg.inst.outer, 'x', 0), p[1] - current(tg.inst.outer, 'y', 0)]; tween(el, {x: to[0], y: to[1]}, a.t + i * (a.stagger ?? 0.02), a.dur, a.ease); });
        log.push({t: a.t, d: a.dur, verb: 'arrange', id: T.map(t => t.inst.id + (t.part ? '.' + t.part : '')).slice(0, 6).join(',') + (n > 6 ? `,…(${n})` : ''), detail: L.type});
      },
      simulate(a, T) { // deterministic motion of particle systems: drift, brownian, attract, orbit, fall
        T.forEach(tg => {
          const inst = tg.inst; if (inst.type !== 'particles') throw new Error('simulate targets a particles object');
          const rand = VG.rng(a.seed ?? inst.spec.seed ?? 11), steps = Math.max(4, Math.round(a.dur * 8)), dt = a.dur / steps, model = a.model || 'brownian', [w, h] = inst.api.size;
          inst.api.pts.forEach(p => {
            let x = current(p.el, 'x', p.x), y = current(p.el, 'y', p.y), vx = (rand() - 0.5) * (a.speed ?? 120), vy = (rand() - 0.5) * (a.speed ?? 120); const kf = [];
            for (let s = 0; s < steps; s++) {
              if (model === 'brownian') { vx += (rand() - 0.5) * (a.speed ?? 120); vy += (rand() - 0.5) * (a.speed ?? 120); vx *= 0.7; vy *= 0.7; }
              if (model === 'drift') { vx = (a.velocity?.[0] ?? 80) + (rand() - 0.5) * 20; vy = (a.velocity?.[1] ?? 0) + (rand() - 0.5) * 20; }
              if (model === 'attract') { const tx = (a.to?.[0] ?? 0) - x, ty = (a.to?.[1] ?? 0) - y; vx = vx * 0.8 + tx * 1.6; vy = vy * 0.8 + ty * 1.6; }
              if (model === 'orbit') { const ang = Math.atan2(y, x) + (a.speed ?? 1) * dt, rr = Math.hypot(x, y); x = Math.cos(ang) * rr; y = Math.sin(ang) * rr; vx = vy = 0; }
              if (model === 'fall') { vy += (a.gravity ?? 900) * dt; }
              x += vx * dt; y += vy * dt;
              if (a.bounded !== false && model !== 'attract' && model !== 'orbit') { if (Math.abs(x) > w / 2) { x = Math.sign(x) * w / 2; vx = -vx; } if (Math.abs(y) > h / 2) { y = Math.sign(y) * h / 2; vy = -vy * (model === 'fall' ? 0.5 : 1); } }
              kf.push({x: r3(x), y: r3(y)});
            }
            const x0 = current(p.el, 'x', p.x), y0 = current(p.el, 'y', p.y);
            claim(p.el, ['x', 'y'], a.t, a.dur);
            tl.fromTo(p.el, {x: x0, y: y0}, {keyframes: kf, duration: a.dur, ease: 'none', immediateRender: false}, a.t);
            state(p.el).x = kf.at(-1).x; state(p.el).y = kf.at(-1).y;
          });
          log.push({t: a.t, d: a.dur, verb: 'simulate', id: inst.id, detail: model});
        });
      },
      focus(a, T) { // dim everything visible except the targets: one clear focus
        const keep = new Set(T.map(t => t.inst.id)); T.forEach(t => t.inst.labelOf && keep.add(t.inst.labelOf));
        for (const inst of objs.values()) {
          if (keep.has(inst.id) || inst.labelOf || (inst.spec.of && keep.has(inst.spec.of))) continue;
          if (inst.spec.of) continue;
          const o = current(inst.outer, 'autoAlpha', 0); if (o < 0.05) continue;
          inst.__dimmedFrom = o; tween(inst.outer, {autoAlpha: Math.min(o, a.level ?? 0.25)}, a.t, a.dur, a.ease);
        }
        log.push({t: a.t, d: a.dur, verb: 'focus', id: [...keep].join(',')});
      },
      unfocus(a) { for (const inst of objs.values()) if (inst.__dimmedFrom != null) { tween(inst.outer, {autoAlpha: inst.__dimmedFrom}, a.t, a.dur, a.ease); inst.__dimmedFrom = null; } log.push({t: a.t, d: a.dur, verb: 'unfocus', id: '*'}); },
      play(a, T) { T.forEach(tg => { show(tg, a.t); log.push({t: a.t, d: tg.inst.spec.mediaDuration || 0, verb: 'play', id: tg.inst.id}); }); },
      // ---- entrances and events with physical character (their eases are named, so a theme can retune them) ----
      drop(a, T) { // arrives from an offset (default from above) and lands
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), el = tg.el, key = tg.whole ? 'autoAlpha' : 'opacity', [dx, dy] = a.from || [0, -90];
          const x = current(el, 'x', 0), y = current(el, 'y', 0);
          tween(el, {x: x + dx, y: y + dy}, preT(t), 0.001, 'none'); tween(el, {x, y}, mainT(t), a.dur, a.ease || 'pop');
          tween(el, {[key]: tg.whole ? tg.inst.spec.opacity ?? 1 : 1}, t, Math.min(0.2, a.dur * 0.4), 'out', {[key]: 0});
          log.push({t, d: a.dur, verb: 'drop', id: tg.inst.id + (tg.part ? '.' + tg.part : '')});
        });
      },
      pop(a, T) { // grows out of nothing past its size and settles
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), el = tg.whole ? tg.inst.rs : tg.el, key = tg.whole ? 'autoAlpha' : 'opacity', vis = tg.whole ? tg.inst.outer : tg.el;
          if (!tg.whole && !el.__origin) { const b = el.getBBox(); el.__origin = `${r3(b.x + b.width / 2)} ${r3(b.y + b.height / 2)}`; }
          const sc = current(el, 'scale', 1);
          tween(el, {scale: a.from_scale ?? 0.001}, preT(t), 0.001, 'none'); tween(el, {scale: sc}, mainT(t), a.dur, a.ease || 'pop');
          tween(vis, {[key]: tg.whole ? tg.inst.spec.opacity ?? 1 : 1}, t, Math.min(0.15, a.dur * 0.3), 'out', {[key]: 0});
          log.push({t, d: a.dur, verb: 'pop', id: tg.inst.id + (tg.part ? '.' + tg.part : '')});
        });
      },
      stamp(a, T) { // slams down from larger than life onto the subject (a verdict: sold out, rejected, approved)
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), el = tg.whole ? tg.inst.rs : tg.el, key = tg.whole ? 'autoAlpha' : 'opacity', vis = tg.whole ? tg.inst.outer : tg.el;
          if (!tg.whole && !el.__origin) { const b = el.getBBox(); el.__origin = `${r3(b.x + b.width / 2)} ${r3(b.y + b.height / 2)}`; }
          const sc = current(el, 'scale', 1);
          tween(el, {scale: sc * (a.from_scale ?? 1.9)}, preT(t), 0.001, 'none'); tween(el, {scale: sc}, mainT(t), a.dur, a.ease || 'in');
          tween(vis, {[key]: tg.whole ? tg.inst.spec.opacity ?? 1 : 1}, t, a.dur * 0.6, 'out', {[key]: 0});
          log.push({t, d: a.dur, verb: 'stamp', id: tg.inst.id + (tg.part ? '.' + tg.part : '')});
        });
      },
      swing(a, T) { // hangs from a pivot (default its top centre) and sways to rest: a tag on a string, a sign on a hook
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), el = tg.whole ? tg.inst.body : tg.el, b = el.getBBox();
          const origin = a.about ? `${a.about[0]} ${a.about[1]}` : `${r3(b.x + b.width / 2)} ${r3(b.y)}`;
          const amp = a.angle ?? 14, r0 = current(el, 'rotation', 0), seq = [1, -0.6, 0.34, -0.17, 0.07, 0], d = a.dur / seq.length;
          claim(el, ['rotation'], t, a.dur);
          tl.fromTo(el, {rotation: r0, svgOrigin: origin}, {keyframes: seq.map(k => ({rotation: r0 + amp * k, duration: d, ease: 'sine.inOut'})), svgOrigin: origin, immediateRender: false}, t);
          state(el).rotation = r0;
          log.push({t, d: a.dur, verb: 'swing', id: tg.inst.id + (tg.part ? '.' + tg.part : ''), detail: `±${amp}°`});
        });
      },
      strike(a, T) { // a line is drawn across the subject; it stays attached to it (crossed out, cancelled)
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), host = tg.whole ? tg.inst.rs : tg.el, b = host.getBBox(), pad = a.padding ?? Math.max(10, b.width * 0.06);
          const line = svg('line', {x1: r3(b.x - pad), y1: r3(b.y + b.height * 0.68), x2: r3(b.x + b.width + pad), y2: r3(b.y + b.height * 0.32),
            stroke: col(a.color ?? 'red'), 'stroke-width': a.width ?? Math.max(8, theme.stroke * 2), 'stroke-linecap': 'round', class: 'vg-fx'}, host);
          setNow(line, {drawSVG: '0% 0%'});
          tween(line, {drawSVG: '0% 100%'}, t, a.dur, a.ease || 'out');
          log.push({t, d: a.dur, verb: 'strike', id: tg.inst.id + (tg.part ? '.' + tg.part : '')});
        });
      },
      type(a, T) { // characters appear one at a time like typing; "cursor": true adds a caret that follows and then blinks
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length); show(tg, t);
          if (!tg.whole) tween(tg.el, {opacity: 1}, t, 0.001, 'none', {opacity: 0});
          textEls(tg.el).forEach(tx => {
            const chars = [...tx.querySelectorAll('.vg-ch')], n = chars.length, step = n ? a.dur / n : 0;
            chars.forEach((c, j) => { tween(c, {'attr.fill-opacity': 0}, t, 0.001, 'none', {'attr.fill-opacity': 1}); tween(c, {'attr.fill-opacity': 1}, t + (j + 1) * step, 0.001, 'none'); });
            if (!a.cursor || !n) return;
            const size = parseFloat(tx.getAttribute('font-size')) || 32, ext = j => tx.getExtentOfChar(j);
            const first = ext(0), cw = a.cursorWidth ?? Math.max(3, size * 0.09), ch = size * 1.05;
            const cur = svg('rect', {x: 0, y: -ch / 2, width: cw, height: ch, fill: col(a.cursorColor ?? a.color ?? tx.getAttribute('fill')), class: 'vg-fx'}, tx.parentNode);
            const at = j => { const e = j < 0 ? {x: first.x, y: first.y, width: 0, height: first.height} : ext(j); return {x: r3(e.x + e.width + cw), y: r3(e.y + e.height / 2)}; };
            setNow(cur, {...at(-1), autoAlpha: 0});
            tween(cur, {autoAlpha: 1}, t, 0.001, 'none');
            chars.forEach((_, j) => tween(cur, at(j), t + (j + 1) * step, 0.001, 'none'));
            for (let k = 0, tb = t + a.dur + 0.5; k < Math.round((a.blink ?? 2) / 0.5); k++, tb += 0.5) tween(cur, {autoAlpha: k % 2 ? 1 : 0}, tb, 0.001, 'none');
          });
          log.push({t, d: a.dur, verb: 'type', id: tg.inst.id + (tg.part ? '.' + tg.part : '')});
        });
      },
      shake(a, T) { // a quick side-to-side shake: refusal, error, impact
        T.forEach((tg, i) => {
          const t = a.t + i * lag(a, T.length), el = tg.whole ? tg.inst.rs : tg.el, amp = a.amount ?? 14, x0 = current(el, 'x', 0);
          const seq = [-1, 1, -0.7, 0.7, -0.35, 0], d = a.dur / seq.length;
          claim(el, ['x'], t, a.dur);
          tl.fromTo(el, {x: x0}, {keyframes: seq.map(k => ({x: x0 + amp * k, duration: d, ease: 'sine.inOut'})), immediateRender: false}, t);
          state(el).x = x0;
          log.push({t, d: a.dur, verb: 'shake', id: tg.inst.id + (tg.part ? '.' + tg.part : '')});
        });
      },
    };
    VERBS.draw = VERBS.create; VERBS.morph = VERBS.transform; VERBS.replace = VERBS.transform;
    VG.verbs = Object.keys(VERBS);

    function pathPoints(ref, tg, n) {
      if (Array.isArray(ref)) return ref;
      const t = resolve(ref), inst = t.inst;
      const el = t.whole ? (inst.parts.shape || inst.parts.shaft || strokeEls(inst.body)[0]) : (t.el.matches('path,line,polyline,polygon,circle,rect,ellipse') ? t.el : strokeEls(t.el)[0]);
      if (!el) throw new Error(`${ref} has no path geometry to follow`);
      const p = el.tagName === 'path' ? el : (MorphSVGPlugin.convertToPath(el.cloneNode(true))[0] || el);
      const tmp = p === el ? null : p; if (tmp) el.parentNode.appendChild(tmp);
      const len = tmp ? tmp.getTotalLength() : el.getTotalLength(), M = el.getCTM ? null : null; void M;
      const toWorld = (() => { const m = ctm(world).inverse().multiply(ctm(tmp || el)); return pt => { const q = new DOMPoint(pt.x, pt.y).matrixTransform(m); return [r3(q.x), r3(q.y)]; }; })();
      // CTM reflects build-time transforms (= the object's tracked state before any tween).
      const out = []; for (let i = 0; i <= n; i++) out.push(toWorld((tmp || el).getPointAtLength(len * i / n)));
      if (tmp) tmp.remove();
      if (tg && tg.inst.spec.of) { const p0 = objs.get(tg.inst.spec.of).outer; const ox = current(p0, 'x', 0), oy = current(p0, 'y', 0); return out.map(q => [q[0] - ox, q[1] - oy]); }
      return out;
    }
    function retargetVector(inst, to, t, dur, ez) {
      const api = inst.api, from = api.from, p0 = api.axes.c2p(...from), p1 = api.axes.c2p(...to), len = Math.max(16, (inst.spec.width ?? 4) * 5), L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
      const ex = p1[0] - (p1[0] - p0[0]) / L * len * 0.8, ey = p1[1] - (p1[1] - p0[1]) / L * len * 0.8;
      tween(inst.parts.shaft, {morphSVG: `M${p0[0]} ${p0[1]} L${r3(ex)} ${r3(ey)}`}, t, dur, ez);
      const tmp = arrowHead(inst.body, p0[0], p0[1], p1[0], p1[1], {...inst.spec, tip: len, color: inst.spec.color ?? 'yellow'}); const d = tmp.getAttribute('d'); tmp.remove();
      tween(inst.parts.head, {morphSVG: d}, t, dur, ez); api.to = to.slice();
    }
    // Paths of an element expressed in another element's coordinate space, using build-time CTMs plus tracked state deltas.
    function geometryPaths(el) { return strokeEls(el).filter(e => !e.closest('.vg-label')); }
    function asPath(el) { if (el.tagName === 'path') return el; const [p] = MorphSVGPlugin.convertToPath(el); return p; }
    function stateMatrix(inst) { // world matrix of an object's body from tracked state (not DOM)
      const x = current(inst.outer, 'x', 0), y = current(inst.outer, 'y', 0), sc = current(inst.rs, 'scale', 1), rot = current(inst.rs, 'rotation', 0);
      let m = new DOMMatrix().translate(x, y).rotate(rot).scale(sc);
      if (inst.spec.of) m = stateMatrix(objs.get(inst.spec.of)).multiply(new DOMMatrix().translate(...(inst.spec.of ? [0, 0] : [0, 0]))).multiply(m);
      const bt = inst.body.transform.baseVal.consolidate(); if (bt) m = m.multiply(dm(bt.matrix));
      return m;
    }
    function transformInto(src, dst, a) {
      const t = a.t, dur = a.dur, A = src.inst, B = dst.inst;
      show(src, t);
      const mA = stateMatrix(A), mB = stateMatrix(B), bodyA = A.body, bodyB = B.body;
      const local = el => ctm(bodyA).inverse().multiply(ctm(el)); // static internal offset inside body A
      // TeX: match terms by \cssId name, move matched parts, fade the rest.
      if (A.type === 'tex' && B.type === 'tex' && Object.keys(A.parts).some(k => B.parts[k])) {
        const toBodyA = el => ctm(bodyA).inverse().multiply(ctm(el));
        const fromB = el => mA.inverse().multiply(mB).multiply(ctm(bodyB).inverse().multiply(ctm(el)));
        const matched = Object.keys(A.parts).filter(k => B.parts[k]);
        const inside = (el, parts) => matched.some(k => parts[k].contains(el));
        const leaves = root => [...root.querySelectorAll('path,rect,line,text')];
        for (const key of matched) {
          const pa = A.parts[key], pb = B.parts[key], ba = pa.getBBox(), bb = pb.getBBox();
          const ma = toBodyA(pa), mb = fromB(pb);
          const ca = new DOMPoint(ba.x + ba.width / 2, ba.y + ba.height / 2).matrixTransform(ma), cb = new DOMPoint(bb.x + bb.width / 2, bb.y + bb.height / 2).matrixTransform(mb);
          const det = ma.a * ma.d - ma.b * ma.c, dx = cb.x - ca.x, dy = cb.y - ca.y;
          const lx = (ma.d * dx - ma.c * dy) / det, ly = (-ma.b * dx + ma.a * dy) / det;
          const s = (Math.hypot(mb.a, mb.b) * Math.max(bb.width, 1)) / (Math.hypot(ma.a, ma.b) * Math.max(ba.width, 1));
          pa.__origin = `${r3(ba.x + ba.width / 2)} ${r3(ba.y + ba.height / 2)}`;
          tween(pa, {x: r3(lx), y: r3(ly), scale: r3(s)}, t, dur, a.ease || 'smooth', {x: 0, y: 0, scale: 1});
          tween(pb, {opacity: 0}, t, 0.001, 'none', {opacity: 1}); tween(pb, {opacity: 1}, t + dur, 0.001, 'none');
        }
        leaves(A.body).filter(el => !inside(el, A.parts)).forEach(el => tween(el, {opacity: 0}, t, dur * 0.5, 'in', {opacity: 1}));
        leaves(B.body).filter(el => !inside(el, B.parts)).forEach(el => { tween(el, {opacity: 0}, t, 0.001, 'none', {opacity: 1}); tween(el, {opacity: 1}, t + dur * 0.5, dur * 0.5, 'out'); });
        show({inst: B, whole: true}, t);
        tween(A.outer, {autoAlpha: 0}, t + dur, 0.001, 'none');
        log.push({t, d: dur, verb: 'transform', id: A.id, detail: `→ ${B.id} (matching terms ${matched.join(', ')})`});
        return;
      }
      const pa = geometryPaths(src.whole ? A.body : src.el), pb = geometryPaths(dst.whole ? B.body : dst.el);
      if (!pa.length || !pb.length) { // text or media: move-and-crossfade
        const ba = worldBox(A), bb = worldBox(B);
        const dx = (bb.x + bb.w / 2) - (ba.x + ba.w / 2), dy = (bb.y + bb.h / 2) - (ba.y + ba.h / 2);
        const x0 = current(A.outer, 'x', 0), y0 = current(A.outer, 'y', 0);
        tween(A.outer, {x: x0 + dx, y: y0 + dy}, t, dur, a.ease || 'smooth');
        tween(A.outer, {autoAlpha: 0}, t + dur * 0.35, dur * 0.65, 'smooth');
        const xb = current(B.outer, 'x', 0), yb = current(B.outer, 'y', 0);
        tween(B.outer, {x: xb - dx, y: yb - dy}, t - 0.002, 0.001, 'none'); show({inst: B, whole: true}, t);
        tween(B.outer, {autoAlpha: 0}, t - 0.001, 0.001, 'none', {autoAlpha: 0}); tween(B.outer, {autoAlpha: B.spec.opacity ?? 1}, t + dur * 0.2, dur * 0.7, 'smooth');
        tween(B.outer, {x: xb, y: yb}, t, dur, a.ease || 'smooth');
        log.push({t, d: dur, verb: 'transform', id: A.id, detail: `→ ${B.id} (crossfade)`});
        return;
      }
      const bodyInv = mA.inverse();
      const n = Math.max(pa.length, pb.length);
      const srcPaths = pa.map(asPath), dstPaths = pb.map(asPath);
      for (let i = 0; i < n; i++) {
        const p = srcPaths[i], q = dstPaths[i];
        if (p && q) {
          const m = local(p).inverse().multiply(bodyInv).multiply(mB).multiply(ctm(bodyB).inverse().multiply(ctm(q)));
          const raw = MorphSVGPlugin.stringToRawPath(q.getAttribute('d'));
          for (const seg of raw) for (let j = 0; j < seg.length; j += 2) { const pt = new DOMPoint(seg[j], seg[j + 1]).matrixTransform(m); seg[j] = r3(pt.x); seg[j + 1] = r3(pt.y); }
          const props = {morphSVG: MorphSVGPlugin.rawPathToString(raw)};
          for (const k of ['stroke', 'fill']) { const v = q.getAttribute(k); if (v && v !== 'none' && p.getAttribute(k) && p.getAttribute(k) !== 'none') props['attr.' + k] = v; }
          const qs = q.getAttribute('stroke-width'); if (qs) props['attr.stroke-width'] = +qs * Math.hypot(m.a, m.b);
          const qfo = q.getAttribute('fill-opacity'); if (qfo != null && p.getAttribute('fill') !== 'none') props['attr.fill-opacity'] = +qfo;
          if (p.getAttribute('fill') === 'none' && q.getAttribute('fill') && q.getAttribute('fill') !== 'none') { p.setAttribute('fill', q.getAttribute('fill')); p.setAttribute('fill-opacity', 0); props['attr.fill-opacity'] = +(qfo ?? 1); }
          tween(p, props, t, dur, a.ease || 'smooth');
        } else if (p) tween(p, {opacity: 0}, t, dur * 0.6, 'in', {opacity: 1});
      }
      textEls(A.body).forEach(tx => tween(tx, {opacity: 0}, t, dur * 0.4, 'in', {opacity: 1}));
      tween(A.outer, {autoAlpha: 0}, t + dur, 0.001, 'none');
      show({inst: B, whole: true}, t + dur);
      if (dstPaths.length > srcPaths.length || textEls(B.body).length) { // extra parts of B arrive with a fade
        const extra = [...dstPaths.slice(srcPaths.length), ...textEls(B.body)];
        tween(B.outer, {autoAlpha: B.spec.opacity ?? 1}, t + dur * 0.5 - 0.001, 0.001, 'none', {autoAlpha: 0});
        Object.values(dstPaths.slice(0, srcPaths.length)).forEach(el => { tween(el, {opacity: 0}, t + dur * 0.5 - 0.001, 0.001, 'none', {opacity: 1}); tween(el, {opacity: 1}, t + dur, 0.001, 'none'); });
        extra.forEach(el => tween(el, {opacity: 1}, t + dur * 0.5, dur * 0.5, 'out', {opacity: 0}));
      }
      log.push({t, d: dur, verb: 'transform', id: A.id, detail: `→ ${B.id} (morph ${Math.min(pa.length, pb.length)} paths)`});
    }

    function writeText(tx, t, dur) { // characters appear left to right
      const chars = [...tx.querySelectorAll('.vg-ch')];
      if (!chars.length) { tween(tx, {opacity: 1}, t, dur, 'out', {opacity: 0}); return; }
      const n = chars.length, per = Math.min(0.3, dur * 0.5), step = n > 1 ? (dur - per) / (n - 1) : 0;
      chars.forEach((c, i) => {
        if (!(('attr.fill-opacity') in state(c))) tween(c, {'attr.fill-opacity': 0}, t, 0.001, 'none', {'attr.fill-opacity': 1});
        tween(c, {'attr.fill-opacity': 1}, t + i * step, per, 'out', {'attr.fill-opacity': 0});
      });
    }
    function kitFor(inst) { return {...ctx, tl, tween, setNow, state, current, resolve, objs, inst, body: inst.body, log, ease, show: (t) => show({inst, whole: true}, t), worldBox, pathPoints}; }

    // ---------- build everything ----------
    for (const o of film.objects) build(o);
    const actions = film.actions.slice().sort((p, q) => p.t - q.t || p.order - q.order);
    for (const a of actions) {
      currentSource = a.source || a.do;
      try {
        if (a.do === 'camera') { VERBS.camera(a); continue; }
        if (a.do === 'unfocus') { VERBS.unfocus(a); continue; }
        const T = targetsOf(a);
        if (VERBS[a.do]) VERBS[a.do](a, T);
        else { // component verb
          for (const tg of T) {
            const fn = tg.inst.verbs[a.do];
            if (!fn) throw new Error(`${tg.inst.id} (${tg.inst.type}) has no verb "${a.do}". Built-in verbs: ${VG.verbs.join(', ')}; component verbs: ${Object.keys(tg.inst.verbs).join(', ') || 'none'}`);
            fn.call(tg.inst.verbs, kitFor(tg.inst), tg.inst, a, a.t, a.dur);
            log.push({t: a.t, d: a.dur, verb: a.do, id: tg.inst.id});
          }
        }
      } catch (error) { throw new Error(`${a.source || 'action'}: ${error.message}`); }
    }
    for (const scene of film.scenes || []) for (const fn of VG.hooks[scene.id] || []) {
      const cue = (name, offset = 0) => { const c = scene.cues?.[name]; if (c == null) throw new Error(`hook ${scene.id}: unknown cue "${name}". Cues: ${Object.keys(scene.cues || {}).join(', ')}`); return c + offset; };
      fn({...ctx, tl, gsap, tween, setNow, state, current, cue, scene, obj: id => { const o = objs.get(id); if (!o) throw new Error(`hook: unknown object ${id}`); return o; }, part: ref => resolve(ref).el,
        add: (id, el, type = 'custom') => { const inst = {id, type, spec: {id, type, scene: scene.id}, scene: scene.id, outer: el, rs: el, body: el, parts: {}, api: {}, verbs: {}}; objs.set(id, inst); return inst; }, log, ease, worldBox, resolve});
    }
    if (film.duration) tl.set({}, {}, film.duration);
    VG.__last = {tl, objs, log, cam, root, film, conflicts};
    return tl;
  }
  function deepMerge(a, b) { for (const [k, v] of Object.entries(b || {})) a[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(a[k] || {}, v) : v; return a; }
  VG.mount = mount;

  /* Inspection API used by the pipeline (not by scenes). */
  // Relative luminance 0..1 of a #rgb / #rrggbb colour (null for anything else).
  function lum(c) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim()); if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1], ch = i => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  }
  VG.snapshot = function () {
    const {objs} = VG.__last, out = [];
    const eff = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentNode) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; o *= +cs.opacity; } return o; };
    for (const inst of objs.values()) {
      const op = eff(inst.outer); const r = inst.outer.getBoundingClientRect();
      const item = {id: inst.id, type: inst.type, scene: inst.scene, opacity: Math.round(op * 100) / 100, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], texts: []};
      // For empty-box checks: is a rectangle only an outline (or a faint fill), and which object holds it.
      if ((inst.type === 'rect' || inst.type === 'square') && inst.parts.shape) {
        const sh = inst.parts.shape, f = sh.getAttribute('fill'), bgL = lum(VG.__last.film.theme?.bg), fL = lum(f);
        item.hollow = !f || f === 'none' || +(sh.getAttribute('fill-opacity') ?? 1) < 0.5 || (fL != null && bgL != null && Math.abs(fL - bgL) < 0.12);
      }
      const holder = inst.outer.parentElement?.closest?.('.vg-obj'); if (holder) item.parent = holder.dataset.vgId;
      // Remove the camera transform before measuring subject development.
      // Screen-space movement alone cannot tell an object move from a camera pan.
      const basis = inst.outer.closest('.vg-world, .vg-screen');
      if (basis && inst.outer.getBBox) {
        const b = inst.outer.getBBox(), m = basis.getScreenCTM().inverse().multiply(inst.outer.getScreenCTM());
        const pts = [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]]
          .map(([x,y]) => new DOMPoint(x,y).matrixTransform(m));
        const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
        item.worldBox = [Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)].map(v=>Math.round(v*10)/10);
      }
      if (op > 0.02 && !inst.media) {
        for (const t of inst.outer.querySelectorAll('text')) {
          if (t.closest('.vg-obj') !== inst.outer && !(inst.type === 'axes' || inst.type === 'network' || inst.type === 'numberline' || inst.type === 'counter')) continue;
          const te = eff(t); if (te < 0.05) continue;
          const m = t.getScreenCTM(); const px = parseFloat(t.getAttribute('font-size')) * Math.hypot(m.a, m.b) * (document.querySelector('.vg-stage').getBoundingClientRect().width / VG.__last.film.width) / (document.querySelector('.vg-stage').getScreenCTM().a || 1);
          const tr = t.getBoundingClientRect(); item.texts.push({text: t.textContent.slice(0, 60), px: Math.round(px), opacity: Math.round(te * 100) / 100, box: [Math.round(tr.x), Math.round(tr.y), Math.round(tr.width), Math.round(tr.height)]});
        }
        // Geometry signature, rounded so equivalent encodings (e.g. MorphSVG's re-serialised paths) compare equal.
        const nums = v => v ? (String(v).match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(x => Math.round(+x)).join(',') : '';
        const r2 = v => v == null || v === '' ? '1' : String(Math.round(parseFloat(v) * 50) / 50);
        const tf = v => { const n = nums(v); return n === '1,0,0,1,0,0' || n === '0,0' ? '' : n; };
        let sig = '';
        for (const p of inst.outer.querySelectorAll('path,line,circle,rect,ellipse,text,g,tspan')) {
          if (p.closest('.vg-obj') !== inst.outer) continue;
          const geo = p.tagName === 'path' ? (() => { try { const b = p.getBBox(); return Math.round(p.getTotalLength() / 2) + ':' + nums([b.x, b.y, b.width, b.height].join(' ')); } catch { return ''; } })() : '';
          sig += p.tagName + geo + tf(p.getAttribute('transform')) + nums([p.getAttribute('x1'), p.getAttribute('y1'), p.getAttribute('x2'), p.getAttribute('y2'), p.getAttribute('height'), p.getAttribute('y')].join(' ')) +
            nums(p.style.strokeDashoffset) + nums(p.style.strokeDasharray) + r2(p.getAttribute('fill-opacity')) + r2(p.style.opacity) + (p.getAttribute('stroke') || '') + (p.getAttribute('fill') || '') + (p.tagName === 'text' ? p.textContent : '') + ';';
        }
        let h = 0; for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0; item.sig = h;
      }
      out.push(item);
    }
    const c = VG.__last.cam;
    return {objects: out, camera: {transform: VG.__last.root.querySelector('.vg-cam-scale').getAttribute('transform') + '|' + VG.__last.root.querySelector('.vg-cam-pan').getAttribute('transform')}, camFinal: c};
  };
})();
