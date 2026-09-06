// Capital desk inquiry forms (/lending, /lending/trucking) → /.netlify/functions/lending-inquiry
(function () {
  const form = document.getElementById("hml-form");
  if (!form) return;

  const submitBtn = document.getElementById("hml-submit");
  const errorBox = document.getElementById("hml-error");
  const confirmBox = document.getElementById("hml-confirm");
  const submitLabel = submitBtn.textContent;

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = "block";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.style.display = "none";

    if (!form.reportValidity()) return;

    const data = Object.fromEntries(new FormData(form).entries());
    data.page = location.pathname;

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    try {
      const res = await fetch("/.netlify/functions/lending-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.reason || "submit failed");
      form.style.display = "none";
      confirmBox.style.display = "block";
      confirmBox.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      console.error("lending inquiry failed:", err);
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;
      showError("Something went wrong sending your inquiry. Please try again, or call (312) 203-8106.");
    }
  });
})();
