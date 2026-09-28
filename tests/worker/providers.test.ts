import { afterEach, describe, expect, it, vi } from 'vitest'
import { adfToText, jiraAdapter, mapIssue, statusColumns, textToAdf } from '../../worker/src/providers/jira'
import { linear, mapIssues, sortStates } from '../../worker/src/providers/linear'
import { mapBoard, trello } from '../../worker/src/providers/trello'
import type { ProviderContext } from '../../worker/src/providers/types'
import { gqlHas, makeEnv, mockFetch, urlIs } from './helpers'

afterEach(() => vi.unstubAllGlobals())

const ctx = (meta: Record<string, unknown> = {}): ProviderContext => ({ env: makeEnv(), userId: 'u1', token: 'tok', meta })

describe('Trello', () => {
  const board = {
    id: 'B1',
    name: 'Sprint',
    url: 'https://trello.com/b/B1',
    lists: [
      { id: 'l2', name: 'Doing', pos: 2000 },
      { id: 'l1', name: 'To do', pos: 1000 },
    ],
    cards: [
      { id: 'c2', name: 'Second', desc: '', idList: 'l1', pos: 200, due: null, idLabels: [], idMembers: [], shortUrl: 'https://trello.com/c/2', idShort: 2 },
      { id: 'c1', name: 'First', desc: 'Notes', idList: 'l1', pos: 100, due: '2026-10-01T12:00:00.000Z', idLabels: ['g', 'x'], idMembers: ['m'], shortUrl: 'https://trello.com/c/1', idShort: 1 },
      { id: 'c3', name: 'Other list', desc: '', idList: 'closed-list', pos: 1, due: null, idLabels: [], idMembers: [], shortUrl: '', idShort: 3 },
    ],
    labels: [{ id: 'g', name: '', color: 'green_dark' }],
    members: [{ id: 'm', fullName: 'Ada', username: 'ada', avatarUrl: 'https://trello-members/abc' }],
  }

  it('maps lists and cards in position order', () => {
    const r = mapBoard(board)
    expect(r.columns).toEqual([
      { id: 'l1', title: 'To do' },
      { id: 'l2', title: 'Doing' },
    ])
    expect(r.cards.map((c) => c.ref.id)).toEqual(['c1', 'c2'])
    expect(r.cards[0]).toMatchObject({
      ref: { provider: 'trello', id: 'c1', url: 'https://trello.com/c/1', key: '#1' },
      description: 'Notes',
      dueDate: '2026-10-01',
      labels: [{ id: 'g', name: 'green_dark', color: '#4bce97' }],
      assignees: [{ id: 'm', name: 'Ada', avatarUrl: 'https://trello-members/abc/50.png' }],
    })
  })

  it('moves a card between its new neighbours', async () => {
    const calls = mockFetch([
      [urlIs('GET', 'https://api.trello.com/1/lists/l2/cards'), () => [{ id: 'a', pos: 100 }, { id: 'moving', pos: 150 }, { id: 'b', pos: 300 }]],
      [urlIs('PUT', 'https://api.trello.com/1/cards/moving'), () => ({})],
    ])
    const result = await trello.applyOp(ctx(), 'B1', { op: 'move', ref: { provider: 'trello', id: 'moving' }, columnId: 'l2', afterId: 'a', beforeId: 'b', columnChanged: true })
    expect(result).toEqual({ ok: true })
    expect(calls[1].json).toEqual({ idList: 'l2', pos: 200 })
    expect(calls[1].headers.get('authorization')).toBe('OAuth oauth_consumer_key="trello-key", oauth_token="tok"')
  })

  it('creates at the top when there is no previous card', async () => {
    const calls = mockFetch([[urlIs('POST', 'https://api.trello.com/1/cards'), () => ({ id: 'n', shortUrl: 'https://trello.com/c/n', idShort: 9 })]])
    const result = await trello.applyOp(ctx(), 'B1', { op: 'create', localId: 'x', columnId: 'l1', title: 'Hi', description: '', afterId: null })
    expect(calls[0].json).toMatchObject({ idList: 'l1', name: 'Hi', pos: 'top' })
    expect(result).toEqual({ ok: true, ref: { provider: 'trello', id: 'n', url: 'https://trello.com/c/n', key: '#9' } })
  })

  it('turns a rejected request into a permanent failure', async () => {
    mockFetch([[urlIs('PUT', 'https://api.trello.com/1/cards/c1'), () => new Response('invalid value for idList', { status: 400 })]])
    const result = await trello.applyOp(ctx(), 'B1', { op: 'archive', ref: { provider: 'trello', id: 'c1' }, archived: true })
    expect(result).toEqual({ ok: false, error: 'invalid value for idList', permanent: true })
  })

  it('treats rate limits as temporary', async () => {
    mockFetch([[urlIs('PUT', 'https://api.trello.com/1/cards/c1'), () => new Response('{"message":"Rate limit"}', { status: 429 })]])
    const result = await trello.applyOp(ctx(), 'B1', { op: 'archive', ref: { provider: 'trello', id: 'c1' }, archived: true })
    expect(result).toMatchObject({ ok: false, permanent: false })
  })
})

describe('Linear', () => {
  const states = [
    { id: 's-done', name: 'Done', color: '#5e6ad2', type: 'completed', position: 0 },
    { id: 's-todo', name: 'Todo', color: '#e2e2e2', type: 'unstarted', position: 0 },
    { id: 's-back', name: 'Backlog', color: '#bec2c8', type: 'backlog', position: 0 },
    { id: 's-prog', name: 'In Progress', color: '#f2c94c', type: 'started', position: 1 },
    { id: 's-rev', name: 'In Review', color: '#0f783c', type: 'started', position: 2 },
  ]

  it('orders workflow states like the Linear board', () => {
    expect(sortStates(states).map((s) => s.title)).toEqual(['Backlog', 'Todo', 'In Progress', 'In Review', 'Done'])
  })

  it('maps issues by state, then sort order', () => {
    const issue = (id: string, state: string, sortOrder: number) => ({
      id,
      identifier: `ENG-${id}`,
      title: id,
      description: null,
      url: `https://linear.app/i/${id}`,
      sortOrder,
      dueDate: null,
      state: { id: state },
      labels: { nodes: [] },
      assignee: null,
    })
    const cards = mapIssues(sortStates(states), [issue('3', 's-done', 1), issue('2', 's-todo', 5), issue('1', 's-todo', -2)])
    expect(cards.map((c) => [c.ref.key, c.columnId])).toEqual([
      ['ENG-1', 's-todo'],
      ['ENG-2', 's-todo'],
      ['ENG-3', 's-done'],
    ])
  })

  it('moves an issue between its neighbours’ sort orders', async () => {
    const calls = mockFetch([
      [gqlHas('https://api.linear.app/graphql', 'sortOrder } next'), () => ({ data: { prev: { sortOrder: 10 }, next: { sortOrder: 20 } } })],
      [gqlHas('https://api.linear.app/graphql', 'issueUpdate'), () => ({ data: { issueUpdate: { success: true } } })],
    ])
    await linear.applyOp(ctx(), 'team', { op: 'move', ref: { provider: 'linear', id: 'i1' }, columnId: 's-prog', afterId: 'p', beforeId: 'n', columnChanged: true })
    expect(calls[1].json.variables).toEqual({ id: 'i1', input: { stateId: 's-prog', sortOrder: 15 } })
  })

  it('surfaces Linear’s user-facing error message', async () => {
    mockFetch([[gqlHas('https://api.linear.app/graphql', 'issueUpdate'), () => ({ errors: [{ message: 'Argument Validation Error', extensions: { code: 'INVALID_INPUT', userPresentableMessage: 'Title is too long' } }] })]])
    expect(await linear.applyOp(ctx(), 'team', { op: 'update', ref: { provider: 'linear', id: 'i1' }, title: 'x' })).toEqual({ ok: false, error: 'Title is too long', permanent: true })
  })
})

describe('Jira', () => {
  it('converts Atlassian Document Format to text and back', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Goal' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Line one' }, { type: 'hardBreak' }, { type: 'text', text: 'line two' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { text: '@Ada' } }] }] }] },
      ],
    }
    expect(adfToText(adf)).toBe('## Goal\n\nLine one\nline two\n\n- a\n- @Ada')
    expect(textToAdf('Hello\nworld\n\nBye')).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }, { type: 'hardBreak' }, { type: 'text', text: 'world' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Bye' }] },
      ],
    })
    expect(textToAdf('  ')).toBeNull()
  })

  it('groups statuses by category and skips sub-task types', () => {
    const s = (id: string, key: string) => ({ id, name: id, statusCategory: { key } })
    const cols = statusColumns([
      { statuses: [s('Done', 'done'), s('To Do', 'new'), s('In Progress', 'indeterminate')] },
      { statuses: [s('Review', 'indeterminate'), s('To Do', 'new')] },
      { subtask: true, statuses: [s('Sub only', 'new')] },
    ])
    expect(cols.map((c) => c.id)).toEqual(['To Do', 'In Progress', 'Review', 'Done'])
  })

  it('maps issues', () => {
    const card = mapIssue(
      {
        id: '10001',
        key: 'ENG-4',
        fields: { summary: 'Fix it', description: null, status: { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } }, labels: ['backend'], assignee: { accountId: 'a1', displayName: 'Ada', avatarUrls: { '48x48': 'https://av/48' } }, duedate: '2026-10-02' },
      },
      'https://acme.atlassian.net',
    )
    expect(card).toMatchObject({ ref: { id: '10001', key: 'ENG-4', url: 'https://acme.atlassian.net/browse/ENG-4' }, columnId: '3', dueDate: '2026-10-02', assignees: [{ id: 'a1', name: 'Ada', avatarUrl: 'https://av/48' }] })
    expect(card.labels[0]).toMatchObject({ id: 'backend', name: 'backend' })
  })

  it('moves a card by running the matching transition', async () => {
    const base = 'https://api.atlassian.com/ex/jira/cloud1/rest/api/3/issue/ENG-4/transitions'
    const calls = mockFetch([
      [urlIs('GET', base), () => ({ transitions: [{ id: '11', to: { id: '1', name: 'To Do' } }, { id: '31', to: { id: '3', name: 'Done' } }] })],
      [urlIs('POST', base), () => new Response(null, { status: 204 })],
    ])
    const ref = { provider: 'jira' as const, id: '10001', meta: { key: 'ENG-4' } }
    expect(await jiraAdapter.applyOp(ctx(), 'cloud1/ENG', { op: 'move', ref, columnId: '3', afterId: null, beforeId: null, columnChanged: true })).toEqual({ ok: true })
    expect(calls[1].json).toEqual({ transition: { id: '31' } })
  })

  it('refuses a move the workflow does not allow, so the app reverts it', async () => {
    mockFetch([[urlIs('GET', 'https://api.atlassian.com/ex/jira/cloud1/rest/api/3/issue/ENG-4/transitions'), () => ({ transitions: [] })]])
    const ref = { provider: 'jira' as const, id: '10001', meta: { key: 'ENG-4' } }
    expect(await jiraAdapter.applyOp(ctx(), 'cloud1/ENG', { op: 'move', ref, columnId: '9', afterId: null, beforeId: null, columnChanged: true })).toMatchObject({ ok: false, permanent: true })
  })

  it('rejects malformed project ids', async () => {
    await expect(jiraAdapter.getBoard(ctx(), 'cloud1/ENG" OR project = "X')).rejects.toThrow('Invalid Jira project.')
  })

  it('falls back to creation order for projects without ranking', async () => {
    const calls = mockFetch([
      [urlIs('GET', 'https://api.atlassian.com/ex/jira/c/rest/api/3/project/ENG/statuses'), () => [{ statuses: [{ id: '1', name: 'To Do', statusCategory: { key: 'new' } }] }]],
      [urlIs('GET', 'https://api.atlassian.com/ex/jira/c/rest/api/3/project/ENG'), () => ({ name: 'Engineering' })],
      [(c) => c.url.endsWith('/search/jql') && c.json.jql.includes('Rank'), () => new Response('{"errorMessages":["Field \'Rank\' does not exist"]}', { status: 400 })],
      [(c) => c.url.endsWith('/search/jql'), () => ({ issues: [], isLast: true })],
    ])
    const board = await jiraAdapter.getBoard(ctx({ sites: [{ id: 'c', url: 'https://acme.atlassian.net', name: 'Acme' }] }), 'c/ENG')
    expect(board).toMatchObject({ id: 'c/ENG', name: 'Engineering (ENG)', columns: [{ id: '1', title: 'To Do' }], cards: [] })
    expect(calls.filter((c) => c.url.endsWith('/search/jql')).map((c) => c.json.jql.split('ORDER BY ')[1])).toEqual(['Rank ASC', 'created ASC'])
  })
})
