'use strict';

// v1: Event ID is admin-supplied or slugified from the name plus a 4-digit
// timestamp suffix: name.toLowerCase().replace(/[^a-z0-9]+/g,'-') + '-' + Date.now().toString().slice(-4)
function slugFor(name, now = Date.now()) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'event'}-${String(now).slice(-4)}`;
}

// The public event object, in v1's getEvents/getEvent shape.
function publicEvent(e) {
  return {
    id:                   e.slug,
    name:                 e.name || '',
    description:          e.description || '',
    date:                 e.event_date || '',
    time:                 e.event_time || '',
    location:             e.location || '',
    status:               e.status || 'Open',
    registerInterest:     Boolean(e.register_interest_mode),
    customerInstructions: e.customer_instructions || '',
  };
}

module.exports = { slugFor, publicEvent };
