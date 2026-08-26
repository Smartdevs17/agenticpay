package subtrackr

import (
	"context"
	"fmt"
	"time"
)

// ─── Types ────────────────────────────────────────────────────────────────────

// SubscriptionStatus represents the current lifecycle state of a subscription.
type SubscriptionStatus string

const (
	SubscriptionStatusActive    SubscriptionStatus = "active"
	SubscriptionStatusPaused    SubscriptionStatus = "paused"
	SubscriptionStatusCancelled SubscriptionStatus = "cancelled"
	SubscriptionStatusTrialing  SubscriptionStatus = "trialing"
	SubscriptionStatusPastDue   SubscriptionStatus = "past_due"
	SubscriptionStatusUnpaid    SubscriptionStatus = "unpaid"
)

// BillingInterval represents the billing frequency.
type BillingInterval string

const (
	BillingIntervalDaily   BillingInterval = "daily"
	BillingIntervalWeekly  BillingInterval = "weekly"
	BillingIntervalMonthly BillingInterval = "monthly"
	BillingIntervalYearly  BillingInterval = "yearly"
)

// Subscription is the full subscription resource.
type Subscription struct {
	ID                 string             `json:"id"`
	CustomerID         string             `json:"customerId"`
	PlanID             string             `json:"planId"`
	Status             SubscriptionStatus `json:"status"`
	CurrentPeriodStart time.Time          `json:"currentPeriodStart"`
	CurrentPeriodEnd   time.Time          `json:"currentPeriodEnd"`
	CancelAtPeriodEnd  bool               `json:"cancelAtPeriodEnd"`
	PausedAt           *time.Time         `json:"pausedAt,omitempty"`
	CancelledAt        *time.Time         `json:"cancelledAt,omitempty"`
	TrialEnd           *time.Time         `json:"trialEnd,omitempty"`
	Metadata           map[string]string  `json:"metadata,omitempty"`
	CreatedAt          time.Time          `json:"createdAt"`
	UpdatedAt          time.Time          `json:"updatedAt"`
}

// CreateSubscriptionParams are the parameters for creating a subscription.
type CreateSubscriptionParams struct {
	CustomerID        string            `json:"customerId"`
	PlanID            string            `json:"planId"`
	TrialDays         int               `json:"trialDays,omitempty"`
	CancelAtPeriodEnd bool              `json:"cancelAtPeriodEnd,omitempty"`
	Metadata          map[string]string `json:"metadata,omitempty"`
}

// UpdateSubscriptionParams are the parameters for updating a subscription.
type UpdateSubscriptionParams struct {
	PlanID            *string           `json:"planId,omitempty"`
	CancelAtPeriodEnd *bool             `json:"cancelAtPeriodEnd,omitempty"`
	Metadata          map[string]string `json:"metadata,omitempty"`
}

// PauseParams controls subscription pause behaviour.
type PauseParams struct {
	// ResumeAt, if non-nil, schedules automatic reactivation.
	ResumeAt *time.Time `json:"resumeAt,omitempty"`
}

// CancelParams controls subscription cancellation behaviour.
type CancelParams struct {
	// Immediately cancels when true; otherwise cancels at period end.
	Immediately bool   `json:"immediately,omitempty"`
	Reason      string `json:"reason,omitempty"`
}

// ─── Service ──────────────────────────────────────────────────────────────────

// SubscriptionService exposes all subscription lifecycle operations.
type SubscriptionService struct {
	client *Client
}

// Create creates a new subscription.
func (s *SubscriptionService) Create(ctx context.Context, p CreateSubscriptionParams) (*Subscription, error) {
	var out Subscription
	if err := s.client.do(ctx, "POST", "/api/v1/subscriptions", p, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Get retrieves a subscription by ID.
func (s *SubscriptionService) Get(ctx context.Context, id string) (*Subscription, error) {
	var out Subscription
	if err := s.client.do(ctx, "GET", fmt.Sprintf("/api/v1/subscriptions/%s", id), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// List returns a paginated list of subscriptions.
func (s *SubscriptionService) List(ctx context.Context, p ListParams) (*Page[Subscription], error) {
	var out Page[Subscription]
	if err := s.client.do(ctx, "GET", "/api/v1/subscriptions"+p.toQuery(), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Update updates mutable fields on a subscription.
func (s *SubscriptionService) Update(ctx context.Context, id string, p UpdateSubscriptionParams) (*Subscription, error) {
	var out Subscription
	if err := s.client.do(ctx, "PATCH", fmt.Sprintf("/api/v1/subscriptions/%s", id), p, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Cancel cancels a subscription, either immediately or at period end.
func (s *SubscriptionService) Cancel(ctx context.Context, id string, p CancelParams) (*Subscription, error) {
	var out Subscription
	if err := s.client.do(ctx, "DELETE", fmt.Sprintf("/api/v1/subscriptions/%s", id), p, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Pause pauses a subscription, optionally scheduling automatic reactivation.
func (s *SubscriptionService) Pause(ctx context.Context, id string, p PauseParams) (*Subscription, error) {
	var out Subscription
	if err := s.client.do(ctx, "POST", fmt.Sprintf("/api/v1/subscriptions/%s/pause", id), p, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Reactivate reactivates a paused or cancelled subscription.
func (s *SubscriptionService) Reactivate(ctx context.Context, id string) (*Subscription, error) {
	var out Subscription
	if err := s.client.do(ctx, "POST", fmt.Sprintf("/api/v1/subscriptions/%s/reactivate", id), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
