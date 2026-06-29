package subtrackr_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Smartdevs17/subtrackr/sdks/go/subtrackr"
)

// newTestServer creates a test HTTP server that always returns the given status
// and JSON-encoded body.
func newTestServer(t *testing.T, status int, body interface{}) (*httptest.Server, *subtrackr.Client) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	return srv, subtrackr.New(srv.URL, "test_key")
}

// ─── Subscription lifecycle ───────────────────────────────────────────────────

func TestSubscriptionCreate(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	want := subtrackr.Subscription{
		ID:         "sub_001",
		CustomerID: "cus_001",
		PlanID:     "plan_monthly",
		Status:     subtrackr.SubscriptionStatusActive,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	_, client := newTestServer(t, http.StatusOK, want)

	got, err := client.Subscriptions.Create(context.Background(), subtrackr.CreateSubscriptionParams{
		CustomerID: "cus_001",
		PlanID:     "plan_monthly",
	})
	if err != nil {
		t.Fatalf("Create: unexpected error: %v", err)
	}
	if got.ID != want.ID {
		t.Errorf("ID: got %q, want %q", got.ID, want.ID)
	}
	if got.Status != want.Status {
		t.Errorf("Status: got %q, want %q", got.Status, want.Status)
	}
}

func TestSubscriptionGet(t *testing.T) {
	want := subtrackr.Subscription{ID: "sub_002", Status: subtrackr.SubscriptionStatusPaused}
	_, client := newTestServer(t, http.StatusOK, want)

	got, err := client.Subscriptions.Get(context.Background(), "sub_002")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.ID != "sub_002" {
		t.Errorf("ID mismatch: %s", got.ID)
	}
}

func TestSubscriptionUpdate(t *testing.T) {
	newPlan := "plan_yearly"
	want := subtrackr.Subscription{ID: "sub_003", PlanID: newPlan, Status: subtrackr.SubscriptionStatusActive}
	_, client := newTestServer(t, http.StatusOK, want)

	got, err := client.Subscriptions.Update(context.Background(), "sub_003", subtrackr.UpdateSubscriptionParams{
		PlanID: &newPlan,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if got.PlanID != newPlan {
		t.Errorf("PlanID: got %q, want %q", got.PlanID, newPlan)
	}
}

func TestSubscriptionCancel(t *testing.T) {
	now := time.Now()
	want := subtrackr.Subscription{ID: "sub_004", Status: subtrackr.SubscriptionStatusCancelled, CancelledAt: &now}
	_, client := newTestServer(t, http.StatusOK, want)

	got, err := client.Subscriptions.Cancel(context.Background(), "sub_004", subtrackr.CancelParams{Immediately: true})
	if err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if got.Status != subtrackr.SubscriptionStatusCancelled {
		t.Errorf("Status: got %q", got.Status)
	}
}

func TestSubscriptionPauseReactivate(t *testing.T) {
	tests := []struct {
		name       string
		serverBody subtrackr.Subscription
		run        func(c *subtrackr.Client) (*subtrackr.Subscription, error)
	}{
		{
			name:       "pause",
			serverBody: subtrackr.Subscription{ID: "sub_005", Status: subtrackr.SubscriptionStatusPaused},
			run: func(c *subtrackr.Client) (*subtrackr.Subscription, error) {
				return c.Subscriptions.Pause(context.Background(), "sub_005", subtrackr.PauseParams{})
			},
		},
		{
			name:       "reactivate",
			serverBody: subtrackr.Subscription{ID: "sub_005", Status: subtrackr.SubscriptionStatusActive},
			run: func(c *subtrackr.Client) (*subtrackr.Subscription, error) {
				return c.Subscriptions.Reactivate(context.Background(), "sub_005")
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, client := newTestServer(t, http.StatusOK, tc.serverBody)
			got, err := tc.run(client)
			if err != nil {
				t.Fatalf("%s: %v", tc.name, err)
			}
			if got.Status != tc.serverBody.Status {
				t.Errorf("Status: got %q, want %q", got.Status, tc.serverBody.Status)
			}
		})
	}
}

// ─── Webhook signature verification ──────────────────────────────────────────

func makeSignature(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestWebhookVerify(t *testing.T) {
	client := subtrackr.New("https://example.com", "key")
	secret := "whsec_test"
	body := []byte(`{"id":"evt_1","type":"subscription.created","createdAt":"2026-01-01T00:00:00Z","data":{}}`)
	validSig := makeSignature(secret, body)

	tests := []struct {
		name    string
		sig     string
		wantErr bool
	}{
		{"valid signature", validSig, false},
		{"wrong signature", "sha256=deadbeef", true},
		{"empty signature", "", true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			evt, err := client.Webhooks.Verify(secret, tc.sig, body)
			if tc.wantErr {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if evt.ID != "evt_1" {
				t.Errorf("event ID: got %q", evt.ID)
			}
		})
	}
}

// ─── Error handling ───────────────────────────────────────────────────────────

func TestAPIError(t *testing.T) {
	errBody := map[string]string{"code": "not_found", "message": "subscription not found"}
	_, client := newTestServer(t, http.StatusNotFound, errBody)

	_, err := client.Subscriptions.Get(context.Background(), "sub_missing")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	apiErr, ok := err.(*subtrackr.APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if apiErr.StatusCode != http.StatusNotFound {
		t.Errorf("StatusCode: got %d, want %d", apiErr.StatusCode, http.StatusNotFound)
	}
	if apiErr.Code != "not_found" {
		t.Errorf("Code: got %q, want %q", apiErr.Code, "not_found")
	}
}

func TestListPagination(t *testing.T) {
	want := subtrackr.Page[subtrackr.Subscription]{
		Data:  []subtrackr.Subscription{{ID: "sub_p1"}, {ID: "sub_p2"}},
		Total: 100,
		Limit: 2,
	}
	_, client := newTestServer(t, http.StatusOK, want)

	page, err := client.Subscriptions.List(context.Background(), subtrackr.ListParams{Limit: 2})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if page.Total != 100 {
		t.Errorf("Total: got %d, want 100", page.Total)
	}
	if len(page.Data) != 2 {
		t.Errorf("len(Data): got %d, want 2", len(page.Data))
	}
}
