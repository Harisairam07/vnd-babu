from datetime import UTC, datetime, timedelta
from typing import Any, Dict
from uuid import uuid4

import httpx
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pymongo.errors import PyMongoError
from pymongo import ASCENDING, DESCENDING

from app.config import Settings, get_settings
from app.database import db_manager
from app.schemas import (
  ActivityResponse,
  ApiMessage,
  LeadCreate,
  LeadListResponse,
  LeadResponse,
  LeadStatusUpdate,
  LoginRequest,
  TokenResponse,
)
from app.security import create_access_token, hash_password, require_admin, verify_password


app = FastAPI(title="VND Babu Financial Solutions API", version="1.0.0")
settings = get_settings()
local_leads: list[Dict[str, Any]] = []
local_activities: list[Dict[str, Any]] = []
app.add_middleware(
  CORSMiddleware,
  allow_origins=settings.cors_origins,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


def serialize_lead(document: Dict[str, Any]) -> Dict[str, Any]:
  return {
    "id": str(document["_id"]),
    "name": document["name"],
    "phone": document["phone"],
    "city": document["city"],
    "loan_type": document["loan_type"],
    "employment_type": document["employment_type"],
    "loan_amount": float(document["loan_amount"]),
    "purpose": document["purpose"],
    "source": document.get("source", "website"),
    "status": document["status"],
    "lead_score": int(document.get("lead_score", 0)),
    "priority": document.get("priority", "low"),
    "created_at": document["created_at"],
  }


def serialize_activity(document: Dict[str, Any]) -> Dict[str, Any]:
  return {
    "id": str(document["_id"]),
    "lead_id": document["lead_id"],
    "action": document["action"],
    "actor_email": document.get("actor_email", "system"),
    "from_status": document.get("from_status"),
    "to_status": document.get("to_status"),
    "created_at": document["created_at"],
  }


def compute_lead_score(loan_type: str, loan_amount: float, employment_type: str, purpose: str) -> tuple[int, str]:
  score = 0
  loan_type_normalized = loan_type.lower()
  purpose_normalized = purpose.lower()

  if loan_amount >= 5000000:
    score += 45
  elif loan_amount >= 2500000:
    score += 35
  elif loan_amount >= 1000000:
    score += 25
  else:
    score += 15

  if "business" in loan_type_normalized:
    score += 20
  if "mortgage" in loan_type_normalized:
    score += 10
  if employment_type == "Self-employed":
    score += 10
  if "expansion" in purpose_normalized or "working capital" in purpose_normalized:
    score += 10

  if score >= 55:
    return score, "high"
  if score >= 35:
    return score, "medium"
  return score, "low"


def parse_lead_id(lead_id: str) -> ObjectId:
  try:
    return ObjectId(lead_id)
  except InvalidId as exc:
    raise HTTPException(status_code=400, detail="Invalid lead id.") from exc


async def track_activity(
  lead_id: str,
  action: str,
  actor_email: str,
  from_status: str | None = None,
  to_status: str | None = None,
) -> None:
  if db_manager.db is None:
    local_activities.append(
      {
        "_id": str(uuid4()),
        "lead_id": lead_id,
        "action": action,
        "actor_email": actor_email,
        "from_status": from_status,
        "to_status": to_status,
        "created_at": datetime.now(UTC),
      }
    )
    return

  await db_manager.db.activities.insert_one(
    {
      "lead_id": lead_id,
      "action": action,
      "actor_email": actor_email,
      "from_status": from_status,
      "to_status": to_status,
      "created_at": datetime.now(UTC),
    }
  )


async def send_whatsapp_notification(lead: Dict[str, Any], settings: Settings) -> None:
  if not settings.whatsapp_enabled or not settings.whatsapp_webhook_url:
    return

  payload = {
    "phone": lead["phone"],
    "name": lead["name"],
    "loan_type": lead["loan_type"],
    "loan_amount": lead["loan_amount"],
    "city": lead["city"],
    "message": "Thank you for contacting VND Babu Financial Solutions. Our advisor will contact you shortly.",
  }

  try:
    async with httpx.AsyncClient(timeout=8.0) as client:
      await client.post(settings.whatsapp_webhook_url, json=payload)
  except Exception:
    # Keep lead capture resilient even if external webhook is down.
    pass


async def ensure_database_setup(current_settings: Settings) -> None:
  if db_manager.db is None or db_manager._setup_complete:
    return

  async with db_manager._setup_lock:
    if db_manager.db is None or db_manager._setup_complete:
      return

    db = db_manager.db
    try:
      await db.leads.create_index([("phone", ASCENDING), ("created_at", DESCENDING)])
      await db.leads.create_index([("status", ASCENDING), ("created_at", DESCENDING)])
      await db.leads.create_index("loan_type")
      await db.leads.create_index("city")

      await db.users.create_index("email", unique=True)
      await db.activities.create_index([("lead_id", ASCENDING), ("created_at", DESCENDING)])

      admin_email = current_settings.admin_email.strip().lower()
      existing_admin = await db.users.find_one({"email": admin_email})
      if not existing_admin:
        await db.users.insert_one(
          {
            "_id": admin_email,
            "email": admin_email,
            "password_hash": hash_password(current_settings.admin_password),
            "role": "admin",
            "is_active": True,
            "created_at": datetime.now(UTC),
          }
        )

      db_manager._setup_complete = True
    except PyMongoError as exc:
      raise HTTPException(
        status_code=503,
        detail="MongoDB Atlas connection failed. Check MONGO_URI credentials and cluster access.",
      ) from exc


async def db_ready(current_settings: Settings) -> bool:
  if db_manager.db is None:
    return False
  try:
    await ensure_database_setup(current_settings)
    return True
  except HTTPException:
    return False


@app.on_event("startup")
async def startup_event() -> None:
  current_settings = get_settings()
  try:
    await db_manager.connect(current_settings.mongo_uri, current_settings.mongo_db)
    db_manager._setup_complete = False
  except Exception as exc:
    print(f"Mongo initialization warning: {exc}")


@app.on_event("shutdown")
async def shutdown_event() -> None:
  await db_manager.close()


@app.post("/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest, settings: Settings = Depends(get_settings)) -> TokenResponse:
  email = payload.email.strip().lower()
  password = payload.password.strip()

  # Primary admin login works from env config and does not depend on Mongo availability.
  if email == settings.admin_email.strip().lower() and password == settings.admin_password:
    access_token = create_access_token(
      {"sub": settings.admin_email, "email": settings.admin_email, "role": "admin"},
      settings=settings,
    )
    return TokenResponse(access_token=access_token, expires_in=settings.jwt_expire_minutes * 60)

  if db_manager.db is None:
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")

  await ensure_database_setup(settings)

  user = await db_manager.db.users.find_one({"email": email})
  if not user or not verify_password(password, user["password_hash"]):
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")

  if not user.get("is_active", True):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive.")

  access_token = create_access_token(
    {"sub": str(user["_id"]), "email": user["email"], "role": user["role"]},
    settings=settings,
  )
  await db_manager.db.users.update_one(
    {"_id": user["_id"]},
    {"$set": {"last_login_at": datetime.now(UTC)}},
  )

  return TokenResponse(access_token=access_token, expires_in=settings.jwt_expire_minutes * 60)


@app.post("/lead")
async def create_lead(
  payload: LeadCreate,
  background_tasks: BackgroundTasks,
  settings: Settings = Depends(get_settings),
) -> Dict[str, Any]:
  if not await db_ready(settings):
    now = datetime.now(UTC)
    duplicate_after = now - timedelta(minutes=settings.duplicate_window_minutes)
    for row in local_leads:
      if row["phone"] == payload.phone and row["created_at"] >= duplicate_after:
        raise HTTPException(
          status_code=status.HTTP_409_CONFLICT,
          detail="A recent lead with this phone number already exists. Please wait before re-submitting.",
        )

    lead_score, priority = compute_lead_score(
      payload.loan_type, payload.loan_amount, payload.employment_type, payload.purpose
    )
    local_doc = {
      "_id": str(uuid4()),
      **payload.model_dump(),
      "status": "new",
      "lead_score": lead_score,
      "priority": priority,
      "created_at": now,
    }
    local_leads.append(local_doc)
    await track_activity(local_doc["_id"], "lead_created", "system")
    return {"ok": True, "message": "Our advisor will contact you shortly", "item": serialize_lead(local_doc)}

  now = datetime.now(UTC)
  duplicate_after = now - timedelta(minutes=settings.duplicate_window_minutes)
  duplicate = await db_manager.db.leads.find_one(
    {"phone": payload.phone, "created_at": {"$gte": duplicate_after}}
  )
  if duplicate:
    raise HTTPException(
      status_code=status.HTTP_409_CONFLICT,
      detail="A recent lead with this phone number already exists. Please wait before re-submitting.",
    )

  lead_score, priority = compute_lead_score(
    payload.loan_type, payload.loan_amount, payload.employment_type, payload.purpose
  )

  lead_document = {
    **payload.model_dump(),
    "status": "new",
    "lead_score": lead_score,
    "priority": priority,
    "created_at": now,
  }
  result = await db_manager.db.leads.insert_one(lead_document)
  lead_document["_id"] = result.inserted_id

  await track_activity(str(result.inserted_id), "lead_created", "system")
  background_tasks.add_task(send_whatsapp_notification, lead_document, settings)

  return {
    "ok": True,
    "message": "Our advisor will contact you shortly",
    "item": serialize_lead(lead_document),
  }


@app.get("/leads", response_model=LeadListResponse)
async def list_leads(
  loan_type: str | None = Query(default=None),
  status_value: str | None = Query(default=None, alias="status"),
  city: str | None = Query(default=None),
  _admin: Dict[str, Any] = Depends(require_admin),
) -> LeadListResponse:
  if not await db_ready(settings):
    rows = list(local_leads)
    if loan_type:
      rows = [r for r in rows if r.get("loan_type") == loan_type]
    if status_value:
      rows = [r for r in rows if r.get("status") == status_value.lower()]
    if city:
      rows = [r for r in rows if str(r.get("city", "")).lower() == city.lower()]
    rows.sort(key=lambda x: x.get("created_at", datetime.now(UTC)), reverse=True)
    items = [serialize_lead(row) for row in rows]
    return LeadListResponse(count=len(items), items=items)

  query: Dict[str, Any] = {}
  if loan_type:
    query["loan_type"] = loan_type
  if status_value:
    query["status"] = status_value.lower()
  if city:
    query["city"] = {"$regex": f"^{city}$", "$options": "i"}

  cursor = db_manager.db.leads.find(query).sort("created_at", DESCENDING)
  rows = await cursor.to_list(length=1000)
  items = [serialize_lead(row) for row in rows]
  return LeadListResponse(count=len(items), items=items)


@app.put("/lead/{lead_id}")
async def update_lead_status(
  lead_id: str,
  payload: LeadStatusUpdate,
  admin: Dict[str, Any] = Depends(require_admin),
  settings: Settings = Depends(get_settings),
) -> Dict[str, Any]:
  if not await db_ready(settings):
    current = next((row for row in local_leads if row["_id"] == lead_id), None)
    if not current:
      raise HTTPException(status_code=404, detail="Lead not found.")

    current_status = current.get("status", "new")
    next_status = payload.status
    status_order = {"new": 1, "contacted": 2, "converted": 3}
    if status_order[next_status] < status_order[current_status]:
      raise HTTPException(status_code=400, detail="Status rollback is not allowed.")
    if status_order[next_status] - status_order[current_status] > 1:
      raise HTTPException(status_code=400, detail="Invalid status transition.")

    current["status"] = next_status
    current["updated_at"] = datetime.now(UTC)
    await track_activity(
      lead_id,
      "status_updated",
      admin["email"],
      from_status=current_status,
      to_status=next_status,
    )
    return {"ok": True, "message": "Lead status updated.", "item": serialize_lead(current)}

  object_id = parse_lead_id(lead_id)
  current = await db_manager.db.leads.find_one({"_id": object_id})
  if not current:
    raise HTTPException(status_code=404, detail="Lead not found.")

  current_status = current.get("status", "new")
  next_status = payload.status
  status_order = {"new": 1, "contacted": 2, "converted": 3}
  if status_order[next_status] < status_order[current_status]:
    raise HTTPException(status_code=400, detail="Status rollback is not allowed.")
  if status_order[next_status] - status_order[current_status] > 1:
    raise HTTPException(status_code=400, detail="Invalid status transition.")

  await db_manager.db.leads.update_one(
    {"_id": object_id},
    {"$set": {"status": next_status, "updated_at": datetime.now(UTC)}},
  )
  await track_activity(
    str(object_id),
    "status_updated",
    admin["email"],
    from_status=current_status,
    to_status=next_status,
  )

  updated = await db_manager.db.leads.find_one({"_id": object_id})
  return {"ok": True, "message": "Lead status updated.", "item": serialize_lead(updated)}


@app.delete("/lead/{lead_id}", response_model=ApiMessage)
async def delete_lead(
  lead_id: str,
  admin: Dict[str, Any] = Depends(require_admin),
  settings: Settings = Depends(get_settings),
) -> ApiMessage:
  if not await db_ready(settings):
    index = next((i for i, row in enumerate(local_leads) if row["_id"] == lead_id), -1)
    if index == -1:
      raise HTTPException(status_code=404, detail="Lead not found.")
    local_leads.pop(index)
    await track_activity(lead_id, "lead_deleted", admin["email"])
    return ApiMessage(message="Lead removed successfully.")

  object_id = parse_lead_id(lead_id)
  result = await db_manager.db.leads.delete_one({"_id": object_id})
  if result.deleted_count == 0:
    raise HTTPException(status_code=404, detail="Lead not found.")

  await track_activity(str(object_id), "lead_deleted", admin["email"])
  return ApiMessage(message="Lead removed successfully.")


@app.get("/activities")
async def list_activities(
  lead_id: str | None = Query(default=None),
  _admin: Dict[str, Any] = Depends(require_admin),
  settings: Settings = Depends(get_settings),
) -> Dict[str, Any]:
  if not await db_ready(settings):
    rows = list(local_activities)
    if lead_id:
      rows = [r for r in rows if r.get("lead_id") == lead_id]
    rows.sort(key=lambda x: x.get("created_at", datetime.now(UTC)), reverse=True)
    items = [ActivityResponse(**serialize_activity(row)).model_dump() for row in rows]
    return {"ok": True, "count": len(items), "items": items}

  query: Dict[str, Any] = {}
  if lead_id:
    query["lead_id"] = lead_id

  rows = await db_manager.db.activities.find(query).sort("created_at", DESCENDING).to_list(length=1000)
  items = [ActivityResponse(**serialize_activity(row)).model_dump() for row in rows]
  return {"ok": True, "count": len(items), "items": items}


@app.get("/api/health")
async def health_check() -> Dict[str, Any]:
  mongo_ok = False
  if db_manager.db is not None:
    try:
      await db_manager.db.command("ping")
      mongo_ok = True
    except Exception:
      mongo_ok = False

  return {"ok": True, "service": "vnd-babu-finance-api", "mongo": mongo_ok}


# Mount public site after API routes so API takes precedence.
app.mount("/", StaticFiles(directory="public", html=True), name="site")
