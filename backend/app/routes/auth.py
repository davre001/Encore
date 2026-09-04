"""Authentication and user management routes."""

import time
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.schemas import (
    ForgotPasswordRequest,
    GoogleAuthRequest,
    MessageResponse,
    ResetPasswordRequest,
    UserResponse,
    UserSignIn,
    UserSignUp,
)
from ..models.user import PasswordReset, User
from ..services.email import generate_six_digit_code, send_password_reset_email
from ..services.security import validate_password_strength

router = APIRouter()


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(body: UserSignUp, db: Session = Depends(get_db)) -> UserResponse:
    """Register a new user account with email and password.

    Validates:
      1. Duplicate email prevention: rejects if email is already registered (409 Conflict).
      2. Password strength: enforces minimum 8 chars, uppercase, lowercase, numbers, and symbols.
    """
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid email address is required.",
        )

    # 1. Check password strength (length, uppercase, lowercase, numbers, symbols)
    valid, message = validate_password_strength(body.password)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message,
        )

    # 2. Check for existing account with the same email
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account already exists with this email address. Please sign in instead.",
        )

    # Determine user display name
    name = body.name.strip() if body.name else email.split("@")[0].replace(".", " ").title()

    user = User(
        id=User.new_id(),
        email=email,
        name=name or "Creator",
        auth_provider="local",
        created_at=int(time.time() * 1000),
    )
    user.set_password(body.password)

    db.add(user)
    db.commit()
    db.refresh(user)

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        picture=user.picture,
        auth_provider=user.auth_provider,
        created_at=user.created_at,
    )


@router.post("/signin", response_model=UserResponse)
def signin(body: UserSignIn, db: Session = Depends(get_db)) -> UserResponse:
    """Sign in with email and password."""
    email = body.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()

    if not user or not user.check_password(body.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        picture=user.picture,
        auth_provider=user.auth_provider,
        created_at=user.created_at,
    )


@router.post("/google", response_model=UserResponse)
def google_auth(body: GoogleAuthRequest, db: Session = Depends(get_db)) -> UserResponse:
    """Authenticate or register a user via Google Sign-In."""
    email = body.email.strip().lower()
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google profile must include a valid email.",
        )

    user = db.query(User).filter(User.email == email).first()

    if user:
        # Existing user: update avatar if newly available
        if body.picture and not user.picture:
            user.picture = body.picture
            db.commit()
            db.refresh(user)
    else:
        # Create new user from Google profile
        user = User(
            id=body.sub or User.new_id(),
            email=email,
            name=body.name or email.split("@")[0].title(),
            picture=body.picture,
            auth_provider="google",
            created_at=int(time.time() * 1000),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        picture=user.picture,
        auth_provider=user.auth_provider,
        created_at=user.created_at,
    )


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)) -> MessageResponse:
    """Send a 6-digit verification code to the user's email address.

    Requires the user to input and confirm their email address first.
    """
    email = body.email.strip().lower()
    confirm_email = body.confirm_email.strip().lower()

    if not email or "@" not in email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid email address is required.",
        )

    # Prompt verification: confirm both email inputs match
    if email != confirm_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The email addresses you entered do not match. Please verify and confirm your email address.",
        )

    # Check if an account exists with this email address
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found with this email address. Please check your email or sign up.",
        )

    # Generate 6-digit verification code
    code = generate_six_digit_code()
    expires_at = int(time.time() * 1000) + (15 * 60 * 1000)  # 15 minutes validity

    # Invalidate any previous unused codes for this email
    db.query(PasswordReset).filter(
        PasswordReset.email == email,
        PasswordReset.used == False,
    ).update({"used": True})

    reset_record = PasswordReset(
        id=PasswordReset.new_id(),
        email=email,
        code=code,
        expires_at=expires_at,
        used=False,
        created_at=int(time.time() * 1000),
    )
    db.add(reset_record)
    db.commit()

    # Dispatch email (via SMTP or console in dev)
    send_password_reset_email(email, code)

    return MessageResponse(
        message=f"A 6-digit verification code has been sent to {email}. It will expire in 15 minutes."
    )


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)) -> MessageResponse:
    """Verify the 6-digit code and reset the user's password."""
    email = body.email.strip().lower()
    code = body.code.strip()

    if not email or "@" not in email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid email address is required.",
        )

    if len(code) != 6 or not code.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code must be a 6-digit number.",
        )

    # Check that verification code exists, is unused, and has not expired
    now = int(time.time() * 1000)
    reset_entry = (
        db.query(PasswordReset)
        .filter(
            PasswordReset.email == email,
            PasswordReset.code == code,
            PasswordReset.used == False,
            PasswordReset.expires_at > now,
        )
        .order_by(PasswordReset.created_at.desc())
        .first()
    )

    if not reset_entry:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification code. Please request a new code.",
        )

    # Validate new password strength
    valid, message = validate_password_strength(body.new_password)
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message,
        )

    # Find user and update password
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User account not found.",
        )

    user.set_password(body.new_password)
    reset_entry.used = True
    db.commit()

    return MessageResponse(
        message="Your password has been reset successfully. Please sign in with your new password."
    )

