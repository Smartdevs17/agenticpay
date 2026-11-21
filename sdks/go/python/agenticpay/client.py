"""HTTP client for the AgenticPay SDK."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, TypeVar

import requests
from requests import Response

from agenticpay.errors import AgenticPayError, NetworkError, raise_for_status

T = TypeVar("T")

RequestInterceptor = Callable[[Dict[str, Any]], Dict[str, Any]]
ResponseInterceptor = Callable[[Dict[str, Any]], Dict[str, Any]]


@dataclass
class RetryConfig:
    """Retry configuration for the HTTP client."""

    attempts: int = 2
    base_delay_ms: int = 250
    retryable_status_codes: List[int] = field(
        default_factory=lambda: [408, 429, 500, 502, 503, 504]
    )


@dataclass
class ClientConfig:
    """Configuration for the AgenticPay HTTP client.

    Attributes:
        base_url: The API base URL (e.g. ``https://api.agenticpay.com/api/v1``).
        api_key: Optional API key for authentication.
        timeout: Request timeout in seconds.
        retry: Optional retry configuration.
    """

    base_url: str
    api_key: Optional[str] = None
    timeout: int = 15
    retry: Optional[RetryConfig] = None

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")
        if self.retry is None:
            self.retry = RetryConfig()


class AgenticPayClient:
    """Low-level HTTP client with retry, interceptors, and error mapping."""

    def __init__(self, config: ClientConfig):
        self._config = config
        self._session = requests.Session()
        self._request_interceptors: List[RequestInterceptor] = []
        self._response_interceptors: List[ResponseInterceptor] = []

    def add_request_interceptor(self, interceptor: RequestInterceptor) -> None:
        self._request_interceptors.append(interceptor)

    def add_response_interceptor(self, interceptor: ResponseInterceptor) -> None:
        self._response_interceptors.append(interceptor)

    def get(self, path: str, headers: Optional[Dict[str, str]] = None) -> Any:
        return self._request("GET", path, headers=headers)

    def post(
        self, path: str, body: Optional[Any] = None, headers: Optional[Dict[str, str]] = None
    ) -> Any:
        return self._request("POST", path, body=body, headers=headers)

    def patch(
        self, path: str, body: Optional[Any] = None, headers: Optional[Dict[str, str]] = None
    ) -> Any:
        return self._request("PATCH", path, body=body, headers=headers)

    def delete(
        self, path: str, body: Optional[Any] = None, headers: Optional[Dict[str, str]] = None
    ) -> Any:
        return self._request("DELETE", path, body=body, headers=headers)

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Any] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        merged_headers: Dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if headers:
            merged_headers.update(headers)
        if self._config.api_key:
            merged_headers["x-api-key"] = self._config.api_key

        context: Dict[str, Any] = {
            "method": method,
            "path": path,
            "headers": merged_headers,
            "body": body,
        }

        for interceptor in self._request_interceptors:
            context = interceptor(context)

        retry = self._config.retry or RetryConfig()
        last_error: Optional[Exception] = None

        for attempt in range(retry.attempts + 1):
            try:
                response = self._session.request(
                    method=context["method"],
                    url=f"{self._config.base_url}{context['path']}",
                    json=context["body"] if context["body"] is not None else None,
                    headers=context["headers"],
                    timeout=self._config.timeout,
                )

                response_context: Dict[str, Any] = {
                    "status": response.status_code,
                    "headers": dict(response.headers),
                    "data": self._parse_response(response),
                }

                for interceptor in self._response_interceptors:
                    response_context = interceptor(response_context)

                if response.ok:
                    return response_context["data"]

                if (
                    response.status_code in retry.retryable_status_codes
                    and attempt < retry.attempts
                ):
                    delay = retry.base_delay_ms * (2 ** attempt) / 1000
                    time.sleep(delay)
                    continue

                raise_for_status(response.status_code, response_context["data"])

            except AgenticPayError:
                raise
            except requests.exceptions.RequestException as exc:
                last_error = exc
                if attempt >= retry.attempts:
                    raise NetworkError("Request failed after retries", details=str(exc)) from exc
                delay = (retry.base_delay_ms * (2 ** attempt)) / 1000
                time.sleep(delay)

        raise NetworkError(
            "Unexpected retry termination",
            details=str(last_error) if last_error else None,
        )

    @staticmethod
    def _parse_response(response: Response) -> Any:
        try:
            return response.json()
        except (json.JSONDecodeError, ValueError):
            return None
