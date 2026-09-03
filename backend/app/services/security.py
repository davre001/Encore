"""Security utilities: password hashing and password strength detection."""

import hashlib
import hmac
import os
import re
from typing import Tuple

ITERATIONS = 200_000
COMMON_GENERIC_PASSWORDS = {
    "password",
    "password123",
    "12345678",
    "123456789",
    "1234567890",
    "qwerty",
    "qwerty123",
    "admin",
    "admin123",
    "welcome",
    "welcome123",
    "letmein",
    "encore",
    "encore123",
    "iloveyou",
    "monkey",
    "dragon",
}


def hash_password(password: str) -> str:
    """Hash a password using PBKDF2-HMAC-SHA256 with a random 16-byte salt."""
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return f"{salt.hex()}${key.hex()}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against the stored salt$hash string."""
    try:
        salt_hex, key_hex = hashed_password.split("$")
        salt = bytes.fromhex(salt_hex)
        expected_key = bytes.fromhex(key_hex)
        actual_key = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, ITERATIONS)
        return hmac.compare_digest(actual_key, expected_key)
    except Exception:
        return False


def validate_password_strength(password: str) -> Tuple[bool, str]:
    """Validate that password meets strength criteria.

    Rules:
      1. Minimum 8 characters.
      2. At least one uppercase letter (A-Z).
      3. At least one lowercase letter (a-z).
      4. At least one digit (0-9).
      5. At least one special symbol (!@#$%^&* etc.).
      6. Cannot be a common/generic password.

    Returns:
      (True, "") on success, or (False, "Reason for failure") on failure.
    """
    if not password:
        return False, "Password cannot be empty."

    if len(password) < 8:
        return False, "Password must be at least 8 characters long."

    if password.lower() in COMMON_GENERIC_PASSWORDS:
        return False, "This password is too generic and easily guessed. Please choose a stronger password."

    missing = []
    if not re.search(r"[A-Z]", password):
        missing.append("an uppercase letter (A-Z)")

    if not re.search(r"[a-z]", password):
        missing.append("a lowercase letter (a-z)")

    if not re.search(r"[0-9]", password):
        missing.append("a number (0-9)")

    # Special symbol detection: any non-alphanumeric or standard punctuation
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~`]", password):
        missing.append("a special symbol (e.g. !@#$%^&*)")

    if missing:
        detail = "Password must include: " + ", ".join(missing) + "."
        return False, detail

    return True, ""
