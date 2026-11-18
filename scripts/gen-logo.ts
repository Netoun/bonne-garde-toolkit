#!/usr/bin/env bun
/**
 * Writes the Bonne Garde logo into assets/logo/: a sword guard (the T) whose outline draws a B in
 * its hollow and a G cut into the pommel. Every curve is a circle arc with a Fibonacci radius,
 * shown on logo-construction.svg. logo.svg is the cream mark on a sky-blue badge.
 *
 * Usage:
 *   bun run gen:logo
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Point = readonly [number, number];

/** Cream on sky blue: the mark sits on its own badge, so it reads on light and dark pages alike. */
export const LOGO_COLORS = { badge: "#93bee1", mark: "#efe9dc" } as const;

const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const unit = (a: Point): Point => mul(a, 1 / Math.hypot(a[0], a[1]));
const angle = (c: Point, p: Point) => Math.atan2(p[1] - c[1], p[0] - c[0]);

function circleIntersections(c1: Point, r1: number, c2: Point, r2: number): [Point, Point] {
  const d = Math.hypot(...sub(c2, c1));
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(r1 * r1 - a * a);
  const u = unit(sub(c2, c1));
  const m = add(c1, mul(u, a));
  return [add(m, mul([-u[1], u[0]], h)), add(m, mul([u[1], -u[0]], h))];
}

const W = 377;
const H = 254;
const cx = 144; // the axis: 377 = 233 + 144, both ratios are phi
const bar = 34; // guard thickness
const E: Point = [cx, 89]; // right edge of the hilt, touches the top line
const rE = 89;
const F: Point = [cx + 144, bar + 55]; // cove under the right arm, tangent to E: 89 + 55 = 144
const rF = 55;
const upperBowl: Point = [cx, 55]; // B, upper bowl (hollow)
const rU = 21;
const lowerBowl: Point = [cx, 110]; // B, lower bowl (hollow), 34/21 = phi
const rL = 34;
const P: Point = [cx, 199]; // pommel, tangent to the lower bowl
const rP = 55;
const Q: Point = [cx + rP, P[1] - 89]; // opening of the G, its bottom is the G bar
const rQ = 89;
const rV = 21; // counter of the G, centred on the pommel; its top touches the hilt: 199 - 21 = 178
const barTip = circleIntersections(Q, rQ, P, rV).reduce((a, b) => (b[1] > a[1] ? b : a));

/** The outline as one closed SVG path, clockwise from the top of the left tip. */
export function logoPath(): string {
  const d: string[] = [];
  const pt = (p: Point) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
  const L = (p: Point) => d.push(`L${pt(p)}`);
  const arc = (c: Point, r: number, from: Point, to: Point, clockwise: boolean) => {
    const turn = 2 * Math.PI;
    const span = clockwise
      ? (((angle(c, to) - angle(c, from)) % turn) + turn) % turn
      : (((angle(c, from) - angle(c, to)) % turn) + turn) % turn;
    d.push(`A${r} ${r} 0 ${span > Math.PI ? 1 : 0} ${clockwise ? 1 : 0} ${pt(to)}`);
  };

  d.push(`M${pt([21, 0])}`);
  L([W, 0]);
  L([W - 21, bar]); // right tip: same 21:34 slant as the left one
  L([F[0], bar]);
  arc(F, rF, [F[0], bar], [cx + rE, E[1]], false);
  arc(E, rE, [cx + rE, E[1]], [cx, 178], true);
  arc(P, rV, [cx, 178], barTip, false);
  arc(Q, rQ, barTip, [cx + rP, P[1]], false);
  arc(P, rP, [cx + rP, P[1]], [cx, 144], true);
  arc(lowerBowl, rL, [cx, 144], [cx, 76], false);
  arc(upperBowl, rU, [cx, 76], [cx, bar], false);
  L([0, bar]);
  d.push("Z");
  return d.join(" ");
}

/** Every file of assets/logo/, by name. */
export function logoFiles(): Record<string, string> {
  const path = logoPath();
  // A square badge around the mark, rounded with a 110 radius, the mark centred in it.
  const side = 500;
  const x = (W - side) / 2;
  const y = (H - side) / 2;
  const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${side} ${side}" role="img" aria-label="Bonne Garde"><rect x="${x}" y="${y}" width="${side}" height="${side}" rx="110" fill="${LOGO_COLORS.badge}"/><path fill="${LOGO_COLORS.mark}" d="${path}"/></svg>\n`;
  const circles: [Point, number][] = [
    [E, rE],
    [F, rF],
    [upperBowl, rU],
    [lowerBowl, rL],
    [P, rP],
    [Q, rQ],
    [P, rV],
  ];
  const rings = circles
    .map(([c, r]) => `<circle cx="${c[0].toFixed(2)}" cy="${c[1].toFixed(2)}" r="${r}"/>`)
    .join("");
  const guides =
    `<line x1="${cx}" y1="-40" x2="${cx}" y2="${H + 42}"/>` +
    `<line x1="-40" y1="0" x2="${W + 43}" y2="0"/><line x1="-40" y1="${bar}" x2="${W + 43}" y2="${bar}"/>`;
  const construction = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -40 ${W + 80} ${H + 82}">
<rect x="-40" y="-40" width="${W + 80}" height="${H + 82}" fill="#fbfaf7"/>
<path fill="${LOGO_COLORS.badge}" d="${path}"/>
<g fill="none" stroke="#c0392b" stroke-width=".6">${rings}</g>
<g stroke="#2f6fb0" stroke-width=".5" stroke-dasharray="3 3">${guides}</g>
</svg>
`;
  return {
    "logo.svg": badge,
    "logo-construction.svg": construction,
  };
}

if (import.meta.main) {
  const out = resolve(import.meta.dir, "../assets/logo");
  mkdirSync(out, { recursive: true });
  for (const [name, content] of Object.entries(logoFiles())) {
    writeFileSync(join(out, name), content);
  }
  console.log(`✓ ${out} written`);
}
