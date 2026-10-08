document.querySelectorAll('[data-current-year]').forEach(function(el){el.textContent = new Date().getFullYear();});
(function(){
  const nav = document.querySelector(".site-nav");
  const toggle = nav && nav.querySelector(".site-nav-toggle");
  const menu = nav && nav.querySelector(".site-nav-menu");
  if(!nav || !toggle || !menu) return;
  const mobile = window.matchMedia("(max-width: 720px)");
  function closeMenu(restoreFocus){
    menu.removeAttribute("data-open");
    toggle.setAttribute("aria-expanded", "false");
    if(restoreFocus) toggle.focus();
  }
  function syncNavigation(){
    nav.toggleAttribute("data-mobile-nav-ready", mobile.matches);
    if(!mobile.matches) closeMenu(false);
  }
  toggle.addEventListener("click", function(){
    const open = !menu.hasAttribute("data-open");
    menu.toggleAttribute("data-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });
  menu.addEventListener("click", function(event){
    const target = event.target instanceof Element ? event.target : false;
    if(mobile.matches && target && target.closest("a")) closeMenu(false);
  });
  document.addEventListener("click", function(event){
    if(mobile.matches && menu.hasAttribute("data-open") && !nav.contains(event.target)) closeMenu(false);
  });
  document.addEventListener("keydown", function(event){
    if(event.key === "Escape" && menu.hasAttribute("data-open")) closeMenu(true);
  });
  if(typeof mobile.addEventListener === "function") mobile.addEventListener("change", syncNavigation);
  syncNavigation();
}());
(function(){
  let lastPlatformFocus = false;
  function closePlatformModal(modal){
    if(!modal) return;
    if(typeof modal.close === "function" && modal.open){
      modal.close();
    } else {
      modal.removeAttribute("open");
    }
    document.documentElement.classList.remove("modal-open");
  }
  document.addEventListener("click", function(event){
    const embedLoader = event.target.closest("[data-embed-load]");
    if(embedLoader){
      const shell = embedLoader.closest("[data-embed-shell]");
      const src = embedLoader.getAttribute("data-src");
      if(!shell || !src) return;
      const iframe = document.createElement("iframe");
      iframe.src = src;
      iframe.loading = "lazy";
      iframe.title = embedLoader.getAttribute("data-title") || "External media player";
      iframe.allow = "autoplay; encrypted-media; picture-in-picture";
      iframe.referrerPolicy = "no-referrer";
      iframe.allowFullscreen = true;
      shell.classList.remove("embed-consent");
      shell.textContent = "";
      shell.appendChild(iframe);
      return;
    }
    const opener = event.target.closest("[data-platform-open]");
    if(opener){
      const modal = document.getElementById(opener.getAttribute("aria-controls"));
      if(!modal) return;
      lastPlatformFocus = opener;
      if(typeof modal.showModal === "function" && !modal.open){
        modal.showModal();
      } else {
        modal.setAttribute("open", "");
      }
      document.documentElement.classList.add("modal-open");
      const focusTarget = modal.querySelector("a,button");
      if(focusTarget) focusTarget.focus({ preventScroll: true });
      return;
    }
    const closer = event.target.closest("[data-platform-close]");
    if(closer) closePlatformModal(closer.closest("dialog"));
  });
  document.querySelectorAll(".platform-modal").forEach(function(modal){
    modal.addEventListener("close", function(){
      document.documentElement.classList.remove("modal-open");
      if(lastPlatformFocus && document.contains(lastPlatformFocus)) lastPlatformFocus.focus({ preventScroll: true });
      lastPlatformFocus = false;
    });
    modal.addEventListener("click", function(event){
      if(event.target === modal) closePlatformModal(modal);
    });
  });
}());
