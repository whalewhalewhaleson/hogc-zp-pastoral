function createNewWeek() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const membersSheet = ss.getSheetByName("Members");
  const templateSheet = ss.getSheetByName("Template Week");

  // ─────────────────────────────────────────────
  // 🗓️ Generate next sheet name using ISO weeks
  // Format: YYYY week WW
  // ─────────────────────────────────────────────
  const weekSheets = ss
    .getSheets()
    .map(s => s.getName())
    .filter(name => /^\d{4} week \d{2}$/.test(name));

  let latestYear = 0;
  let latestWeek = 0;

  weekSheets.forEach(name => {
    const [, year, week] = name.match(/(\d{4}) week (\d{2})/);
    const y = Number(year);
    const w = Number(week);

    if (y > latestYear || (y === latestYear && w > latestWeek)) {
      latestYear = y;
      latestWeek = w;
    }
  });

  if (latestYear === 0) {
    const today = new Date();
    const iso = getISOWeekYear(today);
    latestYear = iso.year;
    latestWeek = iso.week;
  }

  const baseDate = isoWeekToDate(latestYear, latestWeek);
  baseDate.setDate(baseDate.getDate() + 7);

  const nextISO = getISOWeekYear(baseDate);
  const newSheetName = `${nextISO.year} Week ${String(nextISO.week).padStart(2, "0")}`;

  // ─────────────────────────────────────────────
  // 📋 Duplicate template
  // ─────────────────────────────────────────────
  const newSheet = templateSheet.copyTo(ss);
  newSheet.setName(newSheetName);

  // ─────────────────────────────────────────────
  // 🧾 Get member data
  // ─────────────────────────────────────────────
  const memberData1 = membersSheet
    .getRange("B3:B")
    .getValues()
    .filter(r => r[0]);

  const memberData2 = membersSheet
    .getRange("D3:D")
    .getValues()
    .filter(r => r[0]);

  newSheet.getRange(9, 20, memberData1.length, 1).setValues(memberData1);
  newSheet.getRange(9, 21, memberData2.length, 1).setValues(memberData2);

  newSheet.getRange("B1").setFormula(`="ZP1 - ${newSheetName}"`);

  SpreadsheetApp.getUi().alert(`Created ${newSheetName} successfully!`);
}

/* ─────────────────────────────────────────────
   ISO WEEK HELPERS
   KEEP THESE IN THE SAME FILE
───────────────────────────────────────────── */

function getISOWeekYear(date) {
  const d = new Date(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ));

  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

  return { year, week };
}

function isoWeekToDate(year, week) {
  const date = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const day = date.getUTCDay();

  if (day <= 4) {
    date.setUTCDate(date.getUTCDate() - day + 1);
  } else {
    date.setUTCDate(date.getUTCDate() + 8 - day);
  }

  return date;
}