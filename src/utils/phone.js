// src/utils/phone.js
// Telefonnummern-Normalisierung und Validierung

import { extractLid } from './lid.js';

/**
 * Normalisiert eine Telefonnummer zu internationalem Format
 * @param {string} phone - Telefonnummer (verschiedene Formate möglich)
 * @returns {string|null} - Normalisierte Nummer ohne Ländercode-Präfix oder null
 */
export function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return null;

  // Entferne alle nicht-Ziffern außer +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Entferne führendes +
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  // Entferne führende 00 (deutsche Formatierung)
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }

  // Validiere Länge (min 10, max 15 Ziffern)
  if (cleaned.length < 10 || cleaned.length > 15) {
    return null;
  }

  // Validiere dass nur Ziffern enthalten sind
  if (!/^\d+$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

/**
 * Konvertiert Telefonnummer zu WhatsApp JID Format
 * @param {string} phone - Telefonnummer
 * @returns {string|null} - JID Format (z.B. "49170123456@s.whatsapp.net") oder null
 */
export function phoneToJid(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return null;
  return `${normalized}@s.whatsapp.net`;
}

/**
 * Extrahiert Telefonnummer aus JID
 * @param {string} jid - WhatsApp JID
 * @returns {string|null} - Telefonnummer oder null
 */
export function jidToPhone(jid) {
  if (!jid || typeof jid !== 'string') return null;
  const match = jid.match(/^(\d+)@/);
  return match ? match[1] : null;
}

/**
 * Prüft ob Telefonnummer valide ist
 * @param {string} phone - Telefonnummer
 * @returns {boolean}
 */
export function isValidPhoneNumber(phone) {
  return normalizePhoneNumber(phone) !== null;
}

/**
 * Formatiert Telefonnummer für Anzeige
 * @param {string} phone - Telefonnummer
 * @returns {string} - Formatierte Nummer (z.B. "+49 170 123456")
 */
export function formatPhoneNumber(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return phone;

  // Deutsche Nummer: +49 mit Gruppierung
  if (normalized.startsWith('49')) {
    const rest = normalized.substring(2);
    return `+49 ${rest.substring(0, 3)} ${rest.substring(3)}`;
  }

  // Andere: Einfach + vorne
  return `+${normalized}`;
}

/**
 * Extrahiert LID (Local ID) aus verschiedenen Quellen
 * @param {string} input - JID, Nummer oder Text
 * @returns {string|null} - LID oder null
 */
export function extractPhoneLid(input) {
  if (!input) return null;

  // Falls bereits JID-Format: Extrahiere Nummer
  if (input.includes('@')) {
    const phone = jidToPhone(input);
    return phone ? extractLid(phone) : null;
  }

  // Falls Telefonnummer: Extrahiere LID
  const normalized = normalizePhoneNumber(input);
  return normalized ? extractLid(normalized) : null;
}
