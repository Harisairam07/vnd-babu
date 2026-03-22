const ADMIN_TOKEN_KEY = "vndbabu_admin_token";
const FALLBACK_API_ORIGIN = "http://127.0.0.1:8000";

const adminLoginScreen = document.querySelector("#admin-login-screen");
const adminShell = document.querySelector("#admin-shell");
const adminLoginForm = document.querySelector("#admin-login-form");
const adminLoginMessage = document.querySelector("#admin-login-message");
const adminLogoutButton = document.querySelector("#admin-logout-btn");
const totalLeadsValue = document.querySelector("#total-leads-value");
const todayLeadsValue = document.querySelector("#today-leads-value");
const convertedLeadsValue = document.querySelector("#converted-leads-value");
const activePipelineValue = document.querySelector("#active-pipeline-value");
const monthlyChart = document.querySelector("#monthly-chart");
const loanTypeFilter = document.querySelector("#loan-type-filter");
const cityFilter = document.querySelector("#city-filter");
const statusFilter = document.querySelector("#status-filter");
const applyFiltersButton = document.querySelector("#apply-filters-btn");
const clearFiltersButton = document.querySelector("#clear-filters-btn");
const leadsTableBody = document.querySelector("#leads-table-body");
const tableEmptyMessage = document.querySelector("#table-empty-message");

let allLeads = [];

const getToken = () => sessionStorage.getItem(ADMIN_TOKEN_KEY) || "";
const isLoggedIn = () => Boolean(getToken());

const showDashboard = () => {
  adminLoginScreen.hidden = true;
  adminShell.hidden = false;
};

const showLogin = () => {
  adminShell.hidden = true;
  adminLoginScreen.hidden = false;
};

const setLoginMessage = (text, isError = false) => {
  if (!adminLoginMessage) return;
  adminLoginMessage.textContent = text;
  adminLoginMessage.style.color = isError ? "#b42318" : "#087443";
};

const getApiCandidates = (path) => {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const candidates = [cleanPath];
  if (window.location.origin !== FALLBACK_API_ORIGIN) {
    candidates.push(`${FALLBACK_API_ORIGIN}${cleanPath}`);
  }
  return candidates;
};

const fetchJson = async (url, options = {}, includeAuth = true) => {
  const headers = { ...(options.headers || {}) };
  if (includeAuth) {
    headers.Authorization = `Bearer ${getToken()}`;
  }

  const candidates = getApiCandidates(url);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { ...options, headers });
      if (response.ok) {
        return response.json();
      }

      let detail = `Request failed: ${url}`;
      try {
        const payload = await response.json();
        detail = payload.detail || payload.message || detail;
      } catch {
        // keep fallback
      }

      if (response.status === 401) {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        showLogin();
      }

      lastError = new Error(detail);
      if (response.status === 404) {
        continue;
      }
      throw lastError;
    } catch (error) {
      if (!lastError) {
        lastError = error instanceof Error ? error : new Error(`Request failed: ${url}`);
      }
    }
  }

  throw lastError || new Error(`Request failed: ${url}`);
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

const formatCurrency = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "-";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(numeric);
};

const normalizeLead = (lead) => ({
  ...lead,
  created_at: lead.created_at ? new Date(lead.created_at) : null,
});

const renderSummary = () => {
  const today = new Date().toISOString().slice(0, 10);
  const totalLeads = allLeads.length;
  const todayLeads = allLeads.filter(
    (lead) => lead.created_at && lead.created_at.toISOString().slice(0, 10) === today
  ).length;
  const convertedLeads = allLeads.filter((lead) => lead.status === "converted").length;
  const activePipeline = allLeads.filter((lead) =>
    ["new", "contacted"].includes(lead.status)
  ).length;

  totalLeadsValue.textContent = totalLeads;
  todayLeadsValue.textContent = todayLeads;
  convertedLeadsValue.textContent = convertedLeads;
  activePipelineValue.textContent = activePipeline;
};

const renderMonthlyChart = () => {
  const monthKeys = [];
  const today = new Date();

  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - index, 1);
    monthKeys.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleString("en-IN", { month: "short", year: "numeric" }),
    });
  }

  const counts = monthKeys.map((month) => ({
    ...month,
    value: allLeads.filter((lead) => {
      if (!lead.created_at) return false;
      const key = `${lead.created_at.getFullYear()}-${String(lead.created_at.getMonth() + 1).padStart(2, "0")}`;
      return key === month.key;
    }).length,
  }));

  const maxValue = Math.max(...counts.map((item) => item.value), 1);
  monthlyChart.innerHTML = counts
    .map((item) => {
      const height = Math.max((item.value / maxValue) * 180, 24);
      return `
        <article class="chart-bar">
          <strong>${item.value}</strong>
          <div class="chart-bar-fill" style="height:${height}px"></div>
          <span>${item.label}</span>
        </article>
      `;
    })
    .join("");
};

const renderLoanTypeOptions = () => {
  const selectedValue = loanTypeFilter.value;
  const loanTypes = [...new Set(allLeads.map((lead) => lead.loan_type).filter(Boolean))].sort();

  loanTypeFilter.innerHTML = '<option value="">All loan types</option>';
  loanTypes.forEach((loanType) => {
    const option = document.createElement("option");
    option.value = loanType;
    option.textContent = loanType;
    loanTypeFilter.append(option);
  });
  loanTypeFilter.value = selectedValue;
};

const updateLeadStatus = async (id, status) => {
  await fetchJson(
    `/lead/${id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
    true
  );
};

const deleteLead = async (id) => {
  await fetchJson(`/lead/${id}`, { method: "DELETE" }, true);
};

const attachTableListeners = () => {
  document.querySelectorAll(".status-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const leadId = select.dataset.id;
      const nextStatus = select.value;

      try {
        await updateLeadStatus(leadId, nextStatus);
        await loadLeads();
      } catch (error) {
        select.value = select.dataset.previousValue || "new";
      }
    });
    select.dataset.previousValue = select.value;
  });

  document.querySelectorAll(".lead-delete-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const leadId = button.dataset.id;
      const confirmed = window.confirm("Delete this lead permanently?");
      if (!confirmed) return;

      try {
        await deleteLead(leadId);
        await loadLeads();
      } catch (error) {
        // no-op, dashboard message is enough
      }
    });
  });
};

const renderLeadTable = () => {
  if (!allLeads.length) {
    leadsTableBody.innerHTML = "";
    tableEmptyMessage.hidden = false;
    return;
  }

  tableEmptyMessage.hidden = true;
  leadsTableBody.innerHTML = allLeads
    .map(
      (item) => `
        <tr>
          <td>${item.name}</td>
          <td><a href="tel:${item.phone}">${item.phone}</a></td>
          <td>${item.employment_type || "-"}</td>
          <td>${item.loan_type}</td>
          <td>${formatCurrency(item.loan_amount)}</td>
          <td>${item.purpose || "-"}</td>
          <td>${item.city}</td>
          <td>${formatDate(item.created_at)}</td>
          <td>
            <select class="status-select status-select-admin" data-id="${item.id}">
              <option value="new" ${item.status === "new" ? "selected" : ""}>New</option>
              <option value="contacted" ${item.status === "contacted" ? "selected" : ""}>Contacted</option>
              <option value="converted" ${item.status === "converted" ? "selected" : ""}>Converted</option>
            </select>
          </td>
          <td>
            <button type="button" class="btn btn-outline lead-delete-btn" data-id="${item.id}">Delete</button>
          </td>
        </tr>
      `
    )
    .join("");

  attachTableListeners();
};

const buildLeadQuery = () => {
  const params = new URLSearchParams();
  if (loanTypeFilter.value) params.set("loan_type", loanTypeFilter.value);
  if (statusFilter.value) params.set("status", statusFilter.value);
  if (cityFilter.value.trim()) params.set("city", cityFilter.value.trim());
  const query = params.toString();
  return query ? `?${query}` : "";
};

const loadLeads = async () => {
  try {
    const response = await fetchJson(`/leads${buildLeadQuery()}`, {}, true);
    allLeads = (response.items || []).map(normalizeLead);
    renderSummary();
    renderMonthlyChart();
    renderLoanTypeOptions();
    renderLeadTable();
  } catch (error) {
    tableEmptyMessage.hidden = false;
    tableEmptyMessage.textContent = error.message || "Dashboard could not connect to the server.";
    leadsTableBody.innerHTML = "";
  }
};

applyFiltersButton?.addEventListener("click", () => {
  loadLeads();
});

clearFiltersButton?.addEventListener("click", () => {
  loanTypeFilter.value = "";
  cityFilter.value = "";
  statusFilter.value = "";
  loadLeads();
});

adminLoginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(adminLoginForm);
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "").trim();

  if (!email || !password) {
    setLoginMessage("Please enter admin ID and password.", true);
    return;
  }

  try {
    const response = await fetchJson(
      "/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
      false
    );

    sessionStorage.setItem(ADMIN_TOKEN_KEY, response.access_token);
    setLoginMessage("");
    showDashboard();
    await loadLeads();
  } catch (error) {
    setLoginMessage(error.message || "Invalid credentials.", true);
  }
});

adminLogoutButton?.addEventListener("click", () => {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  showLogin();
});

if (isLoggedIn()) {
  showDashboard();
  loadLeads();
} else {
  showLogin();
}
