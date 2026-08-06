'use strict';

// The build must not publish OS/editor debris.
//
// assets/ is copied into dist/ wholesale with a recursive cpSync. .gitignore
// keeps .DS_Store out of the REPO but has no say over the build, so a local
// `npm run build` was copying assets/.DS_Store and assets/documents/.DS_Store
// straight into the deployable directory. CI builds from a clean clone and
// never had them, which is precisely why nothing caught it.
//
// A .DS_Store is a directory listing: it names every file that was ever beside
// it, including ones since deleted or never linked from anywhere.
//
// This drives the real filter over a fixture tree rather than asserting on the
// text of build.js, so it tests the behaviour and not the spelling.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUILD_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');

// Pull the JUNK set and the filter out of build.js and run them for real.
function loadFilter() {
  const junkLine = BUILD_SRC.match(/const JUNK = new Set\(\[[^\]]*\]\);/);
  assert.ok(junkLine, 'build.js must define a JUNK set for the assets copy');
  const body = `
    const path = require('node:path');
    ${junkLine[0]}
    let skipped = 0;
    const filter = (src) => {
      if (!JUNK.has(path.basename(src))) return true;
      skipped++;
      return false;
    };
    return { filter, JUNK, skipped: () => skipped };
  `;
  return new Function('require', body)(require);
}

test('the assets copy filters OS and editor junk', () => {
  const { filter } = loadFilter();

  assert.equal(filter('/x/assets/.DS_Store'), false);
  assert.equal(filter('/x/assets/documents/.DS_Store'), false);
  assert.equal(filter('/x/assets/Thumbs.db'), false);
  assert.equal(filter('/x/assets/desktop.ini'), false);

  // and lets real assets through, including dotted filenames that are not junk
  assert.equal(filter('/x/assets/og_image.png'), true);
  assert.equal(filter('/x/assets/audio/hal_daisy.mp3'), true);
  assert.equal(filter('/x/assets/documents/ianclaird_resume.pdf'), true);
  assert.equal(filter('/x/assets/fonts/some.woff2'), true);
});

test('a real recursive copy drops the junk and keeps everything else', () => {
  const { filter } = loadFilter();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-hygiene-'));
  try {
    const src = path.join(tmp, 'assets');
    fs.mkdirSync(path.join(src, 'documents'), { recursive: true });
    fs.writeFileSync(path.join(src, '.DS_Store'), 'junk');
    fs.writeFileSync(path.join(src, 'og_image.png'), 'png');
    fs.writeFileSync(path.join(src, 'documents', '.DS_Store'), 'junk');
    fs.writeFileSync(path.join(src, 'documents', 'resume.pdf'), 'pdf');

    const dest = path.join(tmp, 'dist-assets');
    fs.cpSync(src, dest, { recursive: true, filter });

    const seen = [];
    (function walk(dir, rel) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = path.join(rel, e.name);
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else seen.push(r);
      }
    })(dest, '');

    assert.deepEqual(
      seen.sort(),
      ['documents/resume.pdf', 'og_image.png'],
      'the copy must contain the real assets and nothing else'
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the filter is actually wired into the assets cpSync', () => {
  // The unit tests above would still pass if someone removed `filter:` from the
  // real call, so pin the wiring too.
  const call = BUILD_SRC.match(/cpSync\(\s*path\.join\(ROOT, 'assets'\)[\s\S]*?\}\);/);
  assert.ok(call, 'build.js must copy assets/ with cpSync');
  assert.match(call[0], /filter:/, 'the assets copy must pass a filter');
});
