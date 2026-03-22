from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


LeadStatus = Literal["new", "contacted", "converted"]


class LeadCreate(BaseModel):
  model_config = ConfigDict(str_strip_whitespace=True)

  name: str = Field(min_length=2, max_length=120)
  phone: str = Field(min_length=10, max_length=10)
  city: str = Field(min_length=2, max_length=120)
  loan_type: str = Field(min_length=2, max_length=120)
  employment_type: Literal["Salaried", "Self-employed"]
  loan_amount: float = Field(gt=0)
  purpose: str = Field(min_length=3, max_length=250)
  source: Literal["website"] = "website"

  @field_validator("phone")
  @classmethod
  def validate_phone(cls, value: str) -> str:
    if not value.isdigit() or len(value) != 10:
      raise ValueError("Phone must be a valid 10-digit number.")
    return value

  @field_validator("loan_amount")
  @classmethod
  def validate_loan_amount(cls, value: float) -> float:
    if value < 10000:
      raise ValueError("Loan amount should be at least 10000.")
    return value


class LeadStatusUpdate(BaseModel):
  status: LeadStatus


class LeadResponse(BaseModel):
  id: str
  name: str
  phone: str
  city: str
  loan_type: str
  employment_type: str
  loan_amount: float
  purpose: str
  source: str
  status: LeadStatus
  lead_score: int
  priority: Literal["low", "medium", "high"]
  created_at: datetime


class LeadListResponse(BaseModel):
  ok: bool = True
  count: int
  items: list[LeadResponse]


class LoginRequest(BaseModel):
  email: str
  password: str


class TokenResponse(BaseModel):
  access_token: str
  token_type: str = "bearer"
  expires_in: int


class ApiMessage(BaseModel):
  ok: bool = True
  message: str


class ActivityResponse(BaseModel):
  id: str
  lead_id: str
  action: str
  actor_email: str
  from_status: LeadStatus | None = None
  to_status: LeadStatus | None = None
  created_at: datetime

