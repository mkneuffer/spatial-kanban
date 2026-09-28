import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { Shape, ShapeGeometry, type Group, type Mesh } from 'three'
import { FONTS } from '../../render/fonts'
import { playSound } from '../../fx/audio'
import { pulse } from '../../fx/haptics'
import { gamepadOf, type XPointerEvent } from '../../board/BoardInteraction'

/** Colors for in-XR UI panels (dark glass over passthrough). */
export const UI = {
  panel: '#0f141b',
  panelBorder: '#2b3440',
  button: '#1d2530',
  buttonHover: '#2a3544',
  buttonActive: '#2f81f7',
  text: '#e8edf3',
  muted: '#b1bac5',
  accent: '#4493f8',
  danger: '#f85149',
  success: '#3fb950',
  warn: '#d29922',
}

const shapeCache = new Map<string, ShapeGeometry>()

export function roundedRectGeometry(w: number, h: number, r: number): ShapeGeometry {
  const key = `${w.toFixed(4)}:${h.toFixed(4)}:${r.toFixed(4)}`
  let g = shapeCache.get(key)
  if (g) return g
  const rr = Math.min(r, w / 2, h / 2)
  const s = new Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + rr, y)
  s.lineTo(x + w - rr, y)
  s.quadraticCurveTo(x + w, y, x + w, y + rr)
  s.lineTo(x + w, y + h - rr)
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  s.lineTo(x + rr, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - rr)
  s.lineTo(x, y + rr)
  s.quadraticCurveTo(x, y, x + rr, y)
  g = new ShapeGeometry(s, 6)
  shapeCache.set(key, g)
  return g
}

export function Panel({
  width,
  height,
  radius = 0.02,
  color = UI.panel,
  opacity = 0.96,
  border = UI.panelBorder,
  children,
  position,
  interactive = true,
}: {
  width: number
  height: number
  radius?: number
  color?: string
  opacity?: number
  border?: string | null
  children?: ReactNode
  position?: [number, number, number]
  interactive?: boolean
}) {
  return (
    <group position={position}>
      {border && (
        <mesh geometry={roundedRectGeometry(width + 0.004, height + 0.004, radius + 0.002)} position={[0, 0, -0.0008]} raycast={() => {}}>
          <meshBasicMaterial color={border} transparent opacity={opacity} depthWrite={false} />
        </mesh>
      )}
      {/* The panel swallows pointer events so rays don't fall through to the board. */}
      <mesh
        geometry={roundedRectGeometry(width, height, radius)}
        onPointerDown={interactive ? (e) => e.stopPropagation() : undefined}
        raycast={interactive ? undefined : () => {}}
      >
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
      <group position={[0, 0, 0.001]}>{children}</group>
    </group>
  )
}

export function Label({
  children,
  size = 0.022,
  color = UI.text,
  weight = 500,
  anchorX = 'center',
  anchorY = 'middle',
  maxWidth,
  position,
  lineHeight,
  font,
}: {
  children: string
  size?: number
  color?: string
  weight?: 400 | 500 | 600 | 700
  anchorX?: 'left' | 'center' | 'right'
  anchorY?: 'top' | 'middle' | 'bottom'
  maxWidth?: number
  position?: [number, number, number]
  lineHeight?: number
  font?: string
}) {
  const f = font ?? (weight >= 700 ? FONTS.inter700 : weight >= 600 ? FONTS.inter600 : weight >= 500 ? FONTS.inter500 : FONTS.inter400)
  return (
    <Text
      font={f}
      fontSize={size}
      color={color}
      anchorX={anchorX}
      anchorY={anchorY}
      maxWidth={maxWidth}
      position={position}
      lineHeight={lineHeight}
      raycast={() => null}
      sdfGlyphSize={64}
    >
      {children}
    </Text>
  )
}

export interface ButtonProps {
  label: string
  sublabel?: string
  width?: number
  height?: number
  onClick: () => void
  active?: boolean
  disabled?: boolean
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  fontSize?: number
  position?: [number, number, number]
  icon?: ReactNode
  ariaLabel?: string
}

/** A pressable 3D button: hover highlight, press depth, click sound and haptic tick. */
export function Button3D({
  label,
  sublabel,
  width = 0.16,
  height = 0.05,
  onClick,
  active,
  disabled,
  variant = 'default',
  fontSize,
  position,
  icon,
}: ButtonProps) {
  const [hover, setHover] = useState(false)
  const [pressed, setPressed] = useState(false)
  const group = useRef<Group>(null)
  const face = useRef<Mesh>(null)
  const fs = fontSize ?? Math.min(0.02, height * 0.36)
  const base =
    variant === 'primary' ? UI.buttonActive : variant === 'danger' ? '#3a1d20' : variant === 'ghost' ? UI.panel : UI.button
  const color = disabled ? '#151a21' : active ? UI.buttonActive : hover ? (variant === 'primary' ? '#539bf5' : UI.buttonHover) : base
  const textColor = disabled ? '#5c6672' : variant === 'danger' && !active ? '#ff8a84' : UI.text
  const geometry = useMemo(() => roundedRectGeometry(width, height, Math.min(height / 2, 0.014)), [width, height])

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const tz = pressed ? -0.003 : hover ? 0.003 : 0
    g.position.z += (tz - g.position.z) * Math.min(1, dt * 20)
  })

  return (
    <group position={position}>
      <group ref={group}>
        <mesh
          ref={face}
          geometry={geometry}
          onPointerEnter={(e) => {
            if (disabled) return
            e.stopPropagation()
            setHover(true)
            pulse(gamepadOf(e as unknown as XPointerEvent), 'tick')
          }}
          onPointerLeave={() => {
            setHover(false)
            setPressed(false)
          }}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (!disabled) setPressed(true)
          }}
          onPointerUp={(e) => {
            e.stopPropagation()
            setPressed(false)
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (disabled) return
            playSound('click')
            pulse(gamepadOf(e as unknown as XPointerEvent), 'firm')
            onClick()
          }}
        >
          <meshBasicMaterial color={color} />
        </mesh>
        {icon ? (
          <group position={[-width / 2 + height * 0.5, 0, 0.001]}>{icon}</group>
        ) : null}
        <Label
          size={fs}
          color={textColor}
          weight={600}
          position={[icon ? height * 0.25 : 0, sublabel ? height * 0.2 : 0, 0.002]}
          maxWidth={width - 0.02}
        >
          {label}
        </Label>
        {sublabel && (
          <Label size={Math.max(0.0125, fs * 0.52)} color={UI.muted} weight={400} anchorY="top" lineHeight={1.25} position={[icon ? height * 0.25 : 0, -height * 0.02, 0.002]} maxWidth={width - 0.03}>
            {sublabel}
          </Label>
        )}
      </group>
    </group>
  )
}

/** A two-state toggle row: label on the left, pill switch on the right. */
export function Toggle3D({ label, value, onChange, width = 0.3, position }: { label: string; value: boolean; onChange: (v: boolean) => void; width?: number; position?: [number, number, number] }) {
  const knob = useRef<Mesh>(null)
  const [hover, setHover] = useState(false)
  useFrame((_, dt) => {
    if (!knob.current) return
    const tx = value ? 0.012 : -0.012
    knob.current.position.x += (tx - knob.current.position.x) * Math.min(1, dt * 18)
  })
  return (
    <group position={position}>
      <mesh
        geometry={roundedRectGeometry(width, 0.042, 0.012)}
        onPointerEnter={(e) => {
          e.stopPropagation()
          setHover(true)
        }}
        onPointerLeave={() => setHover(false)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          playSound('click')
          onChange(!value)
        }}
      >
        <meshBasicMaterial color={hover ? UI.buttonHover : UI.button} />
      </mesh>
      <Label size={0.016} anchorX="left" position={[-width / 2 + 0.014, 0, 0.002]}>
        {label}
      </Label>
      <group position={[width / 2 - 0.034, 0, 0.002]}>
        <mesh geometry={roundedRectGeometry(0.046, 0.022, 0.011)} raycast={() => {}}>
          <meshBasicMaterial color={value ? UI.buttonActive : '#3b4552'} />
        </mesh>
        <mesh ref={knob} position={[value ? 0.012 : -0.012, 0, 0.001]} raycast={() => {}}>
          <circleGeometry args={[0.0085, 20]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>
    </group>
  )
}

/** Simple line icons drawn with thin planes. */
export function MenuIcon({ size = 0.02, color = UI.text }: { size?: number; color?: string }) {
  return (
    <group>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[0, i * size * 0.32, 0]} raycast={() => {}}>
          <planeGeometry args={[size, size * 0.12]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  )
}
