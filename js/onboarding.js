/* Agent Onboarding Packet — fills the CMF onboarding packet (fillable PDF)
   entirely in the browser via pdf-lib, then downloads it and emails it to CMF.

   Field IDs below come from the AcroForm fields in /onboarding/packet-template.pdf
   (extracted programmatically — they're the PDF's own generic names). */

(function () {
  "use strict";

  var PDFDocument = PDFLib.PDFDocument;
  var StandardFonts = PDFLib.StandardFonts;
  var rgb = PDFLib.rgb;

  // ---------------------------------------------------------------
  // Packet schema
  // ---------------------------------------------------------------

  // Background questions (packet pages 5–6). yes/no = checkbox field IDs.
  var LEGAL_QUESTIONS = [
    ["1",  "Have you ever been charged or convicted of or plead guilty or no contest to any Felony, Misdemeanor, federal/state insurance and/or securities or investments regulations and statutes? Have you ever been on probation?", "Checkbox358", "Checkbox359"],
    ["1A", "Have you ever been convicted of or plead guilty or no contest to any Felony?", "Checkbox362", "Checkbox363"],
    ["1B", "Have you ever been convicted of or plead guilty or no contest to any Misdemeanor?", "Checkbox369", "Checkbox370"],
    ["1C", "Have you ever been convicted of or plead guilty or no contest to a violation of federal or state securities or investment related regulation?", "Checkbox366", "Checkbox367"],
    ["1D", "Have you ever been convicted of or plead guilty or no contest to a violation of state insurance department regulation or statute?", "Checkbox360", "Checkbox361"],
    ["1E", "Has any foreign government, court, regulatory agency, or exchange ever entered an order against you related to investments or fraud?", "Checkbox364", "Checkbox365"],
    ["1F", "Have you ever been charged with any Felony?", "Checkbox371", "Checkbox372"],
    ["1G", "Have you ever been charged with any Misdemeanor?", "Checkbox375", "Checkbox376"],
    ["1H", "Have you ever been on probation?", "Checkbox380", "Checkbox381"],
    ["2",  "Have you ever been or are you currently being investigated, have any pending indictments, lawsuits, or have you ever been in lawsuit with an insurance company?", "Checkbox378", "Checkbox379"],
    ["2A", "Are you currently under investigation by any legal or regulatory authority?", "Checkbox373", "Checkbox374"],
    ["2B", "Have you been under investigation by any insurance company?", "Checkbox377", "Checkbox383"],
    ["2C", "Have you ever been or are you currently involved in any pending indictments, lawsuits, civil judgments or other legal proceedings (civil or criminal)? (You may omit family court.)", "Checkbox382", "Checkbox386"],
    ["2D", "Have you ever been named as a defendant or codefendant in a lawsuit, or have you ever sued or been sued by an insurance company?", "Checkbox388", "Checkbox389"],
    ["3",  "Have you ever been alleged to have engaged in any fraud?", "Checkbox396", "Checkbox395"],
    ["4",  "Have you ever been found to have engaged in any fraud?", "Checkbox394", "Checkbox384"],
    ["5",  "Has any insurance or financial services company, or broker-dealer terminated your contract or appointment or permitted you to resign for reason other than lack of sales?", "Checkbox397", "Checkbox398"],
    ["5A", "Were you terminated/resigned because you were accused of violating insurance or investment related statutes, regulations, rules or industry standards of conduct?", "Checkbox391", "Checkbox387"],
    ["5B", "Were you terminated/resigned because you were accused of fraud or the wrongful taking of property?", "Checkbox390", "Checkbox401"],
    ["5C", "Failure to supervise in connection with insurance or investment related statutes, regulations, rules or industry standards of conduct?", "Checkbox399", "Checkbox400"],
    ["6",  "Have you ever had an appointment with any insurance company terminated for cause or been denied an appointment?", "Checkbox393", "Checkbox392"],
    ["7",  "Does any insurer, insured, or other person claim any commission chargeback or other indebtedness from you as a result of any insurance transactions or business?", "Checkbox356", "Checkbox357"],
    ["8",  "Has any lawsuit or claim ever been made against your surety company, or errors and omissions insurer, arising out of your sales or practices, or, have you been refused surety bonding or E&O coverage?", "Checkbox354", "Checkbox355"],
    ["8A", "Has a bonding or surety company ever denied, paid on or revoked a bond for you? Or, have you ever had a claim filed against your surety company?", "Checkbox402", "Checkbox403"],
    ["8B", "Has any Errors & Omissions (E&O) carrier ever denied, paid claims on or cancelled your coverage? Or, have you ever had a claim filed against your E&O carrier?", "Checkbox406", "Checkbox407"],
    ["9",  "Have you ever had an insurance or securities license denied, suspended, cancelled or revoked?", "Checkbox410", "Checkbox411"],
    ["10", "Has any state or federal regulatory body found you to have been a cause of an investment OR insurance-related business having its authorization to do business denied, suspended, revoked, or restricted?", "Checkbox412", "Checkbox413"],
    ["11", "Has any state or federal regulatory agency revoked or suspended your license as an attorney, accountant, or federal contractor?", "Checkbox404", "Checkbox405"],
    ["12", "Has any state or federal regulatory agency found you to have made a false statement or omission or been dishonest, unfair, or unethical?", "Checkbox415", "Checkbox416"],
    ["13", "Have you ever had any interruptions in licensing?", "Checkbox417", "Checkbox418"],
    ["14", "Has any state, federal or self-regulatory agency filed a complaint against you, fined, sanctioned, censured, penalized or otherwise disciplined you for a violation of their regulations or state or federal statutes? Have you ever been the subject of a consumer initiated complaint?", "Checkbox408", "Checkbox409"],
    ["14A", "Has any regulatory body ever sanctioned, censured, penalized or otherwise disciplined you?", "Checkbox421", "Checkbox420"],
    ["14B", "Has any state, federal or self-regulatory agency filed a complaint against you, fined or sanctioned you?", "Checkbox428", "Checkbox429"],
    ["14C", "Have you ever been the subject of a consumer initiated complaint?", "Checkbox426", "Checkbox431"],
    ["15", "Have you personally or any insurance or securities brokerage firm with whom you have been associated filed a bankruptcy petition or declared bankruptcy?", "Checkbox435", "Checkbox436"],
    ["15A", "Have you personally filed a bankruptcy petition or declared bankruptcy?", "Checkbox424", "Checkbox425"],
    ["15B", "Has any insurance or securities brokerage firm with whom you have been associated filed a bankruptcy petition or been declared bankrupt either during your association or within five years after termination of such association?", "Checkbox422", "Checkbox423"],
    ["15C", "Is the bankruptcy pending?", "Checkbox432", "Checkbox430"],
    ["16", "Have you ever had any unsatisfied judgments, garnishments, or liens against you?", "Checkbox433", "Checkbox434"],
    ["17", "Are you connected in any way with a bank, savings & loan association, or other lending or financial institution?", "Checkbox437", "Checkbox438"],
    ["18", "Have you ever used any other names or aliases?", "Checkbox439", "Checkbox440"],
    ["19", "Do you have any unresolved matters pending with the Internal Revenue Service or other taxing authority?", "Checkbox442", "Checkbox441"]
  ];

  var CARRIERS_ACA = [
    ["Aetna", "Text157"], ["Ambetter", "Text158"], ["Anthem", "Text159"],
    ["BCBS (FL) / Florida Blue", "Text160"], ["BCBS (IL/MT/NM/OK/TX)", "Text161"],
    ["BCBS (NE)", "Text162"], ["BCBS (TN)", "Text163"], ["Cigna", "Text164"],
    ["Imperial Health Plan", "Text165"], ["Kaiser Permanente", "Text166"],
    ["Medica", "Text167"], ["Molina", "Text168"], ["Oscar Health", "Text169"],
    ["UnitedHealthcare", "Text170"]
  ];
  var CARRIERS_MA = [
    ["Aetna", "Text171"], ["Anthem", "Text172"], ["Baylor Scott & White", "Text173"],
    ["BCBS (FL) / Florida Blue", "Text174"], ["BCBS (IL/MT/NM/OK/TX)", "Text175"],
    ["BCBS (NE)", "Text176"], ["BCBS (RI)", "Text177"], ["BCBS (TN)", "Text178"],
    ["Care 'N Care", "Text179"], ["CareFirst", "Text180"], ["CareSource", "Text181"],
    ["Cigna", "Text182"], ["Devoted Healthcare", "Text183"], ["Essence Healthcare", "Text184"],
    ["Freedom Health", "Text185"], ["Health Alliance", "Text186"], ["Humana", "Text187"],
    ["Imperial Health Plan", "Text188"], ["Kaiser Permanente", "Text189"], ["Lasso MSA", "Text190"],
    ["Medica", "Text191"], ["Molina", "Text192"], ["Premera", "Text193"],
    ["Regence Blue Shield (Asuris)", "Text194"], ["UnitedHealthcare", "Text195"], ["Wellcare", "Text196"]
  ];
  var CARRIERS_HL = [
    ["Ace Property & Casualty Ins Co", "Text197"], ["Aetna", "Text198"], ["Allstate", "Text199"],
    ["Anthem", "Text200"], ["Bankers Fidelity", "Text201"], ["BCBS (FL) / Florida Blue", "Text202"],
    ["BCBS (IL/MT/NM/OK/TX)", "Text203"], ["BCBS (NE)", "Text204"], ["BCBS (RI)", "Text205"],
    ["BCBS (TN)", "Text206"], ["Cigna", "Text207"], ["Guaranteed Trust Life", "Text208"],
    ["Heartland National", "Text209"], ["Manhattan Life & Affiliates", "Text210"],
    ["Medico/Wellabe", "Text211"], ["Mutual of Omaha & Affiliates", "Text212"],
    ["Physicians Mutual", "Text213"], ["Royal Arcanum", "Text214"],
    ["Sentinel Security Life", "Text215"], ["United American", "Text216"]
  ];

  // Signature stamp locations: [pageIndex, x0, y0, x1, y1] in PDF points.
  // Pages 10, 11, 13 are CMF-authored replacements — coordinates match the
  // line positions in scratchpad/cmf-legal-pages generator, not AcroForm rects.
  var SIGNATURE_SPOTS = [
    [5, 76, 31, 435, 60],     // p6  attestation (E-signature443)
    [7, 153, 441, 337, 459],  // p8  EFT (E-signature333)
    [9, 145, 135, 470, 245],  // p10 Signature Authorization box (sign in box)
    [11, 85, 137, 401, 152],  // p12 VectorOne (E-signature305)
    [12, 112, 306, 298, 352]  // p13 Email setup signature line
  ];
  var SIGNATURE_SPOT_ADVANCE = [10, 112, 256, 298, 302]; // p11 Debit Balance sig line

  var INITIAL_SPOTS = [       // p12 VectorOne statements A–E (Initials308…317)
    [11, 110, 352, 151, 367], [11, 110, 304, 151, 319], [11, 110, 268, 151, 282],
    [11, 110, 242, 151, 257], [11, 110, 205, 151, 220]
  ];
  var INITIAL_SPOT_DEDICATED = [12, 74, 612, 115, 642];  // p13 option A initials line
  var INITIAL_SPOT_OWN = [12, 74, 497, 115, 527];        // p13 option B initials line

  // ---------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function val(id) { var el = $(id); return el ? el.value.trim() : ""; }
  function radio(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : "";
  }
  function usDate(iso) { // yyyy-mm-dd -> MM/DD/YYYY
    if (!iso) return "";
    var p = iso.split("-");
    return p.length === 3 ? p[1] + "/" + p[2] + "/" + p[0] : iso;
  }
  function todayUS() {
    var d = new Date();
    return String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0") + "/" + d.getFullYear();
  }
  function formatSsn(v) {
    var d = v.replace(/\D/g, "").slice(0, 9);
    if (d.length === 9) return d.slice(0, 3) + "-" + d.slice(3, 5) + "-" + d.slice(5);
    return v;
  }

  // ---------------------------------------------------------------
  // Build dynamic sections
  // ---------------------------------------------------------------
  function buildLegalQuestions() {
    var host = $("legalQuestions");
    host.innerHTML = LEGAL_QUESTIONS.map(function (q, i) {
      return '<div class="qrow" data-q="' + i + '">' +
        '<div class="qnum">' + q[0] + "</div>" +
        '<div class="qtext">' + q[1] + "</div>" +
        '<div class="qopts">' +
        '<label><input type="radio" name="lq' + i + '" value="yes" /> Yes</label>' +
        '<label><input type="radio" name="lq' + i + '" value="no" /> No</label>' +
        "</div></div>";
    }).join("");
  }

  function buildCarriers() {
    function rows(list) {
      return list.map(function (c) {
        return '<div class="carrier-row"><span>' + c[0] + "</span>" +
          '<input type="text" data-field="' + c[1] + '" placeholder="States — e.g. IL, MO" /></div>';
      }).join("");
    }
    $("carriersAca").innerHTML = rows(CARRIERS_ACA);
    $("carriersMa").innerHTML = rows(CARRIERS_MA);
    $("carriersHl").innerHTML = rows(CARRIERS_HL);
  }

  function repeatBlock(title, inner) {
    return '<div class="repeat-block"><div class="rb-title">' + title + '</div><div class="grid">' + inner + "</div></div>";
  }

  function buildHistoryBlocks() {
    var emp = "";
    for (var i = 1; i <= 3; i++) {
      var req = i === 1 ? " *" : "";
      emp += repeatBlock("Employer " + i + (i > 1 ? " (if applicable)" : ""),
        '<div class="f c3"><label>From' + req + '</label><input type="date" id="emp' + i + 'From" /></div>' +
        '<div class="f c3"><label>To' + req + ' <span class="opt">(blank = present)</span></label><input type="date" id="emp' + i + 'To" /></div>' +
        '<div class="f c6"><label>Company' + req + '</label><input type="text" id="emp' + i + 'Company" /></div>' +
        '<div class="f c6"><label>Position' + req + '</label><input type="text" id="emp' + i + 'Position" /></div>' +
        '<div class="f c6"><label>Location <span class="opt">(city, state)</span></label><input type="text" id="emp' + i + 'Location" /></div>');
    }
    $("employmentBlocks").innerHTML = emp;

    var adr = "";
    for (var j = 1; j <= 3; j++) {
      adr += repeatBlock("Address " + j + (j === 1 ? " (current — pre-filled)" : " (if applicable)"),
        '<div class="f c3"><label>From' + (j === 1 ? " *" : "") + '</label><input type="date" id="adr' + j + 'From" /></div>' +
        '<div class="f c3"><label>To <span class="opt">(blank = present)</span></label><input type="date" id="adr' + j + 'To" /></div>' +
        '<div class="f c6"><label>Address Line 1' + (j === 1 ? " *" : "") + '</label><input type="text" id="adr' + j + 'Line1" /></div>' +
        '<div class="f c4"><label>Line 2</label><input type="text" id="adr' + j + 'Line2" /></div>' +
        '<div class="f c4"><label>Zip Code' + (j === 1 ? " *" : "") + '</label><input type="text" id="adr' + j + 'Zip" /></div>');
    }
    $("addressBlocks").innerHTML = adr;
  }

  function buildExplanationBlocks() {
    var html = "";
    for (var i = 1; i <= 3; i++) {
      html += repeatBlock("Incident " + i + (i === 1 ? " *" : " (if applicable)"),
        '<div class="f c4"><label>Date of Action</label><input type="date" id="exp' + i + 'Date" /></div>' +
        '<div class="f c8"><label>Action <span class="opt">(what happened, e.g. "Chapter 7 bankruptcy filed")</span></label><input type="text" id="exp' + i + 'Action" /></div>' +
        '<div class="f c12"><label>Reason</label><input type="text" id="exp' + i + 'Reason" /></div>' +
        '<div class="f c12"><label>Explanation <span class="opt">(full detail, include specific dates)</span></label><textarea id="exp' + i + 'Text" rows="3"></textarea></div>');
    }
    $("explanationBlocks").innerHTML = html;
  }

  // ---------------------------------------------------------------
  // Signature pads
  // ---------------------------------------------------------------
  function SigPad(canvas) {
    this.canvas = canvas;
    this.drawn = false;
    var self = this;
    var ctx = null;

    function setup() {
      var ratio = window.devicePixelRatio || 1;
      var cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
      var cssH = parseInt(canvas.getAttribute("height"), 10) || 140;
      canvas.style.height = cssH + "px";
      canvas.width = cssW * ratio;
      canvas.height = cssH * ratio;
      ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1a2b47";
    }
    setup();

    // The pad lives on a hidden step at load (clientWidth 0) — re-measure
    // once it's visible. Resizing clears the canvas, so skip if signed.
    this.ensureSize = function () {
      if (!self.drawn && (canvas.width === 0 || Math.abs(canvas.clientWidth * (window.devicePixelRatio || 1) - canvas.width) > 2)) {
        setup();
      }
    };

    var last = null;
    canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      var r = canvas.getBoundingClientRect();
      last = [e.clientX - r.left, e.clientY - r.top];
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!last) return;
      e.preventDefault();
      var r = canvas.getBoundingClientRect();
      var p = [e.clientX - r.left, e.clientY - r.top];
      ctx.beginPath();
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      last = p;
      self.drawn = true;
      canvas.classList.add("signed");
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      canvas.addEventListener(ev, function () { last = null; });
    });

    this.clear = function () {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      self.drawn = false;
      canvas.classList.remove("signed");
    };

    // Trimmed transparent PNG data URL
    this.toPng = function () {
      var w = canvas.width, h = canvas.height;
      var c2 = canvas.getContext("2d");
      var data = c2.getImageData(0, 0, w, h).data;
      var minX = w, minY = h, maxX = 0, maxY = 0, found = false;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > 10) {
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (!found) return null;
      var pad = 6;
      minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
      maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
      var out = document.createElement("canvas");
      out.width = maxX - minX + 1;
      out.height = maxY - minY + 1;
      out.getContext("2d").drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
      return out.toDataURL("image/png");
    };
  }

  // ---------------------------------------------------------------
  // Uploaded documents
  // ---------------------------------------------------------------
  var docs = { dl: [], check: [], eo: [], aml: [], release: [] };

  function bindUpload(inputId, key, statusId, multiple) {
    $(inputId).addEventListener("change", function () {
      var input = this;
      var files = Array.from(this.files || []);
      docs[key] = [];
      $(statusId).textContent = files.length ? "processing…" : "";
      var promises = files.map(function (f) { return prepareDoc(f); });
      Promise.all(promises).then(function (items) {
        docs[key] = items.filter(Boolean);
        $(statusId).textContent = docs[key].length
          ? (docs[key].length === 1 ? "✓ attached" : "✓ " + docs[key].length + " attached")
          : "";
      }).catch(function (err) {
        docs[key] = [];
        input.value = "";
        $(statusId).textContent = "⚠ not attached";
        alert("That file couldn't be attached: " + err.message +
          "\n\nPlease use a JPG, PNG, or PDF — a clear photo or screenshot of the document works great.");
      });
    });
  }

  // heic2any is 1.3MB, so only load it if someone actually uploads a HEIC
  var heicLibPromise = null;
  function loadHeicLib() {
    if (!heicLibPromise) {
      heicLibPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "/onboarding/heic2any.min.js";
        s.onload = function () { resolve(window.heic2any); };
        s.onerror = function () { reject(new Error("converter failed to load")); };
        document.head.appendChild(s);
      });
    }
    return heicLibPromise;
  }

  function isHeic(file) {
    return /\.(heic|heif)$/i.test(file.name || "") ||
      file.type === "image/heic" || file.type === "image/heif";
  }

  function prepareDoc(file) {
    var name = file.name || "document";
    if (/\.pdf$/i.test(name) || file.type === "application/pdf") {
      return file.arrayBuffer().then(function (buf) {
        return { kind: "pdf", name: name, bytes: new Uint8Array(buf) };
      });
    }
    // iPhone photos shared to a desktop browser arrive as HEIC, which most
    // browsers can't decode — convert to JPEG first.
    if (isHeic(file)) {
      return loadHeicLib().then(function (heic2any) {
        return heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      }).then(function (blob) {
        return imageToDoc(Array.isArray(blob) ? blob[0] : blob, name);
      }).catch(function (err) {
        console.warn("heic conversion failed", err);
        throw new Error("this iPhone photo (HEIC) couldn't be converted");
      });
    }
    if (!/^image\//.test(file.type)) {
      return Promise.reject(new Error("unsupported file type"));
    }
    return imageToDoc(file, name);
  }

  // Downscale + JPEG-compress images so the packet stays emailable
  function imageToDoc(blob, name) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var MAX = 1600;
        var scale = Math.min(1, MAX / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ kind: "image", name: name, dataUrl: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("this image format isn't supported by your browser")); };
      img.src = url;
    });
  }

  // ---------------------------------------------------------------
  // Collect form data
  // ---------------------------------------------------------------
  function collect() {
    var d = {};
    document.querySelectorAll("#obForm input[id], #obForm select[id], #obForm textarea[id]").forEach(function (el) {
      if (el.type === "checkbox") d[el.id] = el.checked;
      else if (el.type !== "file") d[el.id] = el.value.trim();
    });
    ["dbaType", "companyType", "publishName", "recognitionOk", "newBusiness", "deliverContracts",
     "nalu", "finraReportable", "legalSettlement", "finraRep", "eftType", "advanceCommissions", "emailChoice"
    ].forEach(function (n) { d[n] = radio(n); });
    d.legal = LEGAL_QUESTIONS.map(function (_, i) { return radio("lq" + i); });
    d.carriers = {};
    document.querySelectorAll(".carrier-row input").forEach(function (el) {
      if (el.value.trim()) d.carriers[el.getAttribute("data-field")] = el.value.trim().toUpperCase();
    });
    d.fullName = (d.firstName + " " + (d.mi ? d.mi + " " : "") + d.lastName).replace(/\s+/g, " ").trim();
    return d;
  }

  // ---------------------------------------------------------------
  // PDF generation
  // ---------------------------------------------------------------
  var templateBytesPromise = null;
  function getTemplate() {
    if (!templateBytesPromise) {
      templateBytesPromise = fetch("/onboarding/packet-template.pdf").then(function (r) {
        if (!r.ok) throw new Error("Couldn't load packet template");
        return r.arrayBuffer();
      });
    }
    return templateBytesPromise;
  }

  function fit(rect, iw, ih) { // contain-fit an image inside [x0,y0,x1,y1]
    var rw = rect[2] - rect[0], rh = rect[3] - rect[1];
    var s = Math.min(rw / iw, rh / ih);
    var w = iw * s, h = ih * s;
    return { x: rect[0] + (rw - w) / 2, y: rect[1] + (rh - h) / 2, width: w, height: h };
  }

  async function buildPdf(data, sigPng, initPng) {
    var bytes = await getTemplate();
    var pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    var form = pdf.getForm();
    var helv = await pdf.embedFont(StandardFonts.Helvetica);
    var pages = pdf.getPages();

    function setText(name, value) {
      if (!value) return;
      try {
        var f = form.getTextField(name);
        // The template's date fields are "comb" fields with short character
        // limits — they truncate values and scatter huge glyphs across cells.
        // Strip both so every field renders as plain, uniform text.
        try { f.disableCombing(); } catch (eC) {}
        try { f.removeMaxLength(); } catch (eM) {}
        f.setText(value);
        // Shrink the font so long values render fully instead of clipping
        try {
          var rect = f.acroField.getWidgets()[0].getRectangle();
          var unit = helv.widthOfTextAtSize(value, 1);
          var fitSize = unit > 0 ? (rect.width - 4) / unit : 11;
          f.setFontSize(Math.max(5, Math.min(11, fitSize, rect.height - 3)));
        } catch (e2) { /* keep default size */ }
      } catch (e) { console.warn("setText " + name, e); }
    }
    function check(name, on) {
      if (!on) return;
      try { form.getCheckBox(name).check(); } catch (e) { console.warn("check " + name, e); }
    }

    // ---- Page 2: producer info
    setText("Text217", formatSsn(data.ssn));
    setText("Text228", data.gender);
    setText("Date471", usDate(data.dob));
    setText("Text218", data.email);
    setText("Text219", data.resLicense);
    setText("Text220", data.npn);
    setText("Text221", data.lastName);
    setText("Text223", data.firstName);
    setText("Text227", data.mi);
    setText("Number473", data.phone);
    setText("Number476", data.fax);
    setText("Number478", data.cell || data.phone);
    setText("Text474", data.title || "Agent");
    setText("Text224", data.maritalStatus);
    setText("Text229", data.maidenName);
    setText("Text225", data.dlNumber);
    setText("Text226", data.dlState.toUpperCase());
    setText("Date479", usDate(data.resStart));
    setText("Text230", data.resLine1);
    setText("Text231", data.resLine2);
    setText("Text232", data.resZip);
    var mailSame = data.mailSame;
    setText("Date480", usDate(mailSame ? data.resStart : data.mailStart));
    setText("Text233", mailSame ? data.resLine1 : data.mailLine1);
    setText("Text234", mailSame ? data.resLine2 : data.mailLine2);
    setText("Text235", mailSame ? data.resZip : data.mailZip);
    check("Checkbox481", data.dbaType === "individual");
    check("Checkbox482", data.dbaType === "business");
    check("Checkbox483", data.dbaType === "solicitor");
    // All CMF agents assign commissions to CMF regardless of DBA type
    setText("Text238", data.assignCommissionsTo || "Crown Merchant Financial");
    if (data.dbaType === "business") {
      setText("Number484", data.ein);
      setText("Text240", data.businessName);
      setText("Text242", data.website);
      setText("Text243", data.bizTitle);
      setText("Number487", data.bizPhone);
      setText("Number489", data.bizFax);
      setText("Text245", data.principalName);
      setText("Text244", data.principalTitle);
      setText("Text246", data.principalEmail);
      check("Checkbox490", data.companyType === "corp");
      check("Checkbox491", data.companyType === "partnership");
      check("Checkbox493", data.companyType === "llc");
      check("Checkbox492", data.companyType === "llp");
      setText("Date494", usDate(data.corpStart));
      setText("Text247", data.corpLine1);
      setText("Text248", data.corpLine2);
      setText("Text249", data.corpZip);
    }

    // ---- Page 3: history
    var empMap = [
      ["Date495", "Date496", "Text251", "Text252", "Text253"],
      ["Date503", "Date504", "Text497", "Text498", "Text499"],
      ["Date505", "Date506", "Text500", "Text501", "Text502"]
    ];
    for (var i = 1; i <= 3; i++) {
      var m = empMap[i - 1];
      setText(m[0], usDate(data["emp" + i + "From"]));
      setText(m[1], data["emp" + i + "To"] ? usDate(data["emp" + i + "To"]) : (data["emp" + i + "From"] ? "Present" : ""));
      setText(m[2], data["emp" + i + "Company"]);
      setText(m[3], data["emp" + i + "Position"]);
      setText(m[4], data["emp" + i + "Location"]);
    }
    var adrMap = [
      ["Date507", "Date508", "Text255", "Text256", "Text257"],
      ["Date516", "Date515", "Text509", "Text510", "Text511"],
      ["Date517", "Date518", "Text512", "Text513", "Text514"]
    ];
    for (var j = 1; j <= 3; j++) {
      var a = adrMap[j - 1];
      setText(a[0], usDate(data["adr" + j + "From"]));
      setText(a[1], data["adr" + j + "To"] ? usDate(data["adr" + j + "To"]) : (data["adr" + j + "From"] ? "Present" : ""));
      setText(a[2], data["adr" + j + "Line1"]);
      setText(a[3], data["adr" + j + "Line2"]);
      setText(a[4], data["adr" + j + "Zip"]);
    }

    // ---- Page 4: beneficiary + practice
    setText("Text259", data.benName);
    setText("Text260", formatSsn(data.benSsn));
    setText("Text264", data.benRelationship);
    setText("Text261", data.benStreet);
    setText("Text262", data.benCity);
    setText("Text263", data.benState.toUpperCase());
    setText("Text265", data.benZip);
    check("Checkbox448", data.publishName === "yes");
    check("Checkbox449", data.publishName === "no");
    if (data.publishName === "no") {
      check("Checkbox451", data.recognitionOk === "yes");
      check("Checkbox450", data.recognitionOk === "no");
    }
    setText("Text266", data.brokerDealerTin);
    check("Checkbox452", data.mdrt === "qualifying");
    check("Checkbox453", data.mdrt === "life");
    check("Checkbox454", data.mdrt === "court");
    check("Checkbox455", data.mdrt === "top");
    check("Checkbox459", data.commissionFrequency === "daily");
    check("Checkbox458", data.commissionFrequency === "weekly");
    check("Checkbox457", data.commissionFrequency === "biweekly");
    check("Checkbox456", data.commissionFrequency === "monthly");
    check("Checkbox461", data.newBusiness === "yes");
    check("Checkbox460", data.newBusiness === "no");
    check("Checkbox462", data.deliverContracts === "yes");
    check("Checkbox463", data.deliverContracts === "no");
    check("Checkbox465", data.nalu === "yes");
    check("Checkbox464", data.nalu === "no");
    check("Checkbox467", data.finraReportable === "yes");
    check("Checkbox468", data.finraReportable === "no");
    check("Checkbox470", data.legalSettlement === "yes");
    check("Checkbox469", data.legalSettlement === "no");

    // ---- Pages 5–6: background questions
    LEGAL_QUESTIONS.forEach(function (q, idx) {
      var ans = data.legal[idx];
      check(q[2], ans === "yes");
      check(q[3], ans === "no");
    });
    // Name line at top of page 5 has no form field — draw it
    pages[4].drawText(data.fullName, { x: 66, y: 702, size: 11, font: helv, color: rgb(0.1, 0.15, 0.28) });
    setText("Date445", todayUS());

    // ---- Page 7: letters of explanation + licenses
    var expMap = [
      ["Date353", "Text271", "Text267", "Text268", "Text269", "Text270"],
      ["Date349", "Text272", "Text273", "Text274", "Text275", "Text276"],
      ["Date350", "Text277", "Text278", "Text279", "Text282", "Text281"]
    ];
    for (var k = 1; k <= 3; k++) {
      var em = expMap[k - 1];
      setText(em[0], usDate(data["exp" + k + "Date"]));
      var action = data["exp" + k + "Action"] || "";
      // Incident 1's Action field is only 70pt wide but its printed line runs
      // the full page — draw long actions directly on the line instead
      if (k === 1 && action && helv.widthOfTextAtSize(action, 9) > 66) {
        pages[6].drawText(action, { x: 110, y: 681, size: 9, font: helv, color: rgb(0.1, 0.15, 0.28) });
      } else {
        setText(em[1], action);
      }
      setText(em[2], data["exp" + k + "Reason"]);
      var txt = (data["exp" + k + "Text"] || "").replace(/\s+/g, " ").trim();
      // Explanation spans 3 single-line fields — split at ~95 chars per line
      var lines = ["", "", ""];
      var words = txt.split(" ");
      var li = 0;
      words.forEach(function (w) {
        if (li > 2) return;
        if ((lines[li] + " " + w).trim().length > 95 && li < 2) li++;
        if (li <= 2) lines[li] = (lines[li] + " " + w).trim();
      });
      setText(em[3], lines[0]);
      setText(em[4], lines[1]);
      setText(em[5], lines[2]);
    }
    check("Checkbox338", data.amlProvider === "limra");
    check("Checkbox339", data.amlProvider === "none");
    check("Checkbox340", data.amlProvider === "other");
    setText("Date351", usDate(data.amlDate));
    setText("Text283", data.amlOther);
    check("Checkbox336", data.finraRep === "yes");
    check("Checkbox337", data.finraRep === "no");
    if (data.finraRep === "yes") {
      setText("Text285", data.bdName);
      setText("Text286", data.crd);
    }
    setText("Text287", data.honors);

    // ---- Page 8: EFT
    setText("Text289", data.eftOwner);
    setText("Text290", data.eftRouting);
    setText("Text291", data.eftAccount);
    setText("Text292", data.eftBank);
    check("Checkbox327", data.eftType === "checking");
    check("Checkbox328", data.eftType === "saving");
    setText("Date332", todayUS());

    // CMF replacement pages (10, 11, 13) have no AcroForm fields — draw text
    var navy = rgb(0.1, 0.15, 0.28);
    function drawAt(pageIdx, x, y, text, size) {
      if (!text) return;
      pages[pageIdx].drawText(text, { x: x, y: y, size: size || 10.5, font: helv, color: navy });
    }

    // ---- Page 10: signature authorization (producer name line)
    drawAt(9, 190, 638, data.fullName, 11);

    // ---- Page 11: debit balance agreement (only if advancing)
    var advancing = data.advanceCommissions === "yes";
    if (advancing) {
      drawAt(10, 345, 258, todayUS());
      drawAt(10, 115, 201, data.fullName);
      drawAt(10, 345, 201, data.title || "Agent");
    }

    // ---- Page 12: VectorOne
    setText("Text295", data.dbaType === "business" && data.businessName ? data.fullName + " / " + data.businessName : data.fullName);
    setText("Date306", todayUS());

    // ---- Page 13: email setup
    if (data.emailChoice === "own") drawAt(12, 210, 435, data.email);
    drawAt(12, 345, 308, todayUS());
    drawAt(12, 115, 258, data.fullName);
    drawAt(12, 345, 258, data.title || "Agent");
    if (data.dbaType === "business") drawAt(12, 115, 208, data.businessName);
    drawAt(12, 345, 208, data.npn);

    // ---- Pages 14–16: carriers
    Object.keys(data.carriers).forEach(function (fieldId) {
      setText(fieldId, data.carriers[fieldId]);
    });

    // ---- Stamp signature + initials images
    var sigImg = await pdf.embedPng(sigPng);
    var initImg = await pdf.embedPng(initPng);
    var spots = SIGNATURE_SPOTS.slice();
    if (advancing) spots.push(SIGNATURE_SPOT_ADVANCE);
    spots.forEach(function (s) {
      var box = fit([s[1], s[2], s[3], s[4]], sigImg.width, sigImg.height);
      pages[s[0]].drawImage(sigImg, box);
    });
    var initSpots = INITIAL_SPOTS.concat([data.emailChoice === "dedicated" ? INITIAL_SPOT_DEDICATED : INITIAL_SPOT_OWN]);
    initSpots.forEach(function (s) {
      var box = fit([s[1], s[2], s[3], s[4]], initImg.width, initImg.height);
      pages[s[0]].drawImage(initImg, box);
    });

    try { form.updateFieldAppearances(helv); } catch (e) { console.warn("appearances", e); }

    // Non-advancing agents don't sign the Debit Balance Agreement — drop the
    // page entirely rather than shipping a blank "unsigned-looking" form
    if (!advancing) pdf.removePage(10);

    // ---- Append uploaded documents
    var docList = [
      ["Photo ID (Driver's License / State ID / Passport)", docs.dl],
      ["Voided Check / Bank Letter", docs.check],
      ["E&O Certificate of Coverage", docs.eo],
      ["AML Certification", docs.aml],
      ["Carrier Release Documents", docs.release]
    ];
    for (var dIdx = 0; dIdx < docList.length; dIdx++) {
      var label = docList[dIdx][0];
      var items = docList[dIdx][1];
      for (var n = 0; n < items.length; n++) {
        var item = items[n];
        if (item.kind === "image") {
          var jpg = await pdf.embedJpg(item.dataUrl);
          var page = pdf.addPage([612, 792]);
          page.drawText(label + " — " + data.fullName, { x: 50, y: 752, size: 12, font: helv, color: rgb(0.06, 0.09, 0.16) });
          var area = fit([50, 40, 562, 730], jpg.width, jpg.height);
          page.drawImage(jpg, area);
        } else {
          try {
            var attached = await PDFDocument.load(item.bytes, { ignoreEncryption: true });
            var copied = await pdf.copyPages(attached, attached.getPageIndices());
            copied.forEach(function (p) { pdf.addPage(p); });
          } catch (e) {
            console.warn("attach pdf failed: " + item.name, e);
            var errPage = pdf.addPage([612, 792]);
            errPage.drawText(label + ": " + item.name + " could not be embedded — sent separately.", { x: 50, y: 740, size: 11, font: helv });
          }
        }
      }
    }

    return pdf.save();
  }

  // ---------------------------------------------------------------
  // Wizard
  // ---------------------------------------------------------------
  var STEP_NAMES = ["Your Info", "History", "Beneficiary", "Background", "Licenses", "Banking", "Authorizations", "Carriers", "Documents", "Sign"];
  var current = 0;
  var steps = [];

  function showStep(n) {
    steps.forEach(function (s) { s.classList.add("hidden"); });
    var el = document.querySelector('.step[data-step="' + n + '"]');
    if (el) el.classList.remove("hidden");
    if (n === "done") {
      $("navBar").classList.add("hidden");
      $("stepLabel").textContent = "All done";
      renderProgress(STEP_NAMES.length);
      return;
    }
    current = n;
    $("stepLabel").textContent = "Step " + (n + 1) + " of " + STEP_NAMES.length + " — " + STEP_NAMES[n];
    renderProgress(n);
    $("backBtn").style.visibility = n === 0 ? "hidden" : "visible";
    $("nextBtn").classList.toggle("hidden", n === STEP_NAMES.length - 1);
    $("navBar").classList.toggle("hidden", n === STEP_NAMES.length - 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (n === 1) prefillAddressHistory();
    if (n === 4) toggleExplanationSection();
    if (n === 5 && !val("eftOwner")) $("eftOwner").value = collect().fullName;
    if (n === 9) {
      renderReview();
      sigPad.ensureSize();
      initPad.ensureSize();
    }
  }

  function renderProgress(n) {
    var host = $("progress");
    host.innerHTML = "";
    for (var i = 0; i < STEP_NAMES.length; i++) {
      var s = document.createElement("span");
      if (i <= n - 1 || n >= STEP_NAMES.length) s.className = "done";
      host.appendChild(s);
    }
  }

  function markInvalid(el, bad) {
    el.classList.toggle("invalid", bad);
  }

  function requireIds(ids) {
    var ok = true;
    ids.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      var bad = !el.value.trim();
      markInvalid(el, bad);
      if (bad) ok = false;
    });
    return ok;
  }

  function validateStep(n) {
    var d = collect();
    switch (n) {
      case 0: {
        var ids = ["firstName", "lastName", "ssn", "gender", "dob", "email", "phone",
          "resLicense", "npn", "dlNumber", "dlState", "resLine1", "resZip", "resStart"];
        if (d.dbaType === "solicitor") ids.push("assignCommissionsTo");
        if (d.dbaType === "business") ids = ids.concat(["ein", "businessName"]);
        if (!d.mailSame) ids = ids.concat(["mailLine1", "mailZip"]);
        var ok = requireIds(ids);
        if (d.ssn && d.ssn.replace(/\D/g, "").length !== 9) { markInvalid($("ssn"), true); ok = false; }
        var em = $("email");
        if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) { markInvalid(em, true); ok = false; }
        return ok || "Please complete the highlighted fields.";
      }
      case 1: {
        var ok1 = requireIds(["emp1From", "emp1Company", "emp1Position", "adr1From", "adr1Line1", "adr1Zip"]);
        return ok1 || "Please complete your most recent employer and current address.";
      }
      case 3: {
        var allAnswered = true;
        d.legal.forEach(function (ans, i) {
          var row = document.querySelector('.qrow[data-q="' + i + '"]');
          row.classList.toggle("unanswered", !ans);
          if (!ans) allAnswered = false;
        });
        return allAnswered || 'Please answer every question (or use "Answer all unanswered questions No").';
      }
      case 4: {
        var anyYes = d.legal.indexOf("yes") !== -1;
        if (anyYes) {
          var ok4 = requireIds(["exp1Date", "exp1Action", "exp1Reason", "exp1Text"]);
          if (!ok4) return "You answered Yes to a background question — please complete Incident 1.";
        }
        if (d.amlProvider === "other" && !requireIds(["amlOther"])) return "Please provide your AML provider details.";
        return true;
      }
      case 5: {
        var ok5 = requireIds(["eftOwner", "eftRouting", "eftAccount", "eftBank"]);
        if (d.eftRouting && d.eftRouting.replace(/\D/g, "").length !== 9) { markInvalid($("eftRouting"), true); ok5 = false; }
        var advRow = $("advanceRow");
        advRow.classList.toggle("unanswered", !d.advanceCommissions);
        if (!d.advanceCommissions) {
          return "Please answer the advance commissions question — if you're not sure, ask us before submitting.";
        }
        return ok5 || "Please complete your direct deposit details (routing # is 9 digits).";
      }
      case 8: {
        if ($("docsLater").checked) return true;
        var missing = [];
        if (!docs.dl.length) missing.push("driver's license");
        if (!docs.check.length) missing.push("voided check / bank letter");
        if (!docs.eo.length) missing.push("E&O certificate");
        return missing.length === 0 ||
          "Please attach: " + missing.join(", ") + ' — or tick "I\'ll send missing documents separately".';
      }
      default:
        return true;
    }
  }

  function toggleExplanationSection() {
    var anyYes = collect().legal.indexOf("yes") !== -1;
    $("explanationSection").classList.toggle("hidden", !anyYes);
  }

  function prefillAddressHistory() {
    if (!$("adr1Line1").value) {
      $("adr1Line1").value = val("resLine1");
      $("adr1Line2").value = val("resLine2");
      $("adr1Zip").value = val("resZip");
      $("adr1From").value = val("resStart");
    }
  }

  function renderReview() {
    var d = collect();
    var yesCount = d.legal.filter(function (a) { return a === "yes"; }).length;
    var carrierCount = Object.keys(d.carriers).length;
    var docCount = docs.dl.length + docs.check.length + docs.eo.length + docs.aml.length + docs.release.length;
    var advancing = d.advanceCommissions === "yes";
    $("sigAdvanceNote").textContent = advancing ? ", and the Debit Balance Agreement" : "";
    $("attestAdvanceNote").textContent = advancing ? ", including the Agent/Agency Debit Balance Agreement personal guarantee" : "";
    $("reviewSummary").innerHTML =
      "<b>" + d.fullName + "</b> — NPN " + (d.npn || "?") + "<br />" +
      "Doing business as: <b>" + ({ individual: "Individual", business: "Business Entity" + (d.businessName ? " (" + d.businessName + ")" : ""), solicitor: "Solicitor/LOA" }[d.dbaType] || "—") + "</b><br />" +
      "Background questions: <b>" + (yesCount ? yesCount + " answered Yes (letter of explanation included)" : "all No") + "</b><br />" +
      "Advance commissions: <b>" + (advancing ? "Yes — Debit Balance Agreement included" : "No") + "</b><br />" +
      "Carrier appointments requested: <b>" + (carrierCount || "none yet") + "</b> &nbsp;•&nbsp; Documents attached: <b>" + docCount + "</b>";
  }

  // ---------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------
  function bytesToBase64(bytes) {
    var CHUNK = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(""));
  }

  function downloadPdf(bytes, filename) {
    var blob = new Blob([bytes], { type: "application/pdf" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  // POST JSON with one automatic retry for transient failures
  async function postJson(url, payload) {
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (res.ok) return res;
        if (attempt === 1 || (res.status >= 400 && res.status < 500)) {
          throw new Error("send failed (" + res.status + ")");
        }
      } catch (e) {
        if (attempt === 1) throw e;
      }
      await new Promise(function (r) { setTimeout(r, 1500); });
    }
  }

  var CHUNK_B64 = 3000000; // ~3MB base64 per upload call, well under Netlify's 6MB cap

  async function generateAndSubmit() {
    var status = $("submitStatus");
    status.className = "status";
    if (!sigPad.drawn) { status.className = "status err"; status.textContent = "Please draw your signature."; return; }
    if (!initPad.drawn) { status.className = "status err"; status.textContent = "Please draw your initials."; return; }
    if (!$("attest").checked) { status.className = "status err"; status.textContent = "Please confirm the attestation checkbox."; return; }

    var btn = $("generateBtn");
    btn.disabled = true;
    status.textContent = "Building your packet…";

    var filename = "CMF-Onboarding-Packet.pdf";
    try {
      var d = collect();
      var bytes = await buildPdf(d, sigPad.toPng(), initPad.toPng());
      filename = "CMF-Onboarding-" + (d.lastName || "Agent") + "-" + (d.firstName || "") + ".pdf";
      downloadPdf(bytes, filename);

      status.textContent = "Packet built — sending to Crown Merchant Financial…";
      var b64 = bytesToBase64(bytes);
      var meta = {
        name: d.fullName,
        email: d.email,
        phone: d.phone,
        npn: d.npn,
        filename: filename,
        docsLater: $("docsLater").checked,
        website: "" // honeypot
      };

      if (b64.length > 26000000) {
        status.className = "status err";
        status.innerHTML = "Your packet (with attachments) is too large to send automatically. A copy was downloaded to your device — please email it to <b>nquaranta@crownmerchantfinancial.com</b>. <b>Important: attach the file</b> (<code>" + filename + "</code>, in your Downloads folder) before hitting send.";
        btn.disabled = false;
        return;
      }

      if (b64.length <= CHUNK_B64) {
        meta.pdf = b64;
        await postJson("/.netlify/functions/onboarding-submit", meta);
      } else {
        // Large packet: upload in ~3MB chunks, then ask the server to assemble
        var uploadId = "up-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
        var chunkCount = Math.ceil(b64.length / CHUNK_B64);
        for (var i = 0; i < chunkCount; i++) {
          status.textContent = "Sending your packet… " + Math.round((i / chunkCount) * 100) + "%";
          await postJson("/.netlify/functions/onboarding-upload", {
            id: uploadId,
            seq: i,
            data: b64.slice(i * CHUNK_B64, (i + 1) * CHUNK_B64),
            website: ""
          });
        }
        status.textContent = "Sending your packet… finalizing";
        meta.uploadId = uploadId;
        meta.chunkCount = chunkCount;
        await postJson("/.netlify/functions/onboarding-submit", meta);
      }
      showStep("done");
    } catch (err) {
      console.error(err);
      status.className = "status err";
      status.innerHTML = "The packet PDF was downloaded to your device, but sending it automatically failed. Please try again — or email it to <b>nquaranta@crownmerchantfinancial.com</b>. <b>Important: attach the file</b> (<code>" + filename + "</code>, in your Downloads folder) before hitting send.";
      btn.disabled = false;
    }
  }

  // ---------------------------------------------------------------
  // Wire-up
  // ---------------------------------------------------------------
  buildLegalQuestions();
  buildCarriers();
  buildHistoryBlocks();
  buildExplanationBlocks();

  steps = Array.from(document.querySelectorAll(".step"));

  var sigPad = new SigPad($("sigPad"));
  var initPad = new SigPad($("initPad"));
  $("sigClear").addEventListener("click", function () { sigPad.clear(); });
  $("initClear").addEventListener("click", function () { initPad.clear(); });

  bindUpload("docDl", "dl", "docDlStatus");
  bindUpload("docCheck", "check", "docCheckStatus");
  bindUpload("docEo", "eo", "docEoStatus");
  bindUpload("docAml", "aml", "docAmlStatus");
  bindUpload("docRelease", "release", "docReleaseStatus", true);

  $("nextBtn").addEventListener("click", function () {
    var result = validateStep(current);
    if (result !== true) {
      var status = typeof result === "string" ? result : "Please complete the highlighted fields.";
      var el = document.createElement("div");
      el.className = "warn";
      el.textContent = status;
      var existing = document.querySelector(".step:not(.hidden) .warn.auto");
      if (existing) existing.remove();
      el.classList.add("auto");
      document.querySelector('.step[data-step="' + current + '"]').prepend(el);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    var existing2 = document.querySelector(".step:not(.hidden) .warn.auto");
    if (existing2) existing2.remove();
    showStep(current + 1);
  });
  $("backBtn").addEventListener("click", function () { if (current > 0) showStep(current - 1); });

  // Conditional visibility
  document.querySelectorAll('input[name="dbaType"]').forEach(function (el) {
    el.addEventListener("change", function () {
      $("businessFields").classList.toggle("hidden", radio("dbaType") !== "business");
      $("solicitorFields").classList.toggle("hidden", radio("dbaType") !== "solicitor");
    });
  });
  $("mailSame").addEventListener("change", function () {
    $("mailFields").classList.toggle("hidden", this.checked);
  });
  document.querySelectorAll('input[name="publishName"]').forEach(function (el) {
    el.addEventListener("change", function () {
      $("recognitionRow").classList.toggle("hidden", radio("publishName") !== "no");
    });
  });
  document.querySelectorAll('input[name="finraRep"]').forEach(function (el) {
    el.addEventListener("change", function () {
      $("finraRepFields").classList.toggle("hidden", radio("finraRep") !== "yes");
    });
  });
  $("amlProvider").addEventListener("change", function () {
    $("amlOtherWrap").classList.toggle("hidden", this.value !== "other");
  });
  $("allNoBtn").addEventListener("click", function () {
    LEGAL_QUESTIONS.forEach(function (_, i) {
      if (!radio("lq" + i)) {
        var el = document.querySelector('input[name="lq' + i + '"][value="no"]');
        if (el) el.checked = true;
      }
      var row = document.querySelector('.qrow[data-q="' + i + '"]');
      if (row) row.classList.remove("unanswered");
    });
  });
  $("ssn").addEventListener("blur", function () { this.value = formatSsn(this.value); });
  $("benSsn").addEventListener("blur", function () { this.value = formatSsn(this.value); });

  $("generateBtn").addEventListener("click", generateAndSubmit);

  // Debug hook (no secrets — everything here is the user's own client-side data)
  window.__ob = { collect: collect, buildPdf: buildPdf, sigPad: sigPad, initPad: initPad, docs: docs, showStep: showStep };

  showStep(0);
})();
