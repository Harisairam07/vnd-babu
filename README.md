# VND Babu Financial Solutions

Production-ready financial lead generation platform with FastAPI, MongoDB Atlas, and a conversion-focused frontend.

## Stack

- Frontend: HTML, CSS, JavaScript (`public/`)
- Backend: FastAPI (`app/`)
- Database: MongoDB Atlas (Motor/PyMongo)
- Auth: JWT (admin login)

## Folder Structure

```text
.
|-- app/
|   |-- config.py
|   |-- database.py
|   |-- main.py
|   |-- schemas.py
|   `-- security.py
|-- public/
|   |-- index.html
|   |-- script.js
|   |-- styles.css
|   |-- admin.html
|   `-- admin.js
|-- main.py
|-- requirements.txt
|-- render.yaml
`-- start-website.bat
```

## Environment Variables

Create `.env` in project root:

```env
MONGO_URI=your_mongodb_atlas_connection
MONGO_DB=vnd_babu_finance
JWT_SECRET_KEY=change-this-secret
ADMIN_EMAIL=admin
ADMIN_PASSWORD=admin
DUPLICATE_WINDOW_MINUTES=20
WHATSAPP_ENABLED=false
WHATSAPP_WEBHOOK_URL=
```

## Run Locally

Install dependencies:

```powershell
.\.venv\Scripts\pip.exe install -r requirements.txt
```

Start API:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 10000 --reload
```

Windows shortcut:

```bat
start-website.bat
```

## API Endpoints

- `POST /auth/login` -> admin JWT login
- `POST /lead` -> create lead
- `GET /leads?loan_type=&status=&city=` -> list leads (admin JWT)
- `PUT /lead/{id}` -> update lead status (admin JWT)
- `DELETE /lead/{id}` -> delete lead (admin JWT)
- `GET /activities` -> activity audit trail (admin JWT)
- `GET /api/health` -> service health

## Lead Model

```json
{
  "name": "string",
  "phone": "string",
  "city": "string",
  "loan_type": "string",
  "employment_type": "Salaried | Self-employed",
  "loan_amount": 2500000,
  "purpose": "string",
  "source": "website",
  "status": "new | contacted | converted",
  "created_at": "timestamp"
}
```

## Security & Quality

- Strict input validation on API
- Duplicate lead prevention (same phone within configured time window)
- JWT-protected admin APIs
- Password hashing for admin users
- Activity tracking for lead lifecycle updates
- Lead scoring and priority tagging for faster sales handling
