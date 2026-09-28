import worker, { type Env } from '../../worker/src/index'

/**
 * Cloudflare Pages entry point: Pages serves `dist/` itself and hands `/api/*`
 * to the same handler the standalone Worker uses. Bindings (the `DB` D1
 * database) and secrets are set on the Pages project.
 */
export const onRequest: PagesFunction<Env> = (ctx) => worker.fetch(ctx.request, ctx.env)
