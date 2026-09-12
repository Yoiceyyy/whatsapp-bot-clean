// Moderation command security chain
// Replaces simple adminOnly check with comprehensive security validation
// Used by moderation commands (kick, ban, warn, etc.)

import { canExecuteModeration, logModerationAction } from './permissions-new.js';
import { isUserAdmin, senderJid } from './permissions.js';

/**
 * Enhanced context wrapper for moderation actions.
 * Adds security checks before allowing the action.
 */
export async function createModerationContext(msg, chatJid, isGroup, senderIds, sender, senderName, text, args) {
  // Base context from router.js
  const baseCtx = {
    msg,
    chatJid,
    isGroup,
    senderIds,
    sender,
    senderName,
    text,
    args,
    argText: args.join(' '),
  };

  /**
   * Executes a moderation action with full security checks.
   * Replaces manual adminOnly checks in individual commands.
   *
   * @param {string} action - Action name (kick, ban, warn, etc.)
   * @param {Function} executeAction - Async function to execute if allowed
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  baseCtx.executeModeration = async (action, executeAction) => {
    // Security Chain:
    // 1. Check if user is WhatsApp admin
    if (!isGroup) {
      return { success: false, error: 'Moderation only in groups' };
    }

    const isAdmin = await isUserAdmin(chatJid, senderIds);
    if (!isAdmin) {
      return { success: false, error: 'You must be a group admin' };
    }

    // 2. Check whitelist + suspension
    const security = await canExecuteModeration(chatJid, senderIds, action);
    if (!security.allowed) {
      return { success: false, error: security.reason };
    }

    // 3. Execute the action
    try {
      const target = baseCtx.targetUser?.();
      const result = await executeAction();

      // 4. Log to audit trail
      await logModerationAction(
        action,
        sender,
        target,
        chatJid,
        JSON.stringify({ args: args.join(' ') }).slice(0, 200)
      );

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  return baseCtx;
}

/**
 * Example usage in a moderation command:
 *
 * export default {
 *   name: 'kick',
 *   adminOnly: true,
 *   async run(ctx) {
 *     const target = ctx.targetUser();
 *     if (!target) return ctx.reply('Please specify a target.');
 *
 *     // Enhanced security check instead of just checking adminOnly
 *     const result = await ctx.executeModeration('kick', async () => {
 *       // Actual kick logic
 *       const meta = await ctx.groupMeta();
 *       await state.sock.groupParticipantsUpdate(ctx.chatJid, [target], 'remove');
 *     });
 *
 *     if (!result.success) {
 *       return ctx.reply(`❌ ${result.error}`);
 *     }
 *     ctx.reply(`✅ User kicked`);
 *   }
 * };
 */
