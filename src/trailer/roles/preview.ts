import { mountChrome } from '../chrome'
import { everyFrame, getState, linesTyped, stage, subscribe } from '../shared'

/**
 * The live preview (localhost:5173): the scene the editor is writing, built up
 * line by line. A grid when the scene exists, the beacon once it's added (its
 * color, pulse and position as those lines land), signals and routes once the
 * handler is wired, and the midnight sky when the scene starts.
 */
export function mountPreview() {
  const { body } = mountChrome('preview', 'Preview — localhost:5173')
  body.innerHTML = `
    <div class="browser">
      <div class="urlbar"><span class="lock">●</span><span id="url">localhost:5173</span><span class="hmr" id="hmr"></span></div>
      <div class="stage"><canvas id="cv"></canvas><div class="empty" id="empty">Waiting for <code>createScene()</code>…</div><div class="deployed" id="deployed" hidden>Deployed to production ✓</div></div>
    </div>`
  const cv = document.getElementById('cv') as HTMLCanvasElement
  const g = cv.getContext('2d')!
  const empty = document.getElementById('empty')!
  const hmr = document.getElementById('hmr')!
  const url = document.getElementById('url')!
  const deployed = document.getElementById('deployed')!
  let hmrTimer = 0

  subscribe((s, prev) => {
    if (s.savedAt && s.savedAt !== prev.savedAt) {
      hmr.textContent = '⟳ hmr update'
      hmr.classList.add('on')
      clearTimeout(hmrTimer)
      hmrTimer = window.setTimeout(() => hmr.classList.remove('on'), 1400)
    }
  })

  // Scene state, eased toward what the code says.
  const sim = {
    beacon: 0, // 0..1 appears
    color: 0, // grey → cyan
    pulse: 0,
    pos: 0, // center → [2, 1, -4]
    night: 0,
    signals: [] as Array<{ x: number; y: number; t: number; found: boolean }>,
    lastSignal: 0,
    follow: 0,
  }
  const stars = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random() * 0.55, r: Math.random() * 1.4 + 0.3, p: Math.random() * 6 }))

  everyFrame(() => {
    const s = getState()
    const L = linesTyped(s)
    const st = stage(s)
    const dpr = Math.min(2, devicePixelRatio || 1)
    const W = cv.clientWidth
    const H = cv.clientHeight
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr)
      cv.height = Math.round(H * dpr)
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const now = performance.now()
    const ease = (cur: number, target: number) => cur + (target - cur) * 0.06
    sim.beacon = ease(sim.beacon, L >= 2 ? 1 : 0)
    sim.color = ease(sim.color, L >= 3 ? 1 : 0)
    sim.pulse = ease(sim.pulse, L >= 4 ? 1 : 0)
    sim.pos = ease(sim.pos, L >= 5 ? 1 : 0)
    sim.follow = ease(sim.follow, L >= 17 ? 1 : 0)
    sim.night = ease(sim.night, L >= 21 ? 1 : 0)
    empty.style.opacity = L >= 1 ? '0' : '1'
    url.textContent = st === 'merged' ? 'workspace.example.dev' : 'localhost:5173'
    deployed.hidden = st !== 'merged'

    // Sky: dusk grey → midnight with stars.
    const sky = g.createLinearGradient(0, 0, 0, H)
    const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`
    sky.addColorStop(0, mix([18, 24, 30], [4, 6, 22], sim.night))
    sky.addColorStop(0.55, mix([28, 36, 44], [12, 18, 48], sim.night))
    sky.addColorStop(1, mix([10, 14, 18], [3, 4, 12], sim.night))
    g.fillStyle = sky
    g.fillRect(0, 0, W, H)
    if (L < 1) return
    for (const st of stars) {
      g.globalAlpha = sim.night * (0.5 + 0.5 * Math.sin(now / 700 + st.p))
      g.fillStyle = '#cfe8ff'
      g.beginPath()
      g.arc(st.x * W, st.y * H, st.r, 0, Math.PI * 2)
      g.fill()
    }
    g.globalAlpha = 1

    // Ground grid in perspective.
    const horizon = H * 0.55
    const vx = W / 2
    g.strokeStyle = `rgba(51,255,102,${0.18 + 0.1 * sim.night})`
    g.lineWidth = 1
    for (let i = -12; i <= 12; i++) {
      g.beginPath()
      g.moveTo(vx + i * W * 0.012, horizon)
      g.lineTo(vx + i * W * 0.16, H)
      g.stroke()
    }
    const scroll = (now / 4000) % 1
    for (let j = 0; j < 14; j++) {
      const z = (j + scroll) / 14
      const y = horizon + (H - horizon) * z * z
      g.globalAlpha = z
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(W, y)
      g.stroke()
    }
    g.globalAlpha = 1

    // Project a scene point (x right, y up, z forward negative) to the screen.
    const proj = (x: number, y: number, z: number) => {
      const d = 6 - z
      const f = (H * 0.9) / d
      return { sx: vx + x * f, sy: horizon + (1.4 - y) * f * 0.6, f }
    }

    // Beacon.
    const home = { x: 0, y: 1, z: 0 }
    const target = { x: 2, y: 1, z: -4 }
    const bx = home.x + (target.x - home.x) * sim.pos
    const bz = home.z + (target.z - home.z) * sim.pos
    let p = proj(bx, home.y, bz)
    // Follow: drift along the route to the latest found signal.
    const found = sim.signals.filter((sg) => sg.found).at(-1)
    if (found && sim.follow > 0.01) {
      const k = Math.min(1, (now - found.t) / 800) * sim.follow
      const ease2 = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
      p = { sx: p.sx + (found.x * W - p.sx) * ease2 * 0.35, sy: p.sy + (found.y * H - p.sy) * ease2 * 0.35, f: p.f }
    }
    if (sim.beacon > 0.01) {
      const c = sim.color
      const col = (a: number) => `rgba(${Math.round(150 - 90 * c)},${Math.round(160 + 80 * c)},${Math.round(170 + 85 * c)},${a})`
      const r = p.f * 0.12 * sim.beacon
      // Pylon and shadow.
      g.fillStyle = 'rgba(0,0,0,0.35)'
      g.beginPath()
      g.ellipse(p.sx, p.sy + p.f * 0.62, r * 1.4, r * 0.35, 0, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = col(0.5 * sim.beacon)
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(p.sx, p.sy + r)
      g.lineTo(p.sx, p.sy + p.f * 0.6)
      g.stroke()
      // Pulse rings (pulse: 0.42 Hz).
      if (sim.pulse > 0.01) {
        for (let i = 0; i < 3; i++) {
          const t = ((now / 1000) * 0.42 + i / 3) % 1
          g.strokeStyle = col((1 - t) * 0.6 * sim.pulse)
          g.lineWidth = 2
          g.beginPath()
          g.arc(p.sx, p.sy, r * (1 + t * 3.5), 0, Math.PI * 2)
          g.stroke()
        }
      }
      const glow = g.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r * 4)
      glow.addColorStop(0, col(0.55 * sim.beacon))
      glow.addColorStop(1, col(0))
      g.fillStyle = glow
      g.beginPath()
      g.arc(p.sx, p.sy, r * 4, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = col(sim.beacon)
      g.beginPath()
      g.arc(p.sx, p.sy, r, 0, Math.PI * 2)
      g.fill()
    }

    // Signals: once the handler is registered, pings arrive and the beacon finds a quiet route to them.
    if (L >= 20 && now - sim.lastSignal > 2600) {
      sim.lastSignal = now
      sim.signals.push({ x: 0.12 + Math.random() * 0.76, y: 0.62 + Math.random() * 0.3, t: now, found: false })
      sim.signals = sim.signals.slice(-6)
    }
    for (const sg of sim.signals) {
      const age = (now - sg.t) / 1000
      if (age > 0.6 && !sg.found && L >= 12) sg.found = true
      const x = sg.x * W
      const y = sg.y * H
      g.strokeStyle = `rgba(255,211,79,${Math.max(0, 1 - age / 3)})`
      g.lineWidth = 2
      g.beginPath()
      g.arc(x, y, 6 + age * 26, 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = `rgba(255,211,79,${Math.max(0, 1 - age / 4)})`
      g.beginPath()
      g.arc(x, y, 4, 0, Math.PI * 2)
      g.fill()
      if (sg.found && sim.beacon > 0.5) {
        // The quiet route: a dashed curve from the beacon to the signal.
        g.setLineDash([6, 8])
        g.lineDashOffset = -now / 40
        g.strokeStyle = `rgba(51,255,102,${Math.max(0, 0.8 - age / 5)})`
        g.beginPath()
        g.moveTo(p.sx, p.sy)
        g.quadraticCurveTo((p.sx + x) / 2, Math.min(p.sy, y) - 60, x, y)
        g.stroke()
        g.setLineDash([])
      }
    }

    // A small HUD, like a dev overlay.
    g.font = '12px ui-monospace, monospace'
    g.fillStyle = 'rgba(51,255,102,0.7)'
    g.fillText(`fps 60 · lines ${L} · ${sim.signals.filter((x) => x.found).length} routes`, 14, H - 14)
  })
}
