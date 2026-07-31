"""Error classes for the AgenticPay SDK."""

from __future__ import annotations

from typing import Any, Optional


class AgenticPayError(Exception):
    """Base error for all AgenticPay SDK errors."""

    def __init__(
        self,
        message: str = "An error occurred",
        status: Optional[int] = None,
        code: Optional[str] = None,
        details: Optional[Any] = None,
    ):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.details = details

    def __repr__(self) -> str:
        parts = [f"message={self.message!r}"]
        if self.status is not None:
            parts.append(f"status={self.status}")
        if self.code is not None:
            parts.append(f"code={self.code!r}")
        return f"{self.__class__.__name__}({', '.join(parts)})"


class AuthenticationError(AgenticPayError):
    """Raised when authentication fails (401)."""

    def __init__(self, message: str = "Authentication failed", details: Optional[Any] = None):
        super().__init__(message, status=401, code="AUTHENTICATION_ERROR", details=details)


class AuthorizationError(AgenticPayError):
    """Raised when the caller lacks permission (403)."""

    def __init__(self, message: str = "Not authorized", details: Optional[Any] = None):
        super().__init__(message, status=403, code="AUTHORIZATION_ERROR", details=details)


class ValidationError(AgenticPayError):
    """Raised when request validation fails (400)."""

    def __init__(self, message: str = "Validation failed", details: Optional[Any] = None):
        super().__init__(message, status=400, code="VALIDATION_ERROR", details=details)


class RateLimitError(AgenticPayError):
    """Raised when the rate limit is exceeded (429)."""

    def __init__(self, message: str = "Rate limit exceeded", details: Optional[Any] = None):
        super().__init__(message, status=429, code="RATE_LIMIT_EXCEEDED", details=details)


class NetworkError(AgenticPayError):
    """Raised when a network-level error occurs."""

    def __init__(self, message: str = "Network request failed", details: Optional[Any] = None):
        super().__init__(message, code="NETWORK_ERROR", details=details)


class NotFoundError(AgenticPayError):
    """Raised when a resource is not found (404)."""

    def __init__(self, message: str = "Resource not found", details: Optional[Any] = None):
        super().__init__(message, status=404, code="NOT_FOUND", details=details)


def raise_for_status(status: int, payload: Any) -> None:
    """Raise an appropriate error subclass based on HTTP status."""
    if status < 400:
        return

    message = "Request failed"
    code = None
    details = None

    if isinstance(payload, dict):
        err = payload.get("error", payload)
        if isinstance(err, dict):
            message = err.get("message", message)
            code = err.get("code")
            details = err.get("details")
        else:
            message = payload.get("message", message)

    if isinstance(code, str) and code.startswith("ERR_"):
        raise AgenticPayError(message, status=status, code=code, details=details)

    if status == 400:
        raise ValidationError(message, details)
    if status == 401:
        raise AuthenticationError(message, details)
    if status == 403:
        raise AuthorizationError(message, details)
    if status == 404:
        raise NotFoundError(message, details)
    if status == 429:
        raise RateLimitError(message, details)

    raise AgenticPayError(message, status=status, code=code, details=details)
