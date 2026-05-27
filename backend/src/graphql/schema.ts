export const FEDERATED_SCHEMA_SDL = `
schema {
  query: Query
  mutation: Mutation
  subscription: Subscription
}

directive @key(fields: String!) repeatable on OBJECT | INTERFACE
directive @shareable on OBJECT | FIELD_DEFINITION

scalar DateTime
scalar CurrencyCode
scalar USDAmount

type PageInfo {
  endCursor: String
  hasNextPage: Boolean!
}

type Payment @key(fields: "id") {
  id: ID!
  method: String!
  amount: USDAmount!
  currency: CurrencyCode!
  status: String!
  createdAt: DateTime!
  feeAmount: USDAmount!
}

type PaymentEdge {
  cursor: String!
  node: Payment!
}

type PaymentConnection {
  edges: [PaymentEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type Project @key(fields: "id") {
  id: ID!
  name: String!
  clientId: String!
  ownerId: String!
  budget: USDAmount!
  spentBudget: USDAmount!
  status: String!
  createdAt: DateTime!
}

type ProjectEdge {
  cursor: String!
  node: Project!
}

type ProjectConnection {
  edges: [ProjectEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type PaymentLink @key(fields: "id") {
  id: ID!
  slug: String!
  merchantId: String!
  amount: USDAmount!
  currency: CurrencyCode!
  expiresAt: DateTime!
  isActive: Boolean!
}

type PaymentLinkEdge {
  cursor: String!
  node: PaymentLink!
}

type PaymentLinkConnection {
  edges: [PaymentLinkEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type Query {
  paymentsConnection(first: Int = 20, after: String): PaymentConnection!
  projectsConnection(first: Int = 20, after: String): ProjectConnection!
  paymentLinksConnection(first: Int = 20, after: String): PaymentLinkConnection!
  federationSdl: String!
}

input PersistedQueryInput {
  id: String!
  query: String!
}

type PersistedQuery {
  id: String!
  registeredAt: DateTime!
}

type Mutation {
  registerPersistedQuery(input: PersistedQueryInput!): PersistedQuery!
}

type PaymentEvent {
  paymentId: ID!
  eventType: String!
  timestamp: DateTime!
}

type Subscription {
  paymentEvents: PaymentEvent!
}
`;