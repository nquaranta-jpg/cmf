// ============================================
// INTERSECTION OBSERVER ANIMATIONS
// ============================================
// The animated elements start at opacity:0 in CSS, so if the observer never
// runs (old browser, blocked JS feature), whole trust sections would stay
// invisible. Fail open: no observer -> show everything immediately.
var animTargets = ".service-card, .team-card, .feature-item, .step, .product-card";

if ("IntersectionObserver" in window) {
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
      }
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -50px 0px" });

  document.querySelectorAll(animTargets).forEach(function (el) {
    observer.observe(el);
  });
} else {
  document.querySelectorAll(animTargets).forEach(function (el) {
    el.classList.add("visible");
  });
}
