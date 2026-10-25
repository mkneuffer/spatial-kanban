// Fictional sample text for the trailer animation. Keep it independent from the app.
export const SNIPPET = `const scene = createScene()
const beacon = scene.addBeacon({
  color: 'soft cyan',
  pulse: 0.42,
  position: [2, 1, -4],
})

function onSignal(signal) {
  const path = findQuietRoute(signal.origin)
  if (!path) return beacon.fadeOut()

  beacon.follow(path, {
    easing: 'gentle',
    glow: true,
    duration: 800,
  })
  scene.emit('signal:found', { path })
}

scene.on('signal', onSignal)
scene.start({ atmosphere: 'midnight' })
`
