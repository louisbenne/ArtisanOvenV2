/* ArtisanOven v2 — the ONLY browser → backend client (CLAUDE.md golden rule 2).
 *
 * v1's pages were written against Google Apps Script: they build
 *   ORDER_API_URL + "?action=getOrder&query=…"   (or POST a JSON body with `action`)
 * and read v1-shaped JSON back. The only edit made to those pages is
 * `fetch(` → `AO_API.fetch(` at each call site. AO_API.fetch recognises the
 * v1 action, calls v2's REST API instead, and returns a Response-like object
 * whose .json() is EXACTLY what v1's Apps Script returned — so page logic and
 * markup stay untouched. Any other URL goes to the real fetch unchanged.
 *
 * ORDER_API_URL is set by /config.js to a same-origin placeholder; nothing is
 * ever sent to it (and the CSP header allows only this origin anyway).
 */
(function () {
  'use strict';

  var V1_ENDPOINT = window.location.origin + '/__v1api';
  var PAYPAL_ME_BASE = 'https://paypal.me/ArtisanOven';
  var PAYPAL_NCP_LINK = 'https://www.paypal.com/ncp/payment/LXZKSSG3QEFJA';
  var SIZE_LABEL = { '12inch': '12" Pizza', 'Half12inch': 'Half a 12" Pizza', 'Quarter12inch': 'Quarter of a 12" Pizza' };
  var METHOD_TO_V2 = { 'bank transfer': 'bank_transfer', 'paypal': 'paypal', 'cash': 'cash' };
  var METHOD_TO_V1 = { bank_transfer: 'Bank Transfer', paypal: 'PayPal', cash: 'Cash' };
  var realFetch = window.fetch.bind(window);

  // ── plumbing ──────────────────────────────────────────────────────────────
  function jsonResponse(body, status) {
    return {
      ok: true, status: status || 200, statusText: 'OK',
      json: function () { return Promise.resolve(body); },
      text: function () { return Promise.resolve(JSON.stringify(body)); },
    };
  }

  function rest(method, path, body, headers) {
    var init = { method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) };
    if (body !== undefined) init.body = JSON.stringify(body);
    return realFetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        data = data || {};
        data.httpStatus = res.status;
        return data;
      });
    });
  }

  function paramsOf(url, init) {
    var params = {};
    new URL(url, window.location.origin).searchParams.forEach(function (v, k) { params[k] = v; });
    if (init && typeof init.body === 'string' && init.body) {
      try { Object.assign(params, JSON.parse(init.body)); }
      catch (e) { new URLSearchParams(init.body).forEach(function (v, k) { params[k] = v; }); }
    }
    return params;
  }

  function parseItems(items) {
    if (typeof items === 'string') { try { return JSON.parse(items || '[]'); } catch (e) { return []; } }
    return Array.isArray(items) ? items : [];
  }

  var money = function (pence) { return Math.round(Number(pence || 0)) / 100; };
  var toV2Method = function (m) { return METHOD_TO_V2[String(m || 'Bank Transfer').trim().toLowerCase()] || 'bank_transfer'; };

  // ── v1 actions → v2 REST ─────────────────────────────────────────────────
  var actions = {
    getStatus: function () {
      return realFetch('/api/status?_t=' + Date.now()).then(function (r) { return r.json(); });
    },

    getEvents: function () { return rest('GET', '/api/events'); },

    getEvent: function (p) {
      var id = p.eventId || p.event || p.id || '';
      return rest('GET', '/api/events/' + encodeURIComponent(id)).then(function (d) {
        return d.success ? d : { success: false, message: 'Event not found' };
      });
    },

    registerInterest: function (p) {
      var id = p.eventId || p.event || p.id || '';
      return rest('POST', '/api/events/' + encodeURIComponent(id) + '/interest', {
        customerName: p.customerName || p.name || '',
        customerEmail: p.customerEmail || p.email || '',
        notes: p.notes || p.details || '',
      }).then(function (d) {
        return d.success ? { success: true, message: d.message || 'Interest registered successfully!' }
                         : { success: false, message: d.message || 'Could not register interest.' };
      });
    },

    createEventOrder: function (p) {
      return rest('POST', '/api/orders', {
        orderType: 'event',
        eventId: p.eventId || p.event || p.id || '',
        payerName: p.customerName || p.name || '',
        payerEmail: p.customerEmail || p.email || '',
        paymentMethod: toV2Method(p.paymentMethod),
        notes: p.notes || p.orderNotes || '',
        submissionId: p.submissionId || undefined,
        items: parseItems(p.items).map(function (i) { return { size: i.size, qty: i.qty }; }),
      }).then(function (d) {
        if (!d.success) return { success: false, message: d.message || 'Your order could not be placed.' };
        return { success: true, orderId: d.orderRef, total: d.total, token: d.token, message: 'Order successfully placed.' };
      });
    },

    parentAuth: function (p) {
      return rest('POST', '/api/parent/auth', { code: p.code || p.accessCode || '' }).then(function (d) {
        return d.success ? { success: true, token: d.token, expiresInSeconds: 43200, message: 'Access granted.' }
                         : { success: false, message: 'Access denied.' };
      });
    },

    createParentOrder: function (p) {
      // v1 sends items grouped by size ([{size, qty}]) plus comma-joined child
      // names/classes; pair them up in order, as v1's own admin view did.
      var names = String(p.childName || '').split(/\s*,\s*/).filter(Boolean);
      var classes = String(p.childClass || p['class'] || '').split(/\s*,\s*/).filter(Boolean);
      var items = [];
      parseItems(p.items).forEach(function (i) {
        for (var n = 0; n < (parseInt(i.qty, 10) || 1); n++) {
          items.push({ size: i.size, childName: names[items.length] || names[0] || '',
                       childClass: classes[items.length] || classes[0] || '' });
        }
      });
      var token = p.token || p.sessionToken || '';
      return rest('POST', '/api/parent/orders', {
        payerName: p.parentName || p.name || '',
        payerEmail: p.parentEmail || p.email || '',
        paymentMethod: toV2Method(p.paymentMethod),
        notes: p.notes || p.orderNotes || '',
        submissionId: p.submissionId || undefined,
        items: items,
      }, { Authorization: 'Bearer ' + token }).then(function (d) {
        if (d.httpStatus === 401) return { success: false, message: 'Access denied.' };
        if (!d.success) return { success: false, message: d.message || 'Your parent order could not be submitted.' };
        return { success: true, orderId: d.orderRef, originalTotal: d.subtotal, discountAmount: d.discount,
                 finalTotal: d.total, token: d.token, message: 'Parent order successfully placed.' };
      });
    },

    getOrder: function (p) {
      var query = String(p.query || '').trim();
      if (!query) return Promise.resolve({ success: false, message: 'Please provide an email address or Order ID to search.' });
      var qs = '?q=' + encodeURIComponent(query) + (p.token ? '&token=' + encodeURIComponent(p.token) : '');
      return rest('GET', '/api/orders/lookup' + qs).then(function (d) {
        if (!d.success || !d.order) {
          return { success: false, message: "We couldn't find your order. Please use the link in your order confirmation email." };
        }
        var o = d.order;
        var total = money(o.totalPence);
        var ref = o.orderRef;
        return {
          success: true,
          orderId: ref,
          customerName: o.customerName,
          email: o.customerEmail,
          paymentMethod: METHOD_TO_V1[o.paymentMethod] || 'Bank Transfer',
          paid: o.paymentStatus === 'paid' ? 'Yes' : 'No',
          total: total,
          totalAfterDiscount: total,
          totalFormatted: '£' + total.toFixed(2),
          discountCode: o.discountCode || '',
          discountAmount: money(o.discountPence),
          discountReason: o.orderType === 'parent' ? '50% internal parent discount' : '',
          order: (o.items || []).map(function (i, idx) {
            var price = money(i.pricePence);
            return {
              item: SIZE_LABEL[i.size] || i.size, sizeKey: i.size, quantity: 1,
              childName: i.childName || (o.orderType === 'event' ? o.customerName : 'Student'),
              'class': i.childClass || '',
              price: price, priceFormatted: '£' + price.toFixed(2), pickupId: ref + '-' + (idx + 1),
            };
          }),
          paypalMeUrl: PAYPAL_ME_BASE + '/' + total.toFixed(2),
          paypalNcpUrl: PAYPAL_NCP_LINK,
        };
      });
    },

    getVersion: function () {
      return rest('GET', '/api/version').then(function (d) {
        return d.success ? d : { success: true, version: '2.0.0', build: '', name: 'Artisan Oven Backend' };
      });
    },
  };

  // fetch() drop-in for v1 call sites.
  function v1fetch(url, init) {
    var href = String(url && url.url ? url.url : url);
    if (href.indexOf(V1_ENDPOINT) !== 0) return realFetch(url, init);
    var params = paramsOf(href, init);
    var handler = actions[params.action];
    if (!handler) {
      return Promise.resolve(jsonResponse({ success: false, message: 'This action is not available yet.' }));
    }
    return Promise.resolve(handler(params)).then(function (body) {
      if (body) delete body.httpStatus;
      return jsonResponse(body);
    }).catch(function () {
      return jsonResponse({ success: false, message: 'Network error — please try again.' });
    });
  }

  window.AO_API = { fetch: v1fetch, actions: actions, endpoint: V1_ENDPOINT };
  window.ORDER_API_URL = V1_ENDPOINT;
  window.STATUS_API_URL = '/api/status';
})();
