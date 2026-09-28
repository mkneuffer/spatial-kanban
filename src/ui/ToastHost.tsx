import { useToasts } from './toasts'

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run()
                useToasts.getState().dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
