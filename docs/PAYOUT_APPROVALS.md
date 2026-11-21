# Payout Approval Workflow

Large payouts are held for human review instead of executing automatically.

> Approval is one step in a larger lifecycle. For the settlement path, retry policy and
> reservation handling, see [Payout reliability](PAYOUT_RELIABILITY.md).

## When approval is required

A payout batch is created with status `pending` when either condition is true:

- the pending amount is greater than the schedule's `autoApproveLimit`, or
- the pending amount is greater than or equal to the approval threshold.

Otherwise the batch is auto-approved and marked `completed`.

Pending balances must be finite and non-negative. The engine rejects invalid balance updates with
`INVALID_PENDING_PAYOUT_AMOUNT` so a negative value, `NaN`, or infinity cannot poison future evaluations.

## Configuring the threshold

Set `PAYOUT_APPROVAL_THRESHOLD` (see [ENV_VARS.md](../ENV_VARS.md)). If it is unset, the default is `10000`.
The threshold must be a positive number; invalid values cause the engine to fail at startup.

## Approver roles

Only these roles may approve, reject, or retry a payout batch:

| Role               | Can approve | Can reject | Can retry |
| ------------------ | ----------- | ---------- | --------- |
| `finance_approver` | Yes         | Yes        | Yes       |
| `admin`            | Yes         | Yes        | Yes       |

Any other caller receives `PAYOUT_APPROVER_FORBIDDEN`.

## Lifecycle

```text
created -> pending -> completed   (approved)
                   -> failed      (rejected; funds return to the merchant's pending balance)
failed  -> pending                (retried, back into the approval queue)
```

A rejected batch cannot be retried. Create a new payout from the merchant's pending balance instead,
so the rejection cannot be bypassed.

A manual retry only returns the batch to the approval queue; it does not settle it. A batch
that exhausted its retry budget keeps its reservation until an approver releases it — see
[Payout reliability](PAYOUT_RELIABILITY.md#retry-policy).

## Audit trail

Every decision is recorded with the batch ID, action (`created`, `approved`, `rejected`, `retried`),
actor ID, timestamp, and optional details. Query it with `PayoutEngine.getAuditTrail(batchId?)`.

History and audit APIs return defensive snapshots. Changing a returned object or its `Date` values
does not alter the engine's stored payout state.

## Reserved funds

When a batch is created, its amount is moved out of the merchant's pending balance, so repeated
evaluations never create a second batch for the same funds.
