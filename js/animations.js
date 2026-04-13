// ============================================
// INTERSECTION OBSERVER ANIMATIONS
// ============================================
var observerOptions = { threshold: 0.1, rootMargin: "0px 0px -50px 0px" };

var observer = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
    }
  });
}, observerOptions);

document.querySelectorAll(".service-card, .team-card, .feature-item, .step, .product-card").forEach(function (el) {
  observer.observe(el);
});
