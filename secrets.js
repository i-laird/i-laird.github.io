// The easter-egg puzzle — the two XOR-encrypted segments, their key hashes,
// the four key fragments scattered through the filesystem, and the `decrypt`
// handler that validates a guess.
//
// WHY THIS IS ITS OWN FILE
// -----------------------
// This is the only genuinely secret code on the site: everything else is a
// spoiler at worst, but plaintext ciphers/fragments let anyone skip the whole
// hunt (or paste the lot into an LLM). It used to sit inline in app.js, which
// meant the ENTIRE 4,600-line bundle had to take the obfuscator's heavy config
// to hide these ~60 lines — control-flow flattening + dead-code injection +
// split strings cost ~156 KB gzipped on the one script every visitor
// downloads. Splitting the secret out lets scripts/build.js obfuscate THIS unit
// heavily and the rest of the bundle cheaply. See the topology comment there.
//
// Note the two halves of that protection, which is why the FRAGMENTS live here
// and not just the ciphers: the light config still mangles every identifier,
// but it leaves string literals alone. Identifiers are safe either way; the
// *data* is only hidden by the heavy config's string array.
//
// It is NOT lazily fetched — it ships in the page-load bundle like lib/*.js,
// because `ls`/`cat`/`neofetch` need the fragments synchronously mid-hunt.
// It is a separate OBFUSCATION unit, not a separate download.
//
// Loaded as a CLASSIC script, it exposes one global, initSecrets(api), which
// returns { frag, lastEggFile, handleDecrypt }. Because it is obfuscated
// separately from app.js, it must reference NOTHING from app.js or lib/ by free
// global name — every dependency arrives through the explicit `api` bridge
// (app.js's secretsBridge()), exactly like the lazy chunks. That is enforced
// statically by test/secrets-isolation.test.js. The contract is the initSecrets
// name plus the api key names (both on the obfuscator's reserved list).

function initSecrets(api) {
  // Dependency bridge from app.js (see secretsBridge() there). The codec
  // helpers are lib/ globals in the clean source, but they land in the OTHER
  // obfuscation unit and get renamed there, so they must cross by bridge.
  // `endingSeen` is read as api.endingSeen so we always see the live value.
  const { line, blank, esc, djb2, xorDecode, hexRows } = api;

  /* Two XOR-encrypted segments. Segment 1's key is the four fragments below,
     in order — scattered across hal9000.core [1/4], neofetch [2/4],
     a_letter_from_sans.txt [3/4] and .secrets [4/4]. Segment 2's key is those
     four plus a fifth fragment [5/5] that is NOT on the site: it arrives in
     the Proton Sieve auto-reply to the email segment 1 asks for. Only hashes
     are stored — no plaintext of either key or either message. */
  const EGG_CIPHER = '17242737797b515e11292f6c5c5d515928613e3a2d5a1044592d613850445c5564323d322b56454345';
  const EGG_KEY_HASH = 4147063596;
  const EGG2_CIPHER = '07091b1a0a66107962680a057777101d6412263721202d732d5a551046273328';
  const EGG2_KEY_HASH = 67679802;

  // The four on-site key fragments, indexed 1..4 to match their [n/4] labels.
  // app.js interpolates these into the filesystem + neofetch output via frag(),
  // so the literals never appear in the lightly-obfuscated unit.
  const FRAGMENTS = ['DAIS', 'Y200', '1HAL', '9000'];
  function frag(n) { return FRAGMENTS[n - 1]; }

  // the_last_egg.txt — dropped into the home directory once the finale has run.
  function lastEggFile() {
    return { cls: 'bold', f: [
      '-- ENCRYPTED // XOR-16 // segment 1 of 2 --',
      ...hexRows(EGG_CIPHER),
      '',
      '-- key: 16 chars. four fragments, [1/4] through [4/4]. --',
      '-- scattered: a core dump, a system readout, a letter, a secret. --',
      '-- assemble in order, then:  decrypt <key> --',
      '',
      '-- ENCRYPTED // XOR-20 // segment 2 of 2 --',
      ...hexRows(EGG2_CIPHER),
      '',
      '-- key: the first sixteen, plus a fifth fragment [5/5]. --',
      '-- the fifth is not on this site. do what segment 1 says, --',
      '-- and it will find you. --',
    ] };
  }

  function handleDecrypt(arg) {
    blank();
    if (!api.endingSeen) {
      line('decrypt: nothing here is encrypted. yet.', 'dim');
      blank();
      return;
    }
    const key = (arg || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (!key) {
      line('usage: decrypt &lt;key&gt;', 'err');
      line('  segment 1: 16 characters — four fragments of four, in order.', 'dim');
      line('  segment 2: those sixteen plus the fifth fragment.', 'dim');
      blank();
      return;
    }
    if (djb2(key) === EGG2_KEY_HASH) {
      line('✓ key accepted — final segment decrypting...', 'dim');
      blank();
      line(`<span class="bold">${esc(xorDecode(EGG2_CIPHER, key))}</span>`);
      blank();
      line('that is everything. truly. thank you for playing. — ian', 'dim');
      blank();
      return;
    }
    if (djb2(key) === EGG_KEY_HASH) {
      line('✓ key accepted — segment 1 of 2 decrypting...', 'dim');
      blank();
      line(`<span class="bold">${esc(xorDecode(EGG_CIPHER, key))}</span>`);
      blank();
      line('see you in the inbox. — ian', 'dim');
      line('segment 2 remains. the fifth fragment arrives by reply.', 'dim');
      blank();
      return;
    }
    line('✗ integrity check failed — that is not the key.', 'err');
    blank();
  }

  return { frag, lastEggFile, handleDecrypt };
}

// Survives the build's IIFE wrap — app.js looks this up by name.
window.initSecrets = initSecrets;
