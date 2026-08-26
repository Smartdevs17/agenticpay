// Package main demonstrates common AgenticPay Go SDK workflows.
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/Kappa16/agenticpay/sdks/go/agenticpay"
)

func main() {
	client := agenticpay.New("https://api.agenticpay.com/api/v1", "sk_live_your_key_here")
	ctx := context.Background()

	// ── Create a subscription plan ───────────────────────────────────────────
	plan, err := client.Subscriptions.CreatePlan(ctx, agenticpay.CreatePlanParams{
		MerchantID:  "m_abc123",
		Name:        "Pro Plan",
		Interval:    agenticpay.IntervalMonthly,
		Amount:      29.99,
		Currency:    "USD",
		TrialDays:   14,
	})
	if err != nil {
		log.Fatalf("create plan: %v", err)
	}
	fmt.Printf("Created plan %s (status: %v)\n", plan.ID, plan.IsActive)

	// ── Enroll a customer in a subscription ──────────────────────────────────
	sub, err := client.Subscriptions.Enroll(ctx, agenticpay.CreateSubscriptionParams{
		CustomerID: "cus_abc123",
		PlanID:     plan.ID,
	})
	if err != nil {
		log.Fatalf("enroll subscription: %v", err)
	}
	fmt.Printf("Created subscription %s (status: %s)\n", sub.ID, sub.Status)

	// ── Create an escrow agreement ───────────────────────────────────────────
	escrow, err := client.Escrow.Create(ctx, agenticpay.CreateEscrowParams{
		ProjectID:   "proj_001",
		PayerID:     "payer_001",
		PayeeID:     "payee_001",
		Currency:    "XLM",
		TotalAmount: 1000,
		Milestones: []agenticpay.EscrowMilestone{
			{
				Title:              "Design Phase",
				Amount:             500,
				CompletionCriteria: "Approved design mockups",
			},
			{
				Title:              "Development",
				Amount:             500,
				CompletionCriteria: "Working prototype delivered",
			},
		},
	})
	if err != nil {
		log.Fatalf("create escrow: %v", err)
	}
	fmt.Printf("Created escrow %s (status: %s)\n", escrow.ID, escrow.Status)

	// ── Verify freelancer work ───────────────────────────────────────────────
	verification, err := client.Verification.Verify(ctx, agenticpay.VerificationRequest{
		RepositoryURL:        "https://github.com/user/repo",
		MilestoneDescription: "Implement user authentication",
		ProjectID:            "proj_001",
	})
	if err != nil {
		log.Fatalf("verify work: %v", err)
	}
	fmt.Printf("Verification %s: status=%s\n", verification.ID, verification.Status)

	// ── Generate an invoice ──────────────────────────────────────────────────
	invoice, err := client.Invoices.Generate(ctx, agenticpay.GenerateInvoiceParams{
		ProjectID:       "proj_001",
		MerchantID:      "m_001",
		WorkDescription: "Full-stack development, 40 hours",
		HoursWorked:     40,
		HourlyRate:      75,
	})
	if err != nil {
		log.Fatalf("generate invoice: %v", err)
	}
	fmt.Printf("Invoice %s: total=%.2f %s\n", invoice.ID, invoice.TotalAmount, invoice.Currency)

	// ── Get Stellar payment status ───────────────────────────────────────────
	payment, err := client.Stellar.GetPayment(ctx, "abc123def456")
	if err != nil {
		log.Printf("get payment: %v", err)
	} else {
		fmt.Printf("Payment %s: status=%s\n", payment.ID, payment.Status)
	}

	// ── Verify a webhook ─────────────────────────────────────────────────────
	body := []byte(`{"id":"evt_1","type":"payment.completed","createdAt":"2026-01-01T00:00:00Z","data":{}}`)
	event, err := client.Webhooks.Verify("whsec_your_secret", "sha256=...", body)
	if err != nil {
		fmt.Println("Webhook signature invalid:", err)
	} else {
		fmt.Printf("Received event: %s\n", event.Type)
	}

	// ── Cancel subscription ──────────────────────────────────────────────────
	cancelled, err := client.Subscriptions.Cancel(ctx, sub.ID, agenticpay.CancelParams{
		Immediately: false,
		Reason:      "customer request",
	})
	if err != nil {
		log.Fatalf("cancel subscription: %v", err)
	}
	fmt.Printf("Subscription %s cancelled (status: %s)\n", cancelled.ID, cancelled.Status)
}
