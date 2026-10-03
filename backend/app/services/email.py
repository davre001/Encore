"""Email service for password reset codes and notifications."""

import logging
import os
import secrets
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import parseaddr

logger = logging.getLogger("encore.email")

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").replace(" ", "").strip()
EMAILS_FROM = os.getenv("EMAILS_FROM", "noreply@encore.app")
EMAIL_DEBUG_LOG_CODES = os.getenv("EMAIL_DEBUG_LOG_CODES", "").strip().lower() in {"1", "true", "yes"}



def smtp_configured() -> bool:
    """True when the backend has enough SMTP config to attempt real email delivery."""
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)

def generate_six_digit_code() -> str:
    """Generate a cryptographically secure 6-digit verification code."""
    return f"{secrets.randbelow(900000) + 100000}"


def send_password_reset_email(to_email: str, code: str) -> bool:
    """Send the 6-digit password reset verification code to the user's email address.

    If SMTP credentials are configured in .env, sends via real TLS SMTP.
    Otherwise, logs prominently to server output for easy zero-setup testing.
    """
    subject = f"{code} is your Encore password reset code"

    text_body = (
        f"Hello,\n\n"
        f"You requested to reset your Encore account password.\n\n"
        f"Your 6-digit verification code is: {code}\n\n"
        f"This code will expire in 15 minutes. If you did not request this, please ignore this email.\n\n"
        f"— The Encore Team"
    )

    html_body = f"""
    <!DOCTYPE html>
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c0d0e; color: #f4f4f5; padding: 24px;">
        <div style="max-width: 480px; margin: 0 auto; background: #18191b; border: 1px solid #27272a; border-radius: 16px; padding: 32px;">
          <h2 style="margin-top: 0; color: #ffffff;">Reset your password</h2>
          <p style="color: #a1a1aa; font-size: 14px;">You requested a password reset for your Encore account. Use the verification code below:</p>
          <div style="background: #27272a; border-radius: 12px; padding: 16px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #f97316;">{code}</span>
          </div>
          <p style="color: #71717a; font-size: 13px;">This code will expire in 15 minutes. If you didn't request a password reset, you can safely ignore this email.</p>
        </div>
      </body>
    </html>
    """

    # Real SMTP send if credentials exist
    if SMTP_HOST and SMTP_USER and SMTP_PASSWORD:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = EMAILS_FROM
            msg["To"] = to_email

            msg.attach(MIMEText(text_body, "plain"))
            msg.attach(MIMEText(html_body, "html"))

            envelope_from = parseaddr(EMAILS_FROM)[1] or SMTP_USER
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
                server.starttls()
                server.login(SMTP_USER, SMTP_PASSWORD)
                server.sendmail(envelope_from, [to_email], msg.as_string())
            logger.info(f"Password reset email sent to {to_email} via SMTP")
            return True
        except Exception as e:
            logger.error(f"Failed to send password reset email via SMTP: {type(e).__name__}: {e}")

    if EMAIL_DEBUG_LOG_CODES:
        banner = f"""
======================================================================
[ENCORE EMAIL DISPATCH]
To: {to_email}
Subject: {subject}
Verification Code: >>> {code} <<< (Valid for 15 minutes)
======================================================================
"""
        print(banner, flush=True)
        logger.info(f"Verification code for {to_email}: {code}")
        return True

    logger.error("Password reset email not sent: SMTP is not configured.")
    return False