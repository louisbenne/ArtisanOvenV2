'use strict';

// ONE canonical dataset for every screenshot, expressed in domain terms.
// fixtures/v1-api.js turns it into v1 Apps Script responses (for the v1 baseline);
// Phase 2 turns the same data into v2 database rows (for the v2 comparison).
// Fake people only (@example.com). Money in pounds, as v1 shows it.

const settings = {
  serviceDate:        'Tuesday 29th September 2026',
  serviceTitle:       'Tuesday 29th Sept Availability',
  serviceNoticeDate:  'Tuesday Lunchtime — 29th of September',
  maxPizzas:          20,
  orderingEnabled:    true,
  autoCloseEnabled:   true,
  autoCloseDay:       'Sunday',
  autoCloseTime:      '21:00',
  capacityMessage:    'We have a limited number of orders while we gauge our capacity. Once we get into full swing, we’ll be able to open up to more orders.',
  deadlineMessage:    'Orders will close at 9:00 PM on Sunday evenings, giving us time to prepare for Tuesday.',
  fullyBookedMessage: "We're fully booked for this session. Please check back next time.",
  nextOpeningTime:    'Tuesday 6th at 4:00 PM',
  ordersTeamEmail:    'orders-team@example.com',
};

// Lunch orders for the current session (numbers #1…#8). Sizes: 12inch | Half12inch | Quarter12inch.
// Capacity: lunch 1 + 1.5 + 2 + 1 + 2 + 2.5 + 2 = 12, plus parent orders 2 → 14 of 20
// (v1 counts internal parent orders toward capacity).
const lunchOrders = [
  { number: 1, payer: 'Alice Morgan',  email: 'alice@example.com',  method: 'Bank Transfer', paid: true,  allergy: '',
    pizzas: [['12inch', 'Oscar Morgan', 'Class 5']] },
  { number: 2, payer: 'Ben Carter',    email: 'ben@example.com',    method: 'Cash',          paid: false, allergy: '',
    pizzas: [['12inch', 'Ruby Carter', 'Class 3'], ['Half12inch', 'Leo Carter', 'Class 1']] },
  { number: 3, payer: 'Chloe Patel',   email: 'chloe@example.com',  method: 'PayPal',        paid: true,  allergy: 'Nut allergy — no pesto',
    pizzas: [['12inch', 'Maya Patel', 'Class 4'], ['12inch', 'Arjun Patel', 'Class 2']], discount: 'STMSCS' },
  { number: 4, payer: 'Dan Hughes',    email: 'dan@example.com',    method: 'Bank Transfer', paid: false, allergy: '',
    pizzas: [['Half12inch', 'Isla Hughes', 'Class 6'], ['Half12inch', 'Finn Hughes', 'Class 6']] },
  { number: 5, payer: 'Emma Wilson',   email: 'emma@example.com',   method: 'Cash',          paid: true,  allergy: '',
    pizzas: [['12inch', 'Noah Wilson', 'Class 5'], ['12inch', 'Ava Wilson', 'Class 3']] },
  { number: 6, payer: 'Farah Khan',    email: 'farah@example.com',  method: 'Bank Transfer', paid: false, allergy: '',
    pizzas: [['12inch', 'Zara Khan', 'Class 4'], ['12inch', 'Omar Khan', 'Class 2'], ['Half12inch', 'Sami Khan', 'Class 1']] },
  { number: 7, payer: 'George Evans',  email: 'george@example.com', method: 'PayPal',        paid: false, allergy: '',
    pizzas: [['12inch', 'Poppy Evans', 'Class 6'], ['Quarter12inch', 'Alfie Evans', 'Class 1'], ['Quarter12inch', 'Ivy Evans', 'Class 1'], ['Half12inch', 'Jack Evans', 'Class 2']] },
];

const events = [
  { id: 'summer-fair-2026', name: 'Summer Fair 2026', description: 'Wood-fired pizzas at the school Summer Fair.',
    date: 'Saturday 10th October 2026', time: '12:00 – 3:00 PM', location: 'School Field', status: 'Open',
    registerInterest: false, active: true,
    customerInstructions: 'Collect from the pizza tent by the main gate. Please bring your order number.' },
  { id: 'autumn-bbq-2026', name: 'Autumn BBQ', description: 'Menu and numbers still being finalised — tell us you are interested.',
    date: 'Friday 23rd October 2026', time: '5:00 – 7:00 PM', location: 'Sixth Form Garden', status: 'Open',
    registerInterest: true, active: true, customerInstructions: '' },
];

const eventOrders = [
  { ref: 'E101', eventId: 'summer-fair-2026', name: 'Ivy Brooks',  email: 'ivy@example.com',  method: 'PayPal',        paid: true,  items: [['12inch', 2]] },
  { ref: 'E102', eventId: 'summer-fair-2026', name: 'Jon Price',   email: 'jon@example.com',  method: 'Cash',          paid: false, items: [['Half12inch', 1], ['12inch', 1]] },
  { ref: 'E104', eventId: 'summer-fair-2026', name: 'Kate Fisher', email: 'kate@example.com', method: 'Bank Transfer', paid: false, items: [['Quarter12inch', 2]] },
];

const parentOrders = [
  { ref: 'E103', parent: 'Laura Benson', email: 'laura@example.com', child: 'Sophie Benson', className: 'Class 5',
    method: 'Bank Transfer', paid: false, items: [['12inch', 1]] },
  { ref: 'E105', parent: 'Mark Reid',    email: 'mark@example.com',  child: 'Tom Reid',      className: 'Class 2',
    method: 'Cash', paid: true, items: [['Half12inch', 2]] },
];

// Tokens used by "View my order" email links in the fixtures.
const tokens = { lunch3: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b' };

module.exports = { settings, lunchOrders, events, eventOrders, parentOrders, tokens };
