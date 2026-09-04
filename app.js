(function () {
  "use strict";
  const inventory = Array.isArray(window.INVENTORY) ? window.INVENTORY : [];
  const config = window.SITE_CONFIG || {};
  const callLines = Array.isArray(config.phones) && config.phones.length ? config.phones.join(" or ") : config.phone;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  let activeVehicle = null;
  let lastTrackedVehicleId = null;
  let lastDeliveryKey = "";
  let lastDeliveryAt = 0;
  const pathVehicleMatch = location.pathname.match(/\/cars\/([^/]+)\/?$/i);
  const requestedVehicleId = (pathVehicleMatch && decodeURIComponent(pathVehicleMatch[1])) || new URLSearchParams(location.search).get("vehicle");
  const campaignVehicle = inventory.find((vehicle) => vehicle.id === requestedVehicleId) || null;

  function isLocalPreview() {
    return location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  }

  function isPreview() {
    return Boolean(config.demoMode) || isLocalPreview();
  }

  function assetPath(src) {
    if (/^(?:https?:)?\/\//i.test(src) || src.startsWith("/")) return src;
    return `/${src.replace(/^\.\//, "")}`;
  }

  function responsiveImage(src, width) {
    return assetPath(src).replace(/\.webp$/i, `-${width}.webp`);
  }

  function responsiveSrcset(src) {
    const source = assetPath(src);
    return `${responsiveImage(source, 480)} 480w, ${responsiveImage(source, 800)} 800w, ${source} 1200w`;
  }

  function setResponsiveImage(image, src) {
    if (!image || !src) return;
    const source = assetPath(src);
    image.srcset = responsiveSrcset(source);
    image.src = source;
  }

  function validatePhoneInput(input) {
    if (!input) return false;
    const digits = input.value.replace(/\D/g, "");
    input.setCustomValidity(digits.length >= 7 ? "" : "Enter at least 7 digits. You may use +, spaces, parentheses, or dashes.");
    return input.validity.valid;
  }

  function fieldErrorMessage(field) {
    if (field.disabled || !field.willValidate) return "";
    const value = String(field.value || "").trim();
    if (field.required && (field.type === "checkbox" ? !field.checked : !value)) {
      if (field.type === "checkbox") return "Please check this box so the dealer can contact you about your request.";
      const required = {
        firstName: "Please enter your first name.",
        lastName: "Please enter your last name.",
        name: "Please enter your name.",
        phone: "Please enter your phone number.",
        email: "Please enter your email address.",
        vehicleSlug: "Please choose the exact vehicle.",
        requestType: "Please choose what you would like to receive.",
        message: "Please enter your question."
      };
      return required[field.name] || "Please complete this field.";
    }
    if (field.type === "tel" && !validatePhoneInput(field)) return "Please enter at least 7 digits. Spaces, +, parentheses, and dashes are welcome.";
    if (field.type === "email" && field.validity.typeMismatch) return "Please enter a valid email address, such as name@example.com.";
    if (!field.validity.valid) return "Please check this field and try again.";
    return "";
  }

  function setFieldError(field, message) {
    const id = `${field.form.id}-${field.name}-error`;
    let error = document.getElementById(id);
    if (!error && message) {
      error = document.createElement("small");
      error.id = id;
      error.className = "field-error";
      error.lang = "en";
      error.setAttribute("role", "alert");
      const anchor = field.type === "checkbox" ? field.closest("label") || field : field;
      anchor.insertAdjacentElement("afterend", error);
      const descriptions = new Set((field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      descriptions.add(id);
      field.setAttribute("aria-describedby", [...descriptions].join(" "));
    }
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
    if (message) field.setAttribute("aria-invalid", "true");
    else field.removeAttribute("aria-invalid");
  }

  function validateFields(root, revealField) {
    let firstInvalid = null;
    $$("input, select, textarea", root).forEach((field) => {
      const message = fieldErrorMessage(field);
      setFieldError(field, message);
      if (message && !firstInvalid) firstInvalid = field;
    });
    if (!firstInvalid) return true;
    if (revealField) revealField(firstInvalid);
    firstInvalid.focus();
    firstInvalid.scrollIntoView({ block: "center", behavior: "smooth" });
    return false;
  }

  function setupEnglishValidation() {
    $$("form").forEach((form) => {
      form.noValidate = true;
      form.addEventListener("invalid", (event) => event.preventDefault(), true);
      form.addEventListener("input", () => {
        const previousSuccess = $(".form-status.success", form);
        if (previousSuccess) {
          previousSuccess.className = "form-status";
          previousSuccess.textContent = "";
        }
      });
      $$("input, select, textarea", form).forEach((field) => {
        const refresh = () => {
          if (field.hasAttribute("aria-invalid")) setFieldError(field, fieldErrorMessage(field));
        };
        field.addEventListener("input", refresh);
        field.addEventListener("change", refresh);
      });
      form.addEventListener("reset", () => {
        $$("input, select, textarea", form).forEach((field) => setFieldError(field, ""));
      });
    });
  }

  function showRequestSuccess(status) {
    status.className = "form-status success";
    status.textContent = "Thank you! Your request has been sent. Please expect a call from the dealer shortly.";
    status.lang = "en";
    status.tabIndex = -1;
    status.focus({ preventScroll: true });
    status.scrollIntoView({ block: "center", behavior: "smooth" });
  }


  function setupFlexiblePhoneInputs() {
    $$("input[type='tel']").forEach((input, index) => {
      input.inputMode = "tel";
      input.autocomplete = "tel";
      input.maxLength = 40;
      input.placeholder = "+1 (555) 555-5555";
      const hintId = `phone-format-hint-${index + 1}`;
      input.setAttribute("aria-describedby", hintId);
      input.addEventListener("input", () => validatePhoneInput(input));
      const hint = document.createElement("small");
      hint.className = "phone-format-hint";
      hint.id = hintId;
      hint.textContent = "Any phone format is fine — include +1 or another country code if needed.";
      input.insertAdjacentElement("afterend", hint);
    });
  }

  function setupVehicleQuickRequest() {
    if (!campaignVehicle) return;
    [$(".floating-tools"), $(".mobile-bar")].filter(Boolean).forEach((bar) => {
      const chatButton = $("[data-chat-open]", bar);
      if (!chatButton || $(".vehicle-lead-cta", bar)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vehicle-lead-cta";
      button.innerHTML = bar.classList.contains("mobile-bar")
        ? "<span>Check</span><small>availability</small>"
        : '<i data-lucide="clipboard-check" aria-hidden="true"></i><span>Check availability</span>';
      button.setAttribute("aria-label", `Check availability of ${campaignVehicle.title}`);
      button.addEventListener("click", () => startRequest(campaignVehicle.id, "Availability and details"));
      bar.insertBefore(button, chatButton);
    });
  }

  function phoneHref(phone) {
    return `tel:${String(phone || "").replace(/[^\d+]/g, "")}`;
  }

  function replaceWithCallLink(element, phone) {
    if (!element || !phone) return;
    const link = document.createElement("a");
    link.className = element.className;
    link.href = phoneHref(phone);
    link.innerHTML = `<i data-lucide="phone" aria-hidden="true"></i><span>Call ${phone}</span>`;
    element.replaceWith(link);
  }

  function setupCampaignLanding() {
    if (!campaignVehicle) return;
    const galleryNav = $("[data-gallery-nav]");
    if (galleryNav) galleryNav.setAttribute("href", "#campaign-proof-photos");
    const primaryPhone = (Array.isArray(config.phones) && config.phones[0]) || config.phone;
    [$("#vehicle-select"), $("#chat-vehicle-select")].filter(Boolean).forEach((select) => {
      select.innerHTML = `<option value="${campaignVehicle.id}">${campaignVehicle.title} — ${money.format(campaignVehicle.price)}${campaignVehicle.stock ? ` — Stock ${campaignVehicle.stock}` : ""}</option>`;
      select.value = campaignVehicle.id;
      select.setAttribute("aria-label", "Exact vehicle from your ad");
      select.closest("label")?.classList.add("vehicle-locked-field");
    });

    const actions = $(".hero .hero-actions");
    if (actions && !$(".vehicle-certainty", actions.parentElement)) {
      actions.insertAdjacentHTML("afterend", `<div class="vehicle-certainty" aria-label="Exact listing confirmation"><span><strong>Exact vehicle</strong>From your ad</span><span><strong>${campaignVehicle.images.length} real photos</strong>Of this listing</span><span><strong>${campaignVehicle.stock ? `Stock ${campaignVehicle.stock}` : "Current listing"}</strong>${money.format(campaignVehicle.price)} asking price</span></div>`);
    }

    replaceWithCallLink($("#hero-secondary-cta"), primaryPhone);
    $$('[data-campaign-request="Availability and details"]').forEach(button => button.textContent = "Check Availability");
    configureDirectVehicleForm();

    const inventoryList = $("#inventory-list");
    if (inventoryList && !$(".inventory-all-link", inventoryList.parentElement)) {
      const url = new URL("/", location.origin);
      new URLSearchParams(location.search).forEach((value, key) => url.searchParams.append(key, value));
      url.hash = "inventory";
      inventoryList.insertAdjacentHTML("afterend", `<a class="inventory-all-link" href="${url.href}">View all ${inventory.length} Schindler Motors cars</a>`);
    }
  }

  function setLabelText(label, text) {
    if (!label) return;
    const textNode = Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = text;
  }

  function configureDirectVehicleForm() {
    if (!campaignVehicle) return;
    const form = $("#request-form");
    const proofPhotos = $("#campaign-proof-photos");
    const contactStep = $(".form-step[data-step='2']", form);
    const purchaseStep = $(".form-step[data-step='3']", form);
    if (!form || !proofPhotos || !contactStep || !purchaseStep) return;

    form.classList.add("compact-vehicle-form");
    contactStep.querySelector("h3").textContent = "Get a call about this exact car.";

    const firstName = $("input[name='firstName']", form);
    const lastName = $("input[name='lastName']", form);
    const email = $("input[name='email']", form);
    setLabelText(firstName?.closest("label"), "Name");
    firstName.autocomplete = "name";
    if (lastName) {
      lastName.required = false;
      lastName.value = "";
      lastName.closest("label").hidden = true;
    }
    if (email) {
      email.required = true;
      email.closest("label").hidden = false;
    }

    const undecided = $("input[name='purchaseMethod'][value='Undecided']", form);
    if (undecided) undecided.checked = true;

    const consent = $("label.consent", purchaseStep);
    const privacy = $(".privacy-note", purchaseStep);
    const status = $(".form-status", purchaseStep);
    const fullSubmit = $("button[type='submit']", purchaseStep);
    const actions = $(".step-actions", contactStep);
    const next = $("[data-next='3']", contactStep);
    if (consent) actions.before(consent);
    if (privacy) actions.before(privacy);
    if (next) {
      next.type = "submit";
      next.className = "submit-request quick-submit";
      next.removeAttribute("data-next");
      next.textContent = "Call me about this car";
    }
    if (status) actions.after(status);
    if (fullSubmit) {
      fullSubmit.type = "button";
      fullSubmit.disabled = true;
    }

    const thirdPhoto = $$('img', proofPhotos)[2];
    if (thirdPhoto) thirdPhoto.insertAdjacentElement("afterend", form);
    else proofPhotos.append(form);
    showStep(2);
  }

  function setupPhoneTracking() {
    $$('a[href^="tel:"]').forEach((link) => link.addEventListener("click", () => {
      if (!window.fbq) return;
      window.fbq("trackCustom", "PhoneClick", {
        content_name: campaignVehicle ? campaignVehicle.title : "Schindler Motors",
        content_ids: campaignVehicle ? [campaignVehicle.id] : [],
        vehicle_stock: campaignVehicle ? campaignVehicle.stock || "" : "",
        phone_number: link.getAttribute("href").replace(/^tel:/, "")
      });
    }));
  }

  function loadMetaPixel() {
    const pixelIds = Array.isArray(config.metaPixelIds)
      ? config.metaPixelIds.filter((id) => /^\d+$/.test(String(id)))
      : (config.metaPixelId ? [config.metaPixelId] : []);
    if (isLocalPreview() || !pixelIds.length || window.fbq) return;
    (function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = true; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    pixelIds.forEach((pixelId) => window.fbq("init", String(pixelId)));
    window.fbq("track", "PageView");
  }

  function loadLiveChat() {
    if (window.LiveChatWidget || isPreview() || !config.liveChatLicense) return;
    window.__lc = window.__lc || {};
    window.__lc.license = Number(config.liveChatLicense);
    window.__lc.integration_name = "manual_channels";
    window.__lc.product_name = "livechat";
    (function (n, t, c) {
      function i(args) { return e._h ? e._h.apply(null, args) : e._q.push(args); }
      const e = { _q: [], _h: null, _v: "2.0", on() { i(["on", c.call(arguments)]); }, once() { i(["once", c.call(arguments)]); }, off() { i(["off", c.call(arguments)]); }, get() { if (!e._h) throw new Error("LiveChat not ready"); return i(["get", c.call(arguments)]); }, call() { i(["call", c.call(arguments)]); }, init() { const script = t.createElement("script"); script.async = true; script.src = "https://cdn.livechatinc.com/tracking.js"; t.head.appendChild(script); } };
      if (!n.__lc.asyncInit) e.init();
      n.LiveChatWidget = n.LiveChatWidget || e;
    })(window, document, [].slice);
  }

  function getAttribution() {
    const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"];
    const params = new URLSearchParams(location.search);
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem("schindler_attribution") || "{}"); } catch { saved = {}; }
    keys.forEach((key) => { if (params.get(key)) saved[key] = params.get(key).slice(0, 500); });
    if (!saved.landingUrl) saved.landingUrl = location.href.slice(0, 2000);
    sessionStorage.setItem("schindler_attribution", JSON.stringify(saved));
    return saved;
  }

  function updateVehicleMetadata(vehicle) {
    const title = `${vehicle.title} for Sale — ${money.format(vehicle.price)} | Schindler Motors`;
    const description = `${vehicle.title}, stock ${vehicle.stock || "available listing"}, offered at ${money.format(vehicle.price)} by Schindler Motors. View ${vehicle.images.length} real photos and ask about this exact vehicle.`;
    document.title = title;
    const descriptionMeta = document.querySelector('meta[name="description"]');
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDescription = document.querySelector('meta[property="og:description"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    const vehicleMeta = document.querySelector('meta[name="vehicle-id"]');
    if (descriptionMeta) descriptionMeta.content = description;
    if (ogTitle) ogTitle.content = title;
    if (ogDescription) ogDescription.content = description;
    if (ogImage) ogImage.content = new URL(assetPath(vehicle.images[0]), location.origin).href;
    if (vehicleMeta) vehicleMeta.content = vehicle.id;
  }

  function trackVehicleView(vehicle) {
    if (!window.fbq || lastTrackedVehicleId === vehicle.id) return;
    lastTrackedVehicleId = vehicle.id;
    window.fbq("track", "ViewContent", { content_name: vehicle.title, content_ids: [vehicle.id], content_type: "vehicle", vehicle_stock: vehicle.stock || "", value: vehicle.price, currency: "USD" });
  }

  function setupSectionLinks() {
    document.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="#"]');
      const hash = link && link.getAttribute("href");
      if (!hash || hash === "#") return;
      const target = document.querySelector(hash);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      const url = new URL(location.href);
      url.hash = hash;
      history.replaceState(history.state, "", url);
    });
  }

  function setVehicleUrl(vehicle) {
    const current = new URL(location.href);
    const url = new URL(`/cars/${encodeURIComponent(vehicle.id)}/`, location.origin);
    current.searchParams.forEach((value, key) => { if (key !== "vehicle") url.searchParams.append(key, value); });
    history.replaceState({ vehicle: vehicle.id }, "", url);
  }

  function vehicleHref(vehicle) {
    const current = new URL(location.href);
    const url = new URL(`/cars/${encodeURIComponent(vehicle.id)}/`, location.origin);
    current.searchParams.forEach((value, key) => { if (key !== "vehicle") url.searchParams.append(key, value); });
    return url.href;
  }

  function renderCampaignProof(vehicle) {
    document.documentElement.classList.add("vehicle-landing");
    $("#campaign-proof").hidden = false;
    $("#campaign-proof-title").textContent = vehicle.title;
    $("#campaign-proof-price").textContent = `${money.format(vehicle.price)} asking price${vehicle.stock ? ` · Stock ${vehicle.stock}` : ""}`;
    $("#campaign-proof-mood").textContent = vehicle.mood;
    $("#campaign-proof-specs").innerHTML = [["Engine", vehicle.engine], ["Transmission", vehicle.transmission], ["Mileage", vehicle.mileage], ["Body", vehicle.body], ["Exterior", vehicle.exterior], ["Interior", vehicle.interior]].filter(([, value]) => value).map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");
    $("#campaign-proof-photos").innerHTML = vehicle.images.map((src, index) => {
      const source = assetPath(src);
      const image = `<img src="${source}" srcset="${responsiveSrcset(source)}" sizes="(max-width: 740px) calc(100vw - 28px), 50vw" alt="${vehicle.title}, listing photo ${index + 1} of ${vehicle.images.length}" width="1200" height="800" loading="lazy" decoding="async">`;
      if (index !== 5) return image;
      return `${image}<div class="gallery-conversion-cta"><div><strong>Want to see a specific detail?</strong><span>Request a personal walk-around video or ask about delivery before you travel.</span></div><button class="red-button" type="button" data-gallery-request>Ask about this car</button></div>`;
    }).join("");
    const galleryRequest = $("[data-gallery-request]");
    if (galleryRequest) galleryRequest.addEventListener("click", () => startRequest(vehicle.id, "Personal walk-around video"));
    $("[data-campaign-gallery]").textContent = `See All ${vehicle.images.length} Photos`;
    $(".hero .eyebrow").textContent = "THE EXACT VEHICLE FROM YOUR AD";
    $("#hero-headline").textContent = vehicle.title;
    $("#hero-lede").textContent = "Interested in this car? Leave your name, phone number, and email for a dealer callback — or call our sales team now.";
    $("#inventory-heading-title").textContent = "Three more classics, if you want to compare.";
    const proofSection = $("#campaign-proof");
    const requestSection = $("#request");
    if (proofSection && requestSection) {
      proofSection.after(requestSection);
      requestSection.classList.add("vehicle-request-priority");
    }
  }

  function applyCampaignVehicle() {
    if (!campaignVehicle) return;
    if (!pathVehicleMatch) setVehicleUrl(campaignVehicle);
    const heroPhoto = $("#hero-vehicle-image");
    setResponsiveImage(heroPhoto, campaignVehicle.images[0]);
    heroPhoto.alt = `${campaignVehicle.title}, exact current listing`;
    $("#hero-vehicle-kicker").textContent = "THE VEHICLE YOU CAME TO SEE";
    $("#hero-vehicle-title").textContent = campaignVehicle.title;
    $("#hero-vehicle-meta").textContent = `${money.format(campaignVehicle.price)}${campaignVehicle.stock ? ` · STOCK ${campaignVehicle.stock}` : ""}`;
    $("#hero-mobile-title").textContent = campaignVehicle.title;
    $("#hero-mobile-meta").textContent = `${money.format(campaignVehicle.price)}${campaignVehicle.stock ? ` · STOCK ${campaignVehicle.stock}` : ""}`;
    $("#hero-primary-cta").textContent = "Request details";
    $("#hero-secondary-cta").textContent = "Request Walk-Around Video";
    $$("[data-vehicle]", $(".hero")).forEach((button) => button.dataset.vehicle = campaignVehicle.id);
    $(".hero-gallery-button").textContent = `See all ${campaignVehicle.images.length} photos`;
    $("#vehicle-select").value = campaignVehicle.id;
    $("#request-title").textContent = `Ask about the ${campaignVehicle.title}.`;
    $("#request-context").textContent = `${money.format(campaignVehicle.price)} asking price${campaignVehicle.stock ? ` · Stock ${campaignVehicle.stock}` : ""}. Leave your name, phone number, and email for a dealer callback about this exact car.`;
    renderCampaignProof(campaignVehicle);
    updateVehicleMetadata(campaignVehicle);
    trackVehicleView(campaignVehicle);
  }

  function populateSelect() {
    [$("#vehicle-select"), $("#chat-vehicle-select")].filter(Boolean).forEach((select) => {
      inventory.forEach((vehicle) => { const option = document.createElement("option"); option.value = vehicle.id; option.textContent = `${vehicle.title} — ${money.format(vehicle.price)}`; select.appendChild(option); });
    });
  }

  function syncFeaturedContent() {
    const defaultVehicle = inventory.find((vehicle) => vehicle.id === "1955-cadillac-deville-convertible") || inventory[0];
    if (defaultVehicle) {
      const heroPhoto = $("#hero-vehicle-image");
      setResponsiveImage(heroPhoto, defaultVehicle.images[0]);
      heroPhoto.alt = `${defaultVehicle.title}, current listing`;
      $("#hero-vehicle-title").textContent = defaultVehicle.title;
      $("#hero-vehicle-meta").textContent = `${money.format(defaultVehicle.price)}${defaultVehicle.stock ? ` · STOCK ${defaultVehicle.stock}` : ""}`;
      $("#hero-mobile-title").textContent = defaultVehicle.title;
      $("#hero-mobile-meta").textContent = `${money.format(defaultVehicle.price)}${defaultVehicle.stock ? ` · STOCK ${defaultVehicle.stock}` : ""}`;
      const galleryButton = $(".hero-gallery-button");
      if (galleryButton) {
        galleryButton.dataset.vehicle = defaultVehicle.id;
        galleryButton.textContent = `See all ${defaultVehicle.images.length} photos`;
      }
    }
    $$(".match-options [data-vehicle]").forEach((button) => {
      const vehicle = inventory.find((row) => row.id === button.dataset.vehicle);
      if (!vehicle) return;
      $("span", button).textContent = vehicle.stock ? `STOCK ${vehicle.stock}` : "CURRENT LISTING";
      $("strong", button).textContent = vehicle.title;
      $("small", button).textContent = `Asking ${money.format(vehicle.price)} · See ${vehicle.images.length} photos`;
    });
  }

  function filteredRows() {
    const max = $("#budget-filter").value;
    const rows = inventory.filter((vehicle) => max === "all" || vehicle.price <= Number(max));
    if (campaignVehicle) rows.sort((a, b) => Number(b.id === campaignVehicle.id) - Number(a.id === campaignVehicle.id));
    return rows;
  }

  function card(vehicle) {
    return `<article class="classic-card ${campaignVehicle && campaignVehicle.id === vehicle.id ? "campaign-match" : ""}"><a href="${vehicleHref(vehicle)}" data-vehicle="${vehicle.id}"><div class="classic-image"><img src="${assetPath(vehicle.images[0])}" srcset="${responsiveSrcset(vehicle.images[0])}" sizes="(max-width: 740px) calc(100vw - 28px), (max-width: 1080px) 55vw, 35vw" alt="${vehicle.title}" loading="lazy" decoding="async" width="1200" height="800"><span class="listing-status">${campaignVehicle && campaignVehicle.id === vehicle.id ? "FROM YOUR AD" : "CURRENT LISTING"}</span><span class="photo-count"><i data-lucide="images" aria-hidden="true"></i> ${vehicle.images.length} PHOTOS</span></div><div class="classic-copy"><p class="classic-era">${vehicle.year} · ${vehicle.body}</p><h3>${vehicle.title}</h3><p class="classic-price">ASKING ${money.format(vehicle.price)}</p><ul class="classic-specs"><li><strong>Stock:</strong> ${vehicle.stock || "Confirm with dealer"}</li><li><strong>Engine:</strong> ${vehicle.engine}</li><li><strong>Transmission:</strong> ${vehicle.transmission}</li><li><strong>Mileage:</strong> ${vehicle.mileage}</li></ul><span class="classic-more">Open vehicle page · ${vehicle.images.length} photos <i data-lucide="arrow-up-right" aria-hidden="true"></i></span></div></a></article>`;
  }

  function render() {
    const allRows = filteredRows();
    const rows = campaignVehicle ? allRows.filter((vehicle) => vehicle.id !== campaignVehicle.id).slice(0, 3) : allRows;
    $("#inventory-list").innerHTML = rows.length ? rows.map(card).join("") : `<div class="empty-state"><h3>No exact match</h3><p>Reset the filters to see the full collection.</p></div>`;
    $("#inventory-count").textContent = campaignVehicle ? `${rows.length} related vehicles` : `${rows.length} vehicle${rows.length === 1 ? "" : "s"}`;
    if (window.lucide) window.lucide.createIcons();
  }

  function openVehiclePage(id) {
    const vehicle = inventory.find((row) => row.id === id);
    if (!vehicle) return;
    if (pathVehicleMatch && campaignVehicle && campaignVehicle.id === vehicle.id) {
      $("#campaign-proof-photos").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    location.assign(vehicleHref(vehicle));
  }

  function showStep(number) {
    $$(".form-step").forEach((step) => step.classList.toggle("active", Number(step.dataset.step) === number));
    $$('[data-progress]').forEach((progress) => progress.classList.toggle("active", Number(progress.dataset.progress) === number));
  }

  function validateStep(number) {
    const step = $(`.form-step[data-step='${number}']`);
    return validateFields(step);
  }

  function startRequest(id = activeVehicle && activeVehicle.id, type = "") {
    const vehicle = inventory.find((row) => row.id === id) || campaignVehicle || inventory.find((row) => row.id === "1955-cadillac-deville-convertible") || inventory[0];
    if (!vehicle) {
      $("#inventory").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    activeVehicle = vehicle;
    $("#vehicle-select").value = vehicle.id;
    $("#request-title").textContent = `Ask about the ${vehicle.title}.`;
    const directVehicleRequest = Boolean(campaignVehicle && vehicle.id === campaignVehicle.id);
    $("#request-context").textContent = directVehicleRequest
      ? `${money.format(vehicle.price)} asking price${vehicle.stock ? ` · Stock ${vehicle.stock}` : ""}. Leave your name, phone number, and email for a dealer callback about this exact car.`
      : `${money.format(vehicle.price)} asking price${vehicle.stock ? ` · Stock ${vehicle.stock}` : ""}. Leave your contact details so our sales team can follow up about this car.`;
    if (type) $("select[name='requestType']").value = type;
    showStep(directVehicleRequest ? 2 : 1);
    if (window.fbq) window.fbq("trackCustom", "LeadFormOpen", { content_name: vehicle.title, content_ids: [vehicle.id], vehicle_stock: vehicle.stock || "", request_type: type || "Availability and details" });
    const requestTarget = directVehicleRequest ? $("#request-form") : $("#request");
    requestTarget.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      const field = directVehicleRequest ? $("#request-form input[name='firstName']") : $("#vehicle-select");
      field.scrollIntoView({ block: "center", behavior: "auto" });
      field.focus({ preventScroll: true });
    }, 450);
  }

  function openChat() {
    if (!isPreview() && config.liveChatLicense) {
      loadLiveChat();
      document.documentElement.classList.add("internal-chat-open");
      if (!openChat.visibilityBound && window.LiveChatWidget && typeof window.LiveChatWidget.on === "function") {
        window.LiveChatWidget.on("visibility_changed", (data) => {
          const visibility = data && data.visibility;
          document.documentElement.classList.toggle("internal-chat-open", visibility === "maximized");
          if (visibility === "minimized" && typeof window.LiveChatWidget.call === "function") window.LiveChatWidget.call("hide");
        });
        openChat.visibilityBound = true;
      }
      window.LiveChatWidget.call("maximize");
      if (window.fbq) window.fbq("trackCustom", "LiveChatOpen");
      return;
    }
    const vehicle = activeVehicle || campaignVehicle;
    if (vehicle) $("#chat-vehicle-select").value = vehicle.id;
    document.documentElement.classList.add("internal-chat-open");
    $("#chat-panel").removeAttribute("inert"); $("#chat-panel").classList.add("open"); $(".chat-scrim").classList.add("open"); $("#chat-panel").setAttribute("aria-hidden", "false"); setTimeout(() => $("#chat-vehicle-select").focus(), 250);
  }
  function closeChat() { document.documentElement.classList.remove("internal-chat-open"); $("#chat-panel").classList.remove("open"); $(".chat-scrim").classList.remove("open"); $("#chat-panel").setAttribute("aria-hidden", "true"); $("#chat-panel").setAttribute("inert", ""); }

  function newLeadId() {
    return window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function postLeadToRouter(payload) {
    const requestPayload = { ...payload, leadSource: "LANDING", leadId: payload.leadId || newLeadId(), receivedAt: new Date().toISOString() };
    const options = { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(requestPayload), redirect: "follow" };
    const response = await fetch(config.leadEndpoint, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok !== true) {
      throw new Error(body.message || "We could not confirm delivery of your request.");
    }
    return body;
  }

  async function deliver(payload, status) {
    status.className = "form-status";
    const deliveryKey = JSON.stringify([payload.type, payload.phone, payload.email, payload.vehicleSlug, payload.requestType, payload.message]);
    if (deliveryKey === lastDeliveryKey && Date.now() - lastDeliveryAt < 5000) {
      status.classList.add("error");
      status.textContent = "Your request is already being processed. Please wait a moment.";
      return false;
    }
    lastDeliveryKey = deliveryKey;
    lastDeliveryAt = Date.now();
    status.textContent = "Sending…";
    const preview = isPreview();
    if (preview || !config.leadEndpoint) {
      localStorage.setItem("schindler_pending_lead", JSON.stringify({ ...payload, savedAt: new Date().toISOString() }));
      status.classList.add(preview ? "success" : "error");
      status.textContent = preview ? "Preview mode: form validated and saved in this browser. Connect the lead router before traffic." : `Online delivery is not connected yet. Please call ${callLines}.`;
      return false;
    }
    try {
      await postLeadToRouter(payload);
      showRequestSuccess(status);
      return true;
    } catch (error) {
      lastDeliveryKey = "";
      lastDeliveryAt = 0;
      status.classList.add("error"); status.textContent = `We could not send your request. Please try again or call ${callLines}.`; return false;
    }
  }

  async function submitRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === "true") return;
    if (!validateFields(form, (field) => {
      const step = field.closest(".form-step");
      if (step) showStep(Number(step.dataset.step));
    })) return;
    const data = new FormData(form);
    const vehicle = inventory.find((row) => row.id === data.get("vehicleSlug"));
    const payload = { type: "vehicle-request", leadId: newLeadId(), dealerId: config.dealerId, dealerName: config.brand, landingId: config.landingId, vehicleSlug: data.get("vehicleSlug"), vehicle: vehicle ? vehicle.title : "", vehicleStock: vehicle ? vehicle.stock : "", vehiclePrice: vehicle ? vehicle.price : null, requestType: data.get("requestType"), firstName: String(data.get("firstName") || "").trim(), lastName: String(data.get("lastName") || "").trim(), phone: String(data.get("phone") || "").trim(), email: String(data.get("email") || "").trim(), purchaseMethod: data.get("purchaseMethod"), deliveryNeeded: Boolean(data.get("deliveryNeeded")), contactConsent: Boolean(data.get("contactConsent")), pageUrl: location.href, attribution: getAttribution() };
    const submit = form.querySelector('button[type="submit"]');
    form.dataset.submitting = "true";
    submit.disabled = true;
    try {
      const sent = await deliver(payload, $(".form-status", form));
      if (sent) form.reset();
    } finally {
      delete form.dataset.submitting;
      submit.disabled = false;
    }
  }

  async function submitChat(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === "true") return;
    if (!validateFields(form)) return;
    const data = new FormData(form);
    const vehicle = inventory.find((row) => row.id === data.get("vehicleSlug"));
    const payload = { type: "chat-question", leadId: newLeadId(), dealerId: config.dealerId, dealerName: config.brand, landingId: config.landingId, vehicleSlug: data.get("vehicleSlug"), vehicle: vehicle ? vehicle.title : "", vehicleStock: vehicle ? vehicle.stock : "", name: String(data.get("name") || "").trim(), phone: String(data.get("phone") || "").trim(), email: String(data.get("email") || "").trim(), message: String(data.get("message") || "").trim(), contactConsent: Boolean(data.get("contactConsent")), pageUrl: location.href, attribution: getAttribution() };
    const submit = form.querySelector('button[type="submit"]');
    form.dataset.submitting = "true";
    submit.disabled = true;
    try {
      const sent = await deliver(payload, $(".form-status", form));
      if (sent) form.reset();
    } finally {
      delete form.dataset.submitting;
      submit.disabled = false;
    }
  }

  function init() {
    getAttribution(); setupSectionLinks(); loadMetaPixel(); populateSelect(); setupFlexiblePhoneInputs(); syncFeaturedContent(); applyCampaignVehicle(); setupCampaignLanding(); setupVehicleQuickRequest(); setupPhoneTracking(); render();
    setupEnglishValidation();
    $$('[data-vehicle]').filter((button) => !button.closest("#inventory-list")).forEach((button) => button.addEventListener("click", () => openVehiclePage(button.dataset.vehicle)));
    $("#budget-filter").addEventListener("change", render);
    $("#reset-filter").addEventListener("click", () => { $("#budget-filter").value = "all"; render(); });
    $$('[data-hero-request]').forEach((button) => button.addEventListener("click", () => startRequest((campaignVehicle || inventory.find((row) => row.id === "1955-cadillac-deville-convertible") || inventory[0]).id, button.dataset.heroRequest)));
    $$('[data-campaign-request]').forEach((button) => button.addEventListener("click", () => startRequest(campaignVehicle && campaignVehicle.id, button.dataset.campaignRequest)));
    const campaignGallery = $('[data-campaign-gallery]');
    if (campaignGallery && campaignVehicle) campaignGallery.addEventListener("click", () => $("#campaign-proof-photos").scrollIntoView({ behavior: "smooth", block: "start" }));
    $$('[data-next]').forEach((button) => button.addEventListener("click", () => { const current = Number(button.closest(".form-step").dataset.step); if (validateStep(current)) showStep(Number(button.dataset.next)); }));
    $$('[data-back]').forEach((button) => button.addEventListener("click", () => showStep(Number(button.dataset.back))));
    $$('[data-chat-open]').forEach((button) => button.addEventListener("click", openChat));
    $$('[data-chat-close]').forEach((button) => button.addEventListener("click", closeChat));
    $("#request-form").addEventListener("submit", submitRequest);
    $("#chat-form").addEventListener("submit", submitChat);
    if (window.lucide) window.lucide.createIcons();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
