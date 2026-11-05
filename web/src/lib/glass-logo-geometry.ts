/**
 * Builds the Godot head as one smooth, rounded glass solid.
 *
 * A plain extrusion gives a flat slab, and a flat face reflects the room as one dull
 * plane. Glass reads as glass when its surfaces curve and catch long highlights, so
 * the solid is defined by a signed distance field instead:
 *
 * 1. Draw the logo outline flat, with the eyes, nose and mouth cut out as holes.
 * 2. Turn that picture into a 2D distance field (how far each point is from the edge).
 * 3. Grow it into 3D as a slab whose edges are rounded off and whose faces bulge a
 *    little in the middle, like a pebble.
 * 4. Mesh the surface with marching cubes, taking normals from the field so the
 *    rims stay smooth.
 *
 * Distances are in logo units (the logo is 1024 wide).
 */
import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GODOT_LOGO as L } from "@/lib/godot-logo";

const RASTER = 1024; // 2D field resolution: one pixel per logo unit
const GRID = 112; // marching cubes cells per side
const SPAN = 1040; // logo units covered by the grid
const CENTER = { x: 512, y: 491 }; // middle of the logo's bounding box

const HALF_THICKNESS = 92; // at the edges
const BULGE = 38; // extra half-thickness towards the middle of wide areas
const BULGE_WIDTH = 170; // how far in from the edge the bulge reaches full height
const ROUNDING = 64; // radius of the rounded edges
const CORNER_SOFTENING = 9; // blur radius for the outline's corners
const BULGE_SMOOTHING = 28; // blur radius for the bulge

/** 1 where the logo is solid glass, 0 elsewhere (including the eye/nose holes). */
function rasterize() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = RASTER;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fill(new Path2D(L.body));
  ctx.globalCompositeOperation = "destination-out";
  for (const e of L.eyes) {
    ctx.beginPath();
    ctx.arc(e.cx, e.cy, e.r * 0.86, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fill(new Path2D(L.nose));
  const { data } = ctx.getImageData(0, 0, RASTER, RASTER);
  const inside = new Uint8Array(RASTER * RASTER);
  for (let i = 0; i < inside.length; i++) inside[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return inside;
}

/** Felzenszwalb's 1D squared distance transform, in place on f[0..n). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
  for (let q = 0; q < n; q++) f[q] = d[q];
}

/** Distance from every pixel to the nearest pixel where `target` is 1. */
function distanceTo(mask: Uint8Array, target: 0 | 1) {
  const n = RASTER;
  const g = new Float64Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = mask[i] === target ? 0 : 1e20;
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) f[y] = g[y * n + x];
    edt1d(f, n, d, v, z);
    for (let y = 0; y < n; y++) g[y * n + x] = f[y];
  }
  for (let y = 0; y < n; y++) {
    const row = g.subarray(y * n, y * n + n);
    f.set(row);
    edt1d(f, n, d, v, z);
    row.set(f);
  }
  for (let i = 0; i < g.length; i++) g[i] = Math.sqrt(g[i]);
  return g;
}

/** Signed distance to the outline: negative inside the glass. */
function signedDistance2D() {
  const mask = rasterize();
  const toInside = distanceTo(mask, 1);
  const toOutside = distanceTo(mask, 0);
  const sdf = new Float32Array(mask.length);
  for (let i = 0; i < sdf.length; i++) sdf[i] = mask[i] ? 0.5 - toOutside[i] : toInside[i] - 0.5;
  // Blurring the distances rounds off the outline's sharp corners, which would
  // otherwise show as creases running across the rounded edges.
  for (let pass = 0; pass < 3; pass++) boxBlur(sdf, CORNER_SOFTENING);
  return sdf;
}

/**
 * How far each point is from the edge, heavily smoothed. Raw distances crease along
 * the middle of every limb, and a bulge built from them shows those creases.
 */
function bulgeField(sdf: Float32Array) {
  const soft = sdf.slice();
  for (let pass = 0; pass < 3; pass++) boxBlur(soft, BULGE_SMOOTHING);
  return soft;
}

/** Separable box blur of a RASTER x RASTER field with the given radius, in place. */
function boxBlur(f: Float32Array, radius: number) {
  const n = RASTER;
  const tmp = new Float32Array(n);
  const w = 2 * radius + 1;
  for (const horizontal of [true, false]) {
    for (let a = 0; a < n; a++) {
      const at = (b: number) => {
        b = Math.min(Math.max(b, 0), n - 1);
        return horizontal ? f[a * n + b] : f[b * n + a];
      };
      let sum = 0;
      for (let b = -radius; b <= radius; b++) sum += at(b);
      for (let b = 0; b < n; b++) {
        tmp[b] = sum / w;
        sum += at(b + radius + 1) - at(b - radius);
      }
      for (let b = 0; b < n; b++) {
        if (horizontal) f[a * n + b] = tmp[b];
        else f[b * n + a] = tmp[b];
      }
    }
  }
}

function sample(sdf: Float32Array, x: number, y: number) {
  const n = RASTER;
  x = Math.min(Math.max(x, 0), n - 1.001);
  y = Math.min(Math.max(y, 0), n - 1.001);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const i = y0 * n + x0;
  const top = sdf[i] * (1 - tx) + sdf[i + 1] * tx;
  const bottom = sdf[i + n] * (1 - tx) + sdf[i + n + 1] * tx;
  return top * (1 - ty) + bottom * ty;
}

const smoothstep = (t: number) => {
  t = Math.min(Math.max(t, 0), 1);
  return t * t * (3 - 2 * t);
};

/** The logo as a rounded glass solid, centred on the origin, in logo units / 512. */
export function buildGlassLogoGeometry() {
  const sdf = signedDistance2D();
  const soft = bulgeField(sdf);
  const mc = new MarchingCubes(GRID, new THREE.MeshBasicMaterial(), false, false, 200_000);
  mc.isolation = 0;
  const cell = SPAN / GRID;
  const toLogo = (i: number) => ((i - GRID / 2) / (GRID / 2)) * (SPAN / 2);

  // The 2D distance and thickness depend only on x and y: work them out once per column.
  const d2 = new Float32Array(GRID * GRID);
  const half = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      // Grid y points up, the logo's y points down.
      const lx = CENTER.x + toLogo(x);
      const ly = CENTER.y - toLogo(y);
      d2[y * GRID + x] = sample(sdf, lx, ly);
      half[y * GRID + x] = HALF_THICKNESS + BULGE * smoothstep(-sample(soft, lx, ly) / BULGE_WIDTH);
    }
  }

  // Rounded-slab distance; the field is its negative, so it is positive inside.
  const r = ROUNDING;
  for (let z = 0; z < GRID; z++) {
    const zl = Math.abs(toLogo(z));
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const c = y * GRID + x;
        const qx = d2[c] + r;
        const qy = zl - half[c] + r;
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
        const inside = Math.min(Math.max(qx, qy), 0);
        mc.field[z * GRID * GRID + c] = -(outside + inside - r) / cell;
      }
    }
  }
  mc.update();

  const count = mc.count;
  const position = mc.positionArray.slice(0, count * 3);
  const normal = mc.normalArray.slice(0, count * 3);
  for (let i = 0; i < normal.length; i += 3) {
    const len = Math.hypot(normal[i], normal[i + 1], normal[i + 2]) || 1;
    normal[i] /= len;
    normal[i + 1] /= len;
    normal[i + 2] /= len;
  }
  mc.geometry.dispose();

  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry = mergeVertices(geometry, 1e-5);
  // Marching cubes positions run from -1 to 1 across the grid: scale to logo units / 512.
  geometry.scale(SPAN / 1024, SPAN / 1024, SPAN / 1024);
  geometry.computeBoundingSphere();
  return geometry;
}
