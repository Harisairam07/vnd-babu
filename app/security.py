from datetime import UTC, datetime, timedelta
from typing import Any, Dict

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import Settings, get_settings
from app.database import db_manager


pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(password: str) -> str:
  return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
  return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: Dict[str, Any], settings: Settings, expires_minutes: int | None = None) -> str:
  expire_delta = timedelta(minutes=expires_minutes or settings.jwt_expire_minutes)
  to_encode = data.copy()
  to_encode.update({"exp": datetime.now(UTC) + expire_delta})
  return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str, settings: Settings) -> Dict[str, Any]:
  try:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
  except JWTError as exc:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Invalid or expired token.",
      headers={"WWW-Authenticate": "Bearer"},
    ) from exc


async def get_current_user(
  token: str = Depends(oauth2_scheme),
  settings: Settings = Depends(get_settings),
) -> Dict[str, Any]:
  payload = decode_access_token(token, settings)
  user_id = payload.get("sub")
  user_email = payload.get("email")
  user_role = payload.get("role")
  if not user_id:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Invalid token payload.",
      headers={"WWW-Authenticate": "Bearer"},
    )

  # Allow configured env-admin auth even if MongoDB is unavailable.
  if user_role == "admin" and user_email == settings.admin_email:
    return {
      "_id": user_id,
      "email": settings.admin_email,
      "role": "admin",
      "is_active": True,
    }

  if db_manager.db is None:
    raise HTTPException(status_code=500, detail="Database is not initialized.")

  user_query = {"_id": user_id}
  if user_email:
    user_query = {"$or": [{"_id": user_id}, {"email": user_email}]}

  user = await db_manager.db.users.find_one(user_query)
  if not user or not user.get("is_active", True):
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="User is not authorized.",
      headers={"WWW-Authenticate": "Bearer"},
    )

  return user


async def require_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
  if user.get("role") != "admin":
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
  return user
