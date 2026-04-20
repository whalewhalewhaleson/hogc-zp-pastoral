// MarkdownV2 escape helpers for Telegram

export function e(text) {
  return String(text ?? '').replace(/[_*[\]()~`>#+=|{}.!\-]/g, '\\$&');
}

export function bold(text) {
  return `*${e(text)}*`;
}

export function italic(text) {
  return `_${e(text)}_`;
}

export function mono(text) {
  return `\`${String(text ?? '').replace(/`/g, '')}\``;
}
