'use strict';

// privacy.html / terms.html — content integrity.
//
// html-validate (lint:html) already covers markup validity; these tests pin
// the CONTENT the SMS program and the LLM privacy notice legally depend on:
// the disclosures carriers check for, the opt-out contract, and the links
// that make both pages reachable (from the landing page's titlebar nav and
// from the opt-in form itself). If a rewrite drops one of these, CI fails
// instead of a carrier review.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const privacy = read('privacy.html');
const terms = read('terms.html');
const index = read('index.html');
const room = read('room.js');

test('privacy.html carries the SMS / phone disclosures', () => {
  assert.match(privacy, /<title>[^<]*Privacy Policy[^<]*<\/title>/i);
  // the no-sharing sentence carriers look for, verbatim in spirit
  assert.match(
    privacy,
    /no mobile information will be shared with\s*third parties or affiliates for marketing or promotional purposes/i
  );
  assert.match(privacy, /message and data rates may apply/i);
  assert.match(privacy, /STOP/, 'opt-out keyword documented');
  assert.match(privacy, /START/, 'opt-in restore keyword documented');
  assert.match(privacy, /48\s*hours?|48h/i, 'verified-status expiry documented');
  assert.match(
    privacy,
    /one SMS verification code per request/i,
    'message frequency documented'
  );
  assert.match(privacy, /mailto:/, 'a contact address for questions/removal');
  assert.match(privacy, /href="terms\.html"/, 'cross-links the SMS program terms');
});

test('privacy.html discloses the LLM data flow', () => {
  assert.match(privacy, /Anthropic|Claude/i, 'names the model provider');
  assert.match(privacy, /Twilio/i, 'names the telephony processor');
  assert.match(privacy, /Turnstile/i, 'names the bot gate');
  assert.match(privacy, /~?30 minutes/i, 'states the conversation retention window');
});

test('terms.html carries the SMS program terms', () => {
  assert.match(terms, /<title>[^<]*Terms of Service[^<]*<\/title>/i);
  assert.match(terms, /verification codes? only/i, 'message-type disclosure');
  assert.match(terms, /never marketing/i);
  assert.match(terms, /message and data rates may apply/i);
  assert.match(terms, /reply\s*<strong>HELP<\/strong>/i, 'HELP instructions');
  assert.match(terms, /reply\s*<strong>STOP<\/strong>/i, 'STOP instructions');
  assert.match(terms, /US numbers only/i, 'eligibility');
  assert.match(terms, /no recurring messages/i, 'frequency');
  assert.match(terms, /Twilio/i, 'delivery disclosure');
  assert.match(terms, /press 1/i, 'the consent-gated voice call');
  assert.match(terms, /href="privacy\.html"/, 'cross-links the privacy policy');
  assert.match(terms, /mailto:/, 'a contact address');
});

test('both pages are reachable from the landing page titlebar', () => {
  // carrier compliance requires the privacy policy be reachable from the
  // page hosting the opt-in — #legal-links in the titlebar is that path
  assert.match(index, /id="legal-links"/);
  assert.match(index, /href="privacy\.html"/);
  assert.match(index, /href="terms\.html"/);
});

test('the opt-in form itself links both pages', () => {
  // the num-stage popup markup in room.js must keep its terms + privacy links
  assert.match(room, /href="terms\.html"[^>]*>terms of service<\/a>/);
  assert.match(room, /href="privacy\.html"[^>]*>privacy policy<\/a>/);
});

test('every pop object starts with consent unticked (static guard)', () => {
  // belt-and-braces alongside the behavioral test in sms-optin.test.js:
  // no code path may construct a pop object with agree pre-set true
  assert.ok(!/agree:\s*true/.test(room), 'no pop object is ever built with agree:true');
  assert.match(room, /agree:\s*false/, 'openPop builds pop objects with agree:false');
});
