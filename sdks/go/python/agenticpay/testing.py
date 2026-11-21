"""Testing utilities for the AgenticPay Python SDK."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Callable, Dict, List, Optional, Tuple, Union
from urllib.parse import urlparse

from agenticpay.client import AgenticPayClient, ClientConfig, RetryConfig
from agenticpay.sdk import AgenticPaySDK


class MockRoute:
    """A mock route definition."""

    def __init__(
        self,
        method: str,
        path: Union[str, Callable[[str], bool]],
        status: int = 200,
        body: Optional[Any] = None,
        headers: Optional[Dict[str, str]] = None,
        handler: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    ):
        self.method = method.upper()
        self.path = path
        self.status = status
        self.body = body
        self.headers = headers or {}
        self.handler = handler


class MockAgenticPayServer:
    """Lightweight HTTP mock server for testing SDK integrations.

    Example::

        server = MockAgenticPayServer()
        server.add_route(MockRoute("GET", "/health", body={"status": "ok"}))
        server.start()

        sdk = create_test_sdk(server.url)
        result = sdk.sandbox.get_status()  # calls /sandbox/status

        server.stop()
    """

    def __init__(self, port: int = 0):
        self._port = port
        self._routes: List[MockRoute] = []
        self._requests: List[Dict[str, Any]] = []
        self._server: Optional[HTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self._url: Optional[str] = None

    @property
    def url(self) -> str:
        if self._url is None:
            raise RuntimeError("Server not started")
        return self._url

    @property
    def port(self) -> int:
        return self._port

    def add_route(self, route: MockRoute) -> None:
        self._routes.append(route)

    def reset_routes(self) -> None:
        self._routes = []

    def reset_requests(self) -> None:
        self._requests = []

    def get_requests(self) -> List[Dict[str, Any]]:
        return list(self._requests)

    def get_last_request(self) -> Optional[Dict[str, Any]]:
        return self._requests[-1] if self._requests else None

    def start(self) -> None:
        """Start the mock server in a background thread."""
        server_instance = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass  # Suppress default logging

            def _handle(self, method: str):
                content_length = int(self.headers.get("Content-Length", 0))
                body = None
                if content_length > 0:
                    raw = self.rfile.read(content_length)
                    try:
                        body = json.loads(raw)
                    except (json.JSONDecodeError, ValueError):
                        body = raw.decode("utf-8")

                path = urlparse(self.path).path
                headers = dict(self.headers)

                server_instance._requests.append({
                    "method": method,
                    "path": path,
                    "headers": headers,
                    "body": body,
                })

                route = server_instance._find_route(method, path)
                if route:
                    if route.handler:
                        result = route.handler({"method": method, "path": path, "body": body, "headers": headers})
                        status = result.get("status", route.status)
                        resp_body = result.get("body", route.body)
                        resp_headers = {**route.headers, **result.get("headers", {})}
                    else:
                        status = route.status
                        resp_body = route.body
                        resp_headers = route.headers

                    self.send_response(status)
                    self.send_header("Content-Type", "application/json")
                    for k, v in resp_headers.items():
                        self.send_header(k, v)
                    self.end_headers()
                    if resp_body is not None:
                        self.wfile.write(json.dumps(resp_body).encode("utf-8"))
                else:
                    self.send_response(404)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": {"message": "Not Found"}}).encode("utf-8"))

            def do_GET(self):
                self._handle("GET")

            def do_POST(self):
                self._handle("POST")

            def do_PATCH(self):
                self._handle("PATCH")

            def do_DELETE(self):
                self._handle("DELETE")

        self._server = HTTPServer(("127.0.0.1", self._port), Handler)
        self._port = self._server.server_address[1]
        self._url = f"http://127.0.0.1:{self._port}"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Stop the mock server."""
        if self._server:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None

    def _find_route(self, method: str, path: str) -> Optional[MockRoute]:
        for route in self._routes:
            if route.method != method.upper():
                continue
            if isinstance(route.path, str):
                if route.path == path:
                    return route
            elif callable(route.path):
                if route.path(path):
                    return route
        return None


def create_test_client(
    base_url: Optional[str] = None,
    api_key: str = "test_api_key",
) -> AgenticPayClient:
    """Create a test HTTP client configured for a mock server."""
    return AgenticPayClient(
        ClientConfig(
            base_url=base_url or "http://127.0.0.1:0/api/v1",
            api_key=api_key,
            timeout=5,
            retry=RetryConfig(attempts=0, base_delay_ms=0),
        )
    )


def create_test_sdk(
    base_url: Optional[str] = None,
    api_key: str = "test_api_key",
) -> AgenticPaySDK:
    """Create a test SDK configured for a mock server."""
    return AgenticPaySDK(
        base_url=base_url or "http://127.0.0.1:0/api/v1",
        api_key=api_key,
        timeout=5,
        retry=RetryConfig(attempts=0, base_delay_ms=0),
    )
