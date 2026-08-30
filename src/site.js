(function () {
  "use strict";

  const menuButton = document.querySelector("[data-menu-button]");
  const menu = document.querySelector("[data-site-menu]");

  function closeMenu() {
    if (!menuButton || !menu) return;
    menuButton.setAttribute("aria-expanded", "false");
    menu.removeAttribute("data-open");
    document.documentElement.classList.remove("menu-open");
  }

  if (menuButton && menu) {
    menuButton.addEventListener("click", function () {
      const open = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!open));
      menu.toggleAttribute("data-open", !open);
      document.documentElement.classList.toggle("menu-open", !open);
    });
    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeMenu);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeMenu();
        menuButton.focus();
      }
    });
    const desktopMenu = window.matchMedia("(min-width: 761px)");
    desktopMenu.addEventListener("change", function (event) {
      if (event.matches) closeMenu();
    });
  }

  document.querySelectorAll("[data-current-year]").forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });

  window.addEventListener("load", function () {
    const fonts = document.querySelector("[data-font-styles]");
    if (fonts) fonts.media = "all";
  }, { once: true });

  document.querySelectorAll("[data-catalog]").forEach(function (catalog) {
    const cards = Array.from(catalog.querySelectorAll("[data-catalog-card]"));
    const search = catalog.querySelector("[data-catalog-search]");
    const sort = catalog.querySelector("[data-catalog-sort]");
    const count = catalog.querySelector("[data-catalog-count]");
    const empty = catalog.querySelector("[data-catalog-empty]");
    const buttons = Array.from(catalog.querySelectorAll("[data-catalog-filter]"));
    const params = new URLSearchParams(location.search);
    let activeType = params.get("type") || "all";
    const supportedTypes = ["all", "original", "instrumental", "remix", "edit"];
    if (buttons.length ? !buttons.some(function (button) { return button.dataset.catalogFilter === activeType; }) : !supportedTypes.includes(activeType)) activeType = "all";

    function applyCatalog() {
      const query = (search && search.value || "").trim().toLocaleLowerCase();
      const visible = cards.filter(function (card) {
        const typeMatch = activeType === "all" || card.dataset.type === activeType;
        const textMatch = !query || (card.dataset.search || "").includes(query);
        const show = typeMatch && textMatch;
        card.hidden = !show;
        return show;
      });
      const direction = sort && sort.value === "oldest" ? 1 : -1;
      visible.sort(function (a, b) { return direction * String(a.dataset.date).localeCompare(String(b.dataset.date)); });
      visible.forEach(function (card) { card.parentElement.appendChild(card); });
      catalog.querySelectorAll("[data-catalog-group]").forEach(function (group) {
        group.hidden = !group.querySelector("[data-catalog-card]:not([hidden])");
      });
      buttons.forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.catalogFilter === activeType)); });
      if (count) count.textContent = String(visible.length);
      if (empty) empty.hidden = visible.length !== 0;
      const next = new URL(location.href);
      if (activeType === "all") next.searchParams.delete("type"); else next.searchParams.set("type", activeType);
      history.replaceState({}, "", next.pathname + next.search + next.hash);
    }

    buttons.forEach(function (button) {
      button.addEventListener("click", function () { activeType = button.dataset.catalogFilter || "all"; applyCatalog(); });
    });
    if (search) search.addEventListener("input", applyCatalog);
    if (sort) sort.addEventListener("change", applyCatalog);
    applyCatalog();
  });

  document.querySelectorAll("[data-load-player]").forEach(function (button) {
    button.addEventListener("click", function () {
      const shell = button.closest("[data-player-shell]");
      if (!shell) return;
      const source = shell.dataset.playerSource;
      const title = shell.dataset.playerTitle || "Media player";
      const type = shell.dataset.playerType || "video";
      if (!source || !/^https:\/\//.test(source)) return;
      const frame = document.createElement("iframe");
      frame.className = "player-frame" + (type === "mixcloud" ? " mixcloud" : "");
      frame.src = source;
      frame.title = title;
      frame.loading = "lazy";
      frame.allow = type === "mixcloud" ? "autoplay" : "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share";
      frame.referrerPolicy = "no-referrer";
      frame.allowFullscreen = type !== "mixcloud";
      shell.replaceChildren(frame);
    });
  });
}());
