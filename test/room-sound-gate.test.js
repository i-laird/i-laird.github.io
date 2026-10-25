'use strict';

// `room` with sound off asks first (showRoomSoundGate in app.js): a dialog
// that offers to go back or to turn sound on and go in. Boots the real page
// and drives it the way a visitor would — by command, button, and key.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootPage } = require('./helpers/boot-page');

const soundLabel = (window) =>
  window.document.getElementById('sound-toggle-label').textContent;

test('room with sound off: back leaves you in the terminal, sound still off', async (t) => {
  const { window } = await bootPage();
  t.after(() => window.close());
  const $ = (s) => window.document.querySelector(s);
  assert.notEqual(soundLabel(window), 'ON', 'sound starts off');
  window.submitCommand('room');
  const gate = $('.snd-gate');
  assert.ok(gate, 'the confirm appears');
  assert.equal(gate.getAttribute('role'), 'dialog');
  assert.match(gate.textContent, /the room needs sound/);
  assert.ok(!$('script[src="room.js"]'), 'nothing loads before an answer');
  $('.snd-gate-back').click();
  assert.equal($('.snd-gate'), null, 'back closes it');
  assert.notEqual(soundLabel(window), 'ON', 'and leaves sound off');
  assert.ok(!$('script[src="room.js"]'), 'and does not go in');
  assert.match($('#out').textContent, /maybe another night/);
});

test('room with sound off: enable turns sound on and goes in', async (t) => {
  const { window } = await bootPage();
  t.after(() => window.close());
  const $ = (s) => window.document.querySelector(s);
  window.submitCommand('room');
  $('.snd-gate-go').click();
  assert.equal($('.snd-gate'), null);
  assert.equal(soundLabel(window), 'ON', 'sound is on');
  assert.ok($('script[src="room.js"]'), 'the room is loading');
  assert.match($('#out').textContent, /zooming out/);
});

test('the confirm is keyboard-driven: Escape backs out, Enter takes the focused button', async (t) => {
  const { window } = await bootPage();
  t.after(() => window.close());
  const $ = (s) => window.document.querySelector(s);
  const key = (k) =>
    window.document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: k, bubbles: true })
    );
  window.submitCommand('room');
  await new Promise((r) => setTimeout(r, 10)); // focus moves after the opening keypress
  assert.equal(window.document.activeElement, $('.snd-gate-go'), 'enable is focused');
  key('Escape');
  assert.equal($('.snd-gate'), null, 'Escape backs out');
  window.submitCommand('room');
  await new Promise((r) => setTimeout(r, 10));
  key('Tab');
  assert.equal(window.document.activeElement, $('.snd-gate-back'), 'Tab moves to back');
  key('Enter');
  assert.equal($('.snd-gate'), null);
  assert.notEqual(soundLabel(window), 'ON', 'Enter on back did not enable sound');
});

test('room with sound already on goes straight in', async (t) => {
  const { window } = await bootPage();
  t.after(() => window.close());
  window.submitCommand('sound on');
  window.submitCommand('room');
  assert.equal(window.document.querySelector('.snd-gate'), null, 'no confirm');
  assert.ok(window.document.querySelector('script[src="room.js"]'));
});
