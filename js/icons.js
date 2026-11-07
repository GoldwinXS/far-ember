// Ember Squad: line icons (24x24, stroke uses currentColor).
const s = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICON = {
  shoot: s('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  overwatch: s('<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  reload: s('<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16"/><path d="M20 21v-5h-5"/>'),
  hunker: s('<path d="M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6l8-3z"/><path d="M8.5 12.5l2.4 2.4 4.6-5"/>'),
  grenade: s('<circle cx="11" cy="14" r="6.5"/><path d="M13 7.6V5h3v3"/><path d="M16 5l3-2"/><path d="M7.5 14h7M11 10.5v7"/>'),
  rocket: s('<path d="M5 19l3-1 8-8a5 5 0 0 0 1.5-5.5A5 5 0 0 0 12 6L4 14l-1 3z"/><circle cx="14" cy="10" r="1.4"/><path d="M6 15l3 3"/>'),
  rush: s('<path d="M5 6l6 6-6 6"/><path d="M13 6l6 6-6 6"/>'),
  steady: s('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  rapid: s('<path d="M6 20V9l1.5-4L9 9v11z"/><path d="M11 20V9l1.5-4L14 9v11z"/><path d="M16 20V9l1.5-4L19 9v11z"/>'),
  medkit: s('<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2"/><path d="M12 10v6M9 13h6"/>'),
  smoke: s('<path d="M7 18a4 4 0 0 1-.6-8 5 5 0 0 1 9.6-1.4A3.5 3.5 0 0 1 17.5 18z"/><path d="M5 21h14"/>'),
  evac: s('<path d="M12 18V5"/><path d="M6 11l6-6 6 6"/><path d="M4 21h16"/>'),
  move: s('<path d="M5 12h12"/><path d="M13 6l6 6-6 6"/>'),
  endturn: s('<path d="M4 6l7 6-7 6z"/><path d="M13 6l7 6-7 6z"/>'),
  menu: s('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  rotl: s('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  rotr: s('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  left: s('<path d="M15 5l-7 7 7 7"/>'),
  right: s('<path d="M9 5l7 7-7 7"/>'),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  shield: s('<path d="M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6l8-3z"/>'),
  cache: s('<rect x="4" y="7" width="16" height="12" rx="1.5"/><path d="M4 11h16M10 11v3h4v-3"/>'),
  // class marks
  scout: s('<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>'),
  gunner: s('<rect x="4" y="9" width="4" height="11" rx="1"/><rect x="10" y="6" width="4" height="14" rx="1"/><rect x="16" y="3" width="4" height="17" rx="1"/>'),
  marksman: s('<circle cx="12" cy="12" r="8"/><path d="M12 4v5M12 15v5M4 12h5M15 12h5"/>'),
  medic: s('<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>'),
};
