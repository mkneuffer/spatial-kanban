import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSettings } from '../data/settings'
import { ParticleSystem, Shape } from '../render/particles'
import { playSound } from '../fx/audio'
import { useBoardRuntime } from './runtime'

/**
 * Board effects (PLAN §7): short, physical flourishes on top of the spring
 * motion — a ripple where a card lands, dust when a note is peeled, confetti
 * when a card reaches the last column, a puff at the bin, a scan sweep when the
 * board appears. Everything is in board-local space, so effects tilt and move
 * with the board. Off under reduced motion.
 */

export interface BoardFX {
  /** Card landed at (x, y) board-local. `size` ≈ card width. */
  land(x: number, y: number, size: number, color: string): void
  /** Card picked up / peeled off. */
  lift(x: number, y: number, size: number, color: string): void
  /** Card reached the last ("done") column. */
  celebrate(x: number, y: number, size: number): void
  /** Card dropped in the bin. */
  archive(x: number, y: number, size: number): void
  /** New card pulled from the pad. */
  spawn(x: number, y: number, size: number): void
  /** Light sweep across the whole board (entrance, skin switch). */
  sweep(width: number, height: number, color?: string): void
}

const CONFETTI = ['#ff5a5f', '#ffb400', '#3ec300', '#00a6ed', '#7b61ff', '#ff7ab6', '#ffd23f']


export function createBoardFX(sys: ParticleSystem): BoardFX {
  const enabled = () => !useSettings.getState().reducedMotion
  const rnd = (a: number, b: number) => a + Math.random() * (b - a)
  return {
    land(x, y, size, color) {
      if (!enabled()) return
      sys.emit({ x, y, z: 0.0022, size: size * 0.9, grow: 1.9, life: 0.55, color, alpha: 0.55, shape: Shape.Ring })
      sys.emit({ x, y, z: 0.0021, size: size * 0.7, grow: 2.4, life: 0.7, delay: 0.08, color, alpha: 0.28, shape: Shape.Ring })
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + rnd(-0.2, 0.2)
        const sp = rnd(0.12, 0.3) * Math.max(0.5, size / 0.12)
        sys.emit({
          x: x + Math.cos(a) * size * 0.45,
          y: y + Math.sin(a) * size * 0.45,
          z: 0.003,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          vz: rnd(0.02, 0.06),
          drag: 5,
          size: size * rnd(0.06, 0.12),
          grow: 0.4,
          life: rnd(0.35, 0.6),
          color: '#8b8f96',
          alpha: 0.45,
          shape: Shape.Dot,
        })
      }
    },
    lift(x, y, size, color) {
      if (!enabled()) return
      sys.emit({ x, y, z: 0.002, size: size * 1.1, grow: 1.35, life: 0.35, color, alpha: 0.35, shape: Shape.Ring })
      for (let i = 0; i < 5; i++) {
        sys.emit({
          x: x + rnd(-0.5, 0.5) * size,
          y: y - size * 0.5,
          z: 0.004,
          vx: rnd(-0.05, 0.05),
          vy: rnd(-0.02, 0.04),
          vz: rnd(0.04, 0.1),
          drag: 3,
          size: size * rnd(0.05, 0.08),
          grow: 0.5,
          life: rnd(0.4, 0.7),
          color: '#b9bec6',
          alpha: 0.5,
          shape: Shape.Dot,
        })
      }
    },
    celebrate(x, y, size) {
      if (!enabled()) return
      playSound('chime')
      const k = Math.max(0.5, size / 0.12)
      for (let i = 0; i < 44; i++) {
        const a = rnd(Math.PI * 0.15, Math.PI * 0.85)
        const sp = rnd(0.35, 0.8) * k
        sys.emit({
          x: x + rnd(-0.3, 0.3) * size,
          y: y + rnd(-0.1, 0.3) * size,
          z: rnd(0.01, 0.03),
          vx: Math.cos(a) * sp * 0.9,
          vy: Math.sin(a) * sp,
          vz: rnd(0.02, 0.12),
          gravity: 1.2 * k,
          drag: 1.6,
          size: size * rnd(0.07, 0.11),
          aspect: rnd(0.4, 0.8),
          rot: rnd(0, Math.PI),
          spin: rnd(-9, 9),
          flip: rnd(6, 14),
          life: rnd(1.1, 1.7),
          color: CONFETTI[i % CONFETTI.length],
          alpha: 0.95,
          shape: Shape.Square,
        })
      }
      for (let i = 0; i < 6; i++) {
        sys.emit({
          x: x + rnd(-0.6, 0.6) * size,
          y: y + rnd(-0.5, 0.6) * size,
          z: 0.02,
          size: size * rnd(0.18, 0.3),
          grow: 1.4,
          spin: rnd(-2, 2),
          life: rnd(0.5, 0.8),
          delay: rnd(0, 0.35),
          color: '#ffc83d',
          alpha: 0.9,
          shape: Shape.Star,
        })
      }
      sys.emit({ x, y, z: 0.0025, size: size * 1.1, grow: 2.6, life: 0.8, color: '#3ec300', alpha: 0.4, shape: Shape.Ring })
    },
    archive(x, y, size) {
      if (!enabled()) return
      for (let i = 0; i < 16; i++) {
        const a = rnd(0, Math.PI * 2)
        const sp = rnd(0.08, 0.22) * Math.max(0.5, size / 0.12)
        sys.emit({
          x,
          y,
          z: 0.006,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp + 0.05,
          vz: rnd(0.02, 0.08),
          drag: 3.5,
          size: size * rnd(0.12, 0.22),
          grow: 1.6,
          life: rnd(0.45, 0.8),
          delay: 0.3,
          color: '#9aa0a6',
          alpha: 0.35,
          shape: Shape.Dot,
        })
      }
      sys.emit({ x, y, z: 0.0025, size: size * 0.8, grow: 2, life: 0.5, delay: 0.32, color: '#c62828', alpha: 0.35, shape: Shape.Ring })
    },
    spawn(x, y, size) {
      if (!enabled()) return
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2
        sys.emit({
          x: x + Math.cos(a) * size * 0.55,
          y: y + Math.sin(a) * size * 0.55,
          z: 0.02,
          vx: Math.cos(a) * 0.08,
          vy: Math.sin(a) * 0.08,
          drag: 4,
          size: size * rnd(0.14, 0.22),
          spin: rnd(-3, 3),
          life: rnd(0.4, 0.6),
          color: '#ffc83d',
          alpha: 0.9,
          shape: Shape.Star,
        })
      }
    },
    sweep(width, height, color = '#4f8cff') {
      if (!enabled()) return
      const h = Math.max(0.06, height * 0.16)
      const speed = (height + h) / 0.9
      sys.emit({ x: 0, y: height / 2 + h / 2, z: 0.03, vy: -speed, size: h, aspect: width / h, life: 0.9, color, alpha: 0.22, shape: Shape.Band })
      sys.emit({ x: 0, y: height / 2 + h / 2, z: 0.031, vy: -speed, size: h * 0.18, aspect: (width / h) * (1 / 0.18), life: 0.9, color: '#ffffff', alpha: 0.5, shape: Shape.Band })
    },
  }
}

/** Renders and steps the board's particle system; exposes its presets on the runtime. */
export function BoardEffects() {
  const runtime = useBoardRuntime()
  const sys = useMemo(() => new ParticleSystem(), [])
  const fx = useMemo(() => createBoardFX(sys), [sys])
  const swept = useRef(false)
  useEffect(() => {
    const prev = runtime.fx
    runtime.fx = fx
    return () => {
      runtime.fx = prev
      sys.dispose()
    }
  }, [runtime, fx, sys])
  useFrame((_, dt) => {
    // Entrance: one scan sweep once the board has a size.
    if (!swept.current && runtime.root) {
      swept.current = true
      fx.sweep(runtime.size[0], runtime.size[1])
    }
    sys.update(dt, runtime.opacity)
  })
  return <primitive object={sys.mesh} />
}
