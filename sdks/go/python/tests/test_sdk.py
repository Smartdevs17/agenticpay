"""Tests for the AgenticPay Python SDK."""

import json
import time
from typing import Any

import pytest

from agenticpay import (
    AgenticPayError,
    AgenticPaySDK,
    AuthenticationError,
    ClientConfig,
    NotFoundError,
    RateLimitError,
    ValidationError,
    create_agenticpay_sdk,
    verify_webhook_signature,
)
from agenticpay.client import AgenticPayClient, RetryConfig
from agenticpay.testing import (
    MockAgenticPayServer,
    MockRoute,
    create_test_client,
    create_test_sdk,
)
from agenticpay.types import (
    CancelSubscriptionInput,
    CreatePlanInput,
    CreateSubscriptionInput,
    InvoiceRequest,
    RefundEvaluationInput,
    RefundPolicyInput,
    SplitConfigInput,
    SplitRecipient,
    SubscriptionInterval,
    VerificationRequest,
)
from agenticpay.auth import AuthProvider, build_auth_header
from agenticpay.errors import raise_for_status


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def mock_server():
    server = MockAgenticPayServer()
    server.start()
    yield server
    server.stop()


@pytest.fixture
def sdk(mock_server):
    return create_test_sdk(base_url=mock_server.url)


# ─── Error tests ──────────────────────────────────────────────────────────────

class TestErrors:
    def test_agenticpay_error_attributes(self):
        err = AgenticPayError("test", status=500, code="ERR_INTERNAL")
        assert err.message == "test"
        assert err.status == 500
        assert err.code == "ERR_INTERNAL"
        assert str(err) == "test"

    def test_authentication_error(self):
        err = AuthenticationError()
        assert err.status == 401
        assert err.code == "AUTHENTICATION_ERROR"

    def test_validation_error(self):
        err = ValidationError("bad input", details={"field": "name"})
        assert err.status == 400
        assert err.details == {"field": "name"}

    def test_raise_for_status_400(self):
        with pytest.raises(ValidationError):
            raise_for_status(400, {"error": {"message": "bad"}})

    def test_raise_for_status_401(self):
        with pytest.raises(AuthenticationError):
            raise_for_status(401, {"error": {"message": "unauthorized"}})

    def test_raise_for_status_404(self):
        with pytest.raises(NotFoundError):
            raise_for_status(404, {"error": {"message": "not found"}})

    def test_raise_for_status_429(self):
        with pytest.raises(RateLimitError):
            raise_for_status(429, {"error": {"message": "rate limited"}})

    def test_raise_for_status_ok(self):
        raise_for_status(200, {"data": "ok"})  # Should not raise


# ─── Client tests ─────────────────────────────────────────────────────────────

class TestClient:
    def test_client_sends_api_key(self, mock_server):
        mock_server.add_route(MockRoute("GET", "/health", body={"status": "ok"}))
        client = create_test_client(base_url=mock_server.url, api_key="my_key")
        client.get("/health")
        req = mock_server.get_last_request()
        assert req["headers"].get("x-api-key") == "my_key"

    def test_client_handles_404(self, mock_server):
        client = create_test_client(base_url=mock_server.url)
        with pytest.raises(NotFoundError):
            client.get("/nonexistent")

    def test_client_handles_error_response(self, mock_server):
        mock_server.add_route(
            MockRoute("POST", "/test", status=400, body={"error": {"message": "bad request", "code": "ERR_VALIDATION_FAILED"}})
        )
        client = create_test_client(base_url=mock_server.url)
        with pytest.raises(AgenticPayError) as exc_info:
            client.post("/test", {})
        assert exc_info.value.code == "ERR_VALIDATION_FAILED"


# ─── SDK service tests ───────────────────────────────────────────────────────

class TestVerificationApi:
    def test_verify_work(self, mock_server, sdk):
        expected = {"id": "v_1", "status": "verified"}
        mock_server.add_route(
            MockRoute("POST", "/verification/verify", body=expected)
        )
        result = sdk.verification.verify_work(
            VerificationRequest(
                repository_url="https://github.com/user/repo",
                milestone_description="Build login page",
                project_id="proj_1",
            )
        )
        assert result == expected

    def test_verify_work_batch(self, mock_server, sdk):
        expected = {"results": [{"id": "v_1"}, {"id": "v_2"}]}
        mock_server.add_route(
            MockRoute("POST", "/verification/verify/batch", body=expected)
        )
        items = [
            VerificationRequest("url1", "desc1", "proj1"),
            VerificationRequest("url2", "desc2", "proj2"),
        ]
        result = sdk.verification.verify_work_batch(items)
        assert result == expected

    def test_generate_invoice(self, mock_server, sdk):
        expected = {"id": "inv_1", "totalAmount": 100}
        mock_server.add_route(
            MockRoute("POST", "/invoice/generate", body=expected)
        )
        result = sdk.verification.generate_invoice(
            InvoiceRequest(
                project_id="proj_1",
                work_description="Development work",
                merchant_id="m_1",
                hours_worked=10,
                hourly_rate=10,
            )
        )
        assert result == expected


class TestSubscriptionsApi:
    def test_create_plan(self, mock_server, sdk):
        expected = {"id": "plan_1", "name": "Pro"}
        mock_server.add_route(MockRoute("POST", "/plans", body=expected))
        result = sdk.subscriptions.create_plan(
            CreatePlanInput(
                merchant_id="m_1",
                name="Pro",
                interval=SubscriptionInterval.MONTHLY,
                amount=29.99,
                currency="USD",
            )
        )
        assert result == expected

    def test_enroll(self, mock_server, sdk):
        expected = {"id": "sub_1", "status": "active"}
        mock_server.add_route(
            MockRoute("POST", "/subscriptions/enroll", body=expected)
        )
        result = sdk.subscriptions.enroll(
            CreateSubscriptionInput(customer_id="cus_1", plan_id="plan_1")
        )
        assert result == expected

    def test_cancel(self, mock_server, sdk):
        expected = {"id": "sub_1", "status": "cancelled"}
        mock_server.add_route(
            MockRoute("DELETE", "/subscriptions/sub_1", body=expected)
        )
        result = sdk.subscriptions.cancel("sub_1", CancelSubscriptionInput(immediately=True))
        assert result["status"] == "cancelled"

    def test_pause_and_reactivate(self, mock_server, sdk):
        mock_server.add_route(
            MockRoute("POST", "/subscriptions/sub_1/pause", body={"status": "paused"})
        )
        mock_server.add_route(
            MockRoute("POST", "/subscriptions/sub_1/reactivate", body={"status": "active"})
        )
        paused = sdk.subscriptions.pause("sub_1")
        assert paused["status"] == "paused"
        active = sdk.subscriptions.reactivate("sub_1")
        assert active["status"] == "active"


class TestPaymentsApi:
    def test_create_split_config(self, mock_server, sdk):
        expected = {"id": "split_1"}
        mock_server.add_route(MockRoute("POST", "/splits", body=expected))
        result = sdk.payments.create_split_config(
            SplitConfigInput(
                merchant_id="m_1",
                platform_fee_percentage=2.5,
                recipients=[
                    SplitRecipient("r1", "0xabc", 60, 1),
                    SplitRecipient("r2", "0xdef", 37.5, 1),
                ],
            )
        )
        assert result == expected


class TestRefundsApi:
    def test_set_policy(self, mock_server, sdk):
        expected = {"merchantId": "m_1"}
        mock_server.add_route(MockRoute("POST", "/refunds/policies", body=expected))
        result = sdk.refunds.set_policy(
            RefundPolicyInput(
                merchant_id="m_1",
                full_refund_window_days=14,
                auto_approval_threshold=50.0,
                always_refund_under_amount=10.0,
                max_partial_refund_percentage=50.0,
                require_reason=True,
            )
        )
        assert result == expected

    def test_evaluate_refund(self, mock_server, sdk):
        expected = {"decision": "approved", "percentage": 100}
        mock_server.add_route(MockRoute("POST", "/refunds/evaluate", body=expected))
        result = sdk.refunds.evaluate(
            RefundEvaluationInput(
                merchant_id="m_1",
                payment_id="pay_1",
                payment_type="card",
                amount_paid=100,
                requested_amount=100,
                days_since_payment=3,
            )
        )
        assert result == expected


# ─── Auth tests ───────────────────────────────────────────────────────────────

class TestAuth:
    def test_build_auth_header_with_token(self):
        header = build_auth_header("my_token")
        assert header == {"Authorization": "Bearer my_token"}

    def test_build_auth_header_without_token(self):
        header = build_auth_header(None)
        assert header == {}

    def test_auth_provider_interceptor(self, mock_server):
        mock_server.add_route(MockRoute("GET", "/sandbox/status", body={"healthy": True}))

        class TestAuth(AuthProvider):
            def get_access_token(self):
                return "bearer_token_123"

        sdk = AgenticPaySDK(
            base_url=mock_server.url,
            auth_provider=TestAuth(),
        )
        result = sdk.sandbox.get_status()
        # Verify the auth header was injected
        req = mock_server.get_last_request()
        assert req is not None
        assert req["headers"].get("Authorization") == "Bearer bearer_token_123"


# ─── Webhook tests ────────────────────────────────────────────────────────────

class TestWebhooks:
    def test_verify_valid_signature(self):
        secret = "whsec_test"
        body = '{"id":"evt_1","type":"payment.completed"}'
        timestamp = str(int(time.time()))

        import hashlib
        import hmac as hmac_mod

        digest = hmac_mod.new(
            secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256
        ).hexdigest()
        signature = f"v1={digest}"

        assert verify_webhook_signature(body, signature, secret, timestamp) is True

    def test_verify_invalid_signature(self):
        timestamp = str(int(time.time()))
        assert verify_webhook_signature("{}", "v1=invalid", "secret", timestamp) is False

    def test_verify_expired_timestamp(self):
        secret = "whsec_test"
        body = '{"id":"evt_1"}'
        old_timestamp = str(int(time.time()) - 600)  # 10 minutes ago

        import hashlib
        import hmac as hmac_mod

        digest = hmac_mod.new(
            secret.encode(), f"{old_timestamp}.{body}".encode(), hashlib.sha256
        ).hexdigest()
        signature = f"v1={digest}"

        assert verify_webhook_signature(body, signature, secret, old_timestamp) is False


# ─── Mock server tests ───────────────────────────────────────────────────────

class TestMockServer:
    def test_server_responds(self, mock_server):
        mock_server.add_route(MockRoute("GET", "/test", body={"hello": "world"}))
        client = create_test_client(base_url=mock_server.url)
        result = client.get("/test")
        assert result == {"hello": "world"}

    def test_server_records_requests(self, mock_server):
        mock_server.add_route(MockRoute("POST", "/data", body={"ok": True}))
        client = create_test_client(base_url=mock_server.url)
        client.post("/data", {"key": "value"})
        req = mock_server.get_last_request()
        assert req is not None
        assert req["method"] == "POST"
        assert req["path"] == "/data"
        assert req["body"] == {"key": "value"}

    def test_server_dynamic_handler(self, mock_server):
        def handler(req):
            return {"body": {"echo": req["body"]}}

        mock_server.add_route(MockRoute("POST", "/echo", handler=handler))
        client = create_test_client(base_url=mock_server.url)
        result = client.post("/echo", {"msg": "hello"})
        assert result == {"echo": {"msg": "hello"}}

    def test_server_reset(self, mock_server):
        mock_server.add_route(MockRoute("GET", "/a", body={"a": 1}))
        # First make a request
        client = create_test_client(base_url=mock_server.url)
        client.get("/a")
        assert len(mock_server.get_requests()) == 1
        # Reset everything
        mock_server.reset_routes()
        mock_server.reset_requests()
        assert mock_server.get_requests() == []
        # Now /a should 404 since route was reset
        with pytest.raises(NotFoundError):
            client.get("/a")
