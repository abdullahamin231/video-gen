// Compile-time TeX → SVG (MathJax, glyphs as paths). Deterministic, no browser fonts needed.
// \cssId{name}{...} marks a term; the kit exposes it as part "name" and transform() matches terms by name.
import {mathjax} from 'mathjax-full/js/mathjax.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import {AllPackages} from 'mathjax-full/js/input/tex/AllPackages.js';

let doc, adaptor;
function init() {
  if (doc) return;
  adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  doc = mathjax.document('', {InputJax: new TeX({packages: AllPackages.filter(p => p !== 'bussproofs'), formatError: (jax, err) => { throw err; }}),
    OutputJax: new SVG({fontCache: 'none'})});
}

export function texToSvg(tex) {
  init();
  const node = doc.convert(tex, {display: true});
  const svg = adaptor.firstChild(node);
  const html = adaptor.outerHTML(svg);
  if (/data-mjx-error|merror/.test(html)) {
    const message = (html.match(/title="([^"]+)"/) || [])[1] || 'invalid TeX';
    throw new Error(`TeX error in "${tex}": ${message}`);
  }
  // Keep only the inner geometry; the kit supplies scale and colour.
  const viewBox = html.match(/viewBox="([^"]+)"/)[1];
  const inner = html.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`;
}
