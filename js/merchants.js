// Merchants statement analyzer — client logic.
//
// Flow: compress images client-side (phone photos of paper statements are
// huge), then create → upload each page → finalize against the
// merchant-analyzer function. Statement contents never touch URL params or
// client-side storage.
// ── Quick estimator (client-side ballpark, no data leaves the page) ──
// Mirrors the server benchmark: card cost + 0.30% + $0.10 per transaction.
// Card cost is a deliberately conservative blended estimate; the real
// analysis reads it off the statement.
(function () {
  var volumeEl = document.getElementById("est-volume");
  if (!volumeEl) return;

  var EST_CARD_COST = 0.019; // conservative blended card cost (interchange + network)
  var FAIR_MARKUP = 0.003;
  var FAIR_PER_TXN = 0.1;
  var FAIR_TOLERANCE = 1.1;

  var rateEl = document.getElementById("est-rate");
  var ticketEl = document.getElementById("est-ticket");
  var nowEl = document.getElementById("est-now");
  var fairEl = document.getElementById("est-fair");
  var savingsEl = document.getElementById("est-savings");
  var noteEl = document.getElementById("est-note");

  function money(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function update() {
    var volume = parseFloat(volumeEl.value);
    var rate = parseFloat(rateEl.value);
    var ticket = parseFloat(ticketEl.value) || 50;

    if (!(volume > 0) || !(rate > 0)) {
      nowEl.textContent = "–";
      fairEl.textContent = "–";
      savingsEl.textContent = "–";
      noteEl.textContent = "Fill in your numbers and the comparison updates as you type.";
      return;
    }

    var feesNow = volume * (rate / 100);
    var txns = volume / Math.max(1, ticket);
    var fair = volume * (EST_CARD_COST + FAIR_MARKUP) + txns * FAIR_PER_TXN;
    var monthlyDiff = Math.max(0, feesNow - fair);

    nowEl.textContent = money(feesNow) + "/mo";
    fairEl.textContent = money(fair) + "/mo";
    savingsEl.textContent = money(monthlyDiff * 12) + "/yr";

    if (feesNow <= fair * FAIR_TOLERANCE) {
      noteEl.textContent = "On these numbers you look close to fair. Good. Upload a statement and we will confirm it in writing, no strings.";
    } else {
      noteEl.textContent = "Worth two minutes to confirm. The statement analysis pins down the real number, line by line, checked by a person.";
    }
  }

  [volumeEl, rateEl, ticketEl].forEach(function (el) {
    el.addEventListener("input", update);
  });
})();

(function () {
  var form = document.getElementById("mrc-form");
  if (!form) return;

  var ENDPOINT = "/.netlify/functions/merchant-analyzer";
  var MAX_FILES = 12;
  var MAX_FILE_BYTES = 4.75 * 1024 * 1024;
  var MAX_IMAGE_DIM = 1800;
  var JPEG_QUALITY = 0.85;

  var dropzone = document.getElementById("mrc-dropzone");
  var fileInput = document.getElementById("mrc-files");
  var fileList = document.getElementById("mrc-file-list");
  var submitBtn = document.getElementById("mrc-submit");
  var progressEl = document.getElementById("mrc-progress");
  var errorEl = document.getElementById("mrc-error");
  var confirmEl = document.getElementById("mrc-confirm");

  var files = []; // { name, blob, type }
  var formStartedAt = Date.now();

  // ── File picking ──
  dropzone.addEventListener("click", function () { fileInput.click(); });
  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  dropzone.addEventListener("dragover", function (e) {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", function () { dropzone.classList.remove("dragover"); });
  dropzone.addEventListener("drop", function (e) {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", function () {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  function addFiles(list) {
    hideError();
    var pending = Array.prototype.slice.call(list);
    (function next() {
      var raw = pending.shift();
      if (!raw) { renderFileList(); return; }
      if (files.length >= MAX_FILES) {
        showError("That is plenty of pages. " + MAX_FILES + " is the max per submission.");
        renderFileList();
        return;
      }
      prepareFile(raw).then(function (prepared) {
        if (prepared) files.push(prepared);
        next();
      });
    })();
  }

  // PDFs pass through; images get re-encoded to a reasonably sized JPEG so
  // multi-page phone-photo uploads stay under the per-request limit.
  function prepareFile(raw) {
    if (raw.type === "application/pdf") {
      if (raw.size > MAX_FILE_BYTES) {
        showError('"' + raw.name + '" is too large. If the PDF is over ~4.5MB, take photos of the pages instead.');
        return Promise.resolve(null);
      }
      return Promise.resolve({ name: raw.name, blob: raw, type: "application/pdf" });
    }
    return compressImage(raw).then(function (blob) {
      if (!blob) {
        showError('Could not read "' + raw.name + '". Please use a JPEG, PNG, or PDF.');
        return null;
      }
      if (blob.size > MAX_FILE_BYTES) {
        showError('"' + raw.name + '" is too large even after compression. Try a closer, single-page photo.');
        return null;
      }
      var name = raw.name.replace(/\.[^.]+$/, "") + ".jpg";
      return { name: name, blob: blob, type: "image/jpeg" };
    });
  }

  function compressImage(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth;
          var h = img.naturalHeight;
          var scale = Math.min(1, MAX_IMAGE_DIM / Math.max(w, h));
          var canvas = document.createElement("canvas");
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          canvas.toBlob(function (blob) { resolve(blob); }, "image/jpeg", JPEG_QUALITY);
        } catch (err) {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  function renderFileList() {
    fileList.innerHTML = "";
    files.forEach(function (f, i) {
      var li = document.createElement("li");
      var nameSpan = document.createElement("span");
      nameSpan.textContent = f.name;
      nameSpan.style.overflow = "hidden";
      nameSpan.style.textOverflow = "ellipsis";
      nameSpan.style.whiteSpace = "nowrap";
      var sizeSpan = document.createElement("span");
      sizeSpan.className = "size";
      sizeSpan.textContent = (f.blob.size / 1024 / 1024).toFixed(1) + " MB";
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", "Remove " + f.name);
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", function () {
        files.splice(i, 1);
        renderFileList();
      });
      li.appendChild(nameSpan);
      li.appendChild(sizeSpan);
      li.appendChild(removeBtn);
      fileList.appendChild(li);
    });
  }

  // ── Submit ──
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    hideError();

    var data = {
      business: form.business.value.trim(),
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      volume: form.volume.value,
      botField: form["bot-field"].value,
      formElapsedMs: Date.now() - formStartedAt,
    };

    if (!data.business) return showError("Please add your business name.");
    if (!data.name) return showError("Please add your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return showError("Please add a valid email.");
    if (data.phone.replace(/\D/g, "").length < 10) return showError("Please add a valid phone number.");
    if (!data.volume) return showError("Please pick your monthly volume range.");
    if (!files.length) return showError("Please attach your statement. A PDF or photos of each page both work.");

    submitBtn.disabled = true;
    setProgress("Sending your details…");

    var submission;
    postJSON(ENDPOINT + "?action=create", data)
      .then(function (res) {
        submission = res;
        return uploadSequentially(0);
      })
      .then(function () {
        setProgress("Finishing up…");
        return postJSON(ENDPOINT + "?action=finalize", { id: submission.id, token: submission.token });
      })
      .then(function () {
        form.style.display = "none";
        progressEl.style.display = "none";
        confirmEl.style.display = "block";
        confirmEl.scrollIntoView({ behavior: "smooth", block: "center" });
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        progressEl.style.display = "none";
        showError(err && err.friendly ? err.friendly : "Something went wrong on our end. Please try again, or call (312) 203-8106 and we will handle it by hand.");
      });

    function uploadSequentially(i) {
      if (i >= files.length) return Promise.resolve();
      setProgress("Uploading page " + (i + 1) + " of " + files.length + "…");
      var f = files[i];
      var qs = "?action=upload&id=" + encodeURIComponent(submission.id) +
        "&token=" + encodeURIComponent(submission.token) +
        "&index=" + i + "&name=" + encodeURIComponent(f.name);
      return fetch(ENDPOINT + qs, {
        method: "POST",
        headers: { "Content-Type": f.type },
        body: f.blob,
      }).then(function (res) {
        if (!res.ok) {
          var err = new Error("upload failed");
          err.friendly = 'Uploading "' + f.name + '" failed. Please check your connection and try again.';
          throw err;
        }
        return uploadSequentially(i + 1);
      });
    }
  });

  function postJSON(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || !json.ok) {
          var err = new Error(json.reason || "request failed");
          if (json.reason === "validation") {
            err.friendly = "Please double-check your contact details and try again.";
          }
          throw err;
        }
        return json;
      });
    });
  }

  function setProgress(text) {
    progressEl.textContent = text;
    progressEl.style.display = "block";
  }

  function showError(text) {
    errorEl.textContent = text;
    errorEl.style.display = "block";
  }

  function hideError() {
    errorEl.style.display = "none";
  }
})();
