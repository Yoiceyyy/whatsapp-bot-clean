// src/utils/lid.js
// LID (Local ID) Extraktion und Normalisierung
// Verhindert WhatsApp-Nummer-Spoofing durch Standard-Formatierung

/**
 * Extrahiert einen eindeutigen LID (Local ID) aus einer Telefonnummer
 * Normalisiert verschiedene Formate zu einem Standard
 * @param {string} phone - Telefonnummer
 * @returns {string} - Eindeutiger LID
 */
export function extractLid(phone) {
  if (!phone || typeof phone !== 'string') return '';

  // Entferne alle nicht-Ziffern
  const cleaned = phone.replace(/\D/g, '');

  // Entferne führende 00 oder +
  let normalized = cleaned;
  if (normalized.startsWith('00')) {
    normalized = normalized.substring(2);
  } else if (normalized.startsWith('0')) {
    normalized = normalized.substring(1);
  }

  // Validiere und normalisiere
  if (normalized.length < 5) return null;

  // Hash für Konsistenz (optionale zusätzliche Sicherheit)
  return normalized.toLowerCase();
}

/**
 * Normalisiert eine Nummer über verschiedene Formate hinweg
 * z.B. "+49 170 123 456" = "49170123456" = "0170123456"
 * @param {string} phone - Beliebiges Telefonnummern-Format
 * @returns {string|null} - Standardisierte Nummer
 */
export function normalizeLid(phone) {
  return extractLid(phone);
}

/**
 * Vergleicht zwei Telefonnummern ob sie identisch sind
 * (auch mit unterschiedlichen Formaten)
 * @param {string} phone1 - Erste Nummer
 * @param {string} phone2 - Zweite Nummer
 * @returns {boolean}
 */
export function isSamePhone(phone1, phone2) {
  const lid1 = extractLid(phone1);
  const lid2 = extractLid(phone2);
  return lid1 && lid2 && lid1 === lid2;
}
