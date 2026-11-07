// Far Ember: the dropship's trips. Out of the Lantern's bay with the squad aboard, down onto the mission map to drop
// them, and back in to land on the pad. Every flight can be skipped with a tap.
import * as THREE from 'three';
import { setMoving } from './chars.js';
import { buildDropship } from './dropship.js';
import { SHIP_AT } from './carrier.js';

const ease = (k) => k * k * (3 - 2 * k);
const easeIn = (k) => k * k * k;
const easeOut = (k) => 1 - (1 - k) ** 3;
const lerp = (a, b, k) => a + (b - a) * k;

// A timeline that a tap fast-forwards: each step runs over its duration, or jumps to its end once skipped.
function timeline(view) {
  const t = { skip: false };
  t.step = (dur, fn) => (t.skip ? (fn(1), Promise.resolve()) : view.tween(dur, (k) => fn(t.skip ? 1 : k)));
  t.wait = (s) => (t.skip ? Promise.resolve() : view.wait(s));
  const tap = () => { t.skip = true; };
  t.arm = () => { setTimeout(() => window.addEventListener('pointerdown', tap, { once: true }), 300); };
  t.done = () => window.removeEventListener('pointerdown', tap);
  return t;
}
function cam(view, eye, look, speed = 2.5) {
  view.stationNow = null;
  view.cine = { p: new THREE.Vector3(...eye), t: new THREE.Vector3(...look), speed };
}
// Walk a rig along points (x, y, z) over dur seconds with the walk cycle running.
function walk(view, rig, pts, dur, tl) {
  setMoving(rig, true, false);
  const P = pts.map((p) => new THREE.Vector3(...p));
  const seg = P.slice(1).map((p, i) => p.distanceTo(P[i]));
  const total = seg.reduce((a, b) => a + b, 0) || 1;
  return tl.step(dur, (k) => {
    let d = k * total, i = 0;
    while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
    const a = P[i], b = P[i + 1], f = Math.min(1, d / (seg[i] || 1));
    rig.root.position.lerpVectors(a, b, f);
    rig.targetYaw = Math.atan2(b.x - a.x, b.z - a.z);
    if (k >= 1) setMoving(rig, false);
  });
}
function dust(view, x, z, n = 6, size = 1.2) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random();
    view.puff?.(new THREE.Vector3(x + Math.cos(a) * 1.6, 0.15, z + Math.sin(a) * 1.6), '#9a958c', size, 1.6, 0.4);
  }
}

// ------------------------------------------------------------ out of the hangar
export async function flightOut(app) {
  const view = app.view, c = view.carrier;
  if (!c) return;
  const ship = c.ship, tl = timeline(view);
  tl.arm();
  app.sfx.music?.('tension', { fade: 3 });
  const rigs = (app.dio?.units || []).map((id) => view.rigs.get(id)).filter(Boolean);
  view.spin = null;
  // the squad files up the ramp while the camera watches from the starboard quarter
  cam(view, [7.6, 2.3, 8.6], [-0.6, 1.5, 0.5], 3);
  app.sfx.door?.(true);
  await Promise.all(rigs.map(async (r, i) => {
    await tl.wait(i * 0.32);
    const p = r.root.position;
    await walk(view, r, [[p.x, 0, p.z], [p.x * 0.3 + 0.0, 0, 5.2], [0, 0.02, 4.75], [0, 1.12, SHIP_AT.z + 4.2], [0, 1.12, SHIP_AT.z + 2.4]], 2.4, tl);
    r.root.visible = false;
  }));
  // ramp up, engines to hover, lift off
  app.sfx.door?.(false);
  await tl.step(1.0, (k) => ship.setRamp(1 - ease(k)));
  app.sfx.engine?.();
  cam(view, [8.5, 1.6, 4.5], [0, 2.4, -1.5], 2);
  await tl.step(1.0, (k) => { ship.setTilt(1 - ease(k)); ship.setThrust(0.15 + k * 0.5); });
  let puffed = false;
  await tl.step(1.8, (k) => {
    const e = ease(k);
    ship.root.position.y = SHIP_AT.y + e * 2.4;
    ship.setGear(1 - Math.min(1, k * 1.6));
    ship.setThrust(0.65 + k * 0.2);
    view.shake = Math.max(view.shake, 0.04 * (1 - k));
    if (!puffed && k > 0.05) { puffed = true; dust(view, SHIP_AT.x, SHIP_AT.z, 10, 1.6); }
  });
  // nose round to the door, engines swing back, and out through the field toward the planet
  cam(view, [8.5, 5.0, -13.5], [0, 2.5, -2], 3);
  await tl.step(0.9, (k) => { ship.setTilt(ease(k)); ship.setThrust(0.85 + k * 0.15); });
  app.sfx.evac?.();
  const camFrom = view.cine.p.clone(), camTo = new THREE.Vector3(7.5, 3.4, -27);
  await tl.step(3.4, (k) => {
    const e = easeIn(k);
    view.cine.p.lerpVectors(camFrom, camTo, ease(Math.min(1, k * 1.3)));
    ship.root.position.z = SHIP_AT.z - e * 70;
    ship.root.position.y = SHIP_AT.y + 2.4 - easeIn(Math.max(0, (k - 0.45) / 0.55)) * 14;
    ship.body.rotation.x = -0.25 * easeIn(Math.max(0, (k - 0.45) / 0.55));
    view.cine.t.lerp(ship.root.position.clone().setY(ship.root.position.y + 1.4), 0.18);
  });
  tl.done();
}

// ------------------------------------------------------------ back into the hangar
export async function flightIn(app) {
  const view = app.view, c = view.carrier;
  if (!c) return;
  const ship = c.ship, tl = timeline(view);
  tl.arm();
  const rigs = (app.dio?.units || []).map((id) => view.rigs.get(id)).filter(Boolean);
  const spots = rigs.map((r) => r.root.position.clone());
  for (const r of rigs) { r.root.visible = false; r.root.position.set(0, 1.12, SHIP_AT.z + 2.4); }
  ship.setRamp(0); ship.setGear(0); ship.setTilt(1); ship.setThrust(0.9);
  ship.root.position.set(SHIP_AT.x, 9, SHIP_AT.z - 80);
  cam(view, [6.8, 2.2, 10.5], [0, 3.5, -16], 9);
  app.sfx.engine?.();
  // in through the door, slowing, engines swinging down to hover
  await tl.step(3.4, (k) => {
    const e = easeOut(k);
    ship.root.position.z = lerp(SHIP_AT.z - 80, SHIP_AT.z, e);
    ship.root.position.y = lerp(9, 2.3, easeOut(Math.min(1, k * 1.4)));
    ship.body.rotation.x = 0.12 * (1 - k) * Math.sin(k * Math.PI);
    ship.setTilt(1 - ease(Math.max(0, (k - 0.55) / 0.45)));
    ship.setThrust(lerp(0.9, 0.6, k));
    view.cine.t.lerpVectors(new THREE.Vector3(0, 3.5, -16), new THREE.Vector3(0, 1.8, -1), ease(k));
  });
  // set down on the pad
  let puffed = false;
  await tl.step(1.6, (k) => {
    const e = ease(k);
    ship.root.position.y = SHIP_AT.y + 2.3 * (1 - e);
    ship.setGear(Math.min(1, k * 1.8));
    ship.setThrust(lerp(0.6, 0.12, k));
    if (!puffed && k > 0.6) { puffed = true; dust(view, SHIP_AT.x, SHIP_AT.z, 10, 1.4); view.shake = Math.max(view.shake, 0.05); }
  });
  ship.root.position.y = SHIP_AT.y;
  await tl.step(0.8, (k) => { ship.setTilt(ease(k)); ship.setThrust(0.12 * (1 - k)); });
  // ramp down, and the squad walks off to the line
  app.sfx.door?.(true);
  cam(view, [0.4, 1.45, 13.5], [0.2, 1.1, 4.5], 2.2);
  await tl.step(1.1, (k) => ship.setRamp(ease(k)));
  await Promise.all(rigs.map(async (r, i) => {
    await tl.wait(i * 0.35);
    r.root.visible = true;
    const s = spots[i];
    await walk(view, r, [[0, 1.12, SHIP_AT.z + 2.4], [0, 1.12, SHIP_AT.z + 4.1], [0, 0.02, 4.8], [s.x, 0, s.z]], 2.2, tl);
    r.root.position.copy(s);
    r.targetYaw = Math.atan2(-s.x * 0.6, 9);
  }));
  tl.done();
}

// ------------------------------------------------------------ onto the mission map
// The dropship comes in low over the squad's spawn, hovers while they jump down, then climbs away.
export async function dropIn(view, sfx, squad, show) {
  if (!squad.length) return;
  const tl = timeline(view);
  tl.arm();
  const cx = squad.reduce((s, u) => s + u.x, 0) / squad.length, cz = squad.reduce((s, u) => s + u.y, 0) / squad.length;
  const ship = buildDropship();
  // no lights of its own here: a new light would make every material on the map recompile
  ship.bayLight.removeFromParent();
  ship.setRamp(0); ship.setGear(0); ship.setTilt(1); ship.setThrust(0.9);
  view.fxRoot.add(ship.root);
  // it crosses the frame and stops beside the squad, rear door toward them
  const hover = new THREE.Vector3(cx + 5.5, 3.6, cz), from = new THREE.Vector3(cx - 36, 10, cz - 1);
  ship.root.position.copy(from);
  ship.root.rotation.y = -Math.PI / 2;
  view.ships = [...(view.ships || []), ship];
  // watch from inside the map, above the rooftops, looking back at the squad's edge
  // from beyond the squad's edge, high and looking down into the map, so no horizon shows; the ship crosses into frame
  const eye = new THREE.Vector3(cx + 2.5, 15.5, cz + 15);
  const mid = () => ship.root.position.clone().lerp(new THREE.Vector3(cx + 2, 1.2, cz - 1), 0.75);
  view.cine = { p: eye, t: mid(), speed: 3 };
  view.cineCur = { p: view.cine.p.clone(), t: view.cine.t.clone() };
  view.skyOn(true);
  sfx.engine?.();
  await tl.step(2.6, (k) => {
    const e = easeOut(k);
    ship.root.position.lerpVectors(from, hover, e);
    ship.body.rotation.x = 0.18 * (1 - e);
    ship.setTilt(1 - ease(Math.max(0, (k - 0.4) / 0.6)));
    view.cine.t.copy(mid());
  });
  ship.setRamp(0.55);
  sfx.door?.(true);
  // a ring of dust kicked up under the hover
  for (let i = 0; i < 34; i++) {
    const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 2;
    view.puff?.(new THREE.Vector3(hover.x + Math.cos(a) * r, 0.12, hover.z + Math.sin(a) * r), '#9a8f80', 0.6 + Math.random() * 0.9, 1.5, 0.3);
  }
  // they drop from the ramp edge to their tiles, one at a time
  for (const [i, u] of squad.entries()) {
    await tl.wait(i ? 0.22 : 0.3);
    show(u);
    const r = view.rig(u);
    if (!r) continue;
    const y0 = 1.6;
    tl.step(0.32, (k) => { r.root.position.y = y0 * (1 - k * k); if (k >= 1) r.root.position.y = 0; });
    view.puff?.(new THREE.Vector3(u.x, 0.1, u.y), '#9a958c', 0.8, 1.2, 0.3);
  }
  await tl.wait(0.5);
  sfx.evac?.();
  ship.setRamp(0);
  const up = ship.root.position.clone();
  await tl.step(2.0, (k) => {
    const e = easeIn(k);
    ship.root.position.set(up.x + e * 30, up.y + e * 18, up.z - e * 6);
    ship.setTilt(ease(k));
    ship.setThrust(0.9 + k * 0.1);
    ship.body.rotation.x = -0.2 * e;
  });
  tl.done();
  ship.root.removeFromParent();
  view.ships = (view.ships || []).filter((s) => s !== ship);
  for (const u of squad) { const r = view.rig(u); if (r) r.root.position.y = 0; }
}
