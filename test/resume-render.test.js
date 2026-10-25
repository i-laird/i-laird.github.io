'use strict';

// The room's desk shows the REAL resume: an image rendered from the PDF by
// scripts/render-resume.sh (npm run render-resume). This pins the image to
// the PDF it came from, so replacing the resume without re-rendering fails
// CI instead of leaving last year's resume on the desk.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');

test('the desk resume image is rendered from the current resume PDF', () => {
  const pdf = fs.readFileSync(path.join(root, 'assets/documents/ianclaird_resume.pdf'));
  const recorded = fs
    .readFileSync(path.join(root, 'scripts/resume-render.sha256'), 'utf8')
    .trim();
  const actual = crypto.createHash('sha256').update(pdf).digest('hex');
  assert.equal(
    actual,
    recorded,
    'the resume PDF changed: run `npm run render-resume` and commit the image'
  );
  assert.ok(fs.existsSync(path.join(root, 'assets/documents/ianclaird_resume.jpg')));
});

test('room.js points at the rendered image and the PDF', () => {
  const src = fs.readFileSync(path.join(root, 'room.js'), 'utf8');
  assert.match(src, /assets\/documents\/ianclaird_resume\.jpg/);
  assert.match(src, /assets\/documents\/ianclaird_resume\.pdf/);
});
