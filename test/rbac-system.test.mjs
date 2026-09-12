// test/rbac-system.test.mjs
// Vollständiger Test aller RBAC System Komponenten

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhoneNumber,
  phoneToJid,
  jidToPhone,
  isValidPhoneNumber,
  formatPhoneNumber,
} from '../src/utils/phone.js';
import {
  extractLid,
  normalizeLid,
  isSamePhone,
} from '../src/utils/lid.js';

test('Phone Utility Tests', async (t) => {
  // ==================== normalizePhoneNumber ====================
  await t.test('normalizePhoneNumber - various formats', () => {
    // Standard format
    assert.equal(normalizePhoneNumber('49170123456'), '49170123456');

    // With +
    assert.equal(normalizePhoneNumber('+49170123456'), '49170123456');

    // With 00
    assert.equal(normalizePhoneNumber('0049170123456'), '49170123456');

    // German format (0170123456)
    assert.equal(normalizePhoneNumber('0170123456'), '170123456');

    // With spaces
    assert.equal(normalizePhoneNumber('+49 170 123456'), '49170123456');

    // With hyphens
    assert.equal(normalizePhoneNumber('49-170-123456'), '49170123456');

    // Invalid: too short
    assert.equal(normalizePhoneNumber('123'), null);

    // Invalid: too long
    assert.equal(normalizePhoneNumber('123456789012345678'), null);

    // Invalid: null/undefined
    assert.equal(normalizePhoneNumber(null), null);
    assert.equal(normalizePhoneNumber(undefined), null);
    assert.equal(normalizePhoneNumber(''), null);
  });

  // ==================== phoneToJid ====================
  await t.test('phoneToJid conversion', () => {
    assert.equal(
      phoneToJid('49170123456'),
      '49170123456@s.whatsapp.net'
    );

    assert.equal(
      phoneToJid('+49170123456'),
      '49170123456@s.whatsapp.net'
    );

    // Invalid phone
    assert.equal(phoneToJid('123'), null);
  });

  // ==================== jidToPhone ====================
  await t.test('jidToPhone extraction', () => {
    assert.equal(
      jidToPhone('49170123456@s.whatsapp.net'),
      '49170123456'
    );

    // Group JID
    assert.equal(
      jidToPhone('120363123456789-1234567890@g.us'),
      null
    );

    // Invalid
    assert.equal(jidToPhone(null), null);
    assert.equal(jidToPhone('invalid'), null);
  });

  // ==================== isValidPhoneNumber ====================
  await t.test('isValidPhoneNumber validation', () => {
    assert.ok(isValidPhoneNumber('49170123456'));
    assert.ok(isValidPhoneNumber('+49170123456'));
    assert.ok(!isValidPhoneNumber('123'));
    assert.ok(!isValidPhoneNumber(''));
  });

  // ==================== formatPhoneNumber ====================
  await t.test('formatPhoneNumber display', () => {
    const formatted = formatPhoneNumber('49170123456');
    assert.ok(formatted.includes('+49'));
    assert.ok(formatted.includes('170'));
  });
});

test('LID Utility Tests', async (t) => {
  // ==================== extractLid ====================
  await t.test('extractLid normalization', () => {
    const lid1 = extractLid('49170123456');
    const lid2 = extractLid('+49170123456');
    const lid3 = extractLid('0049170123456');

    // All should normalize to same value
    assert.equal(lid1, lid2);
    assert.equal(lid2, lid3);
    assert.ok(lid1);
  });

  // ==================== isSamePhone ====================
  await t.test('isSamePhone comparison', () => {
    // Same number, different formats
    assert.ok(
      isSamePhone('49170123456', '+49170123456')
    );

    assert.ok(
      isSamePhone('+49170123456', '0049170123456')
    );

    // Different numbers
    assert.ok(
      !isSamePhone('49170123456', '49170654321')
    );

    // Invalid
    assert.ok(!isSamePhone(null, '49170123456'));
    assert.ok(!isSamePhone('49170123456', null));
  });

  // ==================== normalizeLid ====================
  await t.test('normalizeLid idempotent', () => {
    const lid1 = normalizeLid('49170123456');
    const lid2 = normalizeLid(lid1);
    assert.equal(lid1, lid2);
  });
});

test('Security Chain Tests', async (t) => {
  // ==================== Spoofing Prevention ====================
  await t.test('LID prevents number spoofing', () => {
    // Same LID from different formats
    const formats = [
      '49170123456',
      '+49170123456',
      '0049170123456',
      '49 170 123456',
    ];

    const lids = formats.map(extractLid);
    const allSame = lids.every((lid) => lid === lids[0]);
    assert.ok(allSame, 'All formats should produce same LID');
  });

  // ==================== JID Normalization ====================
  await t.test('JID format consistency', () => {
    const jids = [
      phoneToJid('49170123456'),
      phoneToJid('+49170123456'),
      phoneToJid('0049170123456'),
    ];

    const allSame = jids.every((jid) => jid === jids[0]);
    assert.ok(allSame, 'All should produce same JID');

    // Verify format
    assert.ok(jids[0].endsWith('@s.whatsapp.net'));
  });
});

test('Edge Cases', async (t) => {
  // ==================== Special Characters ====================
  await t.test('handles special characters', () => {
    assert.ok(normalizePhoneNumber('49-170-123456'));
    assert.ok(normalizePhoneNumber('49.170.123456'));
    assert.ok(normalizePhoneNumber('49 170 123456'));
    assert.ok(normalizePhoneNumber('(49) 170-123456'));
  });

  // ==================== Boundary Cases ====================
  await t.test('boundary length cases', () => {
    // Min length (10 digits)
    assert.ok(normalizePhoneNumber('1234567890'));

    // Max length (15 digits)
    assert.ok(normalizePhoneNumber('123456789012345'));

    // Too short (9 digits)
    assert.equal(normalizePhoneNumber('123456789'), null);

    // Too long (16 digits)
    assert.equal(normalizePhoneNumber('1234567890123456'), null);
  });

  // ==================== Type Validation ====================
  await t.test('type safety', () => {
    // Should handle non-string inputs
    assert.equal(normalizePhoneNumber(12345), null);
    assert.equal(normalizePhoneNumber(true), null);
    assert.equal(normalizePhoneNumber({}), null);
    assert.equal(normalizePhoneNumber([]), null);
  });
});

test('Integration Scenarios', async (t) => {
  // ==================== Complete Flow ====================
  await t.test('complete user flow', () => {
    const userInput = '+49 170 123456';

    // 1. Normalize
    const normalized = normalizePhoneNumber(userInput);
    assert.ok(normalized);

    // 2. Create JID
    const jid = phoneToJid(userInput);
    assert.equal(jid, `${normalized}@s.whatsapp.net`);

    // 3. Extract LID
    const lid = extractLid(userInput);
    assert.ok(lid);

    // 4. Verify consistency
    const reversedPhone = jidToPhone(jid);
    assert.equal(reversedPhone, normalized);
  });

  // ==================== Whitelist Scenario ====================
  await t.test('whitelist comparison', () => {
    const storedNumber = '49170123456';
    const userInput = '+49 170 123456';

    // Even with different formats, should match
    const storedLid = extractLid(storedNumber);
    const inputLid = extractLid(userInput);

    assert.equal(storedLid, inputLid);

    // Or using direct comparison
    assert.ok(isSamePhone(storedNumber, userInput));
  });

  // ==================== Batch Processing ====================
  await t.test('batch normalization', () => {
    const numbers = [
      '49170123456',
      '+49170654321',
      '0049170111111',
      'invalid',
      null,
    ];

    const normalized = numbers
      .map(normalizePhoneNumber)
      .filter((n) => n !== null);

    assert.equal(normalized.length, 3);
    assert.ok(normalized.every((n) => typeof n === 'string'));
  });
});

test('Performance Tests', async (t) => {
  await t.test('normalization performance', () => {
    const iterations = 1000;
    const phone = '49170123456';

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      normalizePhoneNumber(phone);
    }
    const duration = performance.now() - start;

    // Should complete 1000 normalizations in < 10ms
    assert.ok(duration < 10, `Normalization took ${duration}ms`);
  });

  await t.test('LID extraction performance', () => {
    const iterations = 1000;
    const phone = '49170123456';

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      extractLid(phone);
    }
    const duration = performance.now() - start;

    assert.ok(duration < 10, `LID extraction took ${duration}ms`);
  });
});
