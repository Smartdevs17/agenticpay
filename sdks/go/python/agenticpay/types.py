"""Type definitions for the AgenticPay Python SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


# ─── Verification ─────────────────────────────────────────────────────────────

@dataclass
class VerificationRequest:
    """Request to verify freelancer work."""
    repository_url: str
    milestone_description: str
    project_id: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "repositoryUrl": self.repository_url,
            "milestoneDescription": self.milestone_description,
            "projectId": self.project_id,
        }


@dataclass
class InvoiceRequest:
    """Request to generate an invoice."""
    project_id: str
    work_description: str
    merchant_id: str
    hours_worked: Optional[float] = None
    hourly_rate: Optional[float] = None
    country_code: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "projectId": self.project_id,
            "merchantId": self.merchant_id,
            "workDescription": self.work_description,
        }
        if self.hours_worked is not None:
            d["hoursWorked"] = self.hours_worked
        if self.hourly_rate is not None:
            d["hourlyRate"] = self.hourly_rate
        if self.country_code is not None:
            d["countryCode"] = self.country_code
        return d


@dataclass
class GenerateInvoiceInput:
    """Input for generating an invoice."""
    project_id: str
    merchant_id: str
    work_description: str
    hours_worked: Optional[float] = None
    hourly_rate: Optional[float] = None
    country_code: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "projectId": self.project_id,
            "merchantId": self.merchant_id,
            "workDescription": self.work_description,
        }
        if self.hours_worked is not None:
            d["hoursWorked"] = self.hours_worked
        if self.hourly_rate is not None:
            d["hourlyRate"] = self.hourly_rate
        if self.country_code is not None:
            d["countryCode"] = self.country_code
        return d


# ─── Subscriptions ────────────────────────────────────────────────────────────

class SubscriptionStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    CANCELLED = "cancelled"
    PAST_DUE = "past_due"
    TRIALING = "trialing"


class SubscriptionInterval(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


@dataclass
class CreatePlanInput:
    merchant_id: str
    name: str
    interval: SubscriptionInterval
    amount: float
    currency: str
    description: Optional[str] = None
    trial_days: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "merchantId": self.merchant_id,
            "name": self.name,
            "interval": self.interval.value,
            "amount": self.amount,
            "currency": self.currency,
        }
        if self.description is not None:
            d["description"] = self.description
        if self.trial_days is not None:
            d["trialDays"] = self.trial_days
        return d


@dataclass
class CreateSubscriptionInput:
    customer_id: str
    plan_id: str
    trial_days: Optional[int] = None
    metadata: Optional[Dict[str, str]] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "customerId": self.customer_id,
            "planId": self.plan_id,
        }
        if self.trial_days is not None:
            d["trialDays"] = self.trial_days
        if self.metadata is not None:
            d["metadata"] = self.metadata
        return d


@dataclass
class CancelSubscriptionInput:
    immediately: bool = False
    reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"immediately": self.immediately}
        if self.reason is not None:
            d["reason"] = self.reason
        return d


# ─── Payments / Splits ────────────────────────────────────────────────────────

@dataclass
class SplitRecipient:
    recipient_id: str
    wallet_address: str
    percentage: float
    minimum_threshold: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "recipientId": self.recipient_id,
            "walletAddress": self.wallet_address,
            "percentage": self.percentage,
            "minimumThreshold": self.minimum_threshold,
        }


@dataclass
class SplitConfigInput:
    merchant_id: str
    platform_fee_percentage: float
    recipients: List[SplitRecipient]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "merchantId": self.merchant_id,
            "platformFeePercentage": self.platform_fee_percentage,
            "recipients": [r.to_dict() for r in self.recipients],
        }


@dataclass
class SplitExecutionInput:
    split_id: str
    payment_id: str
    total_amount: float
    currency: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "paymentId": self.payment_id,
            "totalAmount": self.total_amount,
            "currency": self.currency,
        }


# ─── Refunds ──────────────────────────────────────────────────────────────────

@dataclass
class RefundPolicyInput:
    merchant_id: str
    full_refund_window_days: int
    auto_approval_threshold: float
    always_refund_under_amount: float
    max_partial_refund_percentage: float
    require_reason: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "merchantId": self.merchant_id,
            "fullRefundWindowDays": self.full_refund_window_days,
            "autoApprovalThreshold": self.auto_approval_threshold,
            "alwaysRefundUnderAmount": self.always_refund_under_amount,
            "maxPartialRefundPercentage": self.max_partial_refund_percentage,
            "requireReason": self.require_reason,
        }


@dataclass
class RefundEvaluationInput:
    merchant_id: str
    payment_id: str
    payment_type: str  # 'card' | 'crypto' | 'bank_transfer'
    amount_paid: float
    requested_amount: float
    days_since_payment: int
    reason: Optional[str] = None
    has_chargeback: bool = False
    has_dispute: bool = False

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "merchantId": self.merchant_id,
            "paymentId": self.payment_id,
            "paymentType": self.payment_type,
            "amountPaid": self.amount_paid,
            "requestedAmount": self.requested_amount,
            "daysSincePayment": self.days_since_payment,
            "hasChargeback": self.has_chargeback,
            "hasDispute": self.has_dispute,
        }
        if self.reason is not None:
            d["reason"] = self.reason
        return d


# ─── Escrow ───────────────────────────────────────────────────────────────────

@dataclass
class EscrowMilestoneInput:
    title: str
    amount: float
    completion_criteria: str
    description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "title": self.title,
            "amount": self.amount,
            "completionCriteria": self.completion_criteria,
        }
        if self.description is not None:
            d["description"] = self.description
        return d


@dataclass
class CreateEscrowInput:
    project_id: str
    payer_id: str
    payee_id: str
    currency: str
    total_amount: float
    milestones: List[EscrowMilestoneInput]
    metadata: Optional[Dict[str, str]] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "projectId": self.project_id,
            "payerId": self.payer_id,
            "payeeId": self.payee_id,
            "currency": self.currency,
            "totalAmount": self.total_amount,
            "milestones": [m.to_dict() for m in self.milestones],
        }
        if self.metadata is not None:
            d["metadata"] = self.metadata
        return d


# ─── Disputes ─────────────────────────────────────────────────────────────────

@dataclass
class CreateDisputeInput:
    reason: str
    escrow_id: Optional[str] = None
    payment_id: Optional[str] = None
    evidence: Optional[List[str]] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"reason": self.reason}
        if self.escrow_id is not None:
            d["escrowId"] = self.escrow_id
        if self.payment_id is not None:
            d["paymentId"] = self.payment_id
        if self.evidence is not None:
            d["evidence"] = self.evidence
        return d


# ─── Sandbox ──────────────────────────────────────────────────────────────────

@dataclass
class SandboxPaymentInput:
    from_account: str
    to_account: str
    amount: float
    currency: str
    memo: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "from": self.from_account,
            "to": self.to_account,
            "amount": self.amount,
            "currency": self.currency,
        }
        if self.memo is not None:
            d["memo"] = self.memo
        return d
