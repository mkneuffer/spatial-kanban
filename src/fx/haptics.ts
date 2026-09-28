/** Haptic feedback (PLAN §6.4): a light tick on target change, a firmer pulse on drop. */
let enabled = true

export function setHapticsEnabled(on: boolean) {
  enabled = on
}

interface HapticActuatorLike {
  pulse?: (value: number, duration: number) => Promise<boolean>
  playEffect?: (type: string, params: { duration: number; strongMagnitude: number; weakMagnitude: number }) => Promise<unknown>
}

export function pulse(gamepad: Gamepad | undefined | null, strength: 'tick' | 'firm') {
  if (!enabled) return
  const [intensity, ms] = strength === 'tick' ? [0.25, 12] : [0.6, 35]
  try {
    const g = gamepad as (Gamepad & { hapticActuators?: HapticActuatorLike[]; vibrationActuator?: HapticActuatorLike }) | null | undefined
    const actuator = g?.hapticActuators?.[0] ?? g?.vibrationActuator
    if (actuator?.pulse) {
      void actuator.pulse(intensity, ms)
      return
    }
    if (actuator?.playEffect) {
      void actuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity })
      return
    }
    // Phones (touch): the Vibration API where available.
    if (!gamepad && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(strength === 'tick' ? 5 : 15)
  } catch {
    // Haptics are best-effort.
  }
}
