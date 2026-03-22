const navbar = document.querySelector("[data-navbar]");
const revealNodes = document.querySelectorAll(".reveal");
const anchorLinks = document.querySelectorAll('a[href^="#"]');
const leadForms = document.querySelectorAll('form[data-source]');
const emiAmount = document.querySelector("#emi-amount");
const emiRate = document.querySelector("#emi-rate");
const emiTenure = document.querySelector("#emi-tenure");
const emiResult = document.querySelector("#emi-result-value");
const emiCalcButton = document.querySelector("#emi-calc-btn");
const emiGuidance = document.querySelector("#emi-guidance");
const eligibilityIncome = document.querySelector("#eligibility-income");
const eligibilityObligations = document.querySelector("#eligibility-obligations");
const eligibilityTenure = document.querySelector("#eligibility-tenure");
const eligibilityRate = document.querySelector("#eligibility-rate");
const eligibilityButton = document.querySelector("#eligibility-btn");
const eligibilityResult = document.querySelector("#eligibility-result-value");
const eligibilityGuidance = document.querySelector("#eligibility-guidance");
const faqItems = document.querySelectorAll(".faq-item");
const popup = document.querySelector("#lead-popup");
const popupCloseNodes = document.querySelectorAll("[data-close-popup]");
const popupOpenNodes = document.querySelectorAll("[data-open-popup]");
const floatingWidget = document.querySelector("[data-float-widget]");
const floatingToggle = document.querySelector("[data-float-toggle]");
const FALLBACK_API_ORIGIN = "http://127.0.0.1:8000";

const getApiCandidates = (path) => {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const candidates = [cleanPath];
  if (window.location.origin !== FALLBACK_API_ORIGIN) {
    candidates.push(`${FALLBACK_API_ORIGIN}${cleanPath}`);
  }
  return candidates;
};

const setNavbarState = () => {
  if (!navbar) return;
  navbar.classList.toggle("scrolled", window.scrollY > 8);
};

const scrollToSection = (targetId) => {
  const target = document.querySelector(targetId);
  if (!target) return;

  const navbarHeight = navbar ? navbar.offsetHeight : 0;
  const y = target.getBoundingClientRect().top + window.scrollY - navbarHeight - 12;
  window.scrollTo({ top: y, behavior: "smooth" });
};

const setMessage = (node, text, isError = false) => {
  if (!node) return;
  node.textContent = text;
  node.style.color = isError ? "#b42318" : "#087443";
};

const submitLead = async (payload) => {
  let lastError = null;
  for (const endpoint of getApiCandidates("/lead")) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return response.json();
      }

      let message = "Lead submission failed";
      try {
        const responsePayload = await response.json();
        message = responsePayload.detail || responsePayload.message || message;
      } catch {
        // keep fallback message
      }

      lastError = new Error(message);
      if (response.status === 404) {
        continue;
      }
      throw lastError;
    } catch (error) {
      if (!lastError) {
        lastError = error instanceof Error ? error : new Error("Lead submission failed");
      }
    }
  }

  throw lastError || new Error("Lead submission failed");
};

const submitLeadForm = async (form) => {
  const messageNode =
    form.querySelector('[role="status"]') ||
    form.querySelector("#form-message") ||
    form.parentElement?.querySelector("#form-message");

  const formData = new FormData(form);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    employment_type: String(formData.get("employmentType") || "").trim(),
    loan_type: String(formData.get("loanType") || "").trim(),
    loan_amount: Number(formData.get("loanAmount") || 0),
    purpose: String(formData.get("purpose") || "").trim(),
    city: String(formData.get("city") || "").trim(),
    source: "website",
  };

  if (
    !payload.name ||
    !payload.loan_type ||
    !payload.city ||
    !payload.employment_type ||
    !payload.purpose
  ) {
    setMessage(messageNode, "Please complete all required fields.", true);
    return;
  }

  if (!/^\d{10}$/.test(payload.phone)) {
    setMessage(messageNode, "Please enter a valid 10-digit phone number.", true);
    return;
  }

  if (!Number.isFinite(payload.loan_amount) || payload.loan_amount < 10000) {
    setMessage(messageNode, "Loan amount should be at least 10,000.", true);
    return;
  }

  try {
    const response = await submitLead(payload);
    setMessage(messageNode, response.message || "Our advisor will contact you shortly");
    form.reset();
    closePopup();
  } catch (error) {
    setMessage(messageNode, error.message || "Unable to submit right now. Please call or WhatsApp us directly.", true);
  }
};

const calculateEmi = () => {
  if (!emiAmount || !emiRate || !emiTenure || !emiResult) return;

  const principal = Number(emiAmount.value);
  const annualRate = Number(emiRate.value);
  const years = Number(emiTenure.value);

  if (!principal || annualRate < 0 || !years) {
    emiResult.textContent = "-";
    if (emiGuidance) {
      emiGuidance.textContent = "Based on your EMI, we can help you find better bank options.";
    }
    return;
  }

  const monthlyRate = annualRate / 12 / 100;
  const tenureMonths = years * 12;
  let emi = 0;

  if (monthlyRate === 0) {
    emi = principal / tenureMonths;
  } else {
    emi =
      (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) /
      (Math.pow(1 + monthlyRate, tenureMonths) - 1);
  }

  if (!Number.isFinite(emi) || emi <= 0) {
    emiResult.textContent = "-";
    return;
  }

  emiResult.textContent = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(emi);

  if (emiGuidance) {
    emiGuidance.textContent = "Based on your EMI, we can help you find better bank options.";
  }
};

const calculateEligibility = () => {
  if (
    !eligibilityIncome ||
    !eligibilityObligations ||
    !eligibilityTenure ||
    !eligibilityRate ||
    !eligibilityResult
  ) {
    return;
  }

  const income = Number(eligibilityIncome.value);
  const obligations = Number(eligibilityObligations.value);
  const years = Number(eligibilityTenure.value);
  const annualRate = Number(eligibilityRate.value);

  if (!income || years <= 0 || annualRate < 0 || obligations < 0 || obligations >= income) {
    eligibilityResult.textContent = "-";
    if (eligibilityGuidance) {
      eligibilityGuidance.textContent = "Compare lender options based on your projected eligibility.";
    }
    return;
  }

  const availableEmi = income * 0.55 - obligations;
  const monthlyRate = annualRate / 12 / 100;
  const months = years * 12;
  let eligibleAmount = 0;

  if (availableEmi <= 0) {
    eligibilityResult.textContent = "-";
    return;
  }

  if (monthlyRate === 0) {
    eligibleAmount = availableEmi * months;
  } else {
    eligibleAmount =
      (availableEmi * (Math.pow(1 + monthlyRate, months) - 1)) /
      (monthlyRate * Math.pow(1 + monthlyRate, months));
  }

  if (!Number.isFinite(eligibleAmount) || eligibleAmount <= 0) {
    eligibilityResult.textContent = "-";
    return;
  }

  eligibilityResult.textContent = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(eligibleAmount);

  if (eligibilityGuidance) {
    eligibilityGuidance.textContent = "Compare lender options based on your projected eligibility.";
  }
};

const openPopup = () => {
  if (!popup) return;
  closeFloatingWidget();
  popup.classList.add("open");
  popup.setAttribute("aria-hidden", "false");
};

const closePopup = () => {
  if (!popup) return;
  popup.classList.remove("open");
  popup.setAttribute("aria-hidden", "true");
};

const closeFloatingWidget = () => {
  if (!floatingWidget) return;
  floatingWidget.classList.remove("open");
};

setNavbarState();
window.addEventListener("scroll", setNavbarState);

anchorLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    const href = link.getAttribute("href");
    if (!href || href === "#" || !href.startsWith("#")) return;

    event.preventDefault();
    scrollToSection(href);
  });
});

if (revealNodes.length) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.16,
      rootMargin: "0px 0px -8% 0px",
    }
  );

  revealNodes.forEach((node) => revealObserver.observe(node));
}

leadForms.forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitLeadForm(form);
  });
});

if (emiCalcButton) {
  emiCalcButton.addEventListener("click", calculateEmi);
  [emiAmount, emiRate, emiTenure].forEach((input) => {
    input?.addEventListener("input", calculateEmi);
  });
  calculateEmi();
}

if (eligibilityButton) {
  eligibilityButton.addEventListener("click", calculateEligibility);
  [eligibilityIncome, eligibilityObligations, eligibilityTenure, eligibilityRate].forEach((input) => {
    input?.addEventListener("input", calculateEligibility);
  });
  calculateEligibility();
}

faqItems.forEach((item) => {
  const toggle = item.querySelector(".faq-toggle");
  if (!toggle) return;

  toggle.addEventListener("click", () => {
    const isOpen = item.classList.contains("open");
    faqItems.forEach((faq) => faq.classList.remove("open"));
    if (!isOpen) {
      item.classList.add("open");
    }
  });
});

popupOpenNodes.forEach((node) => {
  node.addEventListener("click", openPopup);
});

popupCloseNodes.forEach((node) => {
  node.addEventListener("click", closePopup);
});

if (floatingToggle && floatingWidget) {
  floatingToggle.addEventListener("click", () => {
    floatingWidget.classList.toggle("open");
  });

  document.addEventListener("click", (event) => {
    if (!floatingWidget.contains(event.target)) {
      closeFloatingWidget();
    }
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closePopup();
    closeFloatingWidget();
  }
});

if (popup && !sessionStorage.getItem("lead-popup-shown")) {
  window.setTimeout(() => {
    openPopup();
    sessionStorage.setItem("lead-popup-shown", "true");
  }, 5500);
}
