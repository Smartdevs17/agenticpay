package agenticpay

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ─── Verification ─────────────────────────────────────────────────────────────

// VerificationRequest represents a work verification request.
type VerificationRequest struct {
	RepositoryURL        string `json:"repositoryUrl"`
	MilestoneDescription string `json:"milestoneDescription"`
	ProjectID            string `json:"projectId"`
}

// VerificationResult represents the result of a verification.
type VerificationResult struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Score  int    `json:"score,omitempty"`
}

// VerificationService handles work verification.
type VerificationService struct {
	client *Client
}

// Verify verifies freelancer work.
func (v *VerificationService) Verify(ctx context.Context, req VerificationRequest) (*VerificationResult, error) {
	var out VerificationResult
	return &out, v.client.do(ctx, "POST", "/verification/verify", req, &out)
}

// VerifyBatch verifies multiple work submissions.
func (v *VerificationService) VerifyBatch(ctx context.Context, items []VerificationRequest) ([]VerificationResult, error) {
	var out struct {
		Results []VerificationResult `json:"results"`
	}
	err := v.client.do(ctx, "POST", "/verification/verify/batch", map[string]interface{}{"items": items}, &out)
	return out.Results, err
}

// GetVerification gets a verification by ID.
func (v *VerificationService) GetVerification(ctx context.Context, id string) (*VerificationResult, error) {
	var out VerificationResult
	return &out, v.client.do(ctx, "GET", fmt.Sprintf("/verification/%s", id), nil, &out)
}

// ─── Payments ─────────────────────────────────────────────────────────────────

// SplitRecipient represents a payment split recipient.
type SplitRecipient struct {
	RecipientID       string  `json:"recipientId"`
	WalletAddress     string  `json:"walletAddress"`
	Percentage        float64 `json:"percentage"`
	MinimumThreshold  float64 `json:"minimumThreshold"`
}

// CreateSplitConfigParams represents params for creating a split config.
type CreateSplitConfigParams struct {
	MerchantID          string           `json:"merchantId"`
	PlatformFeePct      float64          `json:"platformFeePercentage"`
	Recipients          []SplitRecipient `json:"recipients"`
}

// ExecuteSplitParams represents params for executing a split.
type ExecuteSplitParams struct {
	PaymentID   string  `json:"paymentId"`
	TotalAmount float64 `json:"totalAmount"`
	Currency    string  `json:"currency"`
}

// PaymentsService handles payment split operations.
type PaymentsService struct {
	client *Client
}

// CreateSplitConfig creates a payment split configuration.
func (p *PaymentsService) CreateSplitConfig(ctx context.Context, params CreateSplitConfigParams) (map[string]interface{}, error) {
	var out map[string]interface{}
	return out, p.client.do(ctx, "POST", "/splits", params, &out)
}

// ListMerchantSplits lists split configs for a merchant.
func (p *PaymentsService) ListMerchantSplits(ctx context.Context, merchantID string) ([]map[string]interface{}, error) {
	var out []map[string]interface{}
	return out, p.client.do(ctx, "GET", fmt.Sprintf("/splits/merchant/%s", merchantID), nil, &out)
}

// ExecuteSplit executes a split payment.
func (p *PaymentsService) ExecuteSplit(ctx context.Context, splitID string, params ExecuteSplitParams) (map[string]interface{}, error) {
	var out map[string]interface{}
	return out, p.client.do(ctx, "POST", fmt.Sprintf("/splits/%s/execute", splitID), params, &out)
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

// SubscriptionStatus represents a subscription's state.
type SubscriptionStatus string

const (
	SubscriptionStatusActive    SubscriptionStatus = "active"
	SubscriptionStatusPaused    SubscriptionStatus = "paused"
	SubscriptionStatusCancelled SubscriptionStatus = "cancelled"
	SubscriptionStatusPastDue   SubscriptionStatus = "past_due"
	SubscriptionStatusTrialing  SubscriptionStatus = "trialing"
)

// SubscriptionInterval represents a billing interval.
type SubscriptionInterval string

const (
	IntervalDaily   SubscriptionInterval = "daily"
	IntervalWeekly  SubscriptionInterval = "weekly"
	IntervalMonthly SubscriptionInterval = "monthly"
	IntervalYearly  SubscriptionInterval = "yearly"
)

// Subscription represents a subscription.
type Subscription struct {
	ID                string             `json:"id"`
	CustomerID        string             `json:"customerId"`
	PlanID            string             `json:"planId"`
	Status            SubscriptionStatus `json:"status"`
	CurrentPeriodStart *time.Time        `json:"currentPeriodStart,omitempty"`
	CurrentPeriodEnd   *time.Time        `json:"currentPeriodEnd,omitempty"`
	CreatedAt         time.Time          `json:"createdAt"`
	UpdatedAt         time.Time          `json:"updatedAt"`
}

// Plan represents a subscription plan.
type Plan struct {
	ID          string               `json:"id"`
	MerchantID  string               `json:"merchantId"`
	Name        string               `json:"name"`
	Description string               `json:"description,omitempty"`
	Interval    SubscriptionInterval `json:"interval"`
	Amount      float64              `json:"amount"`
	Currency    string               `json:"currency"`
	TrialDays   int                  `json:"trialDays,omitempty"`
	IsActive    bool                 `json:"isActive"`
	CreatedAt   time.Time            `json:"createdAt"`
	UpdatedAt   time.Time            `json:"updatedAt"`
}

// CreatePlanParams represents params for creating a plan.
type CreatePlanParams struct {
	MerchantID  string               `json:"merchantId"`
	Name        string               `json:"name"`
	Description string               `json:"description,omitempty"`
	Interval    SubscriptionInterval `json:"interval"`
	Amount      float64              `json:"amount"`
	Currency    string               `json:"currency"`
	TrialDays   int                  `json:"trialDays,omitempty"`
}

// CreateSubscriptionParams represents params for enrolling a subscription.
type CreateSubscriptionParams struct {
	CustomerID string `json:"customerId"`
	PlanID     string `json:"planId"`
	TrialDays  int    `json:"trialDays,omitempty"`
}

// CancelParams represents params for cancelling a subscription.
type CancelParams struct {
	Immediately bool   `json:"immediately,omitempty"`
	Reason      string `json:"reason,omitempty"`
}

// PauseParams represents params for pausing a subscription.
type PauseParams struct {
	ResumeAt *time.Time `json:"resumeAt,omitempty"`
}

// SubscriptionsService handles subscription operations.
type SubscriptionsService struct {
	client *Client
}

// CreatePlan creates a new subscription plan.
func (s *SubscriptionsService) CreatePlan(ctx context.Context, params CreatePlanParams) (*Plan, error) {
	var out Plan
	return &out, s.client.do(ctx, "POST", "/plans", params, &out)
}

// ListPlans lists plans for a merchant.
func (s *SubscriptionsService) ListPlans(ctx context.Context, merchantID string) ([]Plan, error) {
	var out []Plan
	return out, s.client.do(ctx, "GET", fmt.Sprintf("/plans/%s", merchantID), nil, &out)
}

// GetPlan gets a plan by ID.
func (s *SubscriptionsService) GetPlan(ctx context.Context, planID string) (*Plan, error) {
	var out Plan
	return &out, s.client.do(ctx, "GET", fmt.Sprintf("/plans/detail/%s", planID), nil, &out)
}

// Enroll enrolls a customer in a subscription plan.
func (s *SubscriptionsService) Enroll(ctx context.Context, params CreateSubscriptionParams) (*Subscription, error) {
	var out Subscription
	return &out, s.client.do(ctx, "POST", "/subscriptions/enroll", params, &out)
}

// Get gets a subscription by ID.
func (s *SubscriptionsService) Get(ctx context.Context, id string) (*Subscription, error) {
	var out Subscription
	return &out, s.client.do(ctx, "GET", fmt.Sprintf("/subscriptions/%s", id), nil, &out)
}

// Cancel cancels a subscription.
func (s *SubscriptionsService) Cancel(ctx context.Context, id string, params CancelParams) (*Subscription, error) {
	var out Subscription
	if err := s.client.do(ctx, "DELETE", fmt.Sprintf("/subscriptions/%s", id), params, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Pause pauses a subscription.
func (s *SubscriptionsService) Pause(ctx context.Context, id string, params PauseParams) (*Subscription, error) {
	var out Subscription
	if err := s.client.do(ctx, "POST", fmt.Sprintf("/subscriptions/%s/pause", id), params, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Reactivate reactivates a paused subscription.
func (s *SubscriptionsService) Reactivate(ctx context.Context, id string) (*Subscription, error) {
	var out Subscription
	if err := s.client.do(ctx, "POST", fmt.Sprintf("/subscriptions/%s/reactivate", id), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

// Invoice represents an invoice.
type Invoice struct {
	ID             string     `json:"id"`
	ProjectID      string     `json:"projectId"`
	MerchantID     string     `json:"merchantId"`
	WorkDescription string   `json:"workDescription"`
	HoursWorked    float64    `json:"hoursWorked,omitempty"`
	HourlyRate     float64    `json:"hourlyRate,omitempty"`
	TotalAmount    float64    `json:"totalAmount"`
	Currency       string     `json:"currency"`
	Status         string     `json:"status"`
	CreatedAt      time.Time  `json:"createdAt"`
}

// GenerateInvoiceParams represents params for generating an invoice.
type GenerateInvoiceParams struct {
	ProjectID       string  `json:"projectId"`
	MerchantID      string  `json:"merchantId"`
	WorkDescription string  `json:"workDescription"`
	HoursWorked     float64 `json:"hoursWorked,omitempty"`
	HourlyRate      float64 `json:"hourlyRate,omitempty"`
	CountryCode     string  `json:"countryCode,omitempty"`
}

// InvoicesService handles invoice operations.
type InvoicesService struct {
	client *Client
}

// Generate generates a new invoice.
func (i *InvoicesService) Generate(ctx context.Context, params GenerateInvoiceParams) (*Invoice, error) {
	var out Invoice
	return &out, i.client.do(ctx, "POST", "/invoice/generate", params, &out)
}

// Get gets an invoice by ID.
func (i *InvoicesService) Get(ctx context.Context, id string) (*Invoice, error) {
	var out Invoice
	return &out, i.client.do(ctx, "GET", fmt.Sprintf("/invoice/%s", id), nil, &out)
}

// ListForMerchant lists invoices for a merchant.
func (i *InvoicesService) ListForMerchant(ctx context.Context, merchantID string, p ListParams) (*Page[Invoice], error) {
	var out Page[Invoice]
	path := fmt.Sprintf("/invoice/merchant/%s%s", merchantID, p.toQuery())
	return &out, i.client.do(ctx, "GET", path, nil, &out)
}

// ─── Escrow ───────────────────────────────────────────────────────────────────

// EscrowMilestone represents a milestone in an escrow agreement.
type EscrowMilestone struct {
	Title              string  `json:"title"`
	Description        string  `json:"description,omitempty"`
	Amount             float64 `json:"amount"`
	CompletionCriteria string  `json:"completionCriteria"`
	Status             string  `json:"status,omitempty"`
}

// Escrow represents an escrow agreement.
type Escrow struct {
	ID            string            `json:"id"`
	ProjectID     string            `json:"projectId"`
	PayerID       string            `json:"payerId"`
	PayeeID       string            `json:"payeeId"`
	Currency      string            `json:"currency"`
	TotalAmount   float64           `json:"totalAmount"`
	FundedAmount  float64           `json:"fundedAmount"`
	Status        string            `json:"status"`
	Milestones    []EscrowMilestone `json:"milestones"`
	CreatedAt     time.Time         `json:"createdAt"`
	UpdatedAt     time.Time         `json:"updatedAt"`
}

// CreateEscrowParams represents params for creating an escrow.
type CreateEscrowParams struct {
	ProjectID   string            `json:"projectId"`
	PayerID     string            `json:"payerId"`
	PayeeID     string            `json:"payeeId"`
	Currency    string            `json:"currency"`
	TotalAmount float64           `json:"totalAmount"`
	Milestones  []EscrowMilestone `json:"milestones"`
}

// EscrowService handles escrow operations.
type EscrowService struct {
	client *Client
}

// Create creates a new escrow agreement.
func (e *EscrowService) Create(ctx context.Context, params CreateEscrowParams) (*Escrow, error) {
	var out Escrow
	return &out, e.client.do(ctx, "POST", "/escrow", params, &out)
}

// Get gets an escrow by ID.
func (e *EscrowService) Get(ctx context.Context, id string) (*Escrow, error) {
	var out Escrow
	return &out, e.client.do(ctx, "GET", fmt.Sprintf("/escrow/%s", id), nil, &out)
}

// Fund funds an escrow.
func (e *EscrowService) Fund(ctx context.Context, id string, amount float64) (*Escrow, error) {
	var out Escrow
	return &out, e.client.do(ctx, "POST", fmt.Sprintf("/escrow/%s/fund", id), map[string]float64{"amount": amount}, &out)
}

// ConfirmMilestone confirms a milestone in an escrow.
func (e *EscrowService) ConfirmMilestone(ctx context.Context, escrowID, milestoneID string) (*Escrow, error) {
	var out Escrow
	return &out, e.client.do(ctx, "POST", fmt.Sprintf("/escrow/%s/milestones/%s/confirm", escrowID, milestoneID), nil, &out)
}

// ─── Disputes ─────────────────────────────────────────────────────────────────

// Dispute represents a payment dispute.
type Dispute struct {
	ID         string    `json:"id"`
	EscrowID   string    `json:"escrowId,omitempty"`
	PaymentID  string    `json:"paymentId,omitempty"`
	RaisedBy   string    `json:"raisedBy"`
	Reason     string    `json:"reason"`
	Status     string    `json:"status"`
	Resolution string    `json:"resolution,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

// CreateDisputeParams represents params for filing a dispute.
type CreateDisputeParams struct {
	EscrowID  string   `json:"escrowId,omitempty"`
	PaymentID string   `json:"paymentId,omitempty"`
	Reason    string   `json:"reason"`
	Evidence  []string `json:"evidence,omitempty"`
}

// DisputesService handles dispute operations.
type DisputesService struct {
	client *Client
}

// Create files a new dispute.
func (d *DisputesService) Create(ctx context.Context, params CreateDisputeParams) (*Dispute, error) {
	var out Dispute
	return &out, d.client.do(ctx, "POST", "/disputes", params, &out)
}

// Get gets a dispute by ID.
func (d *DisputesService) Get(ctx context.Context, id string) (*Dispute, error) {
	var out Dispute
	return &out, d.client.do(ctx, "GET", fmt.Sprintf("/disputes/%s", id), nil, &out)
}

// Respond responds to a dispute.
func (d *DisputesService) Respond(ctx context.Context, id string, response string, evidence []string) (*Dispute, error) {
	var out Dispute
	body := map[string]interface{}{"response": response}
	if evidence != nil {
		body["evidence"] = evidence
	}
	return &out, d.client.do(ctx, "POST", fmt.Sprintf("/disputes/%s/respond", id), body, &out)
}

// ─── Stellar ──────────────────────────────────────────────────────────────────

// StellarPayment represents a Stellar payment.
type StellarPayment struct {
	ID              string `json:"id"`
	TransactionHash string `json:"transactionHash"`
	From            string `json:"from"`
	To              string `json:"to"`
	Amount          string `json:"amount"`
	Asset           string `json:"asset"`
	Status          string `json:"status"`
}

// StellarService handles Stellar blockchain queries.
type StellarService struct {
	client *Client
}

// GetPayment gets a payment by transaction hash.
func (s *StellarService) GetPayment(ctx context.Context, txHash string) (*StellarPayment, error) {
	var out StellarPayment
	return &out, s.client.do(ctx, "GET", fmt.Sprintf("/stellar/payment/%s", txHash), nil, &out)
}

// ─── Sandbox ──────────────────────────────────────────────────────────────────

// SandboxStatus represents sandbox environment status.
type SandboxStatus struct {
	Healthy       bool `json:"healthy"`
	StellarTestnet bool `json:"stellarTestnet"`
	MockPayments  bool `json:"mockPayments"`
}

// SandboxPaymentParams represents params for processing a sandbox payment.
type SandboxPaymentParams struct {
	From     string  `json:"from"`
	To       string  `json:"to"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	Memo     string  `json:"memo,omitempty"`
}

// SandboxService handles sandbox environment operations.
type SandboxService struct {
	client *Client
}

// GetStatus gets the sandbox environment status.
func (s *SandboxService) GetStatus(ctx context.Context) (*SandboxStatus, error) {
	var out SandboxStatus
	return &out, s.client.do(ctx, "GET", "/sandbox/status", nil, &out)
}

// ProcessPayment processes a mock payment in the sandbox.
func (s *SandboxService) ProcessPayment(ctx context.Context, params SandboxPaymentParams) (map[string]interface{}, error) {
	var out map[string]interface{}
	return out, s.client.do(ctx, "POST", "/sandbox/payments/process", params, &out)
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

// WebhookEvent is the parsed payload of an inbound webhook.
type WebhookEvent struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	CreatedAt time.Time       `json:"createdAt"`
	Data      json.RawMessage `json:"data"`
}

// ErrInvalidSignature is returned when webhook signature verification fails.
var ErrInvalidSignature = errors.New("agenticpay: invalid webhook signature")

// WebhookService handles webhook verification.
type WebhookService struct {
	client *Client
}

// Verify verifies a webhook signature and returns the parsed event.
func (w *WebhookService) Verify(secret, signature string, body []byte) (*WebhookEvent, error) {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return nil, ErrInvalidSignature
	}

	var evt WebhookEvent
	if err := json.Unmarshal(body, &evt); err != nil {
		return nil, fmt.Errorf("agenticpay: parse webhook event: %w", err)
	}
	return &evt, nil
}
