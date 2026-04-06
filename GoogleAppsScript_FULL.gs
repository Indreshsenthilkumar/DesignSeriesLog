// ============================================================
//  DesignSeries Attendance Portal — Google Apps Script (FULL)
//  v4 — STRICT UPDATE-ONLY MATRIX (NO DUPLICATE ROWS)
// ============================================================

const STUDENT_SHEET = "StudentData";
const MATRIX_SHEET  = "AttendanceMatrix";
const LOG_SHEET     = "Attendancelog";

const CACHE_TTL     = 25; // seconds

// ════════════════════════════════════════════════════════════
//  ENTRY POINTS
// ════════════════════════════════════════════════════════════

function doGet(e) {
  try {
    const params = e.parameter;
    if (params.email) {
      return respondJSON(getStudentData(params.email));
    }
    return respondJSON({ status: "error", message: "No valid action." });
  } catch(err) {
    return respondJSON({ status: "error", message: err.toString() });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    // email, date, and hours are required
    if (body.date && body.email && body.hours) {
      return respondJSON(recordAttendance(body));
    }
    return respondJSON({ status: "error", message: "Missing fields: date, email and hours are required." });
  } catch (err) {
    return respondJSON({ status: "error", message: "doPost error: " + err.toString() });
  }
}

// ════════════════════════════════════════════════════════════
//  FAST STUDENT DATA (cache-backed)
// ════════════════════════════════════════════════════════════

function getStudentData(email) {
  if (!email) return { status: "error", message: "Email required." };

  const safeKey  = "s_" + email.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(safeKey);
  if (cached) return JSON.parse(cached);

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const studSheet = ss.getSheetByName(STUDENT_SHEET);
  const logSheet  = ss.getSheetByName(LOG_SHEET);

  const studData = studSheet.getDataRange().getValues();
  const headers  = studData[0].map(h => h.toString().trim().toLowerCase());

  let emailIdx = headers.findIndex(h => h.includes("email"));
  if (emailIdx === -1) return { status: "error", message: "No email column found." };

  let student = null;
  const searchEmail = email.toLowerCase().trim();
  for (let r = 1; r < studData.length; r++) {
    if ((studData[r][emailIdx] || "").toString().trim().toLowerCase() === searchEmail) {
      student = {};
      headers.forEach((h, i) => { student[h] = studData[r][i]; });
      break;
    }
  }
  if (!student) return { status: "error", message: "Student not found." };

  const history = buildHistory(logSheet, searchEmail);

  const result = {
    status  : "success",
    student : normaliseStudent(student),
    history : history
  };

  try { cache.put(safeKey, JSON.stringify(result), CACHE_TTL); } catch(_) {}
  return result;
}

function buildHistory(logSheet, email) {
  const logData = logSheet.getDataRange().getValues();
  if (logData.length < 2) return [];

  const lh = logData[0].map(h => h.toString().trim().toLowerCase());
  const eIdx = lh.findIndex(h => h.includes("email"));
  const dIdx = lh.findIndex(h => h.includes("date"));
  const hIdx = lh.findIndex(h => h.includes("hour"));
  const rIdx = lh.findIndex(h => h.includes("reason"));

  const history = [];
  for (let r = 1; r < logData.length; r++) {
    const row = logData[r];
    if ((row[eIdx] || "").toString().trim().toLowerCase() !== email) continue;

    let dVal = row[dIdx];
    if (dVal instanceof Date) dVal = Utilities.formatDate(dVal, Session.getScriptTimeZone(), "yyyy-MM-dd");
    
    history.push({
      date  : (dVal || "").toString().trim(),
      hours : (row[hIdx] || "").toString().trim(),
      reason: (row[rIdx] || "").toString().trim()
    });
  }
  return history;
}

function normaliseStudent(raw) {
  return {
    email       : raw["email id"]    || raw["email"]       || "",
    reg_num     : raw["roll num"]    || raw["roll no"]     || "",
    name        : raw["name"]        || "",
    department  : raw["department"]  || "",
    year        : raw["year"]        || "",
    mobile      : raw["mobile"]      || "",
    domain      : raw["domain"]      || "",
    mentor_name : raw["mentor name"] || "",
    linkedin    : raw["linkedin"]    || "",
    github      : raw["github"]      || ""
  };
}

// ════════════════════════════════════════════════════════════
//  RECORD ATTENDANCE & UPDATE MATRIX
// ════════════════════════════════════════════════════════════

function recordAttendance(body) {
  let { date, rollNo, name, email, hours, reason } = body;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const entriesSheet = ss.getSheetByName(LOG_SHEET);
  const matrixSheet  = ss.getSheetByName(MATRIX_SHEET);

  // --- DEADLINE CHECK (8:00 PM IST) ---
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime   = new Date(new Date().getTime() + istOffset);
  if (istTime.getUTCHours() >= 20) {
    return { status: "error", message: "Submission failed: Deadline (8:00 PM) has passed. Contact admin." };
  }

  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  // 1. One row per hour in Attendancelog
  let hArr = [];
  if (Array.isArray(hours)) hArr = hours.map(h => h.toString().trim());
  else hArr = hours.toString().split(",").map(h => h.trim());

  const validHrs = [...new Set(hArr)].filter(h => h >= 1 && h <= 7).sort();

  validHrs.forEach(hr => {
    entriesSheet.appendRow([date, rollNo || "N/A", name || "", email, hr, reason || "", ts]);
  });

  // 2. Update existing Matrix Row (STRICT)
  try {
    updateMatrix(matrixSheet, email, date, validHrs.join(","));
  } catch(e) {
    Logger.log("Matrix Error: " + e.message);
  }

  // 3. Clear Cache
  const safeKey = "s_" + email.toLowerCase().replace(/[^a-z0-9]/g, "_");
  CacheService.getScriptCache().remove(safeKey);

  return { status: "success", message: "Attendance recorded." };
}

/** 
 * 🔥 THE BULLETPROOF UPDATE-ONLY LOGIC
 */
function updateMatrix(sheet, email, dateStr, hoursStr) {
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error("Matrix sheet is empty.");

  const inputEmail = email.toString().toLowerCase().trim();
  Logger.log("Searching for: " + inputEmail);

  // 1. Read ALL emails from Column A
  const emails = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let rowIndex = -1;

  for (let i = 0; i < emails.length; i++) {
    const sheetEmail = emails[i][0].toString().toLowerCase().trim();
    if (sheetEmail === inputEmail) {
      rowIndex = i + 2; // Exact Row index
      break;
    }
  }

  // 🚀 HARD RULE: If not found, throw error
  if (rowIndex === -1) {
    throw new Error("Student not found in AttendanceMatrix: " + email);
  }
  Logger.log("Matched Row: " + rowIndex);

  // 2. Find/Add Date Column
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let colIndex = -1;

  for (let c = 0; c < headers.length; c++) {
    let hStr = "";
    if (headers[c] instanceof Date) hStr = Utilities.formatDate(headers[c], Session.getScriptTimeZone(), "yyyy-MM-dd");
    else hStr = headers[c].toString().trim();

    if (hStr === dateStr) {
      colIndex = c + 1;
      break;
    }
  }

  if (colIndex === -1) {
    colIndex = lastCol + 1;
    sheet.getRange(1, colIndex).setValue(dateStr);
    sheet.getRange(1, colIndex).setBackground("#F1F2F4").setFontWeight("bold");
    Logger.log("New Column created: " + colIndex);
  }

  // 3. Update Cell
  const cell = sheet.getRange(rowIndex, colIndex);
  const existing = cell.getValue().toString().trim();
  
  const merged = [...new Set((existing ? existing.split(",").concat(hoursStr.split(",")) : hoursStr.split(",")))].sort().join(",");

  cell.setValue(merged);
  cell.setBackground("#FFA500"); // Orange
  cell.setFontColor("#000000");  // Black
  cell.setHorizontalAlignment("center");
  cell.setNumberFormat("@");
}

function respondJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
