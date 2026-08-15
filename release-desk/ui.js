(function () {
  "use strict";
  let csrf = "";
  let state = null;
  let activeTab = "pending";
  const app = document.querySelector("[data-app]");
  const notice = document.querySelector("[data-login-notice]");
  const queue = document.querySelector("[data-queue]");
  const template = document.getElementById("candidate-template");
  const empty = document.querySelector("[data-empty]");
  const status = document.querySelector("[data-session-status]");
  const sessionTime = document.querySelector("[data-session-time]");

  function setNotice(message, error) {
    notice.hidden = !message;
    notice.querySelector("p").textContent = message || "";
    notice.classList.toggle("status-error", Boolean(error));
  }

  async function request(url, options) {
    const config = { credentials: "same-origin", ...(options || {}) };
    config.headers = { "content-type": "application/json", ...(config.headers || {}) };
    if (csrf) config.headers["x-csrf-token"] = csrf;
    const response = await fetch(url, config);
    const value = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(value.message || value.error || "Request failed");
    return value;
  }

  async function authenticate() {
    const token = new URLSearchParams(location.hash.slice(1)).get("token");
    if (token) {
      const result = await request("/api/session", { method: "POST", body: JSON.stringify({ token: token }) });
      csrf = result.csrf;
      history.replaceState({}, "", location.pathname);
    }
    await refresh();
  }

  async function refresh() {
    const value = await request("/api/state");
    csrf = value.csrf;
    state = value;
    app.hidden = false;
    setNotice("");
    status.textContent = "Authenticated";
    status.className = "status-ok";
    const launchNotice = document.querySelector("[data-launch-blockers]");
    launchNotice.hidden = !(value.launchBlockers || []).length;
    launchNotice.querySelector("p").textContent = launchNotice.hidden ? "" : "Publication is locked until these launch requirements are completed: " + value.launchBlockers.join("; ") + ".";
    document.querySelector("[data-check-status]").textContent = value.checkedAt ? "Last checked " + new Date(value.checkedAt).toLocaleString() : "No source check has run yet.";
    render();
    renderFeatures();
    renderPrepared();
    renderVersions();
    updateClock();
  }

  function stateGroup(item) {
    if (item.state === "ignored") return "ignored";
    if (item.state === "published") return "published";
    if (item.state === "approved") return "approved";
    return "pending";
  }

  function readCandidate(card, original) {
    const links = {};
    card.querySelectorAll("[data-link]").forEach(function (input) { links[input.dataset.link] = input.value.trim(); });
    const next = { links: links };
    card.querySelectorAll("[data-field]").forEach(function (input) { next[input.dataset.field] = input.value.trim(); });
    return { ...original, ...next };
  }

  function candidateCard(item) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.querySelector("[data-source]").textContent = (item.sources || [item.source]).join(" + ");
    card.querySelector("[data-title-heading]").textContent = item.title;
    card.querySelector("[data-state]").textContent = item.state;
    const image = card.querySelector("[data-image-preview]");
    image.src = item.image || "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    card.querySelectorAll("[data-field]").forEach(function (input) { input.value = item[input.dataset.field] || ""; });
    card.querySelectorAll("[data-link]").forEach(function (input) { input.value = item.links && item.links[input.dataset.link] || ""; });
    card.querySelector("[data-notes]").textContent = (item.notes || []).join(" · ");
    const cardStatus = card.querySelector("[data-card-status]");
    const approved = stateGroup(item) === "approved" || stateGroup(item) === "published";
    card.querySelector('[data-action="approve"]').hidden = approved;
    card.querySelector('[data-action="ignore"]').hidden = stateGroup(item) === "ignored";
    card.querySelector('[data-action="reopen"]').hidden = stateGroup(item) !== "ignored";
    const feature = card.querySelector('[data-action="feature"]');
    feature.hidden = !item.approvedSlug || item.kind === "set";
    feature.textContent = state.featuredReleaseSlugs.includes(item.approvedSlug) ? "Remove feature" : "Feature on home";
    card.querySelectorAll("[data-action]").forEach(function (button) {
      button.addEventListener("click", async function () {
        button.disabled = true;
        cardStatus.textContent = "Working…";
        cardStatus.className = "";
        try {
          if (button.dataset.action === "feature") {
            await request("/api/feature", { method: "POST", body: JSON.stringify({ slug: item.approvedSlug, featured: !state.featuredReleaseSlugs.includes(item.approvedSlug) }) });
          } else {
            await request("/api/candidate", { method: "POST", body: JSON.stringify({ id: item.id, action: button.dataset.action, candidate: readCandidate(card, item) }) });
          }
          cardStatus.textContent = button.dataset.action === "approve" ? "Approved—not live" : "Saved";
          cardStatus.className = "status-ok";
          await refresh();
        } catch (error) {
          button.disabled = false;
          cardStatus.textContent = error.message;
          cardStatus.className = "status-error";
        }
      });
    });
    return card;
  }

  function render() {
    const grouped = { pending: [], approved: [], published: [], ignored: [] };
    (state.candidates || []).forEach(function (item) { grouped[stateGroup(item)].push(item); });
    Object.keys(grouped).forEach(function (key) {
      const count = document.querySelector("[data-count-" + key + "]");
      if (count) count.textContent = String(grouped[key].length);
    });
    queue.replaceChildren.apply(queue, grouped[activeTab].map(candidateCard));
    empty.hidden = grouped[activeTab].length !== 0;
    document.querySelectorAll("[data-tab]").forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.tab === activeTab)); });
  }

  async function saveFeatureOrder(slugs) {
    await request("/api/feature", { method: "POST", body: JSON.stringify({ slugs: slugs }) });
    await refresh();
  }

  function renderFeatures() {
    const target = document.querySelector("[data-feature-list]");
    const select = document.querySelector("[data-feature-select]");
    const selected = state.featuredReleaseSlugs || [];
    const releases = state.releases || [];
    const bySlug = new Map(releases.map(function (item) { return [item.slug, item]; }));
    const available = releases.filter(function (item) { return !selected.includes(item.slug); });
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = available.length ? "Choose an approved release" : "No additional releases available";
    select.replaceChildren(placeholder);
    available.forEach(function (item) {
      const option = document.createElement("option");
      option.value = item.slug;
      option.textContent = item.title + (item.releaseDate ? " · " + item.releaseDate : "");
      select.appendChild(option);
    });
    document.querySelector("[data-feature-add]").disabled = selected.length >= 8 || available.length === 0;
    target.replaceChildren.apply(target, selected.map(function (slug, index) {
      const item = bySlug.get(slug) || { title: slug, releaseDate: "" };
      const row = document.createElement("div"); row.className = "feature-row";
      const number = document.createElement("span"); number.textContent = String(index + 1).padStart(2, "0");
      const copy = document.createElement("div");
      const strong = document.createElement("strong"); strong.textContent = item.title;
      const small = document.createElement("small"); small.textContent = item.releaseDate || "Approved catalogue release";
      copy.append(strong, small);
      const controls = document.createElement("div"); controls.className = "feature-actions";
      [["Up", -1], ["Down", 1], ["Remove", 0]].forEach(function (action) {
        const button = document.createElement("button"); button.type = "button"; button.className = "button small"; button.textContent = action[0];
        button.disabled = action[1] === -1 && index === 0 || action[1] === 1 && index === selected.length - 1;
        button.addEventListener("click", async function () {
          const next = selected.slice();
          if (action[1] === 0) next.splice(index, 1); else { const swap = index + action[1]; [next[index], next[swap]] = [next[swap], next[index]]; }
          button.disabled = true;
          try { await saveFeatureOrder(next); } catch (error) { setNotice(error.message, true); button.disabled = false; }
        });
        controls.appendChild(button);
      });
      row.append(number, copy, controls); return row;
    }));
    if (!selected.length) {
      const note = document.createElement("p"); note.textContent = "No manual pins. The homepage currently uses newest-first fallback."; target.appendChild(note);
    }
  }

  function renderPrepared() {
    const panel = document.querySelector("[data-prepared]");
    if (!state.prepared) { panel.hidden = true; return; }
    panel.hidden = false;
    const totals = state.prepared.diff.totals;
    const diff = document.querySelector("[data-diff]");
    diff.replaceChildren.apply(diff, [["Version", state.prepared.version], ["Added", totals.added], ["Changed", totals.changed], ["Removed", totals.removed]].map(function (item) { const span = document.createElement("span"); span.textContent = item[0] + " " + item[1]; return span; }));
    const files = document.querySelector("[data-diff-files]");
    files.replaceChildren.apply(files, ["added", "changed", "removed"].filter(function (key) { return state.prepared.diff[key].length; }).map(function (key) {
      const group = document.createElement("div"); group.className = "diff-file-group";
      const heading = document.createElement("strong"); heading.textContent = key[0].toUpperCase() + key.slice(1) + " (" + state.prepared.diff[key].length + ")"; group.appendChild(heading);
      state.prepared.diff[key].forEach(function (path) { const code = document.createElement("code"); code.textContent = path; group.appendChild(code); }); return group;
    }));
    document.querySelector("[data-preview]").href = state.prepared.previewPath;
    const input = document.querySelector("[data-publish-phrase]");
    const publish = document.querySelector("[data-publish]");
    input.placeholder = state.prepared.confirmationPhrase;
    input.value = "";
    input.oninput = function () { publish.disabled = input.value !== state.prepared.confirmationPhrase || !state.publishEnabled; };
    publish.disabled = true;
    const blockers = state.launchBlockers || [];
    document.querySelector("[data-publish-note]").textContent = blockers.length ? "Publish blocked: " + blockers.join("; ") + "." : state.publishEnabled ? "The preview is private. Publishing still requires the exact phrase above and a final confirmation." : "Publish remains disabled until the constrained VPS deployment helper is installed.";
  }

  function renderVersions() {
    const target = document.querySelector("[data-versions]");
    target.replaceChildren.apply(target, (state.versions || []).map(function (version) {
      const row = document.createElement("div");
      row.className = "version";
      const info = document.createElement("div");
      const strong = document.createElement("strong"); strong.textContent = version.version;
      const small = document.createElement("small"); small.textContent = new Date(version.publishedAt || version.preparedAt).toLocaleString() + " · " + version.revision + " · " + (version.mode || "publish");
      info.append(strong, small);
      const controls = document.createElement("div"); controls.className = "rollback-controls";
      const input = document.createElement("input"); input.placeholder = "ROLLBACK " + version.version; input.setAttribute("aria-label", "Rollback confirmation phrase");
      const button = document.createElement("button"); button.className = "button small danger"; button.textContent = "Rollback"; button.disabled = true;
      input.addEventListener("input", function () { button.disabled = input.value !== "ROLLBACK " + version.version || !state.publishEnabled; });
      button.addEventListener("click", async function () { if (!confirm("Switch the live site back to " + version.version + "?")) return; button.disabled = true; try { await request("/api/rollback", { method: "POST", body: JSON.stringify({ version: version.version, phrase: input.value }) }); alert("Rollback complete."); await refresh(); } catch (error) { alert(error.message); button.disabled = false; } });
      controls.append(input, button); row.append(info, controls); return row;
    }));
    if (!(state.versions || []).length) { const emptyVersion = document.createElement("p"); emptyVersion.textContent = "No previously published Release Desk versions yet."; target.appendChild(emptyVersion); }
  }

  function updateClock() {
    if (!state) return;
    const minutes = Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 60000));
    sessionTime.textContent = minutes + " min maximum remaining";
  }

  document.querySelectorAll("[data-tab]").forEach(function (button) { button.addEventListener("click", function () { activeTab = button.dataset.tab; render(); }); });
  document.querySelector("[data-feature-add]").addEventListener("click", async function (event) { const slug = document.querySelector("[data-feature-select]").value; if (!slug) return; event.currentTarget.disabled = true; try { await saveFeatureOrder([...(state.featuredReleaseSlugs || []), slug]); } catch (error) { setNotice(error.message, true); event.currentTarget.disabled = false; } });
  document.querySelector("[data-run-check]").addEventListener("click", async function (event) { const button = event.currentTarget; button.disabled = true; button.textContent = "Checking…"; try { await request("/api/check", { method: "POST", body: "{}" }); await refresh(); } catch (error) { setNotice(error.message, true); } finally { button.disabled = false; button.textContent = "Run check now"; } });
  document.querySelector("[data-prepare]").addEventListener("click", async function (event) { const button = event.currentTarget; button.disabled = true; button.textContent = "Building…"; try { const result = await request("/api/prepare", { method: "POST", body: "{}" }); state.prepared = result.prepared; renderPrepared(); } catch (error) { setNotice(error.message, true); } finally { button.disabled = false; button.textContent = "Prepare release"; } });
  document.querySelector("[data-publish]").addEventListener("click", async function (event) { const phrase = document.querySelector("[data-publish-phrase]").value; if (!confirm("This is the final live publication step. Continue?")) return; event.currentTarget.disabled = true; try { const result = await request("/api/publish", { method: "POST", body: JSON.stringify({ phrase: phrase }) }); document.querySelector("[data-publish-note]").textContent = "Published version " + result.version; await refresh(); } catch (error) { document.querySelector("[data-publish-note]").textContent = error.message; document.querySelector("[data-publish-note]").className = "publish-note status-error"; } });
  setInterval(updateClock, 30000);
  authenticate().catch(function (error) { status.textContent = "Not authenticated"; status.className = "status-error"; setNotice(error.message === "authentication_required" ? "This link has no valid one-time token. Stop the command and start a fresh Release Desk session." : error.message, true); });
}());
