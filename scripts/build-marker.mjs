// Generates src/skins/whiteboard/assets/markers.glb. Not part of the app build; to re-run it:
//   npm i --no-save sharp @gltf-transform/core && node scripts/build-marker.mjs src/skins/whiteboard/assets/markers.glb
//
// Photoreal dry-erase markers (black, blue, red), generic and unbranded: a glossy white barrel with a printed
// label, a colored ribbed cap with a pocket clip, a colored end plug, and a felt chisel nib.
// Frame: the nib's tip at the origin, barrel along +Y. Each color is a node with two children:
// "Marker_<Color>_Body" (barrel, plug, nib) and "Marker_<Color>_Cap" (placed capped; the app can post it on the back end).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import fs from 'fs';

const out = process.argv[2] ?? 'markers.glb';
let seed = 4242;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const LEN = 0.1285; // nib tip → end of the plug

// ——— geometry helpers ———
/** Lathe around Y from a [radius, y] profile, with UVs: u around, v = y / LEN (so the label maps by length). */
function lathe(profile, segments = 48) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let a = Math.atan2(x, z) / (Math.PI * 2); if (a < 0) a += 1;
    // u runs the other way round so printing reads correctly from outside; u = 0 faces +Z.
    uv.setXY(i, 1 - uv.getX(i), y / LEN);
  }
  g.computeVertexNormals();
  return g;
}
function smoothNormals(g) {
  g = g.index ? g : mergeVertices(g, 1e-7);
  g.computeVertexNormals();
  return g;
}

// Barrel: a long, very slightly bulged white tube that tapers to the nib collar.
const barrelProfile = [
  [0.0, 0.0044], [0.0024, 0.0044], [0.0028, 0.0047], [0.0034, 0.0058], [0.0045, 0.0085], [0.0056, 0.0118], [0.0063, 0.0148],
  [0.0067, 0.0162], [0.0068, 0.0172], [0.0071, 0.0176], [0.0072, 0.0195], [0.00735, 0.04], [0.0075, 0.07], [0.00735, 0.1],
  [0.0073, 0.1182], [0.0071, 0.1198], [0.0066, 0.1204], [0.0066, 0.121],
];
const barrel = lathe(barrelProfile);
// End plug: colored, rounded off.
const plug = lathe([[0.0062, 0.1205], [0.00655, 0.1212], [0.0066, 0.1262], [0.0061, 0.1274], [0.0045, 0.1282], [0.0, LEN]]);
// Cap: colored, domed front, grip ribs, slightly flared open end that overlaps the barrel.
const capProfile = [[0.0, -0.0042], [0.0028, -0.0039], [0.0052, -0.0029], [0.0068, -0.0012], [0.0077, 0.0012]];
for (let i = 0; i < 9; i++) { const y = 0.0035 + i * 0.0012; capProfile.push([0.0077, y], [0.00805, y + 0.0003], [0.00805, y + 0.0007], [0.0077, y + 0.001]); }
capProfile.push([0.0079, 0.016], [0.0080, 0.027], [0.00815, 0.0292], [0.0081, 0.0302], [0.0074, 0.0305]);
const capBody = lathe(capProfile.map(([r, y]) => [r, y]));
// Pocket clip along the cap.
const clip = new RoundedBoxGeometry(0.0046, 0.0245, 0.0021, 3, 0.0009);
clip.translate(0, 0.0128, 0.0080 + 0.00125);
const clipFoot = new RoundedBoxGeometry(0.0046, 0.0032, 0.0034, 3, 0.0011);
clipFoot.translate(0, 0.0248, 0.0080 + 0.0009);
const capClip = mergeGeometries([clip, clipFoot].map((g) => { g.deleteAttribute('uv'); return smoothNormals(g).toNonIndexed() }).map((g) => {
  const uv = new Float32Array(g.attributes.position.count * 2); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}));
// Felt chisel nib: a short cylinder sliced by a slanted plane.
const nib = new THREE.CylinderGeometry(0.00235, 0.00245, 0.0075, 20, 8);
nib.translate(0, 0.00375, 0);
{
  const p = nib.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), f = (x + 0.0024) * 0.78;
    if (y < f) p.setY(i, f + (rnd() - 0.5) * 0.00006);
  }
  nib.computeVertexNormals();
}

// ——— textures ———
const svgPng = (svg) => sharp(Buffer.from(svg)).png().toBuffer();
const jpg = (buf, w, h, q = 86) => sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
/** Printed label on the barrel: u around (W), v along the length from the tip (H). Text runs along the barrel. */
function labelSvg(name, color) {
  const W = 512, H = 2048, px = (y) => (y / LEN) * H;
  const y0 = px(0.03), y1 = px(0.112);
  // Centered on u = 0, the side facing +Z (same side as the clip), drawn twice so it wraps across the seam.
  const panel = (cx) => `<g transform="translate(${cx},${(y0 + y1) / 2}) rotate(90)">
    <rect x="${-(y1 - y0) / 2}" y="-58" width="${y1 - y0}" height="116" rx="10" fill="${color}"/>
    <text x="${-(y1 - y0) / 2 + 40}" y="16" font-family="Inter" font-weight="800" font-size="62" letter-spacing="3" fill="#ffffff">DRY ERASE</text>
    <text x="${(y1 - y0) / 2 - 40}" y="12" text-anchor="end" font-family="Inter" font-weight="700" font-size="34" letter-spacing="4" fill="#ffffff">${name}</text>
    <text x="${-(y1 - y0) / 2 + 40}" y="96" font-family="Inter" font-weight="600" font-size="26" letter-spacing="5" fill="#55575c">LOW ODOR · CHISEL TIP · NON-TOXIC</text>
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="#f4f4f1"/>
  <rect x="0" y="${px(0.1135)}" width="${W}" height="${px(0.0042)}" fill="${color}"/>
  ${panel(0)}${panel(W)}
</svg>`;
}
/** Subtle molded-plastic micro texture (normal + roughness), shared by every plastic part. */
function plasticMaps(N = 256) {
  const H = new Float32Array(N * N);
  for (let i = 0; i < H.length; i++) H[i] = rnd();
  for (let pass = 0; pass < 3; pass++) { const T = H.slice(); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0; for (let d = -1; d <= 1; d++) s += T[y * N + (x + d + N) % N] + T[((y + d + N) % N) * N + x]; H[y * N + x] = s / 6 } }
  const nor = Buffer.alloc(N * N * 3), mr = Buffer.alloc(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const h = (i, j) => H[((j + N) % N) * N + ((i + N) % N)], k = (y * N + x) * 3;
    const dx = (h(x + 1, y) - h(x - 1, y)) * 0.22, dy = (h(x, y + 1) - h(x, y - 1)) * 0.22, l = Math.hypot(dx, dy, 1);
    nor[k] = clamp((-dx / l * 0.5 + 0.5) * 255); nor[k + 1] = clamp((dy / l * 0.5 + 0.5) * 255); nor[k + 2] = clamp((1 / l * 0.5 + 0.5) * 255);
    mr[k] = 255; mr[k + 1] = clamp(100 + (H[y * N + x] - 0.5) * 24); mr[k + 2] = 0;
  }
  return { nor, mr, N };
}
/** Ink-soaked felt for the nib, in the ink's color. */
function nibMaps(color, N = 128) {
  const c = new THREE.Color(color), alb = Buffer.alloc(N * N * 3), nor = Buffer.alloc(N * N * 3);
  for (let i = 0; i < N * N; i++) {
    const f = 0.62 + rnd() * 0.22;
    alb[i * 3] = clamp(c.r * 255 * f + 6); alb[i * 3 + 1] = clamp(c.g * 255 * f + 6); alb[i * 3 + 2] = clamp(c.b * 255 * f + 6);
    nor[i * 3] = clamp(128 + (rnd() - 0.5) * 70); nor[i * 3 + 1] = clamp(128 + (rnd() - 0.5) * 70); nor[i * 3 + 2] = 240;
  }
  return { alb, nor, N };
}

// ——— glTF ———
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Markers');
const accessors = new Map();
function prim(g, mat) {
  if (!accessors.has(g)) {
    const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
    const a = { p: acc(new Float32Array(g.attributes.position.array), 'VEC3'), n: acc(new Float32Array(g.attributes.normal.array), 'VEC3'), t: acc(new Float32Array(g.attributes.uv.array), 'VEC2'), i: g.index ? acc(new Uint16Array(g.index.array), 'SCALAR') : null };
    accessors.set(g, a);
  }
  const a = accessors.get(g);
  const pr = doc.createPrimitive().setAttribute('POSITION', a.p).setAttribute('NORMAL', a.n).setAttribute('TEXCOORD_0', a.t).setMaterial(mat);
  if (a.i) pr.setIndices(a.i);
  return pr;
}
const tex = async (name, data, mime = 'image/jpeg') => doc.createTexture(name).setImage(data).setMimeType(mime);
const pm = plasticMaps();
const plasticNormal = await tex('Plastic_n', await jpg(pm.nor, pm.N, pm.N, 90));
const plasticRough = await tex('Plastic_orm', await jpg(pm.mr, pm.N, pm.N, 90));

const COLORS = { Black: '#1d1f23', Blue: '#1f4fbf', Red: '#c62828' };
const INK = { Black: '#111214', Blue: '#163f9e', Red: '#b3201c' };
for (const [name, color] of Object.entries(COLORS)) {
  const label = await tex(`Marker_${name}_Label_c`, await sharp(await svgPng(labelSvg(name.toUpperCase(), color))).jpeg({ quality: 86, mozjpeg: true }).toBuffer());
  const white = doc.createMaterial(`Marker_${name}_Barrel`).setBaseColorTexture(label).setNormalTexture(plasticNormal).setMetallicRoughnessTexture(plasticRough).setMetallicFactor(0).setRoughnessFactor(1);
  const cl = new THREE.Color(color);
  const colored = doc.createMaterial(`Marker_${name}_Plastic`).setBaseColorFactor([cl.r, cl.g, cl.b, 1]).setNormalTexture(plasticNormal).setMetallicRoughnessTexture(plasticRough).setMetallicFactor(0).setRoughnessFactor(0.9);
  const nm = nibMaps(INK[name]);
  const felt = doc.createMaterial(`Marker_${name}_Nib`).setBaseColorTexture(await tex(`Marker_${name}_Nib_c`, await jpg(nm.alb, nm.N, nm.N))).setNormalTexture(await tex(`Marker_${name}_Nib_n`, await jpg(nm.nor, nm.N, nm.N))).setMetallicFactor(0).setRoughnessFactor(1);
  const node = doc.createNode(`Marker_${name}`);
  const body = doc.createNode(`Marker_${name}_Body`).setMesh(doc.createMesh(`Marker_${name}_Body`).addPrimitive(prim(barrel, white)).addPrimitive(prim(plug, colored)).addPrimitive(prim(nib, felt)));
  const cap = doc.createNode(`Marker_${name}_Cap`).setMesh(doc.createMesh(`Marker_${name}_Cap`).addPrimitive(prim(capBody, colored)).addPrimitive(prim(capClip, colored)));
  node.addChild(body).addChild(cap);
  scene.addChild(node);
}
await new NodeIO().write(out, doc);
console.log('wrote', out, fs.statSync(out).size, 'bytes');
