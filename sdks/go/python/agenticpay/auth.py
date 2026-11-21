"""Authentication helpers for the AgenticPay SDK."""

from __future__ import annotations

from typing import Callable, Dict, Optional, Union


class AuthProvider:
    """Protocol-like class for token providers.

    Implement this interface to supply bearer tokens from your auth system.

    Example::

        class MyAuth(AuthProvider):
            async def get_access_token(self) -> str:
                return await my_token_service.get_token()
    """

    def get_access_token(self) -> Optional[str]:
        """Return the current access token, or ``None`` if unavailable."""
        raise NotImplementedError


def build_auth_header(token: Optional[str]) -> Dict[str, str]:
    """Build an Authorization header from a bearer token."""
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}


def create_api_key_auth(api_key: str) -> AuthProvider:
    """Create a simple auth provider that returns a fixed API key as bearer token."""

    class _ApiKeyAuth(AuthProvider):
        def get_access_token(self) -> str:
            return api_key

    return _ApiKeyAuth()
