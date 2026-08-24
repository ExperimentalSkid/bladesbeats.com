(function () {
  "use strict";

  document.querySelectorAll("[data-current-year]").forEach(function (element) {
    element.textContent = String(new Date().getFullYear());
  });

  const canvas = document.getElementById("catalog-canvas");
  const dataEl = document.getElementById("catalog-data");
  if (!canvas || !dataEl) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const hitLayer = document.getElementById("catalog-hit-layer");
  const card = document.getElementById("catalog-card");
  const cardKind = card && card.querySelector("[data-catalog-kind]");
  const cardTitle = card && card.querySelector("[data-catalog-title]");
  const cardMeta = card && card.querySelector("[data-catalog-meta]");
  const pageLink = card && card.querySelector("[data-catalog-page]");
  const serviceLink = card && card.querySelector("[data-catalog-service]");
  const actionList = card && card.querySelector(".catalog-card-actions");
  const closeButton = card && card.querySelector("[data-catalog-close]");
  const latestPanel = document.querySelector("[data-latest-panel]");
  const latestCards = latestPanel ? Array.from(latestPanel.querySelectorAll("[data-latest-card]")) : [];

  let catalog = { start: "2017-01-01", events: [] };
  try {
    catalog = JSON.parse(dataEl.textContent || "{}");
    if (!Array.isArray(catalog.events)) catalog.events = [];
  } catch (error) {
    console.warn("Catalog data could not be parsed:", error);
  }

  const NOW = Date.now();
  const eventKinds = ["release", "set", "gig"];
  const events = catalog.events
    .filter((event) => event && event.date && event.kind)
    .map((event) => Object.assign({}, event, { dateMs: new Date(event.date).getTime() }))
    .filter((event) => !Number.isNaN(event.dateMs) && eventKinds.includes(event.kind));
  events.sort((a, b) => a.dateMs - b.dateMs);

  const DAY = 24 * 60 * 60 * 1000;
  const catalogStart = new Date(catalog.start || "2017-01-01").getTime();
  const firstEventMs = events.length ? events[0].dateMs : catalogStart;
  const lastEventMs = events.length ? events[events.length - 1].dateMs : NOW;
  const visualStart = firstEventMs - 55 * DAY;
  const visualEnd = Math.max(NOW, lastEventMs + 25 * DAY);

  const counter = document.getElementById("catalog-counter");
  const kindColors = {
    release: "#E9EEFB",
    set: "#9D5BFF",
    gig: "#3D7BFF"
  };
  const kindGlow = {
    release: "rgba(233,238,251,.32)",
    set: "rgba(125,215,255,.35)",
    gig: "rgba(61,123,255,.38)"
  };
  const labels = {
    en: {
      entry: ["entry", "entries"],
      release: ["release", "releases"],
      set: ["set", "sets"],
      gig: ["gig", "gigs"],
      releaseKind: "Release",
      setKind: "DJ set",
      gigKind: "Gig",
      releasePage: "Release page",
      setPage: "Set page",
      gigPage: "Gig page",
      openSpotify: "Spotify",
      openApple: "Apple Music",
      openYouTube: "YouTube",
      openMixcloud: "Mixcloud"
    },
    es: {
      entry: ["entrada", "entradas"],
      release: ["lanzamiento", "lanzamientos"],
      set: ["sesi\u00f3n", "sesiones"],
      gig: ["bolo", "bolos"],
      releaseKind: "Lanzamiento",
      setKind: "Sesi\u00f3n DJ",
      gigKind: "Bolo",
      releasePage: "P\u00e1gina del lanzamiento",
      setPage: "P\u00e1gina de la sesi\u00f3n",
      gigPage: "P\u00e1gina del bolo",
      openSpotify: "Spotify",
      openApple: "Apple Music",
      openYouTube: "YouTube",
      openMixcloud: "Mixcloud"
    }
  };

  function lang() {
    return document.documentElement.lang === "es" ? "es" : "en";
  }

  function copy(key) {
    return (labels[lang()] || labels.en)[key] || labels.en[key] || key;
  }

  function plural(activeLang, key, count) {
    const pair = (labels[activeLang] || labels.en)[key] || labels.en[key];
    return pair[count === 1 ? 0 : 1];
  }

  function kindLabel(kind) {
    return copy(kind + "Kind");
  }

  function pageLabel(kind) {
    return copy(kind + "Page");
  }

  function formatDate(event) {
    const date = new Date(event.date + "T00:00:00");
    const locale = lang() === "es" ? "es-ES" : "en-GB";
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  function platformSearchUrl(service, event) {
    const query = encodeURIComponent("BladesBeats " + (event.title || ""));
    if (service === "spotify") return "https://open.spotify.com/search/" + query;
    if (service === "youtube") return "https://www.youtube.com/results?search_query=" + query;
    return "";
  }

  function servicesFor(event) {
    if (event.kind === "release") {
      const directServices = [
        { label: copy("openSpotify"), url: event.spotifyUrl },
        { label: copy("openApple"), url: event.appleMusicUrl },
        { label: copy("openYouTube"), url: event.youtubeUrl }
      ].filter((service) => service.url);
      if (directServices.length) return directServices;
      return [
        { label: copy("openSpotify"), url: platformSearchUrl("spotify", event) },
        { label: copy("openYouTube"), url: platformSearchUrl("youtube", event) }
      ].filter((service) => service.url);
    }
    if (event.kind === "set" && event.mixcloudUrl) {
      return [{ label: copy("openMixcloud"), url: event.mixcloudUrl }];
    }
    return [];
  }

  function clearExtraServiceLinks() {
    if (!card) return;
    card.querySelectorAll("[data-catalog-extra-service]").forEach((link) => link.remove());
  }

  function updateCounter() {
    if (!counter) return;
    const activeLang = lang();
    const counts = events.reduce((all, event) => {
      all[event.kind] = (all[event.kind] || 0) + 1;
      return all;
    }, {});
    counter.innerHTML =
      "<b>" + (counts.release || 0) + " " + plural(activeLang, "release", counts.release || 0) + "</b>" +
      " &middot; " + (counts.set || 0) + " " + plural(activeLang, "set", counts.set || 0) +
      " &middot; " + (counts.gig || 0) + " " + plural(activeLang, "gig", counts.gig || 0);
  }

  function latestEvent(kind) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].kind === kind) return events[index];
    }
    return null;
  }

  function updateLatestCards() {
    if (!latestPanel || !latestCards.length) return;
    let hasContent = false;
    latestCards.forEach((latestCard) => {
      const eventKind = latestCard.dataset.latestCard;
      const event = latestEvent(eventKind);
      if (!event) {
        latestCard.hidden = true;
        return;
      }
      const title = latestCard.querySelector("[data-latest-title]");
      const date = latestCard.querySelector("[data-latest-date]");
      latestCard.hidden = false;
      latestCard.href = event.url || latestCard.href;
      latestCard.style.setProperty("--latest-color", kindColors[event.kind] || kindColors.release);
      latestCard.setAttribute("aria-label", kindLabel(event.kind) + ": " + (event.title || "BladesBeats") + ", " + formatDate(event));
      if (title) title.textContent = event.title || "BladesBeats";
      if (date) date.textContent = formatDate(event);
      hasContent = true;
    });
    latestPanel.hidden = !hasContent;
  }

  let width = 680;
  let height = 200;
  let dpr = 1;
  let points = [];
  let activeIndex = -1;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(rect.width, 320);
    height = Math.max(rect.height, 160);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    updatePoints();
  }

  function timeToX(ms) {
    const t = (ms - visualStart) / (visualEnd - visualStart || 1);
    const inset = width < 560 ? 18 : 24;
    return inset + Math.max(0, Math.min(1, t)) * (width - inset * 2);
  }

  function eventY(event, index) {
    const centerY = Math.max(78, Math.min(height - 58, height * 0.5));
    const laneOffset = ((index % 6) - 2.5) * 24;
    return centerY + laneOffset;
  }

  function updatePoints() {
    points = events.map((event, index) => ({
      event,
      index,
      x: timeToX(event.dateMs),
      y: eventY(event, index)
    }));
    positionMarkers();
    if (activeIndex >= 0) positionCard(activeIndex);
  }

  function drawWave(amp, freq, phase, alpha, yBase, time) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(233,238,251," + alpha + ")";
    ctx.lineWidth = 0.8;
    for (let x = 0; x <= width; x += 2) {
      const xn = x / width;
      const y = yBase
        + Math.sin(xn * Math.PI * freq + phase + time * 0.14) * amp
        + Math.sin(xn * Math.PI * (freq * 0.55) + phase * 1.3 + time * 0.09) * (amp * 0.42)
        + Math.sin(xn * Math.PI * (freq * 1.7) + phase * 0.7 - time * 0.07) * (amp * 0.18);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawMarker(point, time) {
    const event = point.event;
    const color = kindColors[event.kind] || kindColors.release;
    const isActive = point.index === activeIndex;
    const alpha = isActive ? 1 : 0.78;

    ctx.strokeStyle = "rgba(233,238,251," + (isActive ? 0.34 : 0.16) + ")";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y + 6);
    ctx.lineTo(point.x, height - 26);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = isActive ? 1.2 : 0.8;
    ctx.globalAlpha = alpha;

    if (event.kind === "set") {
      ctx.fillRect(point.x - 2, point.y - 8, 4, 16);
    } else if (event.kind === "gig") {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - 7);
      ctx.lineTo(point.x + 6, point.y + 5);
      ctx.lineTo(point.x - 6, point.y + 5);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, reducedMotion ? 7 : 7 + Math.sin(time * 0.7 + point.index) * 0.7, 0, Math.PI * 2);
    ctx.stroke();
  }

  const t0 = performance.now();
  let rafId = false;
  let running = false;

  function draw() {
    const time = reducedMotion ? 0 : (performance.now() - t0) / 1000;
    ctx.clearRect(0, 0, width, height);

    const baseY = height * 0.56;
    drawWave(40, 3.0, 0, 0.06, baseY, time);
    drawWave(26, 4.4, 1.7, 0.10, baseY, time);
    drawWave(15, 6.2, 0.5, 0.16, baseY, time);
    drawWave(7, 8.8, 2.4, 0.24, baseY, time);

    const axisY = height - 26;
    ctx.strokeStyle = "rgba(233,238,251,0.12)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(12, axisY);
    ctx.lineTo(width - 12, axisY);
    ctx.stroke();

    ctx.font = "9px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillStyle = "rgba(126,118,101,0.95)";
    ctx.textAlign = "center";

    const startYear = new Date(visualStart).getFullYear();
    const nowYear = new Date(visualEnd).getFullYear();
    const step = nowYear - startYear > 6 ? 2 : 1;
    for (let year = startYear; year <= nowYear; year += step) {
      const x = timeToX(new Date(year + "-01-01").getTime());
      if (x < 8 || x > width - 8) continue;
      ctx.fillRect(x, axisY, 0.5, 5);
      ctx.fillText(String(year), x, axisY + 15);
    }

    const nowX = timeToX(NOW);
    ctx.fillStyle = "#E8A845";
    ctx.fillRect(nowX - 0.5, axisY - 26, 1, 32);
    ctx.fillText(lang() === "es" ? "ahora" : "now", nowX, axisY + 15);

    points.forEach((point) => drawMarker(point, time));

    if (running && !reducedMotion) {
      rafId = requestAnimationFrame(draw);
    }
  }

  function setActiveMarker(index) {
    activeIndex = index;
    markerButtons.forEach((button, buttonIndex) => {
      button.classList.toggle("active", buttonIndex === index);
    });
    draw();
  }

  function positionCard(index) {
    if (!card || index < 0 || !points[index]) return;
    const point = points[index];
    const cardWidth = card.offsetWidth || 320;
    const cardHeight = card.offsetHeight || 160;
    if (width < 640) {
      card.style.left = Math.max(8, (width - cardWidth) / 2) + "px";
      card.style.top = Math.max(8, height - cardHeight - 8) + "px";
      return;
    }
    let left = point.x + 18;
    let top = point.y - cardHeight - 18;

    if (left + cardWidth > width - 8) left = point.x - cardWidth - 18;
    if (left < 8) left = 8;
    if (top < 8) top = point.y + 24;
    if (top + cardHeight > height - 8) top = Math.max(8, height - cardHeight - 8);

    card.style.left = left + "px";
    card.style.top = top + "px";
  }

  function showCard(index) {
    if (!card || !points[index]) return;
    const event = points[index].event;
    const services = servicesFor(event);
    setActiveMarker(index);

    card.style.setProperty("--marker-color", kindColors[event.kind] || kindColors.release);
    if (cardKind) cardKind.textContent = kindLabel(event.kind);
    if (cardTitle) cardTitle.textContent = event.title || "BladesBeats";
    if (cardMeta) cardMeta.textContent = formatDate(event);
    if (pageLink) {
      pageLink.href = event.url || "/music/";
      pageLink.textContent = pageLabel(event.kind);
    }
    clearExtraServiceLinks();
    if (serviceLink) {
      if (services.length) {
        serviceLink.hidden = false;
        services.forEach((service, serviceIndex) => {
          const link = serviceIndex === 0 ? serviceLink : serviceLink.cloneNode(true);
          link.href = service.url;
          link.textContent = service.label;
          if (serviceIndex > 0) {
            link.setAttribute("data-catalog-extra-service", "");
            if (actionList) actionList.appendChild(link);
          }
        });
      } else {
        serviceLink.hidden = true;
        serviceLink.removeAttribute("href");
        serviceLink.textContent = "";
      }
    }

    card.hidden = false;
    requestAnimationFrame(() => positionCard(index));
  }

  let suppressMarkerActivation = false;
  let dismissedMarkerIndex = -1;

  function clearMarkerSuppression() {
    suppressMarkerActivation = false;
    dismissedMarkerIndex = -1;
  }

  function hideCard(options) {
    suppressMarkerActivation = Boolean(options && options.suppressMarkerActivation);
    dismissedMarkerIndex = suppressMarkerActivation ? activeIndex : -1;
    if (card) card.hidden = true;
    setActiveMarker(-1);
  }

  function positionMarkers() {
    if (!hitLayer) return;
    markerButtons.forEach((button, index) => {
      const point = points[index];
      if (!point) return;
      button.style.left = point.x + "px";
      button.style.top = point.y + "px";
    });
  }

  const markerButtons = hitLayer ? events.map((event, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "catalog-marker";
    button.dataset.kind = event.kind;
    button.style.setProperty("--marker-color", kindColors[event.kind] || kindColors.release);
    button.style.setProperty("--marker-glow", kindGlow[event.kind] || kindGlow.release);
    button.setAttribute("aria-label", kindLabel(event.kind) + ": " + (event.title || "BladesBeats") + ", " + formatDate(event));
    button.addEventListener("pointerdown", () => {
      clearMarkerSuppression();
    });
    button.addEventListener("focus", () => {
      if (suppressMarkerActivation && index === dismissedMarkerIndex) return;
      clearMarkerSuppression();
      showCard(index);
    });
    button.addEventListener("click", (eventObject) => {
      eventObject.preventDefault();
      clearMarkerSuppression();
      showCard(index);
    });
    hitLayer.appendChild(button);
    return button;
  }) : [];

  if (closeButton) {
    closeButton.addEventListener("click", () => hideCard({ suppressMarkerActivation: true }));
  }

  if (card) {
    card.addEventListener("click", (eventObject) => {
      const target = eventObject.target instanceof Element ? eventObject.target : false;
      if (target && target.closest("a,button")) return;
      if (pageLink && pageLink.href) window.location.href = pageLink.href;
    });
  }

  document.addEventListener("click", (eventObject) => {
    if (!card || card.hidden) return;
    const target = eventObject.target instanceof Element ? eventObject.target : false;
    if (!target) return;
    if (target.closest("#catalog-card") || target.closest(".catalog-marker")) return;
    hideCard();
  });

  document.addEventListener("keydown", (eventObject) => {
    if (eventObject.key === "Escape") hideCard();
  });

  function start() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(draw);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = false;
  }

  resize();
  updateCounter();
  updateLatestCards();
  draw();
  if (!reducedMotion) start();

  let resizeRaf = false;
  window.addEventListener("resize", () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resize();
      draw();
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (!reducedMotion) start();
  });

  document.addEventListener("bb:langchange", () => {
    updateCounter();
    updateLatestCards();
    markerButtons.forEach((button, index) => {
      const event = events[index];
      button.setAttribute("aria-label", kindLabel(event.kind) + ": " + (event.title || "BladesBeats") + ", " + formatDate(event));
    });
    if (activeIndex >= 0) showCard(activeIndex);
    draw();
  });
})();
