import type { ProviderId } from '../../../src/integrations/protocol'
import { github } from './github'
import { jiraAdapter } from './jira'
import { linear } from './linear'
import { trello } from './trello'
import type { ProviderAdapter } from './types'

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = { github, trello, linear, jira: jiraAdapter }
