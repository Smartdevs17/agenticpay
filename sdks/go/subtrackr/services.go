package subtrackr

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

// ─── Billing ──────────────────────────────────────────────────────────────────

// Invoice represents a billing invoice.
type Invoice struct {
	ID             string     `json:"id"`
	SubscriptionID string     `json:"subscriptionId"`
	CustomerID     string     `json:"customerId"`
	AmountDue      int64      `json:"amountDue"`   // smallest currency unit
	AmountPaid     int64      `json:"amountPaid"`
	Currency       string     `json:"currency"`
	Status         string     `json:"status"`
	DueDate        *time.Time `json:"dueDate,omitempty"`
	PaidAt         *time.Time `json:"paidAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
}

// BillingService manages invoices and payment retries.
type BillingService struct {
	client *Client
}

// GetInvoice retrieves a specific invoice.
func (b *BillingService) GetInvoice(ctx context.Context, id string) (*Invoice, error) {
	var out Invoice
	return &out, b.client.do(ctx, "GET", fmt.Sprintf("/api/v1/billing/invoices/%s", id), nil, &out)
}

// ListInvoices lists invoices for a subscription.
func (b *BillingService) ListInvoices(ctx context.Context, subscriptionID string, p ListParams) (*Page[Invoice], error) {
	var out Page[Invoice]
	path := fmt.Sprintf("/api/v1/billing/invoices?subscriptionId=%s%s", subscriptionID, p.toQuery())
	return &out, b.client.do(ctx, "GET", path, nil, &out)
}

// RetryInvoice retries payment for a failed invoice.
func (b *BillingService) RetryInvoice(ctx context.Context, invoiceID string) (*Invoice, error) {
	var out Invoice
	return &out, b.client.do(ctx, "POST", fmt.Sprintf("/api/v1/billing/invoices/%s/retry", invoiceID), nil, &out)
}

// ─── Dunning ──────────────────────────────────────────────────────────────────

// DunningRecord represents the dunning state for a subscription.
type DunningRecord struct {
	SubscriptionID string     `json:"subscriptionId"`
	Attempts       int        `json:"attempts"`
	NextRetryAt    *time.Time `json:"nextRetryAt,omitempty"`
	Status         string     `json:"status"` // "active" | "resolved" | "failed"
	LastError      string     `json:"lastError,omitempty"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

// DunningService manages dunning (failed-payment recovery) workflows.
type DunningService struct {
	client *Client
}

// Get returns the current dunning state for a subscription.
func (d *DunningService) Get(ctx context.Context, subscriptionID string) (*DunningRecord, error) {
	var out DunningRecord
	return &out, d.client.do(ctx, "GET", fmt.Sprintf("/api/v1/dunning/%s", subscriptionID), nil, &out)
}

// Resolve manually marks a dunning cycle as resolved (e.g., after out-of-band payment).
func (d *DunningService) Resolve(ctx context.Context, subscriptionID string) (*DunningRecord, error) {
	var out DunningRecord
	return &out, d.client.do(ctx, "POST", fmt.Sprintf("/api/v1/dunning/%s/resolve", subscriptionID), nil, &out)
}

// ─── Metering ─────────────────────────────────────────────────────────────────

// UsageRecord records metered usage for a subscription feature.
type UsageRecord struct {
	ID             string    `json:"id"`
	SubscriptionID string    `json:"subscriptionId"`
	Feature        string    `json:"feature"`
	Quantity       float64   `json:"quantity"`
	Timestamp      time.Time `json:"timestamp"`
}

// ReportUsageParams describes a usage event to report.
type ReportUsageParams struct {
	SubscriptionID string    `json:"subscriptionId"`
	Feature        string    `json:"feature"`
	Quantity       float64   `json:"quantity"`
	Timestamp      time.Time `json:"timestamp,omitempty"`
}

// UsageSummary summarises metered usage for a billing period.
type UsageSummary struct {
	SubscriptionID string             `json:"subscriptionId"`
	PeriodStart    time.Time          `json:"periodStart"`
	PeriodEnd      time.Time          `json:"periodEnd"`
	Totals         map[string]float64 `json:"totals"` // feature -> total quantity
}

// MeteringService manages usage metering.
type MeteringService struct {
	client *Client
}

// Report records a usage event.
func (m *MeteringService) Report(ctx context.Context, p ReportUsageParams) (*UsageRecord, error) {
	var out UsageRecord
	return &out, m.client.do(ctx, "POST", "/api/v1/metering/usage", p, &out)
}

// GetSummary returns aggregated usage for a subscription's current billing period.
func (m *MeteringService) GetSummary(ctx context.Context, subscriptionID string) (*UsageSummary, error) {
	var out UsageSummary
	return &out, m.client.do(ctx, "GET",
		fmt.Sprintf("/api/v1/metering/usage/%s/summary", subscriptionID), nil, &out)
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
var ErrInvalidSignature = errors.New("subtrackr: invalid webhook signature")

// WebhookService handles webhook verification.
type WebhookService struct {
	client *Client
}

// Verify verifies the HMAC-SHA256 signature of an incoming webhook and returns
// the parsed event. sigHeader is the value of the X-SubTrackr-Signature header.
//
// Timing-safe comparison is used to prevent side-channel attacks.
func (w *WebhookService) Verify(secret, sigHeader string, body []byte) (*WebhookEvent, error) {
	if sigHeader == "" {
		return nil, ErrInvalidSignature
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(sigHeader)) {
		return nil, ErrInvalidSignature
	}

	var evt WebhookEvent
	if err := json.Unmarshal(body, &evt); err != nil {
		return nil, fmt.Errorf("subtrackr: parse webhook event: %w", err)
	}
	return &evt, nil
}
