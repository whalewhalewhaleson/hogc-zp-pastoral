function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Member Tools")
    .addItem("Generate IDs", "generateAllMemberIDs")
    .addToUi();
}

function generateAllMemberIDs() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Members");
  if (!sheet) return;

  const ID_COL = 1;   // Column A
  const NAME_COL = 3; // Column C

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const ids = sheet.getRange(2, ID_COL, lastRow - 1).getValues().flat();
  const names = sheet.getRange(2, NAME_COL, lastRow - 1).getValues().flat();

  const today = new Date();
  const dateStr = Utilities.formatDate(
    today,
    Session.getScriptTimeZone(),
    "yyMMdd"
  );

  // Get today's existing IDs
  const todayIds = ids.filter(id => id && id.includes(dateStr));

  let numbers = todayIds
    .map(id => parseInt(id.split("-")[2]))
    .filter(n => !isNaN(n));

  let nextNum = numbers.length ? Math.max(...numbers) + 1 : 1;

  for (let i = 0; i < names.length; i++) {
    if (names[i] !== "" && ids[i] === "") {
      const newId = "M-" + dateStr + "-" + String(nextNum).padStart(4, "0");
      sheet.getRange(i + 2, ID_COL).setValue(newId);
      nextNum++;
    }
  }
}