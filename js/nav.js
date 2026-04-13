// ============================================
// NAV SCROLL EFFECT
// ============================================
window.addEventListener("scroll", function () {
  var nav = document.querySelector("nav");
  if (window.scrollY > 50) {
    nav.classList.add("scrolled");
  } else {
    nav.classList.remove("scrolled");
  }
});

// ============================================
// MOBILE MENU
// ============================================
var mobileToggle = document.querySelector(".mobile-toggle");
var mobileMenu = document.querySelector(".mobile-menu");

if (mobileToggle && mobileMenu) {
  mobileToggle.addEventListener("click", function () {
    mobileToggle.classList.toggle("active");
    mobileMenu.classList.toggle("active");
    document.body.classList.toggle("menu-open");
  });

  document.querySelectorAll(".mobile-menu a").forEach(function (link) {
    link.addEventListener("click", function () {
      mobileToggle.classList.remove("active");
      mobileMenu.classList.remove("active");
      document.body.classList.remove("menu-open");
    });
  });
}

// ============================================
// SMOOTH SCROLL FOR ANCHOR LINKS
// ============================================
document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
  anchor.addEventListener("click", function (e) {
    var target = document.querySelector(this.getAttribute("href"));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});
