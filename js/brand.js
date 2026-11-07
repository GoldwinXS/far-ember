// Far Ember: the brand marks. The emblem is an ember star inside a hex shield with an orbit, in the ember gradient.
let n = 0;
export function emblem(size = 120) {
  const id = `eg${n++}`;
  return `<svg class="emblem" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe3b8"/><stop offset=".5" stop-color="#ff8a3d"/><stop offset="1" stop-color="#a8431a"/></linearGradient></defs>
    <path d="M60 5 L107 29 L100 87 L60 115 L20 87 L13 29 Z" fill="rgba(8,10,16,.55)" stroke="url(#${id})" stroke-width="3.5"/>
    <path d="M60 15 L99 35 L93 82 L60 105 L27 82 L21 35 Z" fill="none" stroke="#ffcf9a" stroke-opacity=".35" stroke-width="1.2"/>
    <ellipse cx="60" cy="61" rx="44" ry="12" transform="rotate(-22 60 61)" fill="none" stroke="#ffe3b8" stroke-opacity=".55" stroke-width="1.6"/>
    <path d="M60 24 L67 53 L94 61 L67 69 L60 98 L53 69 L26 61 L53 53 Z" fill="url(#${id})"/>
    <circle cx="60" cy="61" r="5" fill="#fff5e2"/>
  </svg>`;
}
export function wordmark(cls = '') {
  return `<div class="brand ${cls}">${emblem(cls === 'small' ? 54 : 104)}<div class="word"><span class="far">FAR</span><span class="ember">EMBER</span><span class="sub">Squad tactics on the frontier</span></div></div>`;
}
