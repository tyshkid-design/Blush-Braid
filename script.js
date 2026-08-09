/* ============================================================
   Luminous — booking logic
   NOTE: There is no backend here, so booked slots live only in
   this browser tab's memory (the `bookings` array below) and
   reset on refresh. Wire this up to a real database/API so
   availability is shared across every visitor and device.
   ============================================================ */

(function () {
  "use strict";

  var SUBCATEGORIES = {
    nails: [
      { name: "Overlays", price: 1500 },
      { name: "Gel / Gum Gels", price: 2000 },
      { name: "Acrylic Tips", price: 2500 },
      { name: "Stick-ons & Tips", price: 1200 },
      { name: "French Tips", price: 1800 },
      { name: "Ombre", price: 2200 },
      { name: "Chrome / Cat-eye", price: 2500 },
      { name: "Nail Art", price: 500, fromPrice: true },
      { name: "Gel Polish", price: 1000 },
      { name: "Manicure & Pedicure", price: 1500 },
      { name: "Nail Repair", price: 300, fromPrice: true },
      { name: "Other", price: null }
    ],
    hair: [
      { name: "Braiding", price: 2500, fromPrice: true },
      { name: "Knotless Braids", price: 3500, fromPrice: true },
      { name: "Cornrows", price: 1500, fromPrice: true },
      { name: "Box Braids", price: 3000, fromPrice: true },
      { name: "Weaving", price: 2500, fromPrice: true },
      { name: "Wig Installation", price: 2000 },
      { name: "Silk Press", price: 1500 },
      { name: "Treatment / Deep Conditioning", price: 1000 },
      { name: "Other", price: null }
    ]
  };

  function formatPrice(item) {
    if (!item || item.price === null || item.price === undefined) return "On request";
    var amount = "KSh " + item.price.toLocaleString();
    return item.fromPrice ? "From " + amount : amount;
  }

  var OPEN_HOUR = 7;    // 7:00 AM
  var CLOSE_HOUR = 21;  // 9:00 PM (last appointment starts at 20:00)

  // Demo seed data so the "slot already taken" flow has something
  // to show. Keyed by "YYYY-MM-DD|H" (24h start hour).
  var bookings = {};
  (function seedDemoBookings() {
    var today = new Date();
    var key = formatDateKey(today);
    bookings[key + "|9"] = true;
    bookings[key + "|14"] = true;
  })();

  function formatDateKey(dateObj) {
    var y = dateObj.getFullYear();
    var m = String(dateObj.getMonth() + 1).padStart(2, "0");
    var d = String(dateObj.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function formatHourLabel(hour) {
    var period = hour >= 12 ? "PM" : "AM";
    var h12 = hour % 12 === 0 ? 12 : hour % 12;
    return h12 + ":00 " + period;
  }

  // ---------------- State ----------------
  var DEPOSIT_PERCENT = 0.2;   // 20% of the service price
  var DEPOSIT_MIN = 300;       // floor for services with no fixed price ("Other", on-request)

  var state = {
    step: 1,
    services: { nails: false, hair: false },
    selections: {
      nails: { subcategory: null, item: null, priceLabel: null, otherDetail: "" },
      hair: { subcategory: null, item: null, priceLabel: null, otherDetail: "" }
    },
    imageFile: null,
    imageDataUrl: null,
    date: null,
    hour: null,            // 24h start hour of chosen slot
    paymentMethod: null,   // "mpesa" | "salon"
    paymentStatus: null,   // null | "pending" | "paid"
    depositAmount: DEPOSIT_MIN
  };

  function computeDeposit(item) {
    if (!item || item.price === null || item.price === undefined) return DEPOSIT_MIN;
    var raw = item.price * DEPOSIT_PERCENT;
    var rounded = Math.round(raw / 50) * 50;
    return Math.max(rounded, DEPOSIT_MIN);
  }

  // Sum of deposits across every service the client selected a style for.
  function recomputeTotalDeposit() {
    var total = 0;
    ["nails", "hair"].forEach(function (svc) {
      if (state.services[svc] && state.selections[svc].item) {
        total += computeDeposit(state.selections[svc].item);
      }
    });
    state.depositAmount = total > 0 ? total : DEPOSIT_MIN;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("bookingForm");
    if (!form) return; // not on booking.html

    var steps = form.querySelectorAll(".form-step");
    var dots = form.querySelectorAll(".step-dot");
    var serviceButtons = form.querySelectorAll(".service-option[data-service]");
    var paymentButtons = form.querySelectorAll(".service-option[data-payment]");
    var mpesaPanel = document.getElementById("mpesaPanel");
    var salonPanel = document.getElementById("salonPanel");
    var mpesaPhoneInput = document.getElementById("mpesaPhone");
    var depositAmountLabel = document.getElementById("depositAmountLabel");
    var sendStkBtn = document.getElementById("sendStkBtn");
    var stkPending = document.getElementById("stkPending");
    var stkSuccess = document.getElementById("stkSuccess");
    var stkError = document.getElementById("stkError");
    var subcategorySelects = {
      nails: document.getElementById("nailsSubcategory"),
      hair: document.getElementById("hairSubcategory")
    };
    var otherWraps = {
      nails: document.getElementById("nailsOtherWrap"),
      hair: document.getElementById("hairOtherWrap")
    };
    var otherDetailInputs = {
      nails: document.getElementById("nailsOtherDetail"),
      hair: document.getElementById("hairOtherDetail")
    };
    var serviceBlocks = {
      nails: document.getElementById("nailsBlock"),
      hair: document.getElementById("hairBlock")
    };
    var dropzone = document.getElementById("dropzone");
    var imageInput = document.getElementById("imageInput");
    var imagePreviewWrap = document.getElementById("imagePreviewWrap");
    var imagePreview = document.getElementById("imagePreview");
    var imageFileName = document.getElementById("imageFileName");
    var removeImageBtn = document.getElementById("removeImage");
    var dateInput = document.getElementById("bookingDate");
    var slotGrid = document.getElementById("slotGrid");
    var slotTakenNotice = document.getElementById("slotTakenNotice");
    var summaryList = document.getElementById("summaryList");
    var finalSummary = document.getElementById("finalSummary");

    // Restrict date picker to today .. +60 days
    var todayStr = formatDateKey(new Date());
    dateInput.min = todayStr;
    var maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 60);
    dateInput.max = formatDateKey(maxDate);
    dateInput.value = todayStr;

    goToStep(1);
    renderSlots();

    // ---------- Navigation ----------
    form.addEventListener("click", function (e) {
      if (e.target.matches("[data-next]")) {
        if (validateStep(state.step)) goToStep(state.step + 1);
      }
      if (e.target.matches("[data-prev]")) {
        goToStep(state.step - 1);
      }
    });

    function goToStep(n) {
      state.step = n;
      steps.forEach(function (s) {
        s.classList.toggle("active", Number(s.dataset.step) === n);
      });
      dots.forEach(function (d, i) {
        d.classList.toggle("active", i + 1 === n);
        d.classList.toggle("done", i + 1 < n);
      });
      if (n === 4) {
        if (mpesaPhoneInput && !mpesaPhoneInput.value) {
          mpesaPhoneInput.value = document.getElementById("clientWhatsapp").value.trim();
        }
        if (depositAmountLabel) {
          depositAmountLabel.textContent = "KSh " + state.depositAmount.toLocaleString();
        }
        if (sendStkBtn && state.paymentStatus !== "paid") {
          sendStkBtn.textContent = "Send STK push — pay KSh " + state.depositAmount.toLocaleString();
        }
      }
      if (n === 5) renderSummary(summaryList);
      window.scrollTo({ top: form.offsetTop - 90, behavior: "smooth" });
    }

    // ---------- Step 1 validation ----------
    function validateStep(n) {
      if (n === 1) {
        var name = document.getElementById("clientName").value.trim();
        var email = document.getElementById("clientEmail").value.trim();
        var whatsapp = document.getElementById("clientWhatsapp").value.trim();
        var notice = document.getElementById("step1Notice");
        if (!name || !email || !whatsapp) {
          showNotice(notice, "Please fill in your name, email and WhatsApp number.");
          return false;
        }
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          showNotice(notice, "That email address doesn't look right.");
          return false;
        }
        if (whatsapp.replace(/\D/g, "").length < 9) {
          showNotice(notice, "Please enter a valid WhatsApp number.");
          return false;
        }
        hideNotice(notice);
        return true;
      }
      if (n === 2) {
        var notice2 = document.getElementById("step2Notice");
        if (!state.services.nails && !state.services.hair) {
          showNotice(notice2, "Choose Nails, Hair, or both.");
          return false;
        }
        var missing = [];
        ["nails", "hair"].forEach(function (svc) {
          if (!state.services[svc]) return;
          var sel = state.selections[svc];
          if (!sel.subcategory) {
            missing.push(svc === "nails" ? "a nails style" : "a hair style");
          } else if (sel.subcategory === "Other" && !otherDetailInputs[svc].value.trim()) {
            missing.push(svc === "nails" ? "a description for your nail style" : "a description for your hair style");
          }
        });
        if (missing.length) {
          showNotice(notice2, "Please choose " + missing.join(" and ") + ".");
          return false;
        }
        ["nails", "hair"].forEach(function (svc) {
          if (state.services[svc]) {
            state.selections[svc].otherDetail = otherDetailInputs[svc].value.trim();
          }
        });
        hideNotice(notice2);
        return true;
      }
      if (n === 3) {
        if (!state.date || state.hour === null) {
          slotTakenNotice.style.display = "none";
          alert("Please pick a date and an available time slot.");
          return false;
        }
        // Re-check availability in case it was taken in the meantime
        var key = state.date + "|" + state.hour;
        if (bookings[key]) {
          slotTakenNotice.textContent = "⏰ That slot has just been taken by another client. Please choose another time below.";
          slotTakenNotice.style.display = "flex";
          state.hour = null;
          renderSlots();
          return false;
        }
        return true;
      }
      if (n === 4) {
        var notice4 = document.getElementById("step4Notice");
        if (!state.paymentMethod) {
          showNotice(notice4, "Choose how you'd like to pay first.");
          return false;
        }
        if (state.paymentMethod === "mpesa" && state.paymentStatus !== "paid") {
          showNotice(notice4, "Please complete the M-Pesa deposit above, or switch to \u201cPay at the salon\u201d.");
          return false;
        }
        hideNotice(notice4);
        return true;
      }
      return true;
    }

    function showNotice(el, msg) {
      el.textContent = msg;
      el.classList.add("show");
    }
    function hideNotice(el) {
      el.classList.remove("show");
    }

    // ---------- Service + subcategory (client can pick nails, hair, or both) ----------
    serviceButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var svc = btn.dataset.service;
        var nowSelected = !btn.classList.contains("selected");
        btn.classList.toggle("selected", nowSelected);
        state.services[svc] = nowSelected;
        serviceBlocks[svc].style.display = nowSelected ? "block" : "none";

        if (nowSelected) {
          populateSubcategories(svc);
        } else {
          // Clear that service's selection when it's deselected
          state.selections[svc] = { subcategory: null, item: null, priceLabel: null, otherDetail: "" };
          subcategorySelects[svc].value = "";
          otherWraps[svc].style.display = "none";
          otherDetailInputs[svc].value = "";
        }
        recomputeTotalDeposit();
      });
    });

    function populateSubcategories(service) {
      var list = SUBCATEGORIES[service] || [];
      var select = subcategorySelects[service];
      select.innerHTML = '<option value="">Choose a style…</option>';
      list.forEach(function (item) {
        var opt = document.createElement("option");
        opt.value = item.name;
        opt.dataset.priceLabel = formatPrice(item);
        opt.textContent = item.name + " — " + formatPrice(item);
        select.appendChild(opt);
      });
    }

    ["nails", "hair"].forEach(function (svc) {
      subcategorySelects[svc].addEventListener("change", function () {
        var select = subcategorySelects[svc];
        var value = select.value || null;
        var selectedOpt = select.options[select.selectedIndex];
        var list = SUBCATEGORIES[svc] || [];
        var item = list.filter(function (i) { return i.name === value; })[0] || null;

        state.selections[svc] = {
          subcategory: value,
          item: item,
          priceLabel: value ? selectedOpt.dataset.priceLabel : null,
          otherDetail: state.selections[svc].otherDetail
        };
        otherWraps[svc].style.display = value === "Other" ? "block" : "none";
        recomputeTotalDeposit();
      });
    });

    // ---------- Image upload ----------
    dropzone.addEventListener("click", function () { imageInput.click(); });
    dropzone.addEventListener("dragover", function (e) {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", function () {
      dropzone.classList.remove("dragover");
    });
    dropzone.addEventListener("drop", function (e) {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleImageFile(e.dataTransfer.files[0]);
      }
    });
    imageInput.addEventListener("change", function () {
      if (imageInput.files && imageInput.files[0]) {
        handleImageFile(imageInput.files[0]);
      }
    });

    function handleImageFile(file) {
      var notice2 = document.getElementById("step2Notice");
      if (!/^image\/(png|jpeg)$/.test(file.type)) {
        showNotice(notice2, "Please upload a PNG or JPG image.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showNotice(notice2, "That image is over 5MB — please choose a smaller file.");
        return;
      }
      hideNotice(notice2);
      state.imageFile = file;
      var reader = new FileReader();
      reader.onload = function (e) {
        state.imageDataUrl = e.target.result;
        imagePreview.src = state.imageDataUrl;
        imageFileName.textContent = file.name;
        imagePreviewWrap.style.display = "flex";
        dropzone.style.display = "none";
      };
      reader.readAsDataURL(file);
    }

    removeImageBtn.addEventListener("click", function () {
      state.imageFile = null;
      state.imageDataUrl = null;
      imageInput.value = "";
      imagePreviewWrap.style.display = "none";
      dropzone.style.display = "block";
    });

    // ---------- Payment (STK push is simulated client-side; wire to
    // Safaricom Daraja API — or similar — from the backend for real pushes) ----------
    paymentButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        paymentButtons.forEach(function (b) { b.classList.remove("selected"); });
        btn.classList.add("selected");
        state.paymentMethod = btn.dataset.payment;

        mpesaPanel.style.display = state.paymentMethod === "mpesa" ? "block" : "none";
        salonPanel.style.display = state.paymentMethod === "salon" ? "block" : "none";

        if (state.paymentMethod === "salon") {
          state.paymentStatus = null;
          stkPending.classList.remove("show");
          stkSuccess.classList.remove("show");
          hideNotice(stkError);
        }
        hideNotice(document.getElementById("step4Notice"));
      });
    });

    if (sendStkBtn) {
      sendStkBtn.addEventListener("click", function () {
        var phone = mpesaPhoneInput.value.trim();
        hideNotice(stkError);
        if (phone.replace(/\D/g, "").length < 9) {
          showNotice(stkError, "Enter a valid M-Pesa number to receive the push.");
          return;
        }

        sendStkBtn.disabled = true;
        sendStkBtn.textContent = "Sending request…";
        stkSuccess.classList.remove("show");
        stkPending.classList.add("show");
        state.paymentStatus = "pending";

        // Simulated response — a real integration would poll the
        // backend for the Daraja callback result instead of a timer.
        setTimeout(function () {
          stkPending.classList.remove("show");
          stkSuccess.classList.add("show");
          state.paymentStatus = "paid";
          sendStkBtn.textContent = "Deposit paid ✓";
        }, 2600);      });
    }

    // ---------- Date + slots ----------
    dateInput.addEventListener("change", function () {
      state.date = dateInput.value;
      state.hour = null;
      slotTakenNotice.style.display = "none";
      renderSlots();
    });
    state.date = dateInput.value;

    function renderSlots() {
      slotGrid.innerHTML = "";
      if (!state.date) return;

      var isToday = state.date === todayStr;
      var currentHour = new Date().getHours();

      for (var h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
        var key = state.date + "|" + h;
        var isTaken = !!bookings[key];
        var isPast = isToday && h <= currentHour;

        var slot = document.createElement("button");
        slot.type = "button";
        slot.className = "slot";
        slot.textContent = formatHourLabel(h);

        if (isTaken || isPast) {
          slot.classList.add("taken");
          slot.disabled = true;
          slot.title = isPast ? "This time has already passed" : "Already booked";
        } else {
          slot.addEventListener("click", function () {
            var hour = Number(this.dataset.hour);
            var slotKey = state.date + "|" + hour;
            if (bookings[slotKey]) {
              slotTakenNotice.textContent = "⏰ That slot has just been taken by another client. Please choose another time below.";
              slotTakenNotice.style.display = "flex";
              renderSlots();
              return;
            }
            state.hour = hour;
            slotTakenNotice.style.display = "none";
            renderSlots();
          });
        }
        slot.dataset.hour = h;
        if (state.hour === h) slot.classList.add("selected");
        slotGrid.appendChild(slot);
      }
    }

    // ---------- Summary ----------
    function styleRows() {
      var rows = "";
      var hasOnRequest = false;
      var total = 0;

      ["nails", "hair"].forEach(function (svc) {
        if (!state.services[svc]) return;
        var sel = state.selections[svc];
        var label = sel.subcategory === "Other" ? "Other — " + sel.otherDetail : sel.subcategory;
        var priceLabel = sel.subcategory === "Other" ? "On request" : (sel.priceLabel || "—");
        rows += row(svc === "nails" ? "Nails style" : "Hair style", label || "—");
        rows += row(svc === "nails" ? "Nails price" : "Hair price", priceLabel);

        if (sel.item && typeof sel.item.price === "number") {
          total += sel.item.price;
        } else {
          hasOnRequest = true;
        }
      });

      var totalLabel = total > 0
        ? "KSh " + total.toLocaleString() + (hasOnRequest ? " + item(s) on request" : "")
        : "On request";
      rows += row("Estimated total", totalLabel);
      return rows;
    }

    function renderSummary(target) {
      var name = document.getElementById("clientName").value.trim();
      var email = document.getElementById("clientEmail").value.trim();
      var whatsapp = document.getElementById("clientWhatsapp").value.trim();
      var paymentLabel = state.paymentMethod === "mpesa"
        ? "KSh " + state.depositAmount.toLocaleString() + " deposit paid via M-Pesa"
        : state.paymentMethod === "salon"
          ? "Pay in full at the salon"
          : "—";

      target.innerHTML =
        row("Name", name) +
        row("Email", email) +
        row("WhatsApp", whatsapp) +
        styleRows() +
        row("Reference photo", state.imageFile ? state.imageFile.name : "Not attached") +
        row("Date", state.date) +
        row("Time", state.hour !== null ? formatHourLabel(state.hour) : "—") +
        row("Payment", paymentLabel);
    }

    function row(label, value) {
      return "<div><span>" + label + "</span><span>" + escapeHtml(String(value)) + "</span></div>";
    }
    function escapeHtml(str) {
      var div = document.createElement("div");
      div.textContent = str;
      return div.innerHTML;
    }

    // ---------- Submit ----------
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var notice5 = document.getElementById("step5Notice");
      var key = state.date + "|" + state.hour;

      // Final race-condition check before confirming
      if (bookings[key]) {
        showNotice(notice5, "That slot was just booked by someone else — please go back and pick another time.");
        return;
      }

      bookings[key] = true; // mark as taken for this session

      var confirmMessage = document.getElementById("confirmMessage");
      confirmMessage.textContent = state.paymentMethod === "mpesa"
        ? "Your KSh " + state.depositAmount.toLocaleString() + " deposit is confirmed and your slot is held. We'll also send a confirmation over WhatsApp."
        : "We've saved your slot and will confirm over WhatsApp shortly. Please pay the full amount at the salon.";

      renderSummary(finalSummary);
      goToStep(6);
    });
  });
})();
