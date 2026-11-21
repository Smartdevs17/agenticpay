"""API service classes for the AgenticPay Python SDK."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

from agenticpay.client import AgenticPayClient
from agenticpay.types import (
    CancelSubscriptionInput,
    CreateDisputeInput,
    CreateEscrowInput,
    CreatePlanInput,
    CreateSubscriptionInput,
    GenerateInvoiceInput,
    InvoiceRequest,
    RefundEvaluationInput,
    RefundPolicyInput,
    SandboxPaymentInput,
    SplitConfigInput,
    SplitExecutionInput,
    VerificationRequest,
)


class VerificationApi:
    """Verification and invoice generation endpoints."""

    def __init__(self, client: AgenticPayClient) -> None:
        self._client = client

    def verify_work(self, input: VerificationRequest) -> Any:
        """Verify freelancer work submission."""
        return self._client.post("/verification/verify", input.to_dict())

    def verify_work_batch(self, items: List[VerificationRequest]) -> Any:
        """Batch verify work submissions."""
        return self._client.post("/verification/verify/batch", {"items": [i.to_dict() for i in items]})

    def get_verification(self, verification_id: str) -> Any:
        """Get verification details."""
        return self._client.get(f"/verification/{verification_id}")

    def generate_invoice(self, input: InvoiceRequest) -> Any:
        """Generate an AI-powered invoice."""
        return self._client.post("/invoice/generate", input.to_dict())


class PaymentsApi:
    """Payment split configuration and execution endpoints."""

    def __init__(self, client: AgenticPayClient) -> None:
        self._client = client

    def create_split_config(self, input: SplitConfigInput) -> Any:
        """Create a split payment configuration."""
        return self._client.post("/splits", input.to_dict())

    def list_merchant_splits(self, merchant_id: str) -> Any:
        """List split configs for a merchant."""
        return self._client.get(f"/splits/merchant/{merchant_id}")

    def update_split_config(
        self,
        split_id: str,
        patch: Dict[str, Any],
    ) -> Any:
        """Update a split configuration."""
        return self._client.patch(f"/splits/{split_id}", patch)

    def execute_split(self, input: SplitExecutionInput) -> Any:
        """Execute a split payment."""
        return self._client.post(
            f"/splits/{input.split_id}/execute",
            input.to_dict(),
        )

    def get_split_analytics(self, split_id: str) -> Any:
        """Get analytics for a split config."""
        return self._client.get(f"/splits/{split_id}/analytics")


class RefundsApi:
    """Refund policy and evaluation endpoints."""

    def __init__(self, client: AgenticPayClient) -> None:
        self._client = client

    def set_policy(self, input: RefundPolicyInput) -> Any:
        """Set refund policy for a merchant."""
        return self._client.post("/refunds/policies", input.to_dict())

    def get_policy(self, merchant_id: str) -> Any:
        """Get refund policy for a merchant."""
        return self._client.get(f"/refunds/policies/{merchant_id}")

    def evaluate(self, input: RefundEvaluationInput) -> Any:
        """Evaluate a refund request."""
        return self._client.post("/refunds/evaluate", input.to_dict())

    def list_manual_review(self, merchant_id: Optional[str] = None) -> Any:
        """List refunds pending manual review."""
        suffix = f"?merchantId={merchant_id}" if merchant_id else ""
        return self._client.get(f"/refunds/manual-review{suffix}")

    def resolve_manual_review(self, review_id: str, status: str) -> Any:
        """Resolve a manual review."""
        return self._client.patch(f"/refunds/manual-review/{review_id}", {"status": status})


class SubscriptionsApi:
    """Subscription plan and enrollment endpoints."""

    def __init__(self, client: AgenticPayClient) -> None:
        self._client = client

    def create_plan(self, input: CreatePlanInput) -> Any:
        """Create a subscription plan."""
        return self._client.post("/plans", input.to_dict())

    def list_merchant_plans(self, merchant_id: str) -> Any:
        """List plans for a merchant."""
        return self._client.get(f"/plans/{merchant_id}")

    def get_plan(self, plan_id: str) -> Any:
        """Get plan details."""
        return self._client.get(f"/plans/detail/{plan_id}")

    def enroll(self, input: CreateSubscriptionInput) -> Any:
        """Enroll a customer in a plan."""
        return self._client.post("/subscriptions/enroll", input.to_dict())

    def get_subscription(self, subscription_id: str) -> Any:
        """Get subscription details."""
        return self._client.get(f"/subscriptions/{subscription_id}")

    def cancel(self, subscription_id: str, input: Optional[CancelSubscriptionInput] = None) -> Any:
        """Cancel a subscription."""
        return self._client.delete(
            f"/subscriptions/{subscription_id}",
            input.to_dict() if input else None,
        )

    def pause(self, subscription_id: str, resume_at: Optional[str] = None) -> Any:
        """Pause a subscription."""
        body = {"resumeAt": resume_at} if resume_at else None
        return self._client.post(f"/subscriptions/{subscription_id}/pause", body)

    def reactivate(self, subscription_id: str) -> Any:
        """Reactivate a paused subscription."""
        return self._client.post(f"/subscriptions/{subscription_id}/reactivate")


class InvoicesApi:
    """Invoice endpoints."""

    def __init__(self, client: AgenticPayClient) -> None:
        self._client = client

    def generate(self, input: GenerateInvoiceInput) -> Any:
        """Generate an invoice for completed work."""
        return self._client.post("/invoice/generate", input.to_dict())

    def get(self, invoice_id: str) -> Any:
        """Get invoice details."""
        return self._client.get(f"/invoice/{invoice_id}")

    def list_for_merchant(
        self,
        merchant_id: str,
        status: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Any:
        """List invoices for a merchant."""
        params: Dict[str, str] = {}
        if status:
            params["status"] = status
        if limit is not None:
            params["limit"] = str(limit)
        suffix = f"?{urlencode(params)}" if params else ""
        return self._client.get(f"/invoice/merchant/{merchant_id}{suffix}")

    def list_for_project(self, project_id: str) -> Any:
        """List invoices for a project."""
        return self._client.get(f"/invoice/project/{project_id}")


class EscrowApi:
    """Escrow endpoints."""

    def __init__(self, client: AgenticPayClient) -> None:
        self._client = client

    def create(self, input: CreateEscrowInput) -> Any:
        """Create a new escrow agreement."""
        return self._client.post("/escrow", input.to_dict())

    def get(self, escrow_id: str) -> Any:
        """Get escrow details."""
        return self._client.get(f"/escrow/{escrow_id}")

    def fund(self, escrow_id: str, amount: float) -> Any:
        """Fund an escrow."""
        return self._client.post(f"/escrow/{escrow_id}/fund", {"amount": amount})

    def confirm_milestone(self, escrow_id: str, milestone_id: str) -> Any:
        """Confirm a milestone in an escrow."""
        return self._client.post(f"/escrow/{escrow_id}/milestones/{milestone_id}/confirm")

    def list_by_project(self, project_id: str) -> Any:
        """List escrows for a project."""
        return self._client.get(f"/escrow?projectId={project_id}")


class DisputesApi:
    """Dispute endpoints."""

    def __init__(self, client: AgenticPayClient) -> None:
        self._client = client

    def create(self, input: CreateDisputeInput) -> Any:
        """File a dispute."""
        return self._client.post("/disputes", input.to_dict())

    def get(self, dispute_id: str) -> Any:
        """Get dispute details."""
        return self._client.get(f"/disputes/{dispute_id}")

    def respond(self, dispute_id: str, response: str, evidence: Optional[List[str]] = None) -> Any:
        """Respond to a dispute."""
        body: Dict[str, Any] = {"response": response}
        if evidence:
            body["evidence"] = evidence
        return self._client.post(f"/disputes/{dispute_id}/respond", body)

    def resolve(
        self,
        dispute_id: str,
        resolution: str,
        decision: str,
        split_percentage: Optional[float] = None,
    ) -> Any:
        """Resolve a dispute."""
        body: Dict[str, Any] = {"resolution": resolution, "decision": decision}
        if split_percentage is not None:
            body["splitPercentage"] = split_percentage
        return self._client.post(f"/disputes/{dispute_id}/resolve", body)


class StellarApi:
    """Stellar blockchain endpoints."""

    def __init__(self, client: AgenticPayClient) -> None:
        self._client = client

    def get_payment(self, transaction_hash: str) -> Any:
        """Get payment status by transaction hash."""
        return self._client.get(f"/stellar/payment/{transaction_hash}")

    def get_transaction(self, transaction_hash: str) -> Any:
        """Get transaction details."""
        return self._client.get(f"/stellar/transaction/{transaction_hash}")

    def get_network_status(self, network: Optional[str] = None) -> Any:
        """Get Stellar network status."""
        suffix = f"?network={network}" if network else ""
        return self._client.get(f"/stellar/status{suffix}")


class SandboxApi:
    """Sandbox environment endpoints."""

    def __init__(self, client: AgenticPayClient) -> None:
        self._client = client

    def get_status(self) -> Any:
        """Get sandbox environment status."""
        return self._client.get("/sandbox/status")

    def process_payment(self, input: SandboxPaymentInput) -> Any:
        """Process a mock payment."""
        return self._client.post("/sandbox/payments/process", input.to_dict())

    def request_faucet(self, account_id: str) -> Any:
        """Request test tokens from the faucet."""
        return self._client.post("/sandbox/faucet", {"accountId": account_id})

    def reset(self) -> Any:
        """Reset sandbox state."""
        return self._client.post("/sandbox/reset")
