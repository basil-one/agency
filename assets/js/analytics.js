(function() {
  var measurementId = window.GA_MEASUREMENT_ID;
  if (!measurementId) return;

  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  gtag('js', new Date());
  gtag('config', measurementId, { anonymize_ip: true });

  document.addEventListener('DOMContentLoaded', function() {
    if (typeof window.gtag !== 'function') return;
    document.querySelectorAll('[data-ga-event]').forEach(function(el) {
      function trackClick() {
        var action = el.getAttribute('data-ga-event');
        var label = el.getAttribute('data-ga-label') || el.getAttribute('href') || 'unknown';
        window.gtag('event', action, {
          event_category: 'engagement',
          event_label: label,
          transport_type: 'beacon'
        });
      }

      el.addEventListener('click', trackClick);
      el.addEventListener('auxclick', function(event) {
        if (event.button === 1) trackClick();
      });
    });
  });
})();
