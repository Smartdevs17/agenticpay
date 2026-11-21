// Package agenticpay provides a Go SDK for the AgenticPay payment platform API.
// It covers escrow management, subscription plans, work verification, refunds,
// Stellar blockchain integration, and webhook signature verification.
//
// Usage:
//
//	client := agenticpay.New("https://api.agenticpay.com/api/v1", "sk_live_...")
//	escrow, err := client.Escrow.Create(ctx, agenticpay.CreateEscrowParams{...})
package agenticpay

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// ─── Client ───────────────────────────────────────────────────────────────────

// Client is the root AgenticPay API client.
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client

	Payments      *PaymentsService
	Verification  *VerificationService
	Subscriptions *SubscriptionsService
	Invoices      *InvoicesService
	Escrow        *EscrowService
	Disputes      *DisputesService
	Stellar       *StellarService
	Sandbox       *SandboxService
	Webhooks      *WebhookService
}

// New creates a new AgenticPay client.
func New(baseURL, apiKey string) *Client {
	c := &Client{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
	c.Payments = &PaymentsService{client: c}
	c.Verification = &VerificationService{client: c}
	c.Subscriptions = &SubscriptionsService{client: c}
	c.Invoices = &InvoicesService{client: c}
	c.Escrow = &EscrowService{client: c}
	c.Disputes = &DisputesService{client: c}
	c.Stellar = &StellarService{client: c}
	c.Sandbox = &SandboxService{client: c}
	c.Webhooks = &WebhookService{client: c}
	return c
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

// APIError represents an error returned by the API.
type APIError struct {
	StatusCode int    `json:"-"`
	Code       string `json:"code"`
	Message    string `json:"message"`
}

func (e *APIError) Error() string {
	return fmt.Sprintf("agenticpay: %s (HTTP %d, code=%s)", e.Message, e.StatusCode, e.Code)
}

func (c *Client) do(ctx context.Context, method, path string, body, out interface{}) error {
	return c.doWithRetry(ctx, method, path, body, out, 3)
}

func (c *Client) doWithRetry(ctx context.Context, method, path string, body, out interface{}, maxAttempts int) error {
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			wait := time.Duration(math.Pow(2, float64(attempt))) * 200 * time.Millisecond
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
			}
		}
		err := c.doOnce(ctx, method, path, body, out)
		if err == nil {
			return nil
		}
		// Retry on 429 or 5xx
		if apiErr, ok := err.(*APIError); ok {
			if apiErr.StatusCode == 429 || apiErr.StatusCode >= 500 {
				lastErr = err
				continue
			}
		}
		return err // Non-retryable
	}
	return lastErr
}

func (c *Client) doOnce(ctx context.Context, method, path string, body, out interface{}) error {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("agenticpay: marshal request: %w", err)
		}
		reqBody = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reqBody)
	if err != nil {
		return fmt.Errorf("agenticpay: build request: %w", err)
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("agenticpay: http: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("agenticpay: read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		var apiErr APIError
		apiErr.StatusCode = resp.StatusCode
		_ = json.Unmarshal(respBytes, &apiErr)
		if apiErr.Message == "" {
			// Try to extract from nested error object
			var errResp struct {
				Error struct {
					Message string `json:"message"`
					Code    string `json:"code"`
				} `json:"error"`
			}
			_ = json.Unmarshal(respBytes, &errResp)
			if errResp.Error.Message != "" {
				apiErr.Message = errResp.Error.Message
				apiErr.Code = errResp.Error.Code
			} else {
				apiErr.Message = http.StatusText(resp.StatusCode)
			}
		}
		return &apiErr
	}

	if out != nil {
		if err := json.Unmarshal(respBytes, out); err != nil {
			return fmt.Errorf("agenticpay: unmarshal response: %w", err)
		}
	}
	return nil
}

// ─── Pagination ───────────────────────────────────────────────────────────────

// ListParams contains common pagination parameters.
type ListParams struct {
	Limit  int    `json:"-"`
	Offset int    `json:"-"`
	Cursor string `json:"-"`
}

func (p ListParams) toQuery() string {
	q := url.Values{}
	if p.Limit > 0 {
		q.Set("limit", strconv.Itoa(p.Limit))
	}
	if p.Offset > 0 {
		q.Set("offset", strconv.Itoa(p.Offset))
	}
	if p.Cursor != "" {
		q.Set("cursor", p.Cursor)
	}
	if len(q) == 0 {
		return ""
	}
	return "?" + q.Encode()
}

// Page is a generic paginated response wrapper.
type Page[T any] struct {
	Data       []T    `json:"data"`
	Total      int    `json:"total"`
	Limit      int    `json:"limit"`
	Offset     int    `json:"offset"`
	NextCursor string `json:"nextCursor,omitempty"`
}
