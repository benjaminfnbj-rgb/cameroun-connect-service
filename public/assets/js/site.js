(function () {
  'use strict';

  // Formulaire de contact : la confirmation n'est affichée que si le serveur
  // confirme que l'e-mail a réellement été remis au service d'envoi.
  var form = document.getElementById('contact-form');
  if (form) {
    var status = document.getElementById('f-status');
    var btn = form.querySelector('button[type="submit"]');
    var btnLabel = btn.innerHTML;
    var msg = {
      sending: form.getAttribute('data-msg-sending'),
      ok: form.getAttribute('data-msg-ok'),
      err: form.getAttribute('data-msg-err'),
      invalid: form.getAttribute('data-msg-invalid')
    };
    var started = form.querySelector('input[name="started"]');
    if (started) started.value = String(Date.now());

    function show(type, html) {
      status.className = 'f-status ' + type;
      status.innerHTML = html;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        show('err', msg.invalid);
        return;
      }
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() : v; });
      data.consent = form.querySelector('input[name="consent"]').checked;
      data.lang = document.documentElement.lang || 'fr';

      btn.disabled = true;
      btn.innerHTML = msg.sending;
      status.className = 'f-status';
      status.textContent = '';

      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: ctrl ? ctrl.signal : undefined
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, body: j }; });
        })
        .then(function (res) {
          if (res.ok && res.body && res.body.ok === true) {
            show('ok', msg.ok);
            form.reset();
            if (started) started.value = String(Date.now());
          } else {
            show('err', msg.err);
          }
        })
        .catch(function () { show('err', msg.err); })
        .then(function () {
          clearTimeout(timer);
          btn.disabled = false;
          btn.innerHTML = btnLabel;
        });
    });
  }

  // Lien actif dans la navigation
  var secs = document.querySelectorAll('section[id]');
  var lks = document.querySelectorAll('.nav-links a');
  if (secs.length && lks.length) {
    window.addEventListener('scroll', function () {
      var cur = '';
      secs.forEach(function (s) { if (window.scrollY >= s.offsetTop - 90) cur = s.id; });
      lks.forEach(function (a) { a.style.color = a.getAttribute('href') === '#' + cur ? '#fff' : ''; });
    }, { passive: true });
  }
})();
