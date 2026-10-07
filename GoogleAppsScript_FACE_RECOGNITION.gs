/**
 * =======================================================================================
 * GOOGLE APPS SCRIPT - FACE RECOGNITION ATTENDANCE BACKEND (STANDALONE DEDICATED SCRIPT)
 * Database Spreadsheet: https://docs.google.com/spreadsheets/d/1Up9Z42R39lRxHzHy9ojLtrQy0CV9skA6EWl6rgIzKRA/edit?gid=0#gid=0
 * Spreadsheet ID: 1Up9Z42R39lRxHzHy9ojLtrQy0CV9skA6EWl6rgIzKRA
 * =======================================================================================
 */

const SPREADSHEET_ID = "1Up9Z42R39lRxHzHy9ojLtrQy0CV9skA6EWl6rgIzKRA";

// Sheet Tab Names
const SHEET_REGISTERED_FACES = "Registered_Faces";
const SHEET_ATTENDANCE_LOGS = "Face_Attendance_Logs";
const SHEET_SCHEDULES = "Attendance_Schedules";
const SHEET_HOLIDAYS = "Holidays_Exceptions";

function getSpreadsheet() {
  let ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {}
  if (!ss || ss.getId() !== SPREADSHEET_ID) {
    try {
      ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    } catch (e) {
      if (!ss) throw new Error("Could not open spreadsheet with ID: " + SPREADSHEET_ID);
    }
  }
  return ss;
}

/**
 * Ensures all required sheets & formatted headers exist in the spreadsheet.
 */
function ensureSheetsSetup(ss) {
  Logger.log("Opening spreadsheet: " + ss.getName() + " (ID: " + ss.getId() + ")");

  // 1. Registered Faces
  let faceSheet = ss.getSheetByName(SHEET_REGISTERED_FACES);
  if (!faceSheet) {
    faceSheet = ss.insertSheet(SHEET_REGISTERED_FACES);
    faceSheet.appendRow([
      "Reg_Number", "Name", "Department", "Year", "Email", "Descriptor_Vector",
      "Photo_Thumbnail", "Registered_At", "Registered_By", "Status", "Last_Updated"
    ]);
    faceSheet.getRange("A1:K1").setFontWeight("bold").setBackground("#EDE9FE").setFontColor("#5B21B6");
    faceSheet.setFrozenRows(1);
    Logger.log("✅ Created Tab: " + SHEET_REGISTERED_FACES);
  } else {
    Logger.log("ℹ️ Tab already exists: " + SHEET_REGISTERED_FACES);
  }

  // 2. Attendance Logs
  let attSheet = ss.getSheetByName(SHEET_ATTENDANCE_LOGS);
  if (!attSheet) {
    attSheet = ss.insertSheet(SHEET_ATTENDANCE_LOGS);
    attSheet.appendRow([
      "Log_ID", "Date", "Time", "Timestamp_ISO", "Reg_Number", "Name",
      "Department", "Session_Type", "Status", "Confidence_Score", "Admin_Email", "Device_Info", "Remarks"
    ]);
    attSheet.getRange("A1:M1").setFontWeight("bold").setBackground("#DCFCE7").setFontColor("#166534");
    attSheet.setFrozenRows(1);
    Logger.log("✅ Created Tab: " + SHEET_ATTENDANCE_LOGS);
  } else {
    Logger.log("ℹ️ Tab already exists: " + SHEET_ATTENDANCE_LOGS);
  }

  // 3. Attendance Schedules
  let schedSheet = ss.getSheetByName(SHEET_SCHEDULES);
  if (!schedSheet) {
    schedSheet = ss.insertSheet(SHEET_SCHEDULES);
    schedSheet.appendRow(["Config_Key", "Config_Value", "Description", "Updated_At", "Updated_By"]);
    schedSheet.getRange("A1:E1").setFontWeight("bold").setBackground("#E0F2FE").setFontColor("#075985");
    schedSheet.setFrozenRows(1);
    
    // Seed default schedule values
    const defaultConfigs = [
      ["schedule_mode", "session", "Mode: 'session' (AN/FN) or 'hourly'", new Date().toISOString(), "System"],
      ["fn_start_time", "08:30", "Forenoon Window Start (HH:mm)", new Date().toISOString(), "System"],
      ["fn_end_time", "12:30", "Forenoon Window End (HH:mm)", new Date().toISOString(), "System"],
      ["fn_grace_minutes", "15", "Forenoon Late Grace Period (mins)", new Date().toISOString(), "System"],
      ["an_start_time", "13:30", "Afternoon Window Start (HH:mm)", new Date().toISOString(), "System"],
      ["an_end_time", "17:30", "Afternoon Window End (HH:mm)", new Date().toISOString(), "System"],
      ["an_grace_minutes", "15", "Afternoon Late Grace Period (mins)", new Date().toISOString(), "System"],
      ["hourly_slots", JSON.stringify([
        { hour: 1, name: "Hour 1", start: "08:45", end: "09:45" },
        { hour: 2, name: "Hour 2", start: "09:45", end: "10:45" },
        { hour: 3, name: "Hour 3", start: "11:00", end: "12:00" },
        { hour: 4, name: "Hour 4", start: "12:00", end: "13:00" },
        { hour: 5, name: "Hour 5", start: "13:45", end: "14:45" },
        { hour: 6, name: "Hour 6", start: "14:45", end: "15:45" },
        { hour: 7, name: "Hour 7", start: "16:00", end: "17:00" },
        { hour: 8, name: "Hour 8", start: "17:00", end: "18:00" }
      ]), "Hourly slots configuration JSON", new Date().toISOString(), "System"]
    ];
    defaultConfigs.forEach(row => schedSheet.appendRow(row));
    Logger.log("✅ Created Tab: " + SHEET_SCHEDULES);
  } else {
    Logger.log("ℹ️ Tab already exists: " + SHEET_SCHEDULES);
  }

  // 4. Holidays & Exceptions
  let holSheet = ss.getSheetByName(SHEET_HOLIDAYS);
  if (!holSheet) {
    holSheet = ss.insertSheet(SHEET_HOLIDAYS);
    holSheet.appendRow(["Holiday_Date", "Title", "Type", "Created_At", "Created_By"]);
    holSheet.getRange("A1:E1").setFontWeight("bold").setBackground("#FEE2E2").setFontColor("#991B1B");
    holSheet.setFrozenRows(1);
    Logger.log("✅ Created Tab: " + SHEET_HOLIDAYS);
  } else {
    Logger.log("ℹ️ Tab already exists: " + SHEET_HOLIDAYS);
  }
}

/**
 * Standalone function to initialize all sheets and headers.
 * Select 'initSheets' in the function dropdown in Apps Script editor and click 'Run'.
 */
function initSheets() {
  Logger.log("=== Starting initSheets ===");
  const ss = getSpreadsheet();
  ensureSheetsSetup(ss);
  Logger.log("=== All 4 sheets and headers successfully created! ===");
  return "All 4 sheets successfully initialized!";
}

/**
 * Handle GET Requests
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "get_all_data";
    const ss = getSpreadsheet();
    ensureSheetsSetup(ss);

    let responseData = {};

    if (action === "ping" || action === "check_status" || action === "init_sheets") {
      responseData = {
        status: "success",
        message: "Face Recognition Database Backend Active & Sheets Initialized",
        spreadsheetId: SPREADSHEET_ID,
        timestamp: new Date().toISOString()
      };
    } else if (action === "get_registered_faces") {
      responseData = {
        status: "success",
        registeredFaces: fetchRegisteredFaces(ss)
      };
    } else if (action === "get_attendance_logs") {
      const dateFilter = e.parameter.date || "";
      const regFilter = e.parameter.reg_num || "";
      responseData = {
        status: "success",
        logs: fetchAttendanceLogs(ss, dateFilter, regFilter)
      };
    } else if (action === "get_student_attendance") {
      const regNum = String(e.parameter.reg_num || "").trim();
      const email = String(e.parameter.email || "").trim().toLowerCase();
      responseData = fetchStudentPersonalStats(ss, regNum, email);
    } else if (action === "get_schedule_config") {
      responseData = {
        status: "success",
        schedules: fetchScheduleConfig(ss),
        holidays: fetchHolidays(ss)
      };
    } else if (action === "get_all_data") {
      responseData = {
        status: "success",
        registeredFaces: fetchRegisteredFaces(ss),
        attendanceLogs: fetchAttendanceLogs(ss),
        schedules: fetchScheduleConfig(ss),
        holidays: fetchHolidays(ss),
        timestamp: new Date().toISOString()
      };
    } else {
      responseData = {
        status: "error",
        message: "Unknown GET action: " + action
      };
    }

    return ContentService.createTextOutput(JSON.stringify(responseData))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString(),
      stack: error.stack
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle POST Requests
 */
function doPost(e) {
  try {
    let body = {};
    if (e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        body = e.parameter || {};
      }
    } else {
      body = e.parameter || {};
    }

    const action = body.action || (e.parameter ? e.parameter.action : "");
    const ss = getSpreadsheet();
    ensureSheetsSetup(ss);

    let result = {};

    switch (action) {
      case "register_face":
      case "update_face":
        result = handleRegisterFace(ss, body);
        break;

      case "delete_face":
        result = handleDeleteFace(ss, body);
        break;

      case "mark_face_attendance":
        result = handleMarkAttendance(ss, body);
        break;

      case "bulk_mark_attendance":
        result = handleBulkMarkAttendance(ss, body);
        break;

      case "save_schedule_config":
        result = handleSaveSchedule(ss, body);
        break;

      case "save_holidays":
        result = handleSaveHolidays(ss, body);
        break;

      case "delete_holiday":
        result = handleDeleteHoliday(ss, body);
        break;

      default:
        result = {
          status: "error",
          message: "Unrecognized POST action: " + action
        };
        break;
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString(),
      stack: error.stack
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// DATA FETCH HELPERS
// ==========================================

function fetchRegisteredFaces(ss) {
  const sheet = ss.getSheetByName(SHEET_REGISTERED_FACES);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length <= 1) return [];

  const faces = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue; // Reg_Number required
    faces.push({
      reg_num: String(r[0]).trim(),
      name: String(r[1] || "").trim(),
      department: String(r[2] || "").trim(),
      year: String(r[3] || "").trim(),
      email: String(r[4] || "").trim(),
      descriptor: String(r[5] || ""),
      photo_thumbnail: String(r[6] || ""),
      registered_at: String(r[7] || ""),
      registered_by: String(r[8] || ""),
      status: String(r[9] || "Active"),
      last_updated: String(r[10] || "")
    });
  }
  return faces;
}

function fetchAttendanceLogs(ss, dateFilter, regFilter) {
  const sheet = ss.getSheetByName(SHEET_ATTENDANCE_LOGS);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length <= 1) return [];

  const logs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] && !r[4]) continue;

    const logDate = String(r[1] || "").trim();
    const regNum = String(r[4] || "").trim();

    if (dateFilter && logDate !== dateFilter) continue;
    if (regFilter && regNum.toLowerCase() !== regFilter.toLowerCase()) continue;

    logs.push({
      log_id: String(r[0] || ""),
      date: logDate,
      time: String(r[2] || ""),
      timestamp: String(r[3] || ""),
      reg_num: regNum,
      name: String(r[5] || ""),
      department: String(r[6] || ""),
      session_type: String(r[7] || ""),
      status: String(r[8] || "Present"),
      confidence_score: String(r[9] || ""),
      admin_email: String(r[10] || ""),
      device_info: String(r[11] || ""),
      remarks: String(r[12] || "")
    });
  }
  return logs.reverse(); // Newest first
}

function fetchStudentPersonalStats(ss, regNum, email) {
  const registered = fetchRegisteredFaces(ss);
  const student = registered.find(s => 
    (regNum && s.reg_num.toUpperCase() === regNum.toUpperCase()) ||
    (email && s.email.toLowerCase() === email.toLowerCase())
  );

  const logs = fetchAttendanceLogs(ss, "", student ? student.reg_num : regNum);
  const schedules = fetchScheduleConfig(ss);
  const holidays = fetchHolidays(ss);

  const presentCount = logs.filter(l => (l.status || '').toLowerCase().includes('present') || (l.status || '').toLowerCase().includes('on time') || (l.status || '').toLowerCase().includes('late')).length;
  const onTimeCount = logs.filter(l => (l.status || '').toLowerCase().includes('present') || (l.status || '').toLowerCase().includes('on time')).length;
  const lateCount = logs.filter(l => (l.status || '').toLowerCase().includes('late')).length;
  
  // Calculate total distinct dates present
  const uniqueDatesPresent = new Set(logs.map(l => l.date)).size;
  const totalSessions = Math.max(logs.length, 1);
  const attendancePercentage = totalSessions > 0 ? ((presentCount / totalSessions) * 100).toFixed(1) : "0.0";

  return {
    status: "success",
    student: student || null,
    isRegistered: !!student,
    attendancePercentage: attendancePercentage,
    totalSessions: totalSessions,
    presentCount: presentCount,
    onTimeCount: onTimeCount,
    lateCount: lateCount,
    holidaysExemptedCount: holidays.length,
    logs: logs,
    schedules: schedules,
    holidays: holidays
  };
}

function fetchScheduleConfig(ss) {
  const sheet = ss.getSheetByName(SHEET_SCHEDULES);
  if (!sheet) return {};
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length <= 1) return {};

  const config = {};
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0] || "").trim();
    const val = String(rows[i][1] || "").trim();
    if (key) {
      if (key === "hourly_slots") {
        try {
          config[key] = JSON.parse(val);
        } catch (e) {
          config[key] = val;
        }
      } else {
        config[key] = val;
      }
    }
  }
  return config;
}

function fetchHolidays(ss) {
  const sheet = ss.getSheetByName(SHEET_HOLIDAYS);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length <= 1) return [];

  const holidays = [];
  for (let i = 1; i < rows.length; i++) {
    const dateStr = String(rows[i][0] || "").trim();
    if (!dateStr) continue;
    holidays.push({
      holiday_date: dateStr,
      title: String(rows[i][1] || "").trim(),
      type: String(rows[i][2] || "Full Day").trim(),
      created_at: String(rows[i][3] || ""),
      created_by: String(rows[i][4] || "")
    });
  }
  return holidays;
}

// ==========================================
// MUTATION HANDLERS
// ==========================================

function handleRegisterFace(ss, data) {
  const regNum = String(data.reg_num || "").trim();
  if (!regNum) return { status: "error", message: "Student registration number is required." };

  const name = String(data.name || "").trim();
  const department = String(data.department || "").trim();
  const year = String(data.year || "").trim();
  const email = String(data.email || "").trim();
  const descriptor = typeof data.descriptor === "object" ? JSON.stringify(data.descriptor) : String(data.descriptor || "");
  const photo = String(data.photo_thumbnail || data.photo || "");
  const adminEmail = String(data.admin_email || "Admin").trim();
  const nowISO = new Date().toISOString();

  const sheet = ss.getSheetByName(SHEET_REGISTERED_FACES);
  const rows = sheet.getDataRange().getDisplayValues();

  let existingRowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toUpperCase() === regNum.toUpperCase()) {
      existingRowIndex = i + 1; // 1-based index in sheet
      break;
    }
  }

  if (existingRowIndex > 0) {
    // Update existing student face
    sheet.getRange(existingRowIndex, 2).setValue(name || rows[existingRowIndex - 1][1]);
    sheet.getRange(existingRowIndex, 3).setValue(department || rows[existingRowIndex - 1][2]);
    sheet.getRange(existingRowIndex, 4).setValue(year || rows[existingRowIndex - 1][3]);
    sheet.getRange(existingRowIndex, 5).setValue(email || rows[existingRowIndex - 1][4]);
    if (descriptor) sheet.getRange(existingRowIndex, 6).setValue(descriptor);
    if (photo) sheet.getRange(existingRowIndex, 7).setValue(photo);
    sheet.getRange(existingRowIndex, 10).setValue("Active");
    sheet.getRange(existingRowIndex, 11).setValue(nowISO);

    return {
      status: "success",
      action: "updated",
      message: `Face profile updated for ${name || regNum}`,
      reg_num: regNum
    };
  } else {
    // Insert new registration
    sheet.appendRow([
      regNum, name, department, year, email, descriptor,
      photo, nowISO, adminEmail, "Active", nowISO
    ]);

    return {
      status: "success",
      action: "created",
      message: `Face successfully registered for ${name || regNum}`,
      reg_num: regNum
    };
  }
}

function handleDeleteFace(ss, data) {
  const regNum = String(data.reg_num || "").trim();
  if (!regNum) return { status: "error", message: "Missing reg_num" };

  const sheet = ss.getSheetByName(SHEET_REGISTERED_FACES);
  const rows = sheet.getDataRange().getDisplayValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toUpperCase() === regNum.toUpperCase()) {
      sheet.deleteRow(i + 1);
      return { status: "success", message: `Registered face removed for ${regNum}` };
    }
  }

  return { status: "error", message: `Record not found for ${regNum}` };
}

function handleMarkAttendance(ss, data) {
  const regNum = String(data.reg_num || "").trim();
  if (!regNum) return { status: "error", message: "Student Registration Number is required." };

  const name = String(data.name || "").trim();
  const department = String(data.department || "").trim();
  const sessionType = String(data.session_type || "FN").trim();
  const status = String(data.status || "Present").trim();
  const confidence = String(data.confidence_score || "").trim();
  const adminEmail = String(data.admin_email || "").trim();
  const deviceInfo = String(data.device_info || "").trim();
  const remarks = String(data.remarks || "Face Recognized").trim();

  const now = new Date();
  const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone() || "GMT+05:30", "yyyy-MM-dd");
  const timeStr = Utilities.formatDate(now, Session.getScriptTimeZone() || "GMT+05:30", "hh:mm:ss a");
  const logId = "FACELOG_" + now.getTime() + "_" + Math.floor(Math.random() * 1000);

  const sheet = ss.getSheetByName(SHEET_ATTENDANCE_LOGS);
  const rows = sheet.getDataRange().getDisplayValues();

  // Duplicate Check: Check if already marked for same date & session
  for (let i = 1; i < rows.length; i++) {
    const rDate = String(rows[i][1]).trim();
    const rReg = String(rows[i][4]).trim();
    const rSession = String(rows[i][7]).trim();

    if (rDate === dateStr && rReg.toUpperCase() === regNum.toUpperCase() && rSession.toUpperCase() === sessionType.toUpperCase()) {
      return {
        status: "duplicate",
        message: `Attendance already affixed today for ${name || regNum} (${sessionType} session) at ${rows[i][2]}`,
        existingLog: {
          date: rDate,
          time: rows[i][2],
          session_type: rSession,
          status: rows[i][8]
        }
      };
    }
  }

  sheet.appendRow([
    logId, dateStr, timeStr, now.toISOString(), regNum, name,
    department, sessionType, status, confidence, adminEmail, deviceInfo, remarks
  ]);

  return {
    status: "success",
    message: `Attendance affixed successfully for ${name} (${regNum})`,
    log: {
      log_id: logId,
      date: dateStr,
      time: timeStr,
      reg_num: regNum,
      name: name,
      session_type: sessionType,
      status: status,
      confidence_score: confidence
    }
  };
}

function handleBulkMarkAttendance(ss, data) {
  const logs = data.logs || [];
  if (!Array.isArray(logs) || logs.length === 0) {
    return { status: "error", message: "No logs provided for bulk sync" };
  }

  const sheet = ss.getSheetByName(SHEET_ATTENDANCE_LOGS);
  let count = 0;
  logs.forEach(item => {
    const now = new Date(item.timestamp || Date.now());
    const dateStr = item.date || Utilities.formatDate(now, Session.getScriptTimeZone() || "GMT+05:30", "yyyy-MM-dd");
    const timeStr = item.time || Utilities.formatDate(now, Session.getScriptTimeZone() || "GMT+05:30", "hh:mm:ss a");
    const logId = item.log_id || ("FACELOG_" + now.getTime() + "_" + Math.floor(Math.random() * 1000));

    sheet.appendRow([
      logId, dateStr, timeStr, now.toISOString(),
      item.reg_num || "", item.name || "", item.department || "",
      item.session_type || "FN", item.status || "Present",
      item.confidence_score || "", item.admin_email || "", item.device_info || "", item.remarks || "Offline Sync"
    ]);
    count++;
  });

  return {
    status: "success",
    message: `Bulk synced ${count} attendance logs`,
    count: count
  };
}

function handleSaveSchedule(ss, data) {
  const configs = data.configs || {};
  const adminEmail = String(data.admin_email || "Admin");
  const sheet = ss.getSheetByName(SHEET_SCHEDULES);
  const nowISO = new Date().toISOString();

  const rows = sheet.getDataRange().getDisplayValues();
  const keyToRow = {};
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0]).trim();
    if (key) keyToRow[key] = i + 1;
  }

  for (const key in configs) {
    let val = configs[key];
    if (typeof val === "object") val = JSON.stringify(val);

    if (keyToRow[key]) {
      sheet.getRange(keyToRow[key], 2).setValue(val);
      sheet.getRange(keyToRow[key], 4).setValue(nowISO);
      sheet.getRange(keyToRow[key], 5).setValue(adminEmail);
    } else {
      sheet.appendRow([key, val, "Custom Config", nowISO, adminEmail]);
    }
  }

  return {
    status: "success",
    message: "Schedule timings updated successfully",
    schedules: fetchScheduleConfig(ss)
  };
}

function handleSaveHolidays(ss, data) {
  const holidays = data.holidays || [];
  const adminEmail = String(data.admin_email || "Admin");
  const sheet = ss.getSheetByName(SHEET_HOLIDAYS);
  const nowISO = new Date().toISOString();

  // Clear existing holidays and rebuild
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }

  holidays.forEach(h => {
    if (h.holiday_date) {
      sheet.appendRow([
        h.holiday_date,
        h.title || "Holiday",
        h.type || "Full Day",
        h.created_at || nowISO,
        adminEmail
      ]);
    }
  });

  return {
    status: "success",
    message: `Saved ${holidays.length} holiday exceptions`,
    holidays: fetchHolidays(ss)
  };
}

function handleDeleteHoliday(ss, data) {
  const holidayDate = String(data.holiday_date || "").trim();
  if (!holidayDate) return { status: "error", message: "Missing holiday_date" };

  const sheet = ss.getSheetByName(SHEET_HOLIDAYS);
  const rows = sheet.getDataRange().getDisplayValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === holidayDate) {
      sheet.deleteRow(i + 1);
      return { status: "success", message: `Holiday removed for ${holidayDate}` };
    }
  }

  return { status: "error", message: `Holiday not found for ${holidayDate}` };
}
