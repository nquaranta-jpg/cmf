// Masthead top-tier menus ("I'm looking for", "Log In"): open on click or
// hover, close on outside click or Escape. Keyboard and touch friendly.
(function () {
  var menus = Array.prototype.slice.call(document.querySelectorAll(".mast-menu"));
  if (!menus.length) return;

  function setOpen(menu, open) {
    menu.classList.toggle("open", open);
    var trigger = menu.querySelector(".mast-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function closeAll(except) {
    menus.forEach(function (m) {
      if (m !== except) setOpen(m, false);
    });
  }

  var canHover = window.matchMedia && window.matchMedia("(hover: hover)").matches;

  menus.forEach(function (menu) {
    var trigger = menu.querySelector(".mast-trigger");
    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      // With a mouse, hover has already opened it: a click keeps it open
      // rather than toggling it shut. On touch, tap toggles.
      var open = canHover ? true : !menu.classList.contains("open");
      closeAll(menu);
      setOpen(menu, open);
    });
    if (canHover) {
      menu.addEventListener("mouseenter", function () {
        closeAll(menu);
        setOpen(menu, true);
      });
      menu.addEventListener("mouseleave", function () {
        setOpen(menu, false);
      });
    }
    menu.addEventListener("focusout", function (e) {
      if (!menu.contains(e.relatedTarget)) setOpen(menu, false);
    });
  });

  document.addEventListener("click", function () {
    closeAll(null);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAll(null);
  });
})();
