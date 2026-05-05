import 'dotenv/config';
import { Bot, InlineKeyboard, session } from 'grammy';

import {
  insertUpdate, getUpdate, patchUpdate, softDeleteUpdate,
  getUpdatesByMember, getRecentUpdatesByAuthor,
  countUpdatesByMember,
} from './shared/supabase.js';
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
const RECENT_LIMIT = 20;
const RECENT_PAGE_SIZE = 5;
const PICKER_PAGE_SIZE = 20;
const TIMELINE_PAGE_SIZE = 5;
const NOTES_LIMIT = 30;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (!process.env.BOT_TOKEN) {
  throw new Error('BOT_TOKEN env var is not set.');
}

const bot = new Bot(process.env.BOT_TOKEN);

bot.use(session({ initial: () => ({}) }));

await Promise.all([loadMembers(), reloadLeaders()]);

async function showTyping(ctx) {
  try { await ctx.replyWithChatAction('typing'); } catch {}
}

const TITLE_MAX_CHARS = 100;

function normalizeTitle(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  return t.length > TITLE_MAX_CHARS ? t.slice(0, TITLE_MAX_CHARS) : t;
}

function renderNoteTitleLine(title) {
  return title ? `*${e(title)}*\n\n` : '';
}

// Display date: prefer occurred_at over created_at.
function entryDate(r) {
  return r.occurred_at ?? r.created_at;
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
  `/notes \\[name\\] — browse a member's notes\n` +
  `/recent — your recent notes \\(tap to view, edit, or delete\\)\n` +
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

bot.command('skip', async (ctx) => {
  const pending = ctx.session.pending;
  if (!pending) return ctx.reply('Nothing to skip right now. 😊');

  if (pending.kind === 'update_title_input') {
    const member = getMember(pending.memberId);
    if (!member) {
      ctx.session.pending = null;
      return ctx.reply(`Hmm, that member no longer exists. Cancelled 😕`);
    }
    await saveNewUpdate(ctx, pending.memberId, pending.body, '');
    return;
  }

  if (pending.kind === 'edit_title_only') {
    ctx.session.pending = null;
    return ctx.reply('No changes made. 😊');
  }

  if (pending.kind === 'edit_body_only') {
    ctx.session.pending = null;
    return ctx.reply('No changes made. 😊');
  }

  if (pending.kind === 'edit_date') {
    ctx.session.pending = null;
    return ctx.reply('Date unchanged. 😊');
  }

  return ctx.reply('Nothing to skip right now. 😊');
});

// ---------------------------------------------------------------------------
// /reload, /members
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
  const countById = await countUpdatesByMember();
  const lines = all
    .map((m) => {
      const count = countById[m.memberId] ?? 0;
      return `${e(memberLabel(m))}${count > 0 ? ` — ${count}` : ''}`;
    })
    .join('\n');
  await ctx.reply(`*Members* \\(${all.length}\\)\n\n${lines}`, { parse_mode: 'MarkdownV2' });
});

// ---------------------------------------------------------------------------
// Shared picker — paginated alphabetical member list (/update + /notes)
// ---------------------------------------------------------------------------

function buildPickerPage(allSorted, page, promptText) {
  const totalPages = Math.max(1, Math.ceil(allSorted.length / PICKER_PAGE_SIZE));
  const pageIdx = Math.max(0, Math.min(page, totalPages - 1));
  const start = pageIdx * PICKER_PAGE_SIZE;
  const slice = allSorted.slice(start, start + PICKER_PAGE_SIZE);
  const rangeFrom = start + 1;
  const rangeTo = start + slice.length;

  let text = `${promptText} \\(${rangeFrom}–${rangeTo} of ${allSorted.length}\\)\n\n`;
  slice.forEach((m, i) => { text += `/${i + 1} ${e(memberLabel(m))}\n`; });
  text += `\nReply /1–/${slice.length} to pick, or /cancel\\.`;

  const kb = new InlineKeyboard();
  if (pageIdx > 0) kb.text('⬅️ Back', `picker_page:${pageIdx - 1}`);
  if (pageIdx < totalPages - 1) kb.text('➡️ Next', `picker_page:${pageIdx + 1}`);

  return { text, keyboard: kb, pageIdx, slice };
}

// ---------------------------------------------------------------------------
// /update — write a new pastoral note (content first, then optional title)
// ---------------------------------------------------------------------------

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
    const { text, keyboard, slice, pageIdx } = buildPickerPage(allSorted, 0, `Who are you writing about? 📋`);
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
    return startUpdateBody(ctx, m.memberId);
  }
  let text = `Found a few — which one? 🙂\n\n`;
  matches.forEach((m, i) => { text += `/${i + 1} ${e(memberLabel(m))}\n`; });
  text += `\nReply /1–/${matches.length}, or /cancel\\.`;
  ctx.session.pending = { kind: 'pick_member', candidates: matches, intent: 'update_note' };
  return ctx.reply(text, { parse_mode: 'MarkdownV2' });
});

async function startUpdateBody(ctx, memberId) {
  const m = getMember(memberId);
  if (!m) return ctx.reply(`Hmm, that member no longer exists. Cancelled 😕`);
  ctx.session.pending = { kind: 'update_body', memberId };
  return ctx.reply(
    `Writing a note for *${e(memberLabel(m))}* 📝\nSend the note content, or /cancel\\.`,
    { parse_mode: 'MarkdownV2' },
  );
}

bot.callbackQuery(/^picker_page:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pending = ctx.session.pending;
  if (!pending || pending.kind !== 'pick_member' || !pending.allSorted) {
    return ctx.reply('This list has expired — run /update or /notes to start over. 😊');
  }
  const page = parseInt(ctx.match[1], 10);
  const promptText = pending.intent === 'notes_history'
    ? `Whose notes would you like? 📖`
    : `Who are you writing about? 📋`;
  const { text, keyboard, slice, pageIdx } = buildPickerPage(pending.allSorted, page, promptText);
  pending.candidates = slice;
  pending.page = pageIdx;
  try {
    await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  }
});

// After content typed, show inline title prompt.
bot.callbackQuery('add_title', async (ctx) => {
  await ctx.answerCallbackQuery();
  const pending = ctx.session.pending;
  if (!pending || pending.kind !== 'update_asking_title') {
    return ctx.reply('Nothing to add a title to right now. 😊');
  }
  const m = getMember(pending.memberId);
  ctx.session.pending = { kind: 'update_title_input', memberId: pending.memberId, body: pending.body };
  await ctx.reply(
    `What's the title? \\(short summary\\)\n\nOr /skip to save without one\\.`,
    { parse_mode: 'MarkdownV2' },
  );
});

bot.callbackQuery('skip_title', async (ctx) => {
  await ctx.answerCallbackQuery();
  const pending = ctx.session.pending;
  if (!pending || pending.kind !== 'update_asking_title') {
    return ctx.reply('Nothing to skip right now. 😊');
  }
  await saveNewUpdate(ctx, pending.memberId, pending.body, '');
});

async function saveNewUpdate(ctx, memberId, body, title) {
  const member = getMember(memberId);
  if (!member) {
    ctx.session.pending = null;
    return ctx.reply(`Hmm, that member no longer exists. Cancelled 😕`);
  }
  ctx.session.pending = null;
  await showTyping(ctx);
  const updateId = newUpdateId();
  await insertUpdate({
    id: updateId,
    member_id: memberId,
    author_tg_id: ctx.from.id,
    author_name: (await getLeaderName(ctx.from.id)) || ctx.from.first_name || '',
    title: title || null,
    note: body,
  });
  const kb = new InlineKeyboard()
    .text('✏️ Title', `edit_title:${updateId}`)
    .text('📝 Note', `edit_body:${updateId}`)
    .row()
    .text('📅 Date', `edit_date:${updateId}`)
    .text('🗑 Delete', `ask_delete:${updateId}`);
  const titlePart = title ? ` \\(*${e(title)}*\\)` : '';
  return ctx.reply(
    `Saved\\! 🙌 Your note for *${e(memberLabel(member))}*${titlePart} is in\\.`,
    { parse_mode: 'MarkdownV2', reply_markup: kb },
  );
}

// ---------------------------------------------------------------------------
// /1, /2, /3 … — pick from a numbered list (member only)
// ---------------------------------------------------------------------------

bot.hears(/^\/(\d+)(@\w+)?\s*$/, async (ctx) => {
  const num = parseInt(ctx.match[1], 10);
  const pending = ctx.session.pending;

  if (!pending || pending.kind !== 'pick_member') {
    return ctx.reply(`Hmm, I'm not sure what to do with that 😅 Type /help to see what I can do.`);
  }

  const idx = num - 1;
  if (idx < 0 || idx >= pending.candidates.length) {
    return ctx.reply(`I only have ${pending.candidates.length} option${pending.candidates.length === 1 ? '' : 's'} on this page. Reply /1–/${pending.candidates.length}, or /cancel. 😊`);
  }

  const m = pending.candidates[idx];
  ctx.session.pending = null;

  if (pending.intent === 'notes_history') {
    return sendMemberTimeline(ctx, m.memberId);
  }

  return startUpdateBody(ctx, m.memberId);
});


// ---------------------------------------------------------------------------
// /notes — browse a member's timeline (replaces /history)
// /history is kept as a silent alias for muscle memory.
// ---------------------------------------------------------------------------

async function handleNotesCommand(ctx) {
  const query = ctx.match?.trim();

  if (!query) {
    const all = getAllMembers();
    if (all.length === 0) {
      return ctx.reply(`No members loaded yet\\. Try /reload\\. 😊`, { parse_mode: 'MarkdownV2' });
    }
    const allSorted = [...all].sort((a, b) => a.name.localeCompare(b.name));
    const { text, keyboard, slice, pageIdx } = buildPickerPage(allSorted, 0, `Whose notes would you like? 📖`);
    ctx.session.pending = {
      kind: 'pick_member',
      candidates: slice,
      intent: 'notes_history',
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
    return sendMemberTimeline(ctx, matches[0].memberId);
  }
  const kb = new InlineKeyboard();
  for (const m of matches) {
    kb.text(memberLabel(m), `pick_notes:${m.memberId}`).row();
  }
  await ctx.reply('Found a few — whose notes would you like? 🙂', { reply_markup: kb });
}

bot.command('notes', handleNotesCommand);
bot.command('history', handleNotesCommand);

bot.callbackQuery(/^pick_notes:(.+)$/, async (ctx) => {
  const memberId = ctx.match[1];
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`Loading…`);
  await sendMemberTimeline(ctx, memberId);
});

// ---------------------------------------------------------------------------
// Member timeline — inline-button paginated view (notes only in Phase A)
// ---------------------------------------------------------------------------

async function sendMemberTimeline(ctx, memberId) {
  const member = getMember(memberId);
  if (!member) return ctx.reply('Member not found. Try /reload.');
  await showTyping(ctx);
  const rows = await getUpdatesByMember(memberId, NOTES_LIMIT);

  if (rows.length === 0) {
    return ctx.reply(`No notes written for ${e(memberLabel(member))} yet\\. They're waiting for someone to care\\! 💛`, { parse_mode: 'MarkdownV2' });
  }

  const items = rows.map((r) => ({ kind: 'note', ...r }));
  ctx.session.memberTimeline = items;
  ctx.session.memberTimelineMemberId = memberId;

  const { text, keyboard } = renderTimelineList(items, 0, member);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
}

function renderTimelineList(items, offset, memberHint) {
  const page = items.slice(offset, offset + TIMELINE_PAGE_SIZE);
  const rangeFrom = offset + 1;
  const rangeTo = offset + page.length;

  const header = memberHint
    ? `*${e(memberLabel(memberHint))}* — ${items.length} note${items.length === 1 ? '' : 's'} 📖`
    : `*Notes* 📖`;

  let text = `${header} \\(${rangeFrom}–${rangeTo}\\)\n\n`;
  page.forEach((r, i) => {
    const date = e(formatSGTDate(entryDate(r)));
    const author = e(r.author_name || String(r.author_tg_id));
    const edited = r.edited_at ? ' _\\(edited\\)_' : '';
    const titleLine = r.title ? `*${e(r.title)}*\n` : '';
    const preview = e(String(r.note).slice(0, 60).replace(/\n/g, ' ') + (r.note.length > 60 ? '…' : ''));
    text += `*${i + 1}\\.* 📝 ${date} · ${author}${edited}\n${titleLine}_${preview}_\n\n`;
  });
  text += `Tap a number to open\\.`;

  const kb = new InlineKeyboard();
  page.forEach((_, i) => { kb.text(String(i + 1), `tl_open:${offset + i}`); });
  kb.row();
  if (offset > 0) kb.text('⬅️ Prev', `tl_list:${Math.max(0, offset - TIMELINE_PAGE_SIZE)}`);
  if (offset + TIMELINE_PAGE_SIZE < items.length) {
    kb.text('➡️ Next', `tl_list:${offset + TIMELINE_PAGE_SIZE}`);
  }

  return { text, keyboard: kb };
}

function renderTimelineDetail(items, absIdx, ctx, backOffset) {
  const r = items[absIdx];
  if (!r) return null;
  const member = getMember(String(r.member_id));
  const memberName = member ? memberLabel(member) : String(r.member_id);
  const date = e(formatSGTDate(entryDate(r)));
  const author = e(r.author_name || String(r.author_tg_id));
  const edited = r.edited_at ? ' _\\(edited\\)_' : '';
  const noteText = String(r.note).slice(0, 3500);
  const truncated = r.note.length > 3500 ? '\n\n_\\[truncated\\]_' : '';
  const titleLine = renderNoteTitleLine(r.title);
  const text = `*${e(memberName)}*\n${date} · ${author}${edited}\n\n${titleLine}${e(noteText)}${truncated}`;

  const kb = new InlineKeyboard().text('🔙 Back', `tl_list:${backOffset}`);
  const withinWindow = hoursSince(r.created_at) < EDIT_WINDOW_HOURS;
  if (withinWindow && String(r.author_tg_id) === String(ctx.from.id)) {
    kb.text('✏️ Title', `edit_title:${r.id}`)
      .text('📝 Note', `edit_body:${r.id}`)
      .row()
      .text('📅 Date', `edit_date:${r.id}`)
      .text('🗑 Delete', `ask_delete:${r.id}`);
  }

  return { text, keyboard: kb };
}

bot.callbackQuery(/^tl_list:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const offset = parseInt(ctx.match[1], 10);
  const items = ctx.session.memberTimeline;
  if (!items) {
    return ctx.editMessageText(`This list has expired — run /notes to reload. 😊`);
  }
  const memberId = ctx.session.memberTimelineMemberId;
  const member = memberId ? getMember(memberId) : null;
  const { text, keyboard } = renderTimelineList(items, offset, member);
  try {
    await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  }
});

bot.callbackQuery(/^tl_open:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const absIdx = parseInt(ctx.match[1], 10);
  const items = ctx.session.memberTimeline;
  if (!items) {
    return ctx.editMessageText(`This list has expired — run /notes to reload. 😊`);
  }
  const backOffset = Math.floor(absIdx / TIMELINE_PAGE_SIZE) * TIMELINE_PAGE_SIZE;
  const detail = renderTimelineDetail(items, absIdx, ctx, backOffset);
  if (!detail) {
    return ctx.editMessageText(`Hmm, I couldn't find that note — run /notes to reload.`);
  }
  try {
    await ctx.editMessageText(detail.text, { parse_mode: 'MarkdownV2', reply_markup: detail.keyboard });
  } catch {
    await ctx.reply(detail.text, { parse_mode: 'MarkdownV2', reply_markup: detail.keyboard });
  }
});

// ---------------------------------------------------------------------------
// /recent — your recent notes (morphing list ↔ detail, one message)
// ---------------------------------------------------------------------------

bot.command('recent', async (ctx) => {
  ctx.session.pending = null;
  const authorTgId = ctx.from.id;
  await showTyping(ctx);
  const mine = await getRecentUpdatesByAuthor(authorTgId, RECENT_LIMIT);

  if (mine.length === 0) {
    return ctx.reply(`You haven't written any notes yet — go love on someone! 💛`);
  }

  ctx.session.recentList = mine;
  const { text, keyboard } = renderRecentList(mine, 0);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
});

function renderRecentList(mine, offset) {
  const page = mine.slice(offset, offset + RECENT_PAGE_SIZE);
  const rangeFrom = offset + 1;
  const rangeTo = offset + page.length;

  let text = `*Your recent notes* \\(${rangeFrom}–${rangeTo} of ${mine.length}\\)\n\n`;
  page.forEach((r, i) => {
    const member = getMember(String(r.member_id));
    const memberName = e(member ? memberLabel(member) : String(r.member_id));
    const date = e(formatSGTDate(entryDate(r)));
    const edited = r.edited_at ? ' _\\(edited\\)_' : '';
    const titleLine = r.title ? `*${e(r.title)}*\n` : '';
    const preview = e(String(r.note).slice(0, 80).replace(/\n/g, ' ') + (r.note.length > 80 ? '…' : ''));
    text += `*${i + 1}\\.* 📝 *${memberName}* · ${date}${edited}\n${titleLine}_${preview}_\n\n`;
  });
  text += `Tap a number to open\\.`;

  const kb = new InlineKeyboard();
  page.forEach((_, i) => { kb.text(String(i + 1), `rec_open:${offset + i}`); });
  kb.row();
  if (offset > 0) kb.text('⬅️ Prev', `rec_list:${Math.max(0, offset - RECENT_PAGE_SIZE)}`);
  if (offset + RECENT_PAGE_SIZE < mine.length) {
    kb.text('⬇️ Next', `rec_list:${offset + RECENT_PAGE_SIZE}`);
  }

  return { text, keyboard: kb };
}

function renderRecentDetail(mine, idx, ctx, backOffset) {
  const r = mine[idx];
  if (!r) return null;
  const member = getMember(String(r.member_id));
  const memberName = member ? memberLabel(member) : String(r.member_id);
  const date = e(formatSGTDate(entryDate(r)));
  const edited = r.edited_at ? ' _\\(edited\\)_' : '';
  const noteText = String(r.note).slice(0, 3500);
  const truncated = r.note.length > 3500 ? '\n\n_\\[truncated\\]_' : '';
  const titleLine = renderNoteTitleLine(r.title);
  const text = `*${e(memberName)}*\n${date}${edited}\n\n${titleLine}${e(noteText)}${truncated}`;

  const kb = new InlineKeyboard().text('⬅️ Back', `rec_list:${backOffset}`);
  const withinWindow = hoursSince(r.created_at) < EDIT_WINDOW_HOURS;
  if (withinWindow && String(r.author_tg_id) === String(ctx.from.id)) {
    kb.text('✏️ Title', `edit_title:${r.id}`)
      .text('📝 Note', `edit_body:${r.id}`)
      .row()
      .text('📅 Date', `edit_date:${r.id}`)
      .text('🗑 Delete', `ask_delete:${r.id}`);
  }

  return { text, keyboard: kb };
}

bot.callbackQuery(/^rec_list:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const offset = parseInt(ctx.match[1], 10);
  const mine = ctx.session.recentList;
  if (!mine) {
    return ctx.editMessageText(`This list has expired — tap /recent to reload. 😊`);
  }
  const { text, keyboard } = renderRecentList(mine, offset);
  try {
    await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  }
});

bot.callbackQuery(/^rec_open:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const absIdx = parseInt(ctx.match[1], 10);
  const mine = ctx.session.recentList;
  if (!mine) {
    return ctx.editMessageText(`This list has expired — tap /recent to reload. 😊`);
  }
  const backOffset = Math.floor(absIdx / RECENT_PAGE_SIZE) * RECENT_PAGE_SIZE;
  const detail = renderRecentDetail(mine, absIdx, ctx, backOffset);
  if (!detail) {
    return ctx.editMessageText(`Hmm, I couldn't find that note — tap /recent to reload.`);
  }
  try {
    await ctx.editMessageText(detail.text, { parse_mode: 'MarkdownV2', reply_markup: detail.keyboard });
  } catch {
    await ctx.reply(detail.text, { parse_mode: 'MarkdownV2', reply_markup: detail.keyboard });
  }
});

// ---------------------------------------------------------------------------
// Edit — separate buttons for title / note / date
// ---------------------------------------------------------------------------

bot.callbackQuery(/^start_edit:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  return startEditMenu(ctx, ctx.match[1]);
});

async function startEditMenu(ctx, updateId) {
  await showTyping(ctx);
  const row = await findUpdateRow(updateId);
  const gate = checkEditGate(ctx, row);
  if (gate) return ctx.reply(gate);
  const member = getMember(String(row.member_id));
  const memberName = member ? memberLabel(member) : String(row.member_id);
  const currentTitle = row.title ? `*${e(row.title)}*` : '_\\(none\\)_';
  const kb = new InlineKeyboard()
    .text('✏️ Title', `edit_title:${updateId}`)
    .text('📝 Note', `edit_body:${updateId}`)
    .row()
    .text('📅 Date', `edit_date:${updateId}`)
    .text('Cancel', `cancel_edit:${updateId}`);
  await ctx.reply(
    `Editing note for *${e(memberName)}* ✏️\nTitle: ${currentTitle}\n\nWhat would you like to edit?`,
    { parse_mode: 'MarkdownV2', reply_markup: kb },
  );
}

bot.callbackQuery(/^cancel_edit:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery('No worries!');
  await ctx.editMessageText('No worries, no changes made! 🙂');
});

bot.callbackQuery(/^edit_title:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const updateId = ctx.match[1];
  const row = await findUpdateRow(updateId);
  const gate = checkEditGate(ctx, row);
  if (gate) return ctx.reply(gate);
  const currentTitle = row.title ? `*${e(row.title)}*` : '_\\(none\\)_';
  ctx.session.pending = { kind: 'edit_title_only', updateId, currentBody: row.note };
  await ctx.reply(
    `Current title: ${currentTitle}\n\nSend a new title, or /skip to keep it\\.`,
    { parse_mode: 'MarkdownV2' },
  );
});

bot.callbackQuery(/^edit_body:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const updateId = ctx.match[1];
  const row = await findUpdateRow(updateId);
  const gate = checkEditGate(ctx, row);
  if (gate) return ctx.reply(gate);
  const bodyPreview = String(row.note ?? '').slice(0, 200).replace(/\n/g, ' ') + (row.note?.length > 200 ? '…' : '');
  ctx.session.pending = { kind: 'edit_body_only', updateId, currentTitle: row.title };
  await ctx.reply(
    `Current note: _${e(bodyPreview)}_\n\nSend the updated note, or /skip to keep it\\.`,
    { parse_mode: 'MarkdownV2' },
  );
});

bot.callbackQuery(/^edit_date:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const updateId = ctx.match[1];
  const row = await findUpdateRow(updateId);
  const gate = checkEditGate(ctx, row);
  if (gate) return ctx.reply(gate);
  const current = e(formatSGTDate(entryDate(row)));
  ctx.session.pending = { kind: 'edit_date', updateId };
  await ctx.reply(
    `Current date: ${current}\n\nSend a new date \\(e\\.g\\. _2026\\-05\\-01_ or _today_\\), or /skip to keep it\\.`,
    { parse_mode: 'MarkdownV2' },
  );
});

// ---------------------------------------------------------------------------
// Delete — via inline buttons only
// ---------------------------------------------------------------------------

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
  await ctx.reply(`Remove this note? 🗑\nThis is a soft\\-delete — Wilson can recover it from Supabase if needed\\.`, {
    parse_mode: 'MarkdownV2',
    reply_markup: kb,
  });
}

bot.callbackQuery(/^cancel_delete:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery('No worries!');
  await ctx.editMessageText('No worries, note is still there! 🙂');
});

bot.callbackQuery(/^confirm_delete:(.+)$/, async (ctx) => {
  const updateId = ctx.match[1];
  await ctx.answerCallbackQuery();
  await showTyping(ctx);
  const row = await findUpdateRow(updateId);
  const gate = checkEditGate(ctx, row);
  if (gate) return ctx.editMessageText(gate);
  await softDeleteUpdate(row.id, toSGTIso());
  ctx.session.recentList = null;
  await ctx.editMessageText(`Done — that note has been removed. 🗑\nWilson can recover it from Supabase if needed.`);
});

// ---------------------------------------------------------------------------
// Text message handler — completes pending flows
// ---------------------------------------------------------------------------

bot.on('message:text', async (ctx) => {
  const pending = ctx.session.pending;
  if (!pending) {
    return ctx.reply(`Hmm, I'm not sure what to do with that 😅 Type /help to see what I can do.`);
  }

  if (pending.kind === 'pick_member') {
    return ctx.reply(`Use /1, /2 etc. to pick from the list, or /cancel to back out. 😊`);
  }

  if (pending.kind === 'update_asking_title') {
    return ctx.reply(`Tap *Add title* or *Skip* above to continue, or /cancel\\.`, { parse_mode: 'MarkdownV2' });
  }

  const raw = ctx.message.text.trim();

  // Step 1 of /update: receive content, prompt for optional title.
  if (pending.kind === 'update_body') {
    const member = getMember(pending.memberId);
    if (!member) {
      ctx.session.pending = null;
      return ctx.reply(`Hmm, that member no longer exists. Cancelled 😕`);
    }
    if (!raw) return ctx.reply(`Looks like that was empty — nothing saved. Try again, or /cancel. 😊`);
    ctx.session.pending = { kind: 'update_asking_title', memberId: pending.memberId, body: raw };
    const kb = new InlineKeyboard().text('📌 Add title', 'add_title').text('Skip →', 'skip_title');
    return ctx.reply(
      `Note received\\! Want to add a title\\?\n\n_A title helps you find this note later\\._`,
      { parse_mode: 'MarkdownV2', reply_markup: kb },
    );
  }

  // Step 2 of /update (if Add title was tapped): receive title, save.
  if (pending.kind === 'update_title_input') {
    const title = normalizeTitle(raw);
    if (!title) return ctx.reply(`That title looks empty — try again, or /skip to save without one. 😊`);
    await saveNewUpdate(ctx, pending.memberId, pending.body, title);
    return;
  }

  // Edit title only.
  if (pending.kind === 'edit_title_only') {
    const newTitle = normalizeTitle(raw);
    if (!newTitle) return ctx.reply(`That title looks empty — try again, or /skip to keep the old one. 😊`);
    ctx.session.pending = null;
    await showTyping(ctx);
    const row = await findUpdateRow(pending.updateId);
    const gate = checkEditGate(ctx, row);
    if (gate) return ctx.reply(gate);
    await patchUpdate(row.id, { title: newTitle, edited_at: toSGTIso() });
    ctx.session.recentList = null;
    return ctx.reply(`Done\\! Title updated\\. ✏️`, { parse_mode: 'MarkdownV2' });
  }

  // Edit note body only.
  if (pending.kind === 'edit_body_only') {
    if (!raw) return ctx.reply(`Looks like that was empty — try again, or /skip. 😊`);
    ctx.session.pending = null;
    await showTyping(ctx);
    const row = await findUpdateRow(pending.updateId);
    const gate = checkEditGate(ctx, row);
    if (gate) return ctx.reply(gate);
    await patchUpdate(row.id, { note: raw, edited_at: toSGTIso() });
    ctx.session.recentList = null;
    return ctx.reply(`Done\\! Note updated\\. ✏️`, { parse_mode: 'MarkdownV2' });
  }

  // Edit date.
  if (pending.kind === 'edit_date') {
    const parsed = raw.toLowerCase() === 'today'
      ? new Date()
      : new Date(raw);
    if (isNaN(parsed.getTime())) {
      return ctx.reply(`Hmm, I couldn't parse that date 😕 Try a format like _2026\\-05\\-01_ or just _today_\\.`, { parse_mode: 'MarkdownV2' });
    }
    ctx.session.pending = null;
    await showTyping(ctx);
    const row = await findUpdateRow(pending.updateId);
    const gate = checkEditGate(ctx, row);
    if (gate) return ctx.reply(gate);
    await patchUpdate(row.id, { occurred_at: parsed.toISOString(), edited_at: toSGTIso() });
    ctx.session.recentList = null;
    ctx.session.memberTimeline = null;
    return ctx.reply(`Done\\! Date updated\\. 📅`, { parse_mode: 'MarkdownV2' });
  }
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function findUpdateRow(updateId) {
  return getUpdate(updateId);
}

function checkEditGate(ctx, row) {
  if (!row) return `I couldn't find that note — it may have already been removed.`;
  if (row.deleted_at) return `That note has already been deleted. 🗑`;
  if (String(row.author_tg_id) !== String(ctx.from.id)) {
    return `You can only edit or delete notes you wrote yourself. 😊`;
  }
  if (hoursSince(row.created_at) >= EDIT_WINDOW_HOURS) {
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
