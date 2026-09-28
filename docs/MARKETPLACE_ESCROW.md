# Marketplace Escrow Workflows

Issue: [#915](https://github.com/Smartdevs17/agenticpay/issues/915)

Hold a buyer's funds until delivery is confirmed, then settle the order by
paying the seller and taking a platform commission.

## Backend

Service: `backend/src/services/marketplace-escrow.ts`
Routes: `backend/src/routes/marketplace-escrow.ts` (mounted at `/api/v1/marketplace-escrow`)

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/orders` | Create an escrowed order (optional milestones) |
| `GET` | `/orders` | List orders (`marketplaceId`, `buyerId`, `sellerId`, `status`) |
| `GET` | `/orders/:id` | Read an order (includes the event audit trail) |
| `GET` | `/orders/:id/payout` | Payout breakdown for an order |
| `POST` | `/orders/:id/fund` | Fund the order with a transaction hash |
| `POST` | `/orders/:id/ship` | Record shipment / tracking |
| `POST` | `/orders/:id/deliver` | Confirm delivery and start the inspection window |
| `POST` | `/orders/:id/release` | Release funds to the seller |
| `POST` | `/orders/:id/milestones/:milestoneId/release` | Release one milestone |
| `POST` | `/orders/:id/auto-release` | Release after the inspection window |
| `POST` | `/orders/:id/dispute` | Raise a buyer-protection dispute |
| `POST` | `/orders/:id/resolve` | Resolve a dispute (buyer / seller / split) |
| `POST` | `/orders/:id/refund` | Refund the buyer |
| `POST` | `/orders/:id/cancel` | Cancel an unfunded order |
| `GET` | `/settlements/:marketplaceId` | Marketplace settlement summary |

### Lifecycle

`created → funded → shipped → delivered → released`

- After `deliver`, funds auto-release to the seller once
  `inspectionPeriodMs` (default 7 days) elapses.
- Orders with milestones settle each milestone individually
  (`partially_released`) and become `released` once every milestone is out.
  Milestone amounts must sum to the order amount.
- The platform commission (`platformFeePercent`, default 10%) is deducted from
  the seller payout on release.
- A dispute can be raised by the buyer or seller; resolution to `buyer`
  refunds the full amount, `seller` releases it, and `split` refunds
  `buyerPercent` of the distributable amount to the buyer.

## Tests

`backend/src/services/__tests__/marketplace-escrow.test.ts`
