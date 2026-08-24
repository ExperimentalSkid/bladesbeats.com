(function(){
  const CONTACT_EMAIL = "bladesbeats.opossum156@passinbox.com";
  const CONTACT_ENDPOINT = "/api/contact";
  const FORM_LANGUAGE = document.documentElement.lang === "es" ? "es" : "en";

  function contactType(form){
    const select = form.querySelector("[data-contact-type]");
    return select ? select.value : "booking";
  }

  function updateContactGroups(form){
    const type = contactType(form);
    const isHandoff = type === "mixing" || type === "courses";
    const activeElement = document.activeElement;
    const activeWasHandoff = activeElement instanceof HTMLElement && !!activeElement.closest(".handoff-card");
    const typeSelect = form.querySelector("[data-contact-type]");
    form.classList.toggle("is-handoff", isHandoff);
    form.querySelectorAll("[data-contact-group]").forEach(function(group){
      const active = group.dataset.contactGroup === type;
      group.hidden = !active;
      group.querySelectorAll("input, select, textarea").forEach(function(field){
        field.disabled = !active;
      });
    });
    form.querySelectorAll("input, textarea, button").forEach(function(field){
      if(field.closest("[data-contact-group]")) return;
      field.disabled = isHandoff;
    });
    if(typeSelect) typeSelect.disabled = false;
    const message = form.querySelector("textarea[name='message']");
    const label = form.querySelector("[data-contact-message-label]");
    const key = type.charAt(0).toUpperCase() + type.slice(1);
    if(message) message.setAttribute("placeholder", form.dataset["message" + key] || form.dataset.messageDefault || "");
    if(label) label.textContent = form.dataset["label" + key] || form.dataset.labelDefault || "Message";
    if(isHandoff && activeElement instanceof HTMLElement && form.contains(activeElement) && activeElement !== typeSelect){
      activeElement.blur();
    }
    if(isHandoff){
      const handoffLink = form.querySelector('[data-contact-group="' + type + '"] a');
      if(handoffLink) handoffLink.focus({preventScroll:true});
    } else if(activeWasHandoff && typeSelect){
      typeSelect.focus({preventScroll:true});
    }
  }

  function setStatus(form, message, kind){
    const status = form.querySelector("[data-contact-status]");
    if(!status) return;
    status.textContent = message || "";
    status.classList.toggle("error", kind === "error");
    status.classList.toggle("success", kind === "success");
  }

  function renderTurnstile(tries){
    const el = document.getElementById("bb-turnstile");
    if(!el || el.dataset.rendered) return;
    if(location.hostname === "127.0.0.1" || location.hostname === "localhost"){
      el.dataset.rendered = "local";
      el.textContent = FORM_LANGUAGE === "es" ? "La verificación de seguridad se activa en bladesbeats.com." : "Security verification runs on bladesbeats.com.";
      return;
    }
    if(window.turnstile && typeof window.turnstile.render === "function"){
      try{
        const widgetId = window.turnstile.render(el, {
          sitekey: "0x4AAAAAADoNSCaiKxbVJ44j",
          theme: "dark",
          language: FORM_LANGUAGE,
          callback: function(token){ el.dataset.token = token || ""; },
          "expired-callback": function(){ delete el.dataset.token; },
          "error-callback": function(){ delete el.dataset.token; },
          "timeout-callback": function(){ delete el.dataset.token; }
        });
        if(widgetId) el.dataset.widgetId = widgetId;
        el.dataset.rendered = "1";
      } catch(error){}
    } else if((tries || 0) < 60){
      setTimeout(function(){ renderTurnstile((tries || 0) + 1); }, 250);
    }
  }

  function resetTurnstile(){
    const el = document.getElementById("bb-turnstile");
    if(!el) return;
    delete el.dataset.token;
    if(window.turnstile && typeof window.turnstile.reset === "function"){
      try{
        if(el.dataset.widgetId){
          window.turnstile.reset(el.dataset.widgetId);
        } else {
          window.turnstile.reset();
        }
        return;
      } catch(error){}
    }
    el.dataset.rendered = "";
    delete el.dataset.widgetId;
    el.innerHTML = "";
    renderTurnstile();
  }

  function turnstileToken(form){
    const input = form.querySelector('[name="cf-turnstile-response"]');
    const el = document.getElementById("bb-turnstile");
    return (input && input.value) || (el && el.dataset.token) || "";
  }

  function waitForTurnstileToken(form, deadline){
    return new Promise(function(resolve){
      const started = Date.now();
      function check(){
        const token = turnstileToken(form);
        if(token || Date.now() - started >= deadline){
          resolve(token);
          return;
        }
        setTimeout(check, 150);
      }
      check();
    });
  }

  function formErrorMessage(form, errorCode){
    const base = errorCode === "verification_failed" ? (form.dataset.captchaRequired || form.dataset.formError) : form.dataset.formError;
    return errorCode ? base + " (" + errorCode + ")" : base;
  }

  function fieldLabel(field){
    const fieldLabelEl = field.closest(".form-field") && field.closest(".form-field").querySelector("span");
    const checkLabelEl = field.closest(".form-check") && field.closest(".form-check").querySelector("span");
    return (fieldLabelEl || checkLabelEl)?.textContent?.trim() || field.name;
  }

  async function submitContactForm(event){
    event.preventDefault();
    const form = event.currentTarget;
    const type = contactType(form);
    if(type === "mixing" || type === "courses"){
      setStatus(form, "", "");
      const handoffLink = form.querySelector('[data-contact-group="' + type + '"] a');
      if(handoffLink) handoffLink.focus();
      return;
    }
    const needsCaptcha = location.hostname !== "127.0.0.1" && location.hostname !== "localhost";
    if(needsCaptcha) renderTurnstile();
    const token = needsCaptcha ? await waitForTurnstileToken(form, 8000) : "";
    if(needsCaptcha && !token){
      renderTurnstile();
      setStatus(form, form.dataset.captchaRequired, "error");
      return;
    }
    const data = new FormData(form);
    const submit = form.querySelector("[data-contact-submit]");
    const typeSelect = form.querySelector("[data-contact-type]");
    const typeLabel = typeSelect && typeSelect.selectedOptions[0] ? typeSelect.selectedOptions[0].textContent.trim() : form.dataset.defaultType;
    const skip = new Set(["cf-turnstile-response", "request_type"]);
    const lines = [(form.dataset.typeLabel || "Type") + ": " + typeLabel];
    data.forEach(function(value, key){
      if(skip.has(key) || !value) return;
      const field = form.elements[key];
      lines.push(fieldLabel(field) + ": " + value);
    });
    const subject = "BladesBeats — " + typeLabel;
    const mail = "mailto:" + CONTACT_EMAIL + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(lines.join("\n"));
    const canSendDirect = needsCaptcha && CONTACT_ENDPOINT;
    if(submit){
      submit.disabled = true;
      submit.textContent = form.dataset.formSending;
    }
    if(canSendDirect){
      try{
        const response = await fetch(CONTACT_ENDPOINT, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            turnstileToken: token,
            subject,
            type: typeLabel,
            fields: lines,
            page: location.href
          })
        });
        const result = await response.json().catch(function(){ return {}; });
        if(result.error === "request_blocked" || result.error === "temporarily_blocked"){
          location.href = "/blocked/";
          return;
        }
        if(!response.ok || !result.ok) throw new Error(result.error || "send_failed");
        setStatus(form, form.dataset.formSuccess, "success");
        form.reset();
        updateContactGroups(form);
        resetTurnstile();
        if(submit){
          submit.disabled = false;
          submit.textContent = form.dataset.formSend;
        }
        return;
      } catch(error){
        console.warn("Contact form failed:", error.message);
        setStatus(form, formErrorMessage(form, error.message), "error");
        resetTurnstile();
        if(submit){
          submit.disabled = false;
          submit.textContent = form.dataset.formSend;
        }
        return;
      }
    }
    setStatus(form, form.dataset.formMailto, "success");
    window.location.href = mail;
    setTimeout(function(){
      if(submit){
        submit.disabled = false;
        submit.textContent = form.dataset.formSend;
      }
    }, 800);
  }

  document.querySelectorAll("[data-contact-form]").forEach(function(form){
    form.querySelectorAll("[data-contact-type]").forEach(function(select){
      select.addEventListener("change", function(){ updateContactGroups(form); });
    });
    form.addEventListener("submit", submitContactForm);
    updateContactGroups(form);
    renderTurnstile();
  });
}());
