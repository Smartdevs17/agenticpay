// Package main demonstrates common SubTrackr Go SDK workflows.
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/Smartdevs17/subtrackr/sdks/go/subtrackr"
)

func main() {
	client := subtrackr.New("https://api.subtrackr.io", "sk_live_your_key_here")
	ctx := context.Background()

	// ── Create a subscription ─────────────────────────────────────────────────
	sub, err := client.Subscriptions.Create(ctx, subtrackr.CreateSubscriptionParams{
		CustomerID: "cus_abc123",
		PlanID:     "plan_monthly",
		TrialDays:  14,
	})
	if err != nil {
		log.Fatalf("create subscription: %v", err)
	}
	fmt.Printf("Created subscription %s (status: %s)\n", sub.ID, sub.Status)

	// ── List subscriptions with pagination ────────────────────────────────────
	page, err := client.Subscriptions.List(ctx, subtrackr.ListParams{Limit: 20})
	if err != nil {
		log.Fatalf("list subscriptions: %v", err)
	}
	fmt.Printf("Total subscriptions: %d\n", page.Total)

	// ── Pause and reactivate ──────────────────────────────────────────────────
	resumeAt := time.Now().Add(7 * 24 * time.Hour)
	paused, err := client.Subscriptions.Pause(ctx, sub.ID, subtrackr.PauseParams{ResumeAt: &resumeAt})
	if err != nil {
		log.Fatalf("pause: %v", err)
	}
	fmt.Printf("Paused: %s\n", paused.Status)

	active, err := client.Subscriptions.Reactivate(ctx, sub.ID)
	if err != nil {
		log.Fatalf("reactivate: %v", err)
	}
	fmt.Printf("Reactivated: %s\n", active.Status)

	// ── Report metered usage ──────────────────────────────────────────────────
	_, err = client.Metering.Report(ctx, subtrackr.ReportUsageParams{
		SubscriptionID: sub.ID,
		Feature:        "api_calls",
		Quantity:       150,
		Timestamp:      time.Now(),
	})
	if err != nil {
		log.Fatalf("report usage: %v", err)
	}

	// ── Verify a webhook ──────────────────────────────────────────────────────
	body := []byte(`{"id":"evt_1","type":"subscription.created","createdAt":"2026-01-01T00:00:00Z","data":{}}`)
	event, err := client.Webhooks.Verify("whsec_your_secret", "sha256=...", body)
	if err != nil {
		fmt.Println("Webhook signature invalid:", err)
	} else {
		fmt.Printf("Received event: %s\n", event.Type)
	}

	// ── Cancel at period end ──────────────────────────────────────────────────
	cancelled, err := client.Subscriptions.Cancel(ctx, sub.ID, subtrackr.CancelParams{
		Immediately: false,
		Reason:      "customer request",
	})
	if err != nil {
		log.Fatalf("cancel: %v", err)
	}
	fmt.Printf("Cancellation scheduled: %s\n", cancelled.Status)
}
