import 'dotenv/config';
import { Bot, InlineKeyboard, session } from 'grammy';

import {
  insertUpdate, getUpdate, patchUpdate, softDeleteUpdate,
  getUpdatesByMember, getRecentUpdatesByAuthor,
  countUpdatesByMember, getLatestUpdatePerMember,
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

const TITLE_MAX_CHARS = 100;

function normalizeTitle(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  return t.length > TITLE_MAX_CHARS ? t.slice(0, TITLE_MAX_CHARS) : t;
}

// Format a note record for list/detail rendering.
// Returns MarkdownV2-safe strings.
function renderNoteTitleLine(title) {
  return title ? `*${e(title)}*\n\n` : '';
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

bot.command('skip', async (ctx) => {
  const pending = ctx.session.pending;
  if (!pending) return ctx.reply('Nothing to skip right now. 😊');

  if (pending.kind === 'update_title') {
    const member = getMember(pending.memberId);
    if (!member) {
      ctx.session.pending = null;
      return ctx.reply(`Hmm, that member no longer exists. Cancelled 😕`);
    }
    ctx.session.pending = { kind: 'update_body', memberId: pending.memberId, title: '' };
    return ctx.reply(
      `No title — now type the note for *${e(memberLabel(member))}* \\(or /cancel\\)\\.`,
      { parse_mode: 'MarkdownV2' },
    );
  }

  if (pending.kind === 'update_body') {
    return ctx.reply(`The note itself can't be skipped — go ahead and type it, or /cancel. 😊`);
  }

  if (pending.kind === 'edit_title') {
    ctx.session.pending = {
      kind: 'edit_body',
      updateId: pending.updateId,
      newTitle: pending.currentTitle,
      currentBody: pending.currentBody,
    };
    return ctx.reply(
      `Keeping the current title\\. Now send the updated note, or /skip to keep the old one, or /cancel\\.`,
      { parse_mode: 'MarkdownV2' },
    );
  }

  if (pending.kind === 'edit_body') {
    await showTyping(ctx);
    const row = await findUpdateRow(pending.updateId);
    const gate = checkEditGate(ctx, row);
    if (gate) {
      ctx.session.pending = null;
      return ctx.reply(gate);
    }
    await patchUpdate(row.id, {
      title: pending.newTitle,
      edited_at: toSGTIso(),
    });
    ctx.session.pending = null;
    ctx.session.recentList = null;
    return ctx.reply(`Done\\! Only the title changed\\. ✏️`, { parse_mode: 'MarkdownV2' });
  }

  return ctx.reply('Nothing to skip right now. 😊');
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
    ctx.session.pending = { kind: 'update_title', memberId: m.memberId };
    return ctx.reply(
      `Writing a note for *${e(memberLabel(m))}* 📝\nWhat's this note about? \\(short title, or /skip — /cancel to back out\\)`,
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

  ctx.session.pending = { kind: 'update_title', memberId: m.memberId };
  await ctx.reply(
    `Writing a note for *${e(memberLabel(m))}* 📝\nWhat's this note about? \\(short title, or /skip — /cancel to back out\\)`,
    { parse_mode: 'MarkdownV2' },
  );
});

async function showUpdateDetail(ctx, r) {
  const member = getMember(String(r.member_id));
  const memberName = member ? memberLabel(member) : String(r.member_id);
  const date = e(formatSGTDate(r.created_at));
  const author = e(r.author_name || String(r.author_tg_id));
  const edited = r.edited_at ? ' _\\(edited\\)_' : '';
  const titleLine = renderNoteTitleLine(r.title);
  const text = `*${e(memberName)}*\n${date} · ${author}${edited}\n\n${titleLine}${e(r.note)}`;
  const withinWindow = hoursSince(r.created_at) < EDIT_WINDOW_HOURS;
  const opts = { parse_mode: 'MarkdownV2' };
  if (withinWindow && String(r.author_tg_id) === String(ctx.from.id)) {
    opts.reply_markup = new InlineKeyboard()
      .text('✏️ Edit', `start_edit:${r.id}`)
      .text('🗑 Delete', `ask_delete:${r.id}`);
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
    const recentMemberIds = await getLatestUpdatePerMember(10);
    const recent = recentMemberIds.map((id) => getMember(id)).filter(Boolean);

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
  const filtered = await getUpdatesByMember(memberId, HISTORY_LIMIT);

  if (filtered.length === 0) {
    return ctx.reply(`No notes written for ${memberLabel(member)} yet. They're waiting for someone to care! 💛`);
  }

  let text = `*${e(memberLabel(member))}* — ${filtered.length} note${filtered.length === 1 ? '' : 's'} 📖\n\n`;
  filtered.forEach((r, i) => {
    const date = e(formatSGTDate(r.created_at));
    const author = e(r.author_name || String(r.author_tg_id));
    const edited = r.edited_at ? ' _\\(edited\\)_' : '';
    const titleLine = r.title ? `*${e(r.title)}*\n` : '';
    const preview = e(String(r.note).slice(0, 40).replace(/\n/g, ' ') + (r.note.length > 40 ? '…' : ''));
    text += `/${i + 1} ${date} · ${author}${edited}\n${titleLine}_${preview}_\n\n`;
  });
  text += `Reply /1–/${filtered.length} to read, or /cancel\\.`;
  ctx.session.pending = { kind: 'pick_update', updates: filtered };
  await ctx.reply(text, { parse_mode: 'MarkdownV2' });
}

// ---------------------------------------------------------------------------
// /recent — your recent notes in a single message that morphs between
// list view and detail view. One message, in-place edits, no chat spam.
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
    const date = e(formatSGTDate(r.created_at));
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
  const date = e(formatSGTDate(r.created_at));
  const edited = r.edited_at ? ' _\\(edited\\)_' : '';
  const noteText = String(r.note).slice(0, 3500);
  const truncated = r.note.length > 3500 ? '\n\n_\\[truncated\\]_' : '';
  const titleLine = renderNoteTitleLine(r.title);
  const text = `*${e(memberName)}*\n${date}${edited}\n\n${titleLine}${e(noteText)}${truncated}`;

  const kb = new InlineKeyboard().text('⬅️ Back', `rec_list:${backOffset}`);
  const withinWindow = hoursSince(r.created_at) < EDIT_WINDOW_HOURS;
  if (withinWindow && String(r.author_tg_id) === String(ctx.from.id)) {
    kb.text('✏️ Edit', `start_edit:${r.id}`).text('🗑 Delete', `ask_delete:${r.id}`);
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
  const member = getMember(String(row.member_id));
  const memberName = member ? memberLabel(member) : String(row.member_id);
  const currentTitle = String(row.title ?? '').trim();
  const currentBody = String(row.note ?? '');
  const currentTitleDisplay = currentTitle ? `*${e(currentTitle)}*` : '_\\(none\\)_';
  const bodyPreview = currentBody.slice(0, 200).replace(/\n/g, ' ') + (currentBody.length > 200 ? '…' : '');
  ctx.session.pending = {
    kind: 'edit_title',
    updateId,
    currentTitle,
    currentBody,
  };
  await ctx.reply(
    `Editing your note for *${e(memberName)}* ✏️\n\n` +
      `Current title: ${currentTitleDisplay}\n` +
      `Current note: _${e(bodyPreview)}_\n\n` +
      `Send a new title, /skip to keep it, or /cancel to back out\\.`,
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
  await softDeleteUpdate(row.id, toSGTIso());
  ctx.session.recentList = null;
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

  const raw = ctx.message.text.trim();

  // Title step for new note: save title, move to body prompt.
  if (pending.kind === 'update_title') {
    const member = getMember(pending.memberId);
    if (!member) {
      ctx.session.pending = null;
      return ctx.reply(`Hmm, that member no longer exists in the list. Cancelled 😕`);
    }
    const title = normalizeTitle(raw);
    if (!title) return ctx.reply(`That title looks empty — try again, or /skip. 😊`);
    ctx.session.pending = { kind: 'update_body', memberId: pending.memberId, title };
    return ctx.reply(
      `Nice\\. Now type the note for *${e(memberLabel(member))}*, or /cancel\\.`,
      { parse_mode: 'MarkdownV2' },
    );
  }

  // Body step for new note: save the record.
  if (pending.kind === 'update_body') {
    const member = getMember(pending.memberId);
    if (!member) {
      ctx.session.pending = null;
      return ctx.reply(`Hmm, that member no longer exists in the list. Cancelled 😕`);
    }
    if (!raw) return ctx.reply(`Looks like that was empty — nothing saved. Try again, or /cancel. 😊`);
    ctx.session.pending = null;
    await showTyping(ctx);
    const updateId = newUpdateId();
    await insertUpdate({
      id: updateId,
      member_id: pending.memberId,
      author_tg_id: ctx.from.id,
      author_name: (await getLeaderName(ctx.from.id)) || ctx.from.first_name || '',
      title: pending.title || null,
      note: raw,
    });
    const kb = new InlineKeyboard()
      .text('✏️ Edit', `start_edit:${updateId}`)
      .text('🗑 Delete', `ask_delete:${updateId}`);
    const titlePart = pending.title ? ` \\(*${e(pending.title)}*\\)` : '';
    return ctx.reply(
      `Saved\\! 🙌 Your note for *${e(memberLabel(member))}*${titlePart} is in\\.`,
      { parse_mode: 'MarkdownV2', reply_markup: kb },
    );
  }

  // Title step for edit: capture new title, move to body prompt.
  if (pending.kind === 'edit_title') {
    const newTitle = normalizeTitle(raw);
    if (!newTitle) return ctx.reply(`That title looks empty — try again, or /skip to keep the old one. 😊`);
    ctx.session.pending = {
      kind: 'edit_body',
      updateId: pending.updateId,
      newTitle,
      currentBody: pending.currentBody,
    };
    return ctx.reply(
      `Got the new title\\. Now send the updated note, /skip to keep the current one, or /cancel\\.`,
      { parse_mode: 'MarkdownV2' },
    );
  }

  // Body step for edit: save the updated row.
  if (pending.kind === 'edit_body') {
    if (!raw) return ctx.reply(`Looks like that was empty — try again, or /skip to keep the current note. 😊`);
    ctx.session.pending = null;
    await showTyping(ctx);
    const row = await findUpdateRow(pending.updateId);
    const gate = checkEditGate(ctx, row);
    if (gate) return ctx.reply(gate);
    await patchUpdate(row.id, {
      title: pending.newTitle || null,
      note: raw,
      edited_at: toSGTIso(),
    });
    ctx.session.recentList = null;
    return ctx.reply(`Done\\! Your note has been updated\\. ✏️`, { parse_mode: 'MarkdownV2' });
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
