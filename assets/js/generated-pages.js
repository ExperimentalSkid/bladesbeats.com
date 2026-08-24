document.querySelectorAll('[data-current-year]').forEach(function(el){el.textContent = new Date().getFullYear();});
(function(){
  let lastPlatformFocus = false;
  function closePlatformModal(modal){
    if(!modal) return;
    if(typeof modal.close === "function" && modal.open){
      modal.close();
    } else {
      modal.removeAttribute("open");
    }
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
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
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
      const focusTarget = modal.querySelector("a,button");
      if(focusTarget) focusTarget.focus({ preventScroll: true });
      return;
    }
    const closer = event.target.closest("[data-platform-close]");
    if(closer) closePlatformModal(closer.closest("dialog"));
  });
  document.querySelectorAll(".platform-modal").forEach(function(modal){
    modal.addEventListener("close", function(){
      if(lastPlatformFocus && document.contains(lastPlatformFocus)) lastPlatformFocus.focus({ preventScroll: true });
      lastPlatformFocus = false;
    });
    modal.addEventListener("click", function(event){
      if(event.target === modal) closePlatformModal(modal);
    });
  });
}());
