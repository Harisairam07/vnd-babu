import "dotenv/config";
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient, ObjectId } from "mongodb";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const fallbackFile = path.join(dataDir, "leads.json");
const allowedStatuses = new Set(["New", "Contacted", "Converted"]);

const mongoEnabled =
  Boolean(process.env.MONGODB_URI) &&
  Boolean(process.env.MONGODB_DB) &&
  Boolean(process.env.MONGODB_COLLECTION);

const mongoClient = mongoEnabled ? new MongoClient(process.env.MONGODB_URI) : null;
let leadCollectionPromise = null;
let storageMode = mongoEnabled ? "mongo-pending" : "file";

const ensureFallbackStore = async () => {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(fallbackFile);
  } catch {
    await fs.writeFile(fallbackFile, "[]", "utf8");
  }
};

const readFallbackLeads = async () => {
  await ensureFallbackStore();
  const raw = await fs.readFile(fallbackFile, "utf8");
  return JSON.parse(raw);
};

const writeFallbackLeads = async (items) => {
  await ensureFallbackStore();
  await fs.writeFile(fallbackFile, JSON.stringify(items, null, 2), "utf8");
};

const createFallbackId = () =>
  `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const getLeadCollection = async () => {
  if (!mongoEnabled) {
    storageMode = "file";
    return null;
  }

  if (!leadCollectionPromise) {
    leadCollectionPromise = mongoClient
      .connect()
      .then((connectedClient) => {
        storageMode = "mongo";
        return connectedClient
          .db(process.env.MONGODB_DB)
          .collection(process.env.MONGODB_COLLECTION);
      })
      .catch((error) => {
        storageMode = "file";
        console.error("MongoDB unavailable. Falling back to file storage.", error);
        return null;
      });
  }

  return leadCollectionPromise;
};

const normalizeLead = (payload = {}) => ({
  name: String(payload.name || "").trim(),
  phone: String(payload.phone || "").trim(),
  employment_type: String(payload.employment_type || "").trim(),
  loan_type: String(payload.loan_type || "").trim(),
  loan_amount: Number(payload.loan_amount || 0),
  purpose: String(payload.purpose || "").trim(),
  city: String(payload.city || "").trim(),
  source: String(payload.source || "website").trim(),
});

const validateLead = (lead) => {
  if (
    !lead.name ||
    !lead.phone ||
    !lead.employment_type ||
    !lead.loan_type ||
    !lead.loan_amount ||
    !lead.purpose ||
    !lead.city
  ) {
    return "All fields are required.";
  }

  if (!/^\d{10}$/.test(lead.phone)) {
    return "Phone number must be a valid 10-digit number.";
  }

  if (!Number.isFinite(lead.loan_amount) || lead.loan_amount < 10000) {
    return "Loan amount must be at least 10000.";
  }

  return null;
};

const getAllLeads = async () => {
  const collection = await getLeadCollection();

  if (collection) {
    return collection.find({}).sort({ createdAt: -1 }).toArray();
  }

  const items = await readFallbackLeads();
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

const createLead = async (lead) => {
  const collection = await getLeadCollection();
  const payload = {
    ...lead,
    createdAt: new Date(),
    status: "New",
  };

  if (collection) {
    const result = await collection.insertOne(payload);
    return { id: result.insertedId };
  }

  const items = await readFallbackLeads();
  const id = createFallbackId();
  items.push({ _id: id, ...payload });
  await writeFallbackLeads(items);
  return { id };
};

const updateLeadStatus = async (id, status) => {
  const collection = await getLeadCollection();

  if (collection) {
    const filter = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
    const result = await collection.updateOne(filter, { $set: { status } });
    return result.matchedCount > 0;
  }

  const items = await readFallbackLeads();
  const index = items.findIndex((item) => String(item._id) === String(id));

  if (index === -1) {
    return false;
  }

  items[index].status = status;
  await writeFallbackLeads(items);
  return true;
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

app.post("/api/lead", async (req, res) => {
  try {
    const lead = normalizeLead(req.body);
    const validationError = validateLead(lead);

    if (validationError) {
      res.status(400).json({ ok: false, message: validationError });
      return;
    }

    const result = await createLead(lead);
    res.status(201).json({
      ok: true,
      id: result.id,
      message: "Lead created successfully.",
      storage: storageMode,
    });
  } catch (error) {
    console.error("Failed to create lead:", error);
    res.status(500).json({ ok: false, message: "Unable to save lead right now." });
  }
});

app.get("/admin/leads", async (_req, res) => {
  try {
    const items = await getAllLeads();
    res.json({ ok: true, items, storage: storageMode });
  } catch (error) {
    console.error("Failed to fetch leads:", error);
    res.status(500).json({ ok: false, message: "Unable to fetch leads." });
  }
});

app.put("/admin/lead/:id", async (req, res) => {
  try {
    const { status } = req.body;

    if (!allowedStatuses.has(status)) {
      res.status(400).json({ ok: false, message: "Invalid status." });
      return;
    }

    const updated = await updateLeadStatus(req.params.id, status);

    if (!updated) {
      res.status(404).json({ ok: false, message: "Lead not found." });
      return;
    }

    res.json({ ok: true, message: "Lead status updated.", storage: storageMode });
  } catch (error) {
    console.error("Failed to update lead:", error);
    res.status(500).json({ ok: false, message: "Unable to update lead." });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    await ensureFallbackStore();
    await getLeadCollection();
    res.json({
      ok: true,
      service: "finance-app",
      storage: storageMode,
      mongoConfigured: mongoEnabled,
    });
  } catch (error) {
    console.error("Health check failed:", error);
    res.json({
      ok: true,
      service: "finance-app",
      storage: "file",
      mongoConfigured: mongoEnabled,
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(PORT, async () => {
  await ensureFallbackStore();
  console.log(`Finance app running on port ${PORT}`);
});
