import 'dotenv/config';
import { Bot, InlineKeyboard, session } from 'grammy';

import { appendRow, readRows, updateRow } from './sheets.js';
import { isLeader, getLeaderName, reloadLeaders } from './leaders.js';
import {
  loadMembers,
  reloadMembers,
  searchMembers,
  getAllMembers,
  getMember,
  memberLabel,
} from './members.js';
import { toSGTIso, formatSGTDate, hoursSince } from './util/time.js';
import { e, mono } from './util/escape.js';
import { newUpdateId } from './util/id.js';

const EDIT_WINDOW_HOURS = 24;
const HISTORY_LIMIT = 20;
const RECENT_LIMIT = 20;
const RECENT_PAGE_SIZE = 5;
const UPDATE_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (!process.env.BOT_TOKEN) {
  throw new Error('BOT_TOKEN env var is not set.');
}

const bot = new Bot(process.env.BOT_TOKEN);

bot.use(session({ initial: () => ({}) }));

await Promise.all([loadMembers(), reloadLeaders()]);

// Fire-and-forget typing indicator before slow Sheets calls.
async function showTyping(ctx) {
  try { await ctx.replyWithChatAction('typing'); } catch {}
}

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

async function handleUnregisteredStart(ctx) {
  const tgId = ctx.from.id;
  const name = ctx.from.first_name || 'friend';
  const username = ctx.from.username ? `@${ctx.from.username}` : '(no username)';
  await ctx.reply(
    `Hey ${name}! 👋 Welcome to ZP Pastoral Bot.\n\n` +
      `This bot is for ZP leaders. You're not on the access list yet.\n\n` +
      `Your Telegram ID is: ${tgId}\n` +
      `Send that to Wilson and he'll get you set up! 😊`,
  );
  const adminId = process.env.ADMIN_TG_ID;
  if (adminId) {
    try {
      await ctx.api.sendMessage(
        adminId,
        `👋 New access request:\n${name} (${username})\nTelegram ID: ${tgId}`,
      );
    } catch (err) {
      console.warn('[start] Could not notify admin:', err.message);
    }
  }
}

bot.use(async (ctx, next) => {
  const tgId = ctx.from?.id;
  if (!tgId) return;
  if (await isLeader(tgId)) return next();

  const username = ctx.from.username ? `@${ctx.from.username}` : '(no username)';
  console.log(`[auth] rejected tg_id=${tgId} username=${username} name="${ctx.from.first_name ?? ''} ${ctx.from.last_name ?? ''}"`);

  if (ctx.message?.text?.split(' ')[0] === '/start') {
    await handleUnregisteredStart(ctx);
    return;
  }

  await ctx.reply(
    `Hey! 👋 This bot is just for ZP leaders right now.\n\n` +
      `Your Telegram ID is: ${tgId}\n` +
      `Send that to Wilson and he'll get you set up! 😊`,
  );
});

// ---------------------------------------------------------------------------
// /start, /help, /cancel
// ---------------------------------------------------------------------------

const HELP_TEXT =
  `*ZP Pastoral Bot* 🌿\n` +
  `_Your companion for keeping pastoral notes on ZP1 members\\._\n\n` +
  `/update — write a note about a member\n` +
  `/recent — your recent notes \\(tap to view, edit, or delete\\)\n` +
  `/history \\[name\\] — browse a member's notes\n` +
  `/cancel — back out of whatever you were doing\n` +
  `/help — show this message`;

bot.command('start', async (ctx) => {
  const name = (await getLeaderName(ctx.from.id)) || ctx.from.first_name || 'friend';
  await ctx.reply(`Hey ${name}! 👋 Good to see you here.`);
  await ctx.reply(HELP_TEXT, { parse_mode: 'MarkdownV2' });
});

bot.command('help', (ctx) => ctx.reply(HELP_TEXT, { parse_mode: 'MarkdownV2' }));

bot.command('cancel', (ctx) => {
  ctx.session.pending = null;
  return ctx.reply('No worries, cancelled! 🙂');
});

// ---------------------------------------------------------------------------
// /reload, /members — still work, not surfaced in the help menu
// ---------------------------------------------------------------------------

bot.command('reload', async (ctx) => {
  await showTyping(ctx);
  await Promise.all([reloadMembers(), reloadLeaders()]);
  await ctx.reply('All refreshed! ✨ Member and leader lists are up to date.');
});

bot.command('members', async (ctx) => {
  const all = getAllMembers();
  if (all.length === 0) return ctx.reply('No members loaded yet. Try /reload.');
  await showTyping(ctx);
  const { rows } = await readRows('_updates');
  const countById = {};
  for (const r of rows) {
    if (!r.deleted_at) countById[String(r.member_id)] = (countById[String(r.member_id)] ?? 0) + 1;
  }
  const lines = all
    .map((m) => {
      const count = countById[m.memberId] ?? 0;
      return `${e(memberLabel(m))}${count > 0 ? ` — ${count}` : ''}`;
    })
    .join('\n');
  await ctx.reply(`*Members* \\(${all.length}\\)\n\n${lines}`, { parse_mode: 'MarkdownV2' });
});

// ---------------------------------------------------------------------------
// /update — write a new pastoral note
// No args: paginated alphabetical list. With args: fuzzy search.
// ---------------------------------------------------------------------------

function buildUpdatePickerPage(allSorted, page) {
  const totalPages = Math.max(1, Math.ceil(allSorted.length / UPDATE_PAGE_SIZE));
  const pageIdx = Math.max(0, Math.min(page, totalPages - 1));
  const start = pageIdx * UPDATE_PAGE_SIZE;
  const slice = allSorted.slice(start, start + UPDATE_PAGE_SIZE);
  const rangeFrom = start + 1;
  const rangeTo = start + slice.length;

  let text = `Who are you writing about? 📋 \\(${rangeFrom}–${rangeTo} of ${allSorted.length}\\)\n\n`;
  slice.forEach((m, i) => { text += `/${i + 1} ${e(memberLabel(m))}\n`; });
  text += `\nReply /1–/${slice.length} to pick, /cancel to back out, or /update <name\\> to search by name\\.`;

  const kb = new InlineKeyboard();
  if (pageIdx > 0) kb.text('⬅️ Back', `update_page:${pageIdx - 1}`);
  if (pageIdx < totalPages - 1) kb.text('➡️ Next', `update_page:${pageIdx + 1}`);

  return { text, keyboard: kb, pageIdx, slice };
}

bot.command('update', async (ctx) => {
  const query = ctx.match?.trim();

  if (!query) {
    const all = getAllMembers();
    if (all.length === 0) {
      return ctx.reply(
        `Hmm, I don't have any members loaded yet 🤔\n\n` +
          `Make sure the Apps Script has been run to generate Member IDs in the spreadsheet, then try /reload.`,
      );
    }
    const allSorted = [...all].sort((a, b) => a.name.localeCompare(b.name));
    const { text, keyboard, slice, pageIdx } = buildUpdatePickerPage(allSorted, 0);
    ctx.session.pending = {
      kind: 'pick_member',
      candidates: slice,
      intent: 'update_note',
      allSorted,
      page: pageIdx,
    };
    return ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  }

  const matches = searchMembers(query, 8);
  if (matches.length === 0) {
    return ctx.reply(`Hmm, I couldn't find anyone called "${query}" 🤔 Try a slightly different spelling?`);
  }
  if (matches.length === 1) {
    const m = matches[0];
    ctx.session.pending = { kind: 'update_note', memberId: m.memberId };
    return ctx.reply(
      `Got it — writing a note for *${e(memberLabel(m))}* 📝\nGo ahead and type your note, or /cancel if you change your mind\\.`,
      { parse_mode: 'MarkdownV2' },
    );
  }
  let text = `Found a few — which one? 🙂\n\n`;
  matches.forEach((m, i) => { text += `/${i + 1} ${e(memberLabel(m))}\n`; });
  text += `\nReply /1–/${matches.length}, or /cancel\\.`;
  ctx.session.pending = { kind: 'pick_member', candidates: matches, intent: 'update_note' };
  return ctx.reply(text, { parse_mode: 'MarkdownV2' });
});

bot.callbackQuery(/^update_page:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pending = ctx.session.pending;
  if (!pending || pending.kind !== 'pick_member' || !pending.allSorted) {
    return ctx.reply('This list has expired — run /update to start over. 😊');
  }
  const page = parseInt(ctx.match[1], 10);
  const { text, keyboard, slice, pageIdx } = buildUpdatePickerPage(pending.allSorted, page);
  pending.candidates = slice;
  pending.page = pageIdx;
  try {
    await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  }
});

// ---------------------------------------------------------------------------
// /1, /2, /3 … — pick from a numbered list (member or update)
// ---------------------------------------------------------------------------

bot.hears(/^\/(\d+)(@\w+)?\s*$/, async (ctx) => {
  const num = parseInt(ctx.match[1], 10);
  const pending = ctx.session.pending;

  if (!pending || (pending.kind !== 'pick_member' && pending.kind !== 'pick_update')) {
    return ctx.reply(`Hmm, I'm not sure what to do with that 😅 Type /help to see what I can do.`);
  }

  if (pending.kind === 'pick_update') {
    const idx = num - 1;
    if (idx < 0 || idx >= pending.updates.length) {
      return ctx.reply(`I only have ${pending.updates.length} update${pending.updates.length === 1 ? '' : 's'} listed. Reply /1–/${pending.updates.length}, or /cancel. 😊`);
    }
    ctx.session.pending = null;
    return showUpdateDetail(ctx, pending.updates[idx]);
  }

  const idx = num - 1;
  if (idx < 0 || idx >= pending.candidates.length) {
    return ctx.reply(`I only have ${pending.candidates.length} option${pending.candidates.length === 1 ? '' : 's'} on this page. Reply /1–/${pending.candidates.length}, or /cancel. 😊`);
  }

  const m = pending.candidates[idx];
  ctx.session.pending = null;

  if (pending.intent === 'history') {
    return sendHistory(ctx, m.memberId);
  }

  ctx.session.pending = { kind: 'update_note', memberId: m.memberId };
  await ctx.reply(
    `Got it — writing a note for *${e(memberLabel(m))}* 📝\nGo ahead and type your note, or /cancel if you change your mind\\.`,
    { parse_mode: 'MarkdownV2' },
  );
});

async function showUpdateDetail(ctx, r) {
  const member = getMember(String(r.member_id));
  const memberName = member ? memberLabel(member) : String(r.member_id);
  const date = e(formatSGTDate(r.timestamp));
  const author = e(r.author_name || String(r.author_tg_id));
  const edited = r.edited_at ? ' _\\(edited\\)_' : '';
  const text = `*${e(memberName)}*\n${date} · ${author}${edited}\n\n${e(r.note)}`;
  const withinWindow = hoursSince(r.timestamp) < EDIT_WINDOW_HOURS;
  const opts = { parse_mode: 'MarkdownV2' };
  if (withinWindow && String(r.author_tg_id) === String(ctx.from.id)) {
    opts.reply_markup = new InlineKeyboard()
      .text('✏️ Edit', `start_edit:${r.update_id}`)
      .text('🗑 Delete', `ask_delete:${r.update_id}`);
  }
  return ctx.reply(text, opts);
}

// ---------------------------------------------------------------------------
// /history — browse updates for one member
// ---------------------------------------------------------------------------

bot.command('history', async (ctx) => {
  const query = ctx.match?.trim();

  if (!query) {
    await showTyping(ctx);
    const { rows } = await readRows('_updates');
    const latestByMember = new Map();
    for (const r of rows) {
      if (r.deleted_at) continue;
      const id = String(r.member_id);
      const ts = String(r.timestamp);
      if (!latestByMember.has(id) || ts > latestByMember.get(id)) {
        latestByMember.set(id, ts);
      }
    }
    const recent = [...latestByMember.entries()]
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, 10)
      .map(([id]) => getMember(id))
      .filter(Boolean);

    if (recent.length === 0) {
      return ctx.reply('No notes written yet\\. Use /update to write the first one\\! 🌱', { parse_mode: 'MarkdownV2' });
    }
    let text = `Recently updated — whose history? 📖\n\n`;
    recent.forEach((m, i) => { text += `/${i + 1} ${e(memberLabel(m))}\n`; });
    text += `\nPick /1–/${recent.length}, /cancel, or type /history <name\\> to search\\.`;
    ctx.session.pending = { kind: 'pick_member', candidates: recent, intent: 'history' };
    return ctx.reply(text, { parse_mode: 'MarkdownV2' });
  }

  const matches = searchMembers(query, 8);
  if (matches.length === 0) {
    return ctx.reply(`Hmm, I couldn't find anyone called "${query}" 🤔 Try a slightly different spelling?`);
  }
  if (matches.length === 1) {
    return sendHistory(ctx, matches[0].memberId);
  }
  const kb = new InlineKeyboard();
  for (const m of matches) {
    kb.text(memberLabel(m), `pick_history:${m.memberId}`).row();
  }
  await ctx.reply('Found a few — whose history would you like? 🙂', { reply_markup: kb });
});

bot.callbackQuery(/^pick_history:(.+)$/, async (ctx) => {
  const memberId = ctx.match[1];
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`Loading history…`);
  await sendHistory(ctx, memberId);
});

async function sendHistory(ctx, memberId) {
  const member = getMember(memberId);
  if (!member) return ctx.reply('Member not found. Try /reload.');
  await showTyping(ctx);
  const { rows } = await readRows('_updates');
  const filtered = rows
    .filter((r) => String(r.member_id) === memberId && !r.deleted_at)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, HISTORY_LIMIT);

  if (filtered.length === 0) {
    return ctx.reply(`No notes written for ${memberLabel(member)} yet. They're waiting for someone to care! 💛`);
  }

  let text = `*${e(memberLabel(member))}* — ${filtered.length} note${filtered.length === 1 ? '' : 's'} 📖\n\n`;
  filtered.forEach((r, i) => {
    const date = e(formatSGTDate(r.timestamp));
    const author = e(r.author_name || String(r.author_tg_id));
    const edited = r.edited_at ? ' _\\(edited\\)_' : '';
    const preview = e(String(r.note).slice(0, 40).replace(/\n/g, ' ') + (r.note.length > 40 ? '…' : ''));
    text += `/${i + 1} ${date} · ${author}${edited}\n_${preview}_\n\n`;
  });
  text += `Reply /1–/${filtered.length} to read, or /cancel\\.`;
  ctx.session.pending = { kind: 'pick_update', updates: filtered };
  await ctx.reply(text, { parse_mode: 'MarkdownV2' });
}

// ---------------------------------------------------------------------------
// /recent — your recent notes as individual messages with inline buttons
// ---------------------------------------------------------------------------

bot.command('recent', async (ctx) => {
  ctx.session.pending = null;
  const authorTgId = String(ctx.from.id);
  await showTyping(ctx);
  const { rows } = await readRows('_updates');
  const mine = rows
    .filter((r) => String(r.author_tg_id) === authorTgId && !r.deleted_at)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, RECENT_LIMIT);

  if (mine.length === 0) {
    return ctx.reply(`You haven't written any notes yet — go love on someone! 💛`);
  }

  await ctx.reply(`Here are your recent notes! 📋 (${mine.length} total)`);
  await sendRecentPage(ctx, mine, 0);
});

async function sendRecentPage(ctx, mine, offset) {
  const page = mine.slice(offset, offset + RECENT_PAGE_SIZE);
  for (const r of page) {
    await sendRecentEntry(ctx, r);
  }
  const nextOffset = offset + RECENT_PAGE_SIZE;
  if (nextOffset < mine.length) {
    const remaining = mine.length - nextOffset;
    const batch = Math.min(RECENT_PAGE_SIZE, remaining);
    ctx.session.recentList = mine;
    const kb = new InlineKeyboard().text(`⬇️ Show ${batch} more`, `recent_more:${nextOffset}`);
    await ctx.reply(`Showing ${page.length} of ${mine.length} — ${remaining} more below.`, { reply_markup: kb });
  } else {
    ctx.session.recentList = null;
  }
}

async function sendRecentEntry(ctx, r) {
  const member = getMember(String(r.member_id));
  const memberName = e(member ? memberLabel(member) : String(r.member_id));
  const date = e(formatSGTDate(r.timestamp));
  const edited = r.edited_at ? ' _\\(edited\\)_' : '';
  const preview = e(String(r.note).slice(0, 100).replace(/\n/g, ' ') + (r.note.length > 100 ? '…' : ''));
  const text = `📝 *${memberName}* · ${date}${edited}\n_${preview}_`;

  const kb = new InlineKeyboard().text('👁 View full', `view_update:${r.update_id}`);
  const withinWindow = hoursSince(r.timestamp) < EDIT_WINDOW_HOURS;
  if (withinWindow) {
    kb.text('✏️ Edit', `start_edit:${r.update_id}`).text('🗑 Delete', `ask_delete:${r.update_id}`);
  }

  await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: kb });
}

bot.callbackQuery(/^view_update:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const updateId = ctx.match[1];
  await showTyping(ctx);
  const row = await findUpdateRow(updateId);
  if (!row || row.deleted_at) {
    return ctx.reply(`Hmm, I couldn't find that note — it may have been deleted.`);
  }
  const member = getMember(String(row.member_id));
  const memberName = member ? memberLabel(member) : String(row.member_id);
  const date = e(formatSGTDate(row.timestamp));
  const edited = row.edited_at ? ' _\\(edited\\)_' : '';
  const text = `*${e(memberName)}*\n${date}${edited}\n\n${e(row.note)}`;

  const kb = new InlineKeyboard();
  const withinWindow = hoursSince(row.timestamp) < EDIT_WINDOW_HOURS;
  if (withinWindow && String(row.author_tg_id) === String(ctx.from.id)) {
    kb.text('✏️ Edit', `start_edit:${row.update_id}`).text('🗑 Delete', `ask_delete:${row.update_id}`);
  }
  try {
    await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: kb });
  }
});

bot.callbackQuery(/^recent_more:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const offset = parseInt(ctx.match[1], 10);
  const mine = ctx.session.recentList;
  if (!mine) {
    return ctx.reply(`This list has expired — run /recent to see your notes again. 😊`);
  }
  try { await ctx.deleteMessage(); } catch {}
  await sendRecentPage(ctx, mine, offset);
});

// ---------------------------------------------------------------------------
// Edit / Delete — via inline buttons only
// ---------------------------------------------------------------------------

bot.callbackQuery(/^start_edit:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  return startEdit(ctx, ctx.match[1]);
});

async function startEdit(ctx, updateId) {
  await showTyping(ctx);
  const row = await findUpdateRow(updateId);
  const gate = checkEditGate(ctx, row);
  if (gate) return ctx.reply(gate);
  ctx.session.pending = { kind: 'edit_note', updateId };
  await ctx.reply(
    `Sure thing ✏️ Editing ${mono(updateId)}\\.\nSend the updated note, or /cancel to leave it as\\-is\\.`,
    { parse_mode: 'MarkdownV2' },
  );
}

bot.callbackQuery(/^ask_delete:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  return askDelete(ctx, ctx.match[1]);
});

async function askDelete(ctx, updateId) {
  await showTyping(ctx);
  const row = await findUpdateRow(updateId);
  const gate = checkEditGate(ctx, row);
  if (gate) return ctx.reply(gate);
  const kb = new InlineKeyboard()
    .text('Yes, delete', `confirm_delete:${updateId}`)
    .text('Cancel', `cancel_delete:${updateId}`);
  await ctx.reply(`Remove update ${mono(updateId)}? 🗑\nThis is a soft\\-delete — Wilson can recover it from the sheet if needed\\.`, {
    parse_mode: 'MarkdownV2',
    reply_markup: kb,
  });
}

bot.callbackQuery(/^cancel_delete:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery('No worries!');
  await ctx.editMessageText('No worries, cancelled! 🙂');
});

bot.callbackQuery(/^confirm_delete:(.+)$/, async (ctx) => {
  const updateId = ctx.match[1];
  await ctx.answerCallbackQuery();
  await showTyping(ctx);
  const row = await findUpdateRow(updateId);
  const gate = checkEditGate(ctx, row);
  if (gate) return ctx.editMessageText(gate);
  await updateRow('_updates', row._rowIndex, { deleted_at: toSGTIso() });
  await ctx.editMessageText(`Done — that note has been removed. 🗑\nWilson can recover it from the sheet if needed.`);
});

// ---------------------------------------------------------------------------
// Text message handler — completes pending /update or /edit flows
// ---------------------------------------------------------------------------

bot.on('message:text', async (ctx) => {
  const pending = ctx.session.pending;
  if (!pending) {
    return ctx.reply(`Hmm, I'm not sure what to do with that 😅 Type /help to see what I can do.`);
  }

  if (pending.kind === 'pick_member' || pending.kind === 'pick_update') {
    return ctx.reply(`Use /1, /2 etc. to pick from the list, or /cancel to back out. 😊`);
  }

  ctx.session.pending = null;
  const note = ctx.message.text.trim();
  if (!note) return ctx.reply(`Looks like that was empty — nothing saved. Try again? 😊`);

  if (pending.kind === 'update_note') {
    const member = getMember(pending.memberId);
    if (!member) return ctx.reply(`Hmm, that member no longer exists in the list. Cancelled 😕`);
    await showTyping(ctx);
    const updateId = newUpdateId();
    await appendRow('_updates', {
      update_id: updateId,
      timestamp: toSGTIso(),
      member_id: pending.memberId,
      author_tg_id: String(ctx.from.id),
      author_name: (await getLeaderName(ctx.from.id)) || ctx.from.first_name || '',
      note,
      edited_at: '',
      deleted_at: '',
    });
    const kb = new InlineKeyboard()
      .text('✏️ Edit', `start_edit:${updateId}`)
      .text('🗑 Delete', `ask_delete:${updateId}`);
    return ctx.reply(
      `Saved\\! 🙌 Your note for *${e(memberLabel(member))}* is in\\.`,
      { parse_mode: 'MarkdownV2', reply_markup: kb },
    );
  }

  if (pending.kind === 'edit_note') {
    await showTyping(ctx);
    const row = await findUpdateRow(pending.updateId);
    const gate = checkEditGate(ctx, row);
    if (gate) return ctx.reply(gate);
    await updateRow('_updates', row._rowIndex, {
      note,
      edited_at: toSGTIso(),
    });
    return ctx.reply(`Done\\! Your note has been updated\\. ✏️`, { parse_mode: 'MarkdownV2' });
  }
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function findUpdateRow(updateId) {
  const { rows } = await readRows('_updates');
  return rows.find((r) => String(r.update_id) === updateId) ?? null;
}

function checkEditGate(ctx, row) {
  if (!row) return `I couldn't find that note — it may have already been removed.`;
  if (row.deleted_at) return `That note has already been deleted. 🗑`;
  if (String(row.author_tg_id) !== String(ctx.from.id)) {
    return `You can only edit or delete notes you wrote yourself. 😊`;
  }
  if (hoursSince(row.timestamp) >= EDIT_WINDOW_HOURS) {
    return `The ${EDIT_WINDOW_HOURS}h edit window has passed. Just write a new note instead! 😊`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

bot.catch((err) => {
  console.error('[bot error]', err);
});

console.log('Pastoral bot starting…');
await bot.start();
