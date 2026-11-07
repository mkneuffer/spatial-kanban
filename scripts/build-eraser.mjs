// Generates src/skins/whiteboard/assets/eraser.glb. Not part of the app build; to re-run it:
//   npm i --no-save sharp @gltf-transform/core && node scripts/build-eraser.mjs src/skins/whiteboard/assets/eraser.glb
//
// Builds a photoreal dry-erase eraser (gray EPS foam block, raised rim around a recessed top, white felt pad)
// as a self-contained GLB with baked textures. Frame: felt face at z = 0 facing -Z, block up +Z, long side along X.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import fs from 'fs';

const out = process.argv[2] ?? 'eraser.glb';
const L = 0.13, W = 0.05, FELT = 0.0062, BODY = 0.0235, RIM = 0.0032;
const TILE = 0.04; // texture repeat in meters (foam), felt uses 0.03

// ——— seeded random ———
let seed = 1337;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ——— foam: tileable Voronoi beads (expanded polystyrene) ———
// Beads are pillows: height rises with the distance to the cell edge, so every bead is a soft rounded
// mound that follows its own irregular outline. The lookup is domain-warped so no edge is straight.
function foamMaps(N = 1024, cells = 13) {
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push({ x: (i + 0.1 + rnd() * 0.8) / cells, y: (j + 0.1 + rnd() * 0.8) / cells, tone: rnd(), h: 0.8 + rnd() * 0.4 });
  const H = new Float32Array(N * N), C = new Float32Array(N * N), R = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let u = x / N, v = y / N;
    // Domain warp (tileable): wobble the lookup so bead outlines are irregular.
    const wu = (vnoise(u * 12, v * 12, 12, 21) - 0.5) * 0.022 + (vnoise(u * 36, v * 36, 36, 23) - 0.5) * 0.006;
    const wv = (vnoise(u * 12, v * 12, 12, 22) - 0.5) * 0.022 + (vnoise(u * 36, v * 36, 36, 24) - 0.5) * 0.006;
    u += wu; v += wv;
    const ci = Math.floor(u * cells), cj = Math.floor(v * cells);
    let f1 = 9, f2 = 9, best = null, second = null;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const gi = ci + di, gj = cj + dj;
      const ii = ((gi % cells) + cells) % cells, jj = ((gj % cells) + cells) % cells;
      const p = pts[jj * cells + ii];
      const px = p.x + (gi - ii) / cells, py = p.y + (gj - jj) / cells;
      const d = Math.hypot(u - px, v - py) * cells;
      if (d < f1) { f2 = f1; second = best; f1 = d; best = p } else if (d < f2) { f2 = d; second = p }
    }
    const edge = (f2 - f1) * 0.5; // ~distance to the boundary, in cell units
    const pillow = Math.pow(smooth(0, 0.42, edge), 0.7) * best.h;
    // Seams: most beads are fused (a shallow groove); here and there they part into a dark crack.
    const open = vnoise(u * 9, v * 9, 9, 3);
    const groove = 1 - smooth(0, 0.05, edge);
    const crack = (1 - smooth(0, 0.016 + 0.014 * open, edge)) * smooth(0.5, 0.8, open);
    const grain = vnoise(x / N * 160, y / N * 160, 160, 5) - 0.5;
    const k = y * N + x;
    H[k] = pillow * 0.55 - groove * 0.1 - crack * 0.25 + grain * 0.05;
    C[k] = best.tone * 0.5 + (second?.tone ?? 0.5) * groove * 0.15 + vnoise(u * 5, v * 5, 5, 9) * 0.35 + grain * 0.4;
    R[k] = crack + groove * 0.3;
  }
  const alb = Buffer.alloc(N * N * 3), mr = Buffer.alloc(N * N * 3), nor = Buffer.alloc(N * N * 3);
  for (let i = 0; i < N * N; i++) {
    const speck = (rnd() - 0.5) * 6;
    // Bead tops catch a little more light-gray pigment; seams collect grime.
    const base = 90 + (C[i] - 0.45) * 30 + H[i] * 28 - R[i] * 30 + speck;
    alb[i * 3] = clamp(base + 2); alb[i * 3 + 1] = clamp(base + 1); alb[i * 3 + 2] = clamp(base - 1);
    mr[i * 3] = 255; mr[i * 3 + 1] = clamp(150 + R[i] * 90 - H[i] * 40 + speck * 2); mr[i * 3 + 2] = 0;
  }
  normalFrom(H, N, 5.5, nor);
  return { alb, mr, nor, N };
}

// ——— felt: tileable fibers ———
function feltMaps(N = 512) {
  const H = new Float32Array(N * N);
  for (let f = 0; f < 11000; f++) {
    let x = rnd() * N, y = rnd() * N; const a = rnd() * Math.PI * 2, len = 6 + rnd() * 26, w = 0.35 + rnd() * 0.5;
    const dx = Math.cos(a), dy = Math.sin(a); let cur = (rnd() - 0.5) * 0.08;
    let ang = a;
    for (let s = 0; s < len; s++) {
      ang += cur; x += Math.cos(ang); y += Math.sin(ang);
      const xi = ((Math.round(x) % N) + N) % N, yi = ((Math.round(y) % N) + N) % N;
      H[yi * N + xi] += w;
    }
    void dx; void dy;
  }
  blur(H, N, 1);
  let m = 0; for (const v of H) m = Math.max(m, v);
  for (let i = 0; i < H.length; i++) H[i] = Math.min(1, H[i] / (m * 0.55));
  const alb = Buffer.alloc(N * N * 3), mr = Buffer.alloc(N * N * 3), nor = Buffer.alloc(N * N * 3);
  for (let i = 0; i < N * N; i++) {
    // Gray felt, a little warm, fibers catching lighter.
    const b = 112 + H[i] * 44 + (rnd() - 0.5) * 12;
    alb[i * 3] = clamp(b + 2); alb[i * 3 + 1] = clamp(b + 1); alb[i * 3 + 2] = clamp(b - 2);
    mr[i * 3] = 255; mr[i * 3 + 1] = clamp(235 + (rnd() - 0.5) * 20); mr[i * 3 + 2] = 0;
  }
  normalFrom(H, N, 4.5, nor);
  return { alb, mr, nor, N, fib: H };
}

// Tileable smooth value noise in [0, 1] (period 1 in u, v once scaled by an integer).
const lattice = new Float32Array(64 * 64).map(() => rnd());
function vnoise(x, y, period, salt) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const g = (i, j) => lattice[(((i % period) + period) % period + salt * 7) % 64 * 64 + ((((j % period) + period) % period + salt * 13) % 64)];
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return (g(xi, yi) * (1 - sx) + g(xi + 1, yi) * sx) * (1 - sy) + (g(xi, yi + 1) * (1 - sx) + g(xi + 1, yi + 1) * sx) * sy;
}
function mottle(x, y, salt) {
  const p = Math.round(x / (x || 1) ) ; void p;
  return (vnoise(x, y, 6, salt) * 0.55 + vnoise(x * 2, y * 2, 12, salt + 1) * 0.3 + vnoise(x * 4, y * 4, 24, salt + 2) * 0.15);
}

function blur(H, N, r) {
  const T = new Float32Array(H.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0; for (let d = -r; d <= r; d++) s += pass === 0 ? H[y * N + (x + d + N) % N] : H[((y + d + N) % N) * N + x];
      T[y * N + x] = s / (2 * r + 1);
    }
    H.set(T);
  }
}
function normalFrom(H, N, strength, out) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const h = (i, j) => H[((j + N) % N) * N + ((i + N) % N)];
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), k = (y * N + x) * 3;
    out[k] = clamp((-dx / l * 0.5 + 0.5) * 255); out[k + 1] = clamp((dy / l * 0.5 + 0.5) * 255); out[k + 2] = clamp((1 / l * 0.5 + 0.5) * 255);
  }
}
function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))) }
const jpg = (buf, N, q = 90) => sharp(buf, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: q, mozjpeg: true }).toBuffer();

// ——— geometry ———
function triplanar(g, tile) {
  // Smooth normals across the rounded edges (weld, then average), kept when the triangles are split for UVs.
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-6);
  g.computeVertexNormals();
  g = g.toNonIndexed();
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = [a, b, c][k];
      let s, t;
      if (az >= ax && az >= ay) { s = v.x; t = v.y } else if (ax >= ay) { s = v.y; t = v.z } else { s = v.x; t = v.z }
      uv[(i + k) * 2] = s / tile + 0.37; uv[(i + k) * 2 + 1] = t / tile + 0.11;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
// Foam block, one piece: an outer wall extruded to full height with rounded edges (bevels), whose hole is
// the recessed top panel; the panel is a lower slab inside it. The sides roll straight up into the rim.
const z0 = FELT - 0.0006, Htot = BODY + RIM, bev = 0.0035, rimW = 0.0062, panelDrop = RIM;
const outerW = L - 2 * bev, outerH = W - 2 * bev;
const wall = roundedRect(outerW, outerH, 0.004);
// The hole shrinks by the bevel too, so cut it bevel wider than the rim's inner edge.
wall.holes.push(roundedRect(L - 2 * rimW + 2 * 0.0012, W - 2 * rimW + 2 * 0.0012, 0.003));
const wallGeo = new THREE.ExtrudeGeometry(wall, { depth: Htot - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 6, curveSegments: 12 });
// Hole walls get a smaller bevel than the outside in reality; ExtrudeGeometry uses one, so keep it modest.
wallGeo.translate(0, 0, z0 + bev);
const panel = new THREE.ExtrudeGeometry(roundedRect(L - 2 * rimW + 0.004, W - 2 * rimW + 0.004, 0.004), { depth: Htot - panelDrop - 0.001, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 2, curveSegments: 12 });
panel.translate(0, 0, z0 + 0.0008);
const foam = mergeGeometries([wallGeo, panel].map((g) => triplanar(g, TILE)));
const top = z0 + Htot;
// Felt pad, a hair smaller than the block, squared-off and soft-edged.
const felt = triplanar(new RoundedBoxGeometry(L - 0.0022, W - 0.0022, FELT, 3, 0.0016).translate(0, 0, FELT / 2), 0.03);
console.log('total height', top.toFixed(4));

// ——— glTF ———
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Eraser');
const root = doc.createNode('Eraser');
scene.addChild(root);
async function material(name, maps) {
  const t = async (suffix, data) => doc.createTexture(name + suffix).setImage(await jpg(data, maps.N, suffix === '_n' ? 86 : 80)).setMimeType('image/jpeg');
  return doc.createMaterial(name).setBaseColorTexture(await t('_c', maps.alb)).setNormalTexture(await t('_n', maps.nor)).setMetallicRoughnessTexture(await t('_orm', maps.mr)).setMetallicFactor(0).setRoughnessFactor(1);
}
function addMesh(name, g, mat) {
  const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', acc(new Float32Array(g.attributes.position.array), 'VEC3')).setAttribute('NORMAL', acc(new Float32Array(g.attributes.normal.array), 'VEC3')).setAttribute('TEXCOORD_0', acc(new Float32Array(g.attributes.uv.array), 'VEC2')).setMaterial(mat);
  root.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
}
addMesh('Eraser_Foam', foam, await material('Eraser_Foam', foamMaps()));
const feltM = feltMaps();
const feltMat = await material('Eraser_Felt', feltM);
addMesh('Eraser_Felt', felt, feltMat);
// Fuzz: two thin shells around the pad that show only the fibers (alpha-tested), so its edges look soft, not molded.
const alpha = Buffer.alloc(feltM.N * feltM.N * 4);
for (let i = 0; i < feltM.N * feltM.N; i++) {
  alpha[i * 4] = feltM.alb[i * 3]; alpha[i * 4 + 1] = feltM.alb[i * 3 + 1]; alpha[i * 4 + 2] = feltM.alb[i * 3 + 2];
  alpha[i * 4 + 3] = clamp((feltM.fib[i] - 0.42) * 600);
}
const fuzzTex = doc.createTexture('Eraser_Fuzz_c').setImage(await sharp(alpha, { raw: { width: feltM.N, height: feltM.N, channels: 4 } }).png({ compressionLevel: 9, palette: false }).toBuffer()).setMimeType('image/png');
const fuzz = doc.createMaterial('Eraser_Fuzz').setBaseColorTexture(fuzzTex).setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(1);
for (const [i, grow] of [[1, 0.00045], [2, 0.0009]]) {
  const shell = triplanar(new RoundedBoxGeometry(L - 0.0022 + 2 * grow, W - 0.0022 + 2 * grow, FELT - 0.0012 + grow, 3, 0.0016 + grow).translate(0, 0, (FELT - 0.0012 + grow) / 2 - grow * 0.2), 0.03 * (1 + i * 0.13));
  addMesh('Eraser_Fuzz' + i, shell, fuzz);
}
await new NodeIO().write(out, doc);
console.log('wrote', out, fs.statSync(out).size, 'bytes');
