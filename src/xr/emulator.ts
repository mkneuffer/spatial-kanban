import { xrStore } from './session'

/**
 * Dev only: emulate a Meta Quest 3 in a synthetic office with IWER (PLAN §15)
 * when the browser has no immersive sessions. Unlike pmndrs' built-in
 * emulation, this also overrides a non-immersive native `navigator.xr`
 * (e.g. embedded Chromium), which otherwise blocks the emulator.
 */
export async function installDevEmulator(): Promise<boolean> {
  if (!import.meta.env.DEV) return false
  const params = new URLSearchParams(location.search)
  if (params.get('emulate') === '0') return false
  const xr = navigator.xr
  const supported = await Promise.all([
    xr?.isSessionSupported('immersive-ar').catch(() => false),
    xr?.isSessionSupported('immersive-vr').catch(() => false),
  ])
  if (supported.some(Boolean)) return false
  const [{ XRDevice, metaQuest3 }, { DevUI }, { SyntheticEnvironmentModule }] = await Promise.all([
    import('iwer'),
    import('@iwer/devui'),
    import('@iwer/sem'),
  ])
  const device = new XRDevice(metaQuest3)
  device.installRuntime({ forceInstall: true })
  // `?devui=0` skips the emulator panel (it owns controller poses), for scripted testing.
  if (params.get('devui') !== '0') device.installDevUI(DevUI)
  device.installSEM(SyntheticEnvironmentModule)
  device.sem?.loadDefaultEnvironment(params.get('room') ?? 'office_small')
  device.primaryInputMode = 'controller'
  xrStore.setState({ emulator: device } as never)
  return true
}
