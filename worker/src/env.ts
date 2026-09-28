export interface Env {
  /** Static app build (`dist/`). */
  ASSETS: Fetcher
  /** D1 database. Without it the Worker only serves the app. */
  DB?: D1Database
  /** Secret used to encrypt provider tokens at rest. Required for integrations. */
  TOKEN_ENCRYPTION_KEY?: string
  /** Public origin, e.g. https://kanban.example.com. Defaults to the request origin. */
  PUBLIC_URL?: string

  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  /** Space-separated OAuth scopes. Defaults to `read:user read:org project repo`. */
  GITHUB_SCOPES?: string

  TRELLO_API_KEY?: string
  /** Shown on Trello's consent screen. */
  TRELLO_APP_NAME?: string

  LINEAR_CLIENT_ID?: string
  LINEAR_CLIENT_SECRET?: string

  JIRA_CLIENT_ID?: string
  JIRA_CLIENT_SECRET?: string
}
