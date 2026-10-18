import type {
  DailyOverview,
  OverviewEvent,
  OverviewTask,
  SourceFreshness,
  WorkspaceSnapshot,
} from './contracts'

// Mock-only contracts. Real authentication/transport requires separate qualification.
export type GatewayReadScope = 'brief:read' | 'tasks:read' | 'agenda:read'
export type GatewayReadOperation = 'overview' | 'tasks' | 'agenda'
export interface PairingTicket {
  ticketId: string
  fingerprint: string
  expiresAt: string
}
export interface PairingChallenge {
  purpose: 'today.mock.pair.v1'
  issuer: string
  ticketId: string
  nonce: string
  fingerprint: string
  workspaceId: string
  deviceId: string
  scopes: GatewayReadScope[]
  expiresAt: string
}
export type PairingStatus =
  | { state: 'pending' }
  | { state: 'approved'; challenge: PairingChallenge }
export interface DeviceGrant {
  issuer: string
  deviceId: string
  workspaceId: string
  scopes: GatewayReadScope[]
  expiresAt: string
}
export interface GatewayReadInit {
  deviceId: string
  operation: GatewayReadOperation
  date: string
  timeZone: string
  clientNonce: string
  issuedAt: string
  signature: string
}
export interface GatewayReadChallenge {
  purpose: 'today.mock.read.v1'
  issuer: string
  requestId: string
  nonce: string
  deviceId: string
  workspaceId: string
  grantVersion: string
  operation: GatewayReadOperation
  date: string
  timeZone: string
  expiresAt: string
}
export interface GatewayReadMetadata {
  contractVersion: 'today.mock.gateway.v1'
  fixtureOnly: true
  workspaceId: string
  revision: number
  capturedAt: string
  expiresAt: string
}
export type GatewayReadResult = GatewayReadMetadata &
  (
    | { overview: DailyOverview }
    | { tasks: OverviewTask[] }
    | { events: OverviewEvent[]; calendar: SourceFreshness }
  )
export interface FixtureWriteReceipt {
  revision: number
  replayed: boolean
}
export interface FixtureWorkspaceDocument {
  schemaVersion: 1
  fixtureOnly: true
  workspaceId: string
  revision: number
  updatedAt: string
  data: WorkspaceSnapshot
  receipts: { operationId: string; requestHash: string; revision: number }[]
}
export type WorkspaceLoadState =
  | { state: 'FIRST_USE'; revision: null }
  | { state: 'UNAVAILABLE' | 'CORRUPT'; revision: null }
  | { state: 'PRESENT'; revision: number }
