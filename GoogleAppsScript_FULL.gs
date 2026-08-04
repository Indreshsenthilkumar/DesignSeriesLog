// ============================================================
//  DesignSeries Attendance Portal — Google Apps Script (FULL)
//  v8 — INTEGRATED ACCESS CONTROL (LOGIN/LOGOUT/BLOCK/UNBLOCK)
// ============================================================

const STUDENT_SHEET = "StudentData";
const LOG_SHEET     = "Attendancelog";
const SUPER_ADMIN   = "indreshs.it24@bitsathy.ac.in";
const CACHE_TTL     = 60; 

// --- CACHE ENGINE ---
function getFromCache(key) {
  try {
    const cache = CacheService.getScriptCache();
    const data = cache.get(key);
    return data ? JSON.parse(data) : null;
  } catch(e) {
    return null;
  }
}

function putInCache(key, value, ttlSeconds) {
  try {
    const cache = CacheService.getScriptCache();
    cache.put(key, JSON.stringify(value), ttlSeconds || 300);
  } catch(e) {}
}

function clearFromCache(key) {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(key);
  } catch(e) {}
}

// ════════════════════════════════════════════════════════════
//  ENTRY POINTS
// ════════════════════════════════════════════════════════════

function doGet(e) {
  try {
    const params = e.parameter;
    const isAdmin = checkAdminStatus(params.adminEmail);
    
    if (params.action === "getHighestPoints") {
      return respondJSON(getHighestPointsFromChart());
    }
    if (params.action === "getRewardPoints") {
      return respondJSON(getRewardPointsFromExternalCSV(params.email));
    }
    if (params.action === "getTasks") {
      return respondJSON(getAllTasks());
    }
    if (params.action === "getNotifications") {
      return respondJSON(getAllNotifications());
    }
    if (params.action === "getUserExtensions") {
      return respondJSON(getUserExtensions(params.email));
    }
    if (params.adminAction === "getAllUsers" && isAdmin) {
      return respondJSON(getAllStudents());
    }
    if (params.adminAction === "getAdmins" && isAdmin) {
      return respondJSON(getAdminsOnly());
    }
    if (params.adminAction === "getAllAnalytics" && isAdmin) {
      return respondJSON(getAllAnalytics(params.startRow, params.limit));
    }
    if (params.adminAction === "getAdminSummary" && isAdmin) {
      return respondJSON(getAdminAnalyticsSummary());
    }
    if (params.adminAction === "getAllExtensions" && isAdmin) {
      return respondJSON(getAllExtensions());
    }
    if (params.email) {
      const bypass = params.bypassCache === "true" || params.force === "true";
      return respondJSON(getStudentData(params.email, bypass));
    }
    
    return respondJSON({ status: "error", message: "No valid GET action or insufficient permissions." });
  } catch(err) {
    return respondJSON({ status: "error", message: err.toString() });
  }
}

function doPost(e) {
  try {
    let body;
    if (e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (jsonErr) {
        // Fallback for form/url encoded body
        body = {};
        const parts = e.postData.contents.split("&");
        parts.forEach(part => {
          const pair = part.split("=");
          const key = decodeURIComponent(pair[0].replace(/\+/g, '%20'));
          const val = decodeURIComponent((pair[1] || "").replace(/\+/g, '%20'));
          body[key] = val;
        });
        // Check if there is a 'data' param containing JSON
        if (body.data) {
          try {
            body = JSON.parse(body.data);
          } catch(e) {}
        }
      }
    } else {
      body = e.parameter || {};
    }
    
    if (body.action === "publishTaskAssignment") {
      return respondJSON(saveTaskAssignment(body));
    }
    if (body.action === "publishAdvancedNotif") {
      return respondJSON(saveNotificationAssignment(body));
    }
    if (body.action === "registerFCMToken" && body.email && body.token) {
      return respondJSON(registerFCMToken(body.email, body.token));
    }
    if (body.action === "requestExtension") {
      return respondJSON(requestExtension(body));
    }
    
    const isAdmin = checkAdminStatus(body.adminEmail || body.admin);
    
    // 🛡️ ADMIN ACTIONS
    if (isAdmin) {
      if (body.action === "deleteUser") return respondJSON(deleteUser(body.targetEmail));
      if (body.action === "addUser")    return respondJSON(addUser(body.userData));
      if (body.action === "updateRole") return respondJSON(updateUserRole(body.targetEmail, body.newRole));
      if (body.action === "updateAdminPermission") return respondJSON(updateAdminPermission(body.targetEmail, body.moduleId, body.isAllowed));
      if (body.action === "approveExtension") return respondJSON(approveExtension(body.requestId, body.newDeadline));
      if (body.action === "rejectExtension") return respondJSON(rejectExtension(body.requestId));
    }

    // 🔑 ACCESS CONTROL ACTIONS (Login/Logout State)
    if (body.action === "updateStatus" && body.email && body.status) {
      return respondJSON(updateUserStatus(body.email, body.status));
    }

    // 👤 STANDARD ATTENDANCE RECORDING
    if (body.date && body.email && body.hours) {
      return respondJSON(recordAttendance(body));
    }
    
    return respondJSON({ status: "error", message: "Missing required fields or invalid action." });
  } catch (err) {
    return respondJSON({ status: "error", message: "doPost error: " + err.toString() });
  }
}

// ════════════════════════════════════════════════════════════
//  CORE FUNCTIONS
// ════════════════════════════════════════════════════════════

function getAllAnalytics(startRow, limit) {
  const ss = getSpreadsheet();
  const logSheet = ss.getSheetByName(LOG_SHEET);
  if (!logSheet) return { status: "error", message: "Log sheet not found." };
  
  const totalRows = logSheet.getLastRow();
  let start = startRow ? parseInt(startRow) : 2;
  let rowCount = limit ? parseInt(limit) : 200;
  
  if (start < 2) start = 2;
  if (start > totalRows) return { status: "success", history: [], hasMore: false };
  
  const actualLimit = Math.min(rowCount, totalRows - start + 1);
  const logData = logSheet.getRange(start, 1, actualLimit, 7).getValues();
  
  const history = logData.map(row => ({
    date: (row[0] instanceof Date) ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), "yyyy-MM-dd") : row[0],
    rollNo: row[1],
    name: row[2],
    email: row[3],
    hours: row[4],
    reason: row[5],
    timestamp: row[6]
  })).reverse();

  return { status: "success", history: history, hasMore: (start + actualLimit <= totalRows) };
}

function getStudentData(email, bypassCache) {
  const emailLower = email.toLowerCase().trim();
  const cacheKey = "student_data_" + emailLower.replace(/[^a-zA-Z0-9]/g, "_");
  if (!bypassCache) {
    const cachedVal = getFromCache(cacheKey);
    if (cachedVal) {
      return cachedVal;
    }
  }

  const ss = getSpreadsheet();
  const studentSheet = ss.getSheetByName(STUDENT_SHEET);
  const studentData = studentSheet.getDataRange().getValues();
  const headers = studentData[0].map(h => h.toString().toLowerCase().trim().replace(/\s+/g, '_'));
  
  let student = null;
  const emailIdx = studentData[0].findIndex(h => h.toString().toLowerCase().includes("email"));

  for (let i = 1; i < studentData.length; i++) {
    if ((studentData[i][emailIdx] || "").toString().toLowerCase().trim() === emailLower) {
      student = {};
      headers.forEach((h, idx) => { student[h] = studentData[i][idx]; });
      break;
    }
  }

  if (!student) return { status: "error", message: "User not found." };

  const logSheet = ss.getSheetByName(LOG_SHEET);
  const logData = logSheet.getDataRange().getValues();
  const history = logData.slice(1)
    .filter(row => (row[3] || "").toString().toLowerCase().trim() === emailLower)
    .map(row => ({
      date: (row[0] instanceof Date) ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), "yyyy-MM-dd") : row[0],
      rollNo: row[1],
      name: row[2],
      email: row[3],
      hours: row[4],
      reason: row[5],
      timestamp: row[6]
    }));

  const assignedTasks = getTasksForStudent(student);
  const notifications = getNotificationsForStudent(student);
  const extensionsResult = getUserExtensions(emailLower);
  const extensions = extensionsResult.status === "success" ? extensionsResult.extensions : [];
  
  const result = { status: "success", student: student, history: history, assignedTasks: assignedTasks, notifications: notifications, extensions: extensions };
  putInCache(cacheKey, result, 300);
  return result;
}

function updateUserStatus(email, newStatus) {
  const emailLower = email.toLowerCase().trim();
  const cacheKey = "student_data_" + emailLower.replace(/[^a-zA-Z0-9]/g, "_");
  clearFromCache(cacheKey);

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(STUDENT_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().toLowerCase().trim());
  
  const emailIdx = headers.findIndex(h => h.includes("email"));
  let statusIdx = headers.findIndex(h => h.includes("system_status"));
  
  // Auto-create column if missing
  if (statusIdx === -1) {
    statusIdx = headers.length;
    sheet.getRange(1, statusIdx + 1).setValue("System_Status");
  }

  for (let i = 1; i < data.length; i++) {
    if ((data[i][emailIdx] || "").toString().toLowerCase().trim() === emailLower) {
      // Don't override 'Blocked' unless unblocking
      const currentStatus = (data[i][statusIdx] || "").toString();
      if (currentStatus === "Blocked" && newStatus !== "Logged_Out") {
        return { status: "error", message: "Account is blocked." };
      }
      sheet.getRange(i + 1, statusIdx + 1).setValue(newStatus);
      return { status: "success", message: "Status updated to " + newStatus };
    }
  }
  return { status: "error", message: "User not found." };
}

function recordAttendance(body) {
  const { date, rollNo, name, email, hours, reason } = body;
  const cacheKey = "student_data_" + email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, "_");
  clearFromCache(cacheKey);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { status: "error", message: "Lock acquisition timeout. Spreadsheet is currently busy." };
  }

  try {
    const entriesSheet = getSpreadsheet().getSheetByName(LOG_SHEET);
    const now = new Date();
    const ts = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

    let hArr = Array.isArray(hours) ? hours : hours.toString().split(",").map(h => h.trim());
    const validHrs = [...new Set(hArr)].filter(h => h >= 1 && h <= 7).sort();

    const rowsToAdd = validHrs.map(hr => [date, rollNo || "N/A", name || "", email, hr, reason || "", ts]);
    if (rowsToAdd.length > 0) {
      entriesSheet.getRange(entriesSheet.getLastRow() + 1, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);
    }
    return { status: "success", message: "Attendance recorded." };
  } finally {
    lock.releaseLock();
  }
}

// ════════════════════════════════════════════════════════════
//  ADMIN HELPERS
// ════════════════════════════════════════════════════════════

function checkAdminStatus(email) {
  if (!email) return false;
  const emailLower = email.toLowerCase().trim();
  if (emailLower === SUPER_ADMIN.toLowerCase()) return true;
  
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(STUDENT_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().toLowerCase());
  
  const emailIdx = headers.findIndex(h => h.includes("email"));
  const roleIdx = headers.findIndex(h => h.includes("role"));
  
  if (emailIdx === -1 || roleIdx === -1) return false;
  
  for (let i = 1; i < data.length; i++) {
    if ((data[i][emailIdx] || "").toString().toLowerCase().trim() === emailLower) {
      return (data[i][roleIdx] || "").toString().toLowerCase().trim() === "admin";
    }
  }
  return false;
}

function getAllStudents() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(STUDENT_SHEET);
  if (!sheet) return { status: "error", message: "Sheet not found." };
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
  
  const students = data.slice(1)
    .filter(row => row[2] && row[2].toString().includes("@"))
    .map(row => {
      let obj = {};
      headers.forEach((h, i) => { if(h) obj[h] = row[i]; });
      return obj;
    });
  
  return { status: "success", users: students };
}

function getAdminsOnly() {
  const result = getAllStudents();
  if (result.status === "error") return result;
  
  let admins = result.users.filter(u => (u.role || "").toLowerCase().trim() === "admin");
  
  if (!admins.find(u => (u.email || u.email_id || "").toLowerCase().trim() === SUPER_ADMIN.toLowerCase())) {
     admins.unshift({ name: "Primary Admin", email: SUPER_ADMIN, role: "Admin" });
  }
  return { status: "success", admins: admins };
}

function updateUserRole(targetEmail, newRole) {
  const emailLower = targetEmail.toLowerCase().trim();
  const cacheKey = "student_data_" + emailLower.replace(/[^a-zA-Z0-9]/g, "_");
  clearFromCache(cacheKey);

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(STUDENT_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().toLowerCase().trim());
  
  const emailIdx = headers.findIndex(h => h.includes("email"));
  let roleIdx = headers.findIndex(h => h.includes("role"));
  
  if (roleIdx === -1) {
    roleIdx = headers.length;
    sheet.getRange(1, roleIdx + 1).setValue("Role");
  }
  
  const searchMail = emailLower;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][emailIdx] || "").toString().toLowerCase().trim() === searchMail) {
      sheet.getRange(i + 1, roleIdx + 1).setValue(newRole);
      return { status: "success", message: `Role updated to ${newRole}` };
    }
  }
  return { status: "error", message: "User not found." };
}

function checkAdminPermission(email, moduleId) {
  if (!email) return false;
  const emailLower = email.toLowerCase().trim();
  if (emailLower === SUPER_ADMIN.toLowerCase()) return true;
  
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(STUDENT_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().toLowerCase().trim());
  
  const emailIdx = headers.findIndex(h => h.includes("email"));
  const roleIdx = headers.findIndex(h => h.includes("role"));
  
  if (emailIdx === -1 || roleIdx === -1) return false;
  
  const targetHeader = moduleId.toLowerCase().trim();
  const permIdx = headers.indexOf(targetHeader);
  
  for (let i = 1; i < data.length; i++) {
    if ((data[i][emailIdx] || "").toString().toLowerCase().trim() === emailLower) {
      const isRoleAdmin = (data[i][roleIdx] || "").toString().toLowerCase().trim() === "admin";
      if (!isRoleAdmin) return false;
      if (permIdx === -1) return false;
      const val = data[i][permIdx];
      return val === true || val === "TRUE" || val === "true" || val === 1 || val === "1";
    }
  }
  return false;
}

function updateAdminPermission(targetEmail, moduleId, isAllowed) {
  const emailLower = targetEmail.toLowerCase().trim();
  const cacheKey = "student_data_" + emailLower.replace(/[^a-zA-Z0-9]/g, "_");
  clearFromCache(cacheKey);

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(STUDENT_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().toLowerCase().trim());
  
  const emailIdx = headers.findIndex(h => h.includes("email"));
  if (emailIdx === -1) return { status: "error", message: "Email column not found in student sheet." };
  
  const targetHeader = moduleId.toLowerCase().trim();
  let permIdx = headers.indexOf(targetHeader);
  
  if (permIdx === -1) {
    permIdx = headers.length;
    sheet.getRange(1, permIdx + 1).setValue(moduleId);
  }
  
  const searchMail = emailLower;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][emailIdx] || "").toString().toLowerCase().trim() === searchMail) {
      sheet.getRange(i + 1, permIdx + 1).setValue(isAllowed ? "TRUE" : "FALSE");
      return { status: "success", message: `Permission updated successfully` };
    }
  }
  return { status: "error", message: "User not found." };
}

function deleteUser(targetEmail) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(STUDENT_SHEET);
  const data = sheet.getDataRange().getValues();
  const emailIdx = data[0].findIndex(h => h.toString().toLowerCase().includes("email"));
  
  const searchMail = targetEmail.toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    if ((data[i][emailIdx] || "").toString().toLowerCase().trim() === searchMail) {
      sheet.deleteRow(i + 1);
      return { status: "success", message: "User deleted." };
    }
  }
  return { status: "error", message: "User not found." };
}

function addUser(userData) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(STUDENT_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().toLowerCase().replace(/\s+/g, '_'));
  
  const emailIdx = data[0].findIndex(h => h.toString().toLowerCase().includes("email"));
  for (let i = 1; i < data.length; i++) {
    if ((data[i][emailIdx] || "").toString().toLowerCase().trim() === userData.email_id?.toLowerCase()) {
       return { status: "error", message: "User already exists." };
    }
  }
  
  const newRow = headers.map(h => userData[h] || "");
  sheet.appendRow(newRow);
  return { status: "success", message: "User added successfully." };
}

function respondJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getAdminAnalyticsSummary() {
  const ss = getSpreadsheet();
  
  // 1. Attendance Log Count
  let attendanceToday = 0;
  let attendanceTotal = 0;
  const logSheet = ss.getSheetByName(LOG_SHEET);
  if (logSheet) {
    const data = logSheet.getDataRange().getValues();
    const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    for (let i = 1; i < data.length; i++) {
      attendanceTotal++;
      const dateVal = data[i][0];
      const dateStr = (dateVal instanceof Date) ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "yyyy-MM-dd") : (dateVal ? dateVal.toString() : '');
      if (dateStr === todayStr) {
        attendanceToday++;
      }
    }
  }
  
  // 2. Worklog Count
  let worklogsToday = 0;
  let worklogsTotal = 0;
  const worklogSheet = ss.getSheetByName("Worklog") || ss.getSheetByName("Worklogs") || ss.getSheetByName("WorklogData");
  if (worklogSheet) {
    const data = worklogSheet.getDataRange().getValues();
    const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    
    let dateColIdx = 0;
    if (data.length > 0) {
      const headers = data[0].map(h => h.toString().toLowerCase().trim());
      const idx = headers.indexOf("date");
      if (idx !== -1) dateColIdx = idx;
    }
    
    for (let i = 1; i < data.length; i++) {
      worklogsTotal++;
      const dateVal = data[i][dateColIdx];
      const dateStr = (dateVal instanceof Date) ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "yyyy-MM-dd") : (dateVal ? dateVal.toString() : '');
      if (dateStr === todayStr) {
        worklogsToday++;
      }
    }
  }
  
  // 3. Total Students Count
  let totalStudents = 0;
  const studentSheet = ss.getSheetByName(STUDENT_SHEET);
  if (studentSheet) {
    totalStudents = studentSheet.getLastRow() - 1;
  }
  
  return {
    status: "success",
    attendanceToday: attendanceToday,
    attendanceTotal: attendanceTotal,
    worklogsToday: worklogsToday,
    worklogsTotal: worklogsTotal,
    totalStudents: totalStudents
  };
}

function getHighestPointsFromChart() {
  const url = "https://docs.google.com/spreadsheets/d/e/2CAIWO3em3HQZrRGzVdUU7mHdTcBe0gKU1yB-wzrIfkQpSL58Bi8N9fEQJUR3vs4fAaHNRQ9cpp7EkWB-UsQ/gviz/chartiframe?oid=1134533186";
  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true
    });
    const html = response.getContentText();
    const match = html.match(/chartJson':\s*'([^']+)'/);
    if (match) {
      const decodedJsonStr = match[1].replace(/\\x([0-9a-fA-F]{2})/g, function(g, m) {
        return String.fromCharCode(parseInt(m, 16));
      });
      const data = JSON.parse(decodedJsonStr);
      const rows = data.dataTable.rows;
      const points = {};
      rows.forEach(row => {
        if (row.c && row.c[0]) {
          const year = row.c[0].v;
          const val = (row.c[1] && row.c[1].v !== null) ? row.c[1].v : 0;
          points[year] = val;
        }
      });
      return { status: "success", points: points };
    }
    return { status: "error", message: "Chart data not found in HTML" };
  } catch(err) {
    return { status: "error", message: err.toString() };
  }
}

// ════════════════════════════════════════════════════════════
//  TASK MANAGEMENT HELPERS
// ════════════════════════════════════════════════════════════

function getTasksSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName("Tasks");
  if (!sheet) {
    sheet = ss.insertSheet("Tasks");
    sheet.appendRow(["Timestamp", "Title", "Description", "Deadline", "Task Date", "Targets", "Link", "Images", "Admin"]);
    sheet.getRange(1, 1, 1, 9).setBackground("#F1F5F9").setFontWeight("bold");
  }
  return sheet;
}

function saveTaskAssignment(data) {
  try {
    const sheet = getTasksSheet();
    const now = new Date();
    const ts = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    
    // Structure the target string
    const targets = {
      years: data.targets?.years || [],
      domains: data.targets?.domains || [],
      users: (data.targets?.users || []).map(u => u.email)
    };
    
    sheet.appendRow([
      ts,
      data.title || "",
      data.desc || "",
      data.deadline || "",
      data.taskDate || "",
      JSON.stringify(targets),
      data.link || "",
      JSON.stringify(data.images || []),
      data.admin || ""
    ]);
    
    return { status: "success", message: "Task assigned successfully." };
  } catch (err) {
    return { status: "error", message: "Save task error: " + err.toString() };
  }
}

function getAllTasks() {
  try {
    const sheet = getTasksSheet();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { status: "success", tasks: [] };
    
    const tasks = [];
    for (let i = 1; i < data.length; i++) {
      let targets = {};
      try { targets = JSON.parse(data[i][5]); } catch(e) {}
      
      let images = [];
      try { images = JSON.parse(data[i][7]); } catch(e) {}
      
      let targetCount = 0;
      if (targets.users && targets.users.length > 0) {
        targetCount = targets.users.length;
      } else if ((targets.years && targets.years.length > 0) || (targets.domains && targets.domains.length > 0)) {
        targetCount = "Filtered";
      } else {
        targetCount = "All";
      }
      
      tasks.push({
        timestamp: data[i][0],
        title: data[i][1],
        desc: data[i][2],
        deadline: data[i][3],
        taskDate: data[i][4],
        targets: targets,
        target_count: targetCount,
        link: data[i][6],
        images: images,
        admin: data[i][8]
      });
    }
    return { status: "success", tasks: tasks.reverse() };
  } catch(err) {
    return { status: "error", message: "Get tasks error: " + err.toString() };
  }
}

function getTasksForStudent(student) {
  try {
    const sheet = getTasksSheet();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    
    const sEmail = (student.email_id || student.email || "").toLowerCase().trim();
    const sYearRaw = (student.year || "").toString().toLowerCase().trim();
    const sDomainRaw = (student.domain || "").toString().toLowerCase().trim();
    
    const sYearMatch = sYearRaw.match(/\d+/);
    const sYearNum = sYearMatch ? sYearMatch[0] : sYearRaw;
    
    const tasks = [];
    for (let i = 1; i < data.length; i++) {
      let targets = {};
      try { targets = JSON.parse(data[i][5]); } catch(e) {}
      
      let images = [];
      try { images = JSON.parse(data[i][7]); } catch(e) {}
      
      const targetUsers = (targets.users || []).map(u => u.toLowerCase().trim());
      const targetYears = (targets.years || []).map(y => y.toString().toLowerCase().trim());
      const targetDomains = (targets.domains || []).map(d => d.toLowerCase().trim());
      
      let isTargeted = false;
      
      if (targetUsers.length === 0 && targetYears.length === 0 && targetDomains.length === 0) {
        isTargeted = true;
      } else {
        if (targetUsers.includes(sEmail)) {
          isTargeted = true;
        }
        
        if (!isTargeted && targetYears.length > 0) {
          const yearMatched = targetYears.some(y => {
            const yNumMatch = y.match(/\d+/);
            const yNum = yNumMatch ? yNumMatch[0] : y;
            return sYearNum.includes(yNum) || yNum.includes(sYearNum) || sYearRaw.includes(y);
          });
          if (yearMatched) isTargeted = true;
        }
        
        if (!isTargeted && targetDomains.length > 0) {
          const domainMatched = targetDomains.some(d => {
            return sDomainRaw.includes(d) || d.includes(sDomainRaw);
          });
          if (domainMatched) isTargeted = true;
        }
      }
      
      if (isTargeted) {
        tasks.push({
          timestamp: data[i][0],
          title: data[i][1],
          desc: data[i][2],
          deadline: data[i][3],
          taskDate: data[i][4],
          link: data[i][6],
          images: images
        });
      }
    }
    return tasks.reverse();
  } catch (err) {
    return [];
  }
}


function getSpreadsheet() {
  return SpreadsheetApp.openById("1NzalQvWi_X_ecyjGVM4JN3IhrxDekmt3GlXi--HwJAY");
}

// ════════════════════════════════════════════════════════════
//  NOTIFICATION DATABASE & REAL-TIME DISPATCH HELPERS
// ════════════════════════════════════════════════════════════

function getNotificationsSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName("Notifications");
  if (!sheet) {
    sheet = ss.insertSheet("Notifications");
    sheet.appendRow(["Timestamp", "Title", "LaunchTime", "Deadline", "Iframe", "Targets", "Admin", "Description"]);
    sheet.getRange(1, 1, 1, 8).setBackground("#F1F5F9").setFontWeight("bold");
  }
  return sheet;
}

function saveNotificationAssignment(data) {
  try {
    const sheet = getNotificationsSheet();
    const now = new Date();
    const ts = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    
    // Structure the targets filter
    const targets = {
      years: data.targets?.years || [],
      domains: data.targets?.domains || [],
      users: (data.targets?.users || []).map(u => u.email)
    };
    
    sheet.appendRow([
      ts,
      data.title || "",
      data.launch || "",
      data.deadline || "",
      data.iframe || "",
      JSON.stringify(targets),
      data.admin || "",
      data.description || ""
    ]);
    
    // Send FCM push notifications to targeted students
    try {
      const targetEmails = getTargetStudentEmails(targets);
      if (targetEmails.length > 0) {
        sendFcmNotification(targetEmails, data.title || "New Notification", data.description || "");
      }
    } catch (fcmErr) {
      console.error("Error sending FCM notification: " + fcmErr.toString());
    }
    
    return { status: "success", message: "Notification posted successfully." };
  } catch (err) {
    return { status: "error", message: "Save notification error: " + err.toString() };
  }
}

function getAllNotifications() {
  try {
    const sheet = getNotificationsSheet();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { status: "success", notifications: [] };
    
    const notifications = [];
    for (let i = 1; i < data.length; i++) {
      let targets = {};
      try { targets = JSON.parse(data[i][5]); } catch(e) {}
      
      notifications.push({
        timestamp: data[i][0],
        title: data[i][1],
        launch: data[i][2],
        deadline: data[i][3],
        iframe: data[i][4],
        targets: targets,
        admin: data[i][6],
        description: data[i][7] || ""
      });
    }
    return { status: "success", notifications: notifications.reverse() };
  } catch(err) {
    return { status: "error", message: "Get notifications error: " + err.toString() };
  }
}

function getNotificationsForStudent(student) {
  try {
    const sheet = getNotificationsSheet();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    
    const sEmail = (student.email_id || student.email || "").toLowerCase().trim();
    const sYearRaw = (student.year || "").toString().toLowerCase().trim();
    const sDomainRaw = (student.domain || "").toString().toLowerCase().trim();
    
    const sYearMatch = sYearRaw.match(/\d+/);
    const sYearNum = sYearMatch ? sYearMatch[0] : sYearRaw;
    
    const notifications = [];
    const nowTime = new Date().getTime();
    
    for (let i = 1; i < data.length; i++) {
      let targets = {};
      try { targets = JSON.parse(data[i][5]); } catch(e) {}
      
      const targetUsers = (targets.users || []).map(u => u.toLowerCase().trim());
      const targetYears = (targets.years || []).map(y => y.toString().toLowerCase().trim());
      const targetDomains = (targets.domains || []).map(d => d.toLowerCase().trim());
      
      let isTargeted = false;
      
      if (targetUsers.length === 0 && targetYears.length === 0 && targetDomains.length === 0) {
        isTargeted = true;
      } else {
        // Clean target arrays from URL plus symbols ('+')
        const cleanYears = targetYears.map(y => y.replace(/\+/g, ' '));
        const cleanDomains = targetDomains.map(d => d.replace(/\+/g, ' '));
        
        // 1. Direct user email targeting takes absolute precedence
        if (targetUsers.includes(sEmail)) {
          isTargeted = true;
        } else {
          // 2. Strict intersection targeting: If both year and domain filters exist, student MUST match both.
          let matchesYear = true;
          let matchesDomain = true;
          
          if (cleanYears.length > 0) {
            matchesYear = cleanYears.some(y => {
              const cleanY = y.replace(/[\s_]/g, '');
              const cleanStudentY = sYearRaw.replace(/[\s_]/g, '');
              
              // Attempt numerical check if available
              const yNumMatch = y.match(/\d+/);
              if (yNumMatch && sYearNum) {
                return sYearNum.includes(yNumMatch[0]) || yNumMatch[0].includes(sYearNum);
              }
              return cleanStudentY.includes(cleanY) || cleanY.includes(cleanStudentY);
            });
          }
          
          if (cleanDomains.length > 0) {
            matchesDomain = cleanDomains.some(d => {
              const cleanD = d.replace(/[\s_]/g, '');
              const cleanStudentD = sDomainRaw.replace(/[\s_]/g, '');
              return cleanStudentD.includes(cleanD) || cleanD.includes(cleanStudentD);
            });
          }
          
          // Require target matches for categories configured
          if (cleanYears.length > 0 && cleanDomains.length > 0) {
            isTargeted = matchesYear && matchesDomain;
          } else if (cleanYears.length > 0) {
            isTargeted = matchesYear;
          } else if (cleanDomains.length > 0) {
            isTargeted = matchesDomain;
          }
        }
      }
      
      if (isTargeted) {
        const launchStr = data[i][2];
        const deadlineStr = data[i][3];
        
        const launchTime = launchStr ? new Date(launchStr).getTime() : 0;
        const deadlineTime = deadlineStr ? new Date(deadlineStr).getTime() : Infinity;
        
        if (nowTime >= launchTime && nowTime <= deadlineTime) {
          notifications.push({
            timestamp: data[i][0],
            title: data[i][1],
            launch: data[i][2],
            deadline: data[i][3],
            iframe: data[i][4],
            description: data[i][7] || ""
          });
        }
      }
    }
    return notifications.reverse();
  } catch (err) {
    return [];
  }
}

// ════════════════════════════════════════════════════════════
//  FCM PUSH CONFIGURATION & UTILITIES
// ════════════════════════════════════════════════════════════
const USER_TOKENS_SHEET = "UserTokens";

const SERVICE_ACCOUNT = {
  "project_id": "designseries-web",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDji9v1KN4cItdL\nL5PwhQIOV49fypsJbN26Xln4a8I+IJiznFDK/DSrJ6koV5vE8b6l0ka466hPcSdv\ntpcCsRrY03z5lWsS6aC9/So5FsNFF2pYSguJK3UFGMfCR2NwlBVy3D4OooWsUQ+6\nn0tPJWz4vfSLVaTVP5e8IqrOaQ1USzkd5RfT+ATAESEJgb3+0i5x49BeYRjke7kY\nZK6/CxTYrzEp+6pRCOeE4mBO9RKzTf49qy/GMidGBxbYNtld1muQN34jUUlB918f\n+tvrCPHWv5rrxH7ItxfqmCGTQBvyfgHzA64cmYEIrhceE1aTXgHz3CttX8TLuNyx\nhoaJ7NmHAgMBAAECggEAIouBnbMSIUhi0g3LkmjG+qFtaVgLeH9YHCql0xKc/yyY\nsi/pjh+C6XcQdcjzI4+l52vIg9t3BnSBzbJ1M5nqnv9gik2WX10ro5xTNC6R/6PB\n59x56t23msn7zbFj1dwNc44fN76Rt6rozebQGphudkb0YNDkQOGyKgRDVSnatbCa\nlv4yOTPcTBH+HD2cw08nyqeAvTmh2r5wz2EQfMW0CBttwRu2XLZcYR0Ylre3F6vh\nrqKUeKFCkAERZFEF78M5XuLN78rmL/tTdsXz+gj/ftqPORrxFSvOtDkhkx8cpn0B\nI5lD8VXrGVNhtgKpzJSdmufHJz+x+UjVkp3kjE/kmQKBgQDybI9GRHk6U37ScoBi\ndv9pGpNYb9raLmLHAW5zscChvpHAsIjKnv4K5G65C52b/ulk/IBQkNfZAJJVQzdJ\noYcb2aTyu0WBI9jBa2Qo8dC8lW843JeJRLPrum5NIaWwcTTmPr/cQt59fcqTJ9cG\n5RapQNxL9wETY8CdBNWURnpyPwKBgQDwSgJiOs2TZwTt4L3Xk5wXl3oqpWCjfF1f\nf34w6yRtAkb4lbbDVIVv11wutdG2JQ1aKhFvZMEUOwuCs3b3s/GFt6ygXGhOnHC8\nCdjRkRQLN1rnlJ6kVbbVyUYMRW7W3FBpiNkd2qkOV8OLiscaelUHsB7qIHLcColR\nWjBlNOk2uQKBgQC4y/Rz1iKrSZa1ib9AUAHm9vE3Sx0DkLSPixHNc8SqB4FH58p+\n2rBBUVzuBmLA1ZLI/oo54BAKRZtHD5QHtvAtVL2eow8aoF7NIrYZWCyMdUVxjQaf\nBxY4LceDWJDbbZCrq03J89dyxf80KfyKLvwVTXIhHktdon7jsxm0i/0vNQKBgAWf\n1dpywekXWjgvMIJhRCARPZzN7isleBIKK+v9NQcQLJUY/AQqcE0j31aAjv4Sc/OO\nVIYk95f/oc9XYAuAPMECgZnnT9G3O7RLDrYpDS0OCKSvB9+U2gi7A1a6MVP6KC+w\nMlTOj3J0f3E+uFZYUrExYCfexpF79abf044q5OKRAoGBANUTjqMUj0UDTGTWFLqR\nKyzQOnTerqVDXmCJC//PSp3KdMKABCZFEDkm6ASNPgMyoL925x7vPrm8SlAIIrxp\noluX38CVIe1eDJCGB7yyIsAJlO8wfOK1CTx8+cbz+NQCJG9/lws6IeXv2McrfImF\nPuNLEq9qWrr41yS5uqiuaOEh\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@designseries-web.iam.gserviceaccount.com",
  "token_uri": "https://oauth2.googleapis.com/token"
};

// 1. Setup Sheet for Tokens
function getUserTokensSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(USER_TOKENS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(USER_TOKENS_SHEET);
    sheet.appendRow(["Email", "FCM_Token", "Timestamp"]);
    sheet.getRange(1, 1, 1, 3).setBackground("#F1F5F9").setFontWeight("bold");
  }
  return sheet;
}

// 2. Endpoint to Register Tokens
function registerFCMToken(email, token) {
  try {
    const sheet = getUserTokensSheet();
    const data = sheet.getDataRange().getValues();
    const cleanEmail = email.toLowerCase().trim();
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    
    let existsIdx = -1;
    for (let i = 1; i < data.length; i++) {
      // Allow multiple tokens per email (e.g. laptop and phone) by checking if both email and token match
      if ((data[i][0] || "").toString().toLowerCase().trim() === cleanEmail && (data[i][1] || "").toString() === token) {
        existsIdx = i + 1;
        break;
      }
    }
    
    if (existsIdx > -1) {
      sheet.getRange(existsIdx, 3).setValue(now); // Just update the active timestamp
    } else {
      sheet.appendRow([cleanEmail, token, now]); // Append new device token row
    }
    return { status: "success", message: "Token registered." };
  } catch(e) {
    return { status: "error", message: e.toString() };
  }
}

// 3. Resolve student emails targeted by year, domain or specific user email lists
function getTargetStudentEmails(targets) {
  const ss = getSpreadsheet();
  const studentSheet = ss.getSheetByName(STUDENT_SHEET);
  const data = studentSheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().toLowerCase().trim().replace(/\s+/g, '_'));
  
  // Find correct column indexes using robust checking
  const emailIdx = headers.indexOf("my_email_address") !== -1 ? headers.indexOf("my_email_address") : 
                   headers.indexOf("email_id") !== -1 ? headers.indexOf("email_id") :
                   headers.indexOf("email") !== -1 ? headers.indexOf("email") :
                   headers.findIndex(h => h.includes("email"));
                   
  const yearIdx = headers.indexOf("session_year") !== -1 ? headers.indexOf("session_year") :
                  headers.indexOf("year") !== -1 ? headers.indexOf("year") :
                  headers.indexOf("academic_year") !== -1 ? headers.indexOf("academic_year") :
                  headers.findIndex(h => h.includes("year"));
                  
  const domainIdx = headers.indexOf("domain_focus") !== -1 ? headers.indexOf("domain_focus") :
                    headers.indexOf("domain") !== -1 ? headers.indexOf("domain") :
                    headers.findIndex(h => h.includes("domain"));
  
  if (emailIdx === -1) return [];
  
  const targetUsers = (targets.users || []).map(u => (typeof u === 'object' ? u.email : u || "").toLowerCase().trim());
  const targetYears = (targets.years || []).map(y => y.toString().toLowerCase().trim());
  const targetDomains = (targets.domains || []).map(d => d.toLowerCase().trim());
  
  const matches = [];
  
  for (let i = 1; i < data.length; i++) {
    const sEmail = (data[i][emailIdx] || "").toString().toLowerCase().trim();
    if (!sEmail) continue;
    
    const sYearRaw = yearIdx > -1 ? (data[i][yearIdx] || "").toString().toLowerCase().trim() : "";
    const sDomainRaw = domainIdx > -1 ? (data[i][domainIdx] || "").toString().toLowerCase().trim() : "";
    
    const sYearMatch = sYearRaw.match(/\d+/);
    const sYearNum = sYearMatch ? sYearMatch[0] : sYearRaw;
    
    let isTargeted = false;
    
    if (targetUsers.length === 0 && targetYears.length === 0 && targetDomains.length === 0) {
      isTargeted = true;
    } else {
      const cleanYears = targetYears.map(y => y.replace(/\+/g, ' '));
      const cleanDomains = targetDomains.map(d => d.replace(/\+/g, ' '));
      
      if (targetUsers.includes(sEmail)) {
        isTargeted = true;
      } else {
        let matchesYear = true;
        let matchesDomain = true;
        
        if (cleanYears.length > 0) {
          matchesYear = cleanYears.some(y => {
            const cleanY = y.replace(/[\s_]/g, '');
            const cleanStudentY = sYearRaw.replace(/[\s_]/g, '');
            
            // If the filter is a simple number (like "2024"), do numerical matching
            const isSimpleNumber = /^\d+$/.test(cleanY);
            if (isSimpleNumber) {
              const yNumMatch = y.match(/\d+/);
              if (yNumMatch && sYearNum) {
                return sYearNum.includes(yNumMatch[0]) || yNumMatch[0].includes(sYearNum);
              }
            }
            return cleanStudentY.includes(cleanY) || cleanY.includes(cleanStudentY);
          });
        }
        
        if (cleanDomains.length > 0) {
          matchesDomain = cleanDomains.some(d => {
            const cleanD = d.replace(/[\s_]/g, '');
            const cleanStudentD = sDomainRaw.replace(/[\s_]/g, '');
            if (!cleanStudentD) return false;
            return cleanStudentD.includes(cleanD) || cleanD.includes(cleanStudentD);
          });
        }
        
        if (cleanYears.length > 0 && cleanDomains.length > 0) {
          isTargeted = matchesYear && matchesDomain;
        } else if (cleanYears.length > 0) {
          isTargeted = matchesYear;
        } else if (cleanDomains.length > 0) {
          isTargeted = matchesDomain;
        }
      }
    }
    
    if (isTargeted) {
      matches.push(sEmail);
    }
  }
  
  return matches;
}

// 4. Obtain OAuth2 Token for FCM API v1 using JSON key
function getFcmAccessToken() {
  const header = JSON.stringify({
    alg: "RS256",
    typ: "JWT"
  });
  
  const now = Math.floor(Date.now() / 1000);
  const claimSet = JSON.stringify({
    iss: SERVICE_ACCOUNT.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: SERVICE_ACCOUNT.token_uri,
    exp: now + 3600,
    iat: now
  });
  
  const toSign = Utilities.base64EncodeWebSafe(header) + "." + Utilities.base64EncodeWebSafe(claimSet);
  const signature = Utilities.computeRsaSha256Signature(toSign, SERVICE_ACCOUNT.private_key);
  const jwt = toSign + "." + Utilities.base64EncodeWebSafe(signature);
  
  const options = {
    method: "post",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    }
  };
  
  const response = UrlFetchApp.fetch(SERVICE_ACCOUNT.token_uri, options);
  const data = JSON.parse(response.getContentText());
  return data.access_token;
}

// 5. Send background notification to list of targets
function sendFcmNotification(targetEmails, title, description) {
  try {
    const sheet = getUserTokensSheet();
    const data = sheet.getDataRange().getValues();
    const cleanTargets = targetEmails.map(e => e.toLowerCase().trim());
    
    const tokens = [];
    for (let i = 1; i < data.length; i++) {
      const email = (data[i][0] || "").toString().toLowerCase().trim();
      const token = (data[i][1] || "").toString();
      if (cleanTargets.includes(email) && token) {
        tokens.push(token);
      }
    }
    
    if (tokens.length === 0) return { status: "success", message: "No FCM tokens registered for targets." };
    
    const accessToken = getFcmAccessToken();
    const baseUrl = "https://fcm.googleapis.com/v1/projects/" + SERVICE_ACCOUNT.project_id + "/messages:send";
    
    tokens.forEach(token => {
      try {
        const payload = {
          message: {
            token: token,
            notification: {
              title: title.replace(/\+/g, ' '),
              body: description.replace(/\+/g, ' ')
            },
            data: {
              click_action: "https://designseriesattendance.vercel.app/"
            }
          }
        };
        
        const options = {
          method: "post",
          contentType: "application/json",
          headers: {
            Authorization: "Bearer " + accessToken
          },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        };
        
        const response = UrlFetchApp.fetch(baseUrl, options);
        console.log("FCM Send Response for token (" + token.substring(0, 10) + "...): " + response.getContentText());
      } catch (tokenErr) {
        console.error("FCM Send error for token " + token.substring(0, 10) + "...: " + tokenErr.toString());
      }
    });
    
    return { status: "success", message: "FCM Push sent." };
  } catch(e) {
    return { status: "error", message: "FCM Send error: " + e.toString() };
  }
}

// ════════════════════════════════════════════════════════════
//  EXTENSION REQUEST SYSTEM
// ════════════════════════════════════════════════════════════

function getExtensionsSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName("ExtensionRequests");
  if (!sheet) {
    sheet = ss.insertSheet("ExtensionRequests");
    sheet.appendRow([
      "Timestamp", "RequestId", "Name", "Email", "RollNumber", "Year", 
      "NotificationTitle", "Reason", "NewDeadline", "RequestDate", "ResolvedDate", "Status", "ExtensionCount", "NotificationId"
    ]);
    sheet.getRange(1, 1, 1, 14).setBackground("#F1F5F9").setFontWeight("bold");
  }
  return sheet;
}

function requestExtension(data) {
  try {
    const sheet = getExtensionsSheet();
    const now = new Date();
    const ts = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    
    // Check if a request already exists for this email and notificationId
    const rows = sheet.getDataRange().getValues();
    const emailLower = (data.email || "").toLowerCase().trim();
    const notifId = (data.notificationId || "").toString().trim();
    
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][3] || "").toString().toLowerCase().trim() === emailLower && (rows[i][13] || "").toString().trim() === notifId) {
        return { status: "error", message: "An extension request has already been submitted for this notification." };
      }
    }
    
    // Resolve Student Details
    let studentName = "Student";
    let studentRoll = "N/A";
    let studentYear = "N/A";
    const studentsRes = getAllStudents();
    if (studentsRes.status === "success") {
      const studentObj = studentsRes.users.find(u => 
        (u.email || u.email_id || "").toString().toLowerCase().trim() === emailLower
      );
      if (studentObj) {
        studentName = studentObj.name || studentObj.student_name || "Student";
        studentRoll = studentObj.roll_no || studentObj.roll_number || studentObj.reg_num || studentObj.reg_no || "N/A";
        studentYear = studentObj.year || "N/A";
      }
    }
    
    // Resolve Notification Details
    let notifTitle = "LinkedIn Submission";
    try {
      const notifSheet = getNotificationsSheet();
      const notifData = notifSheet.getDataRange().getValues();
      for (let i = 1; i < notifData.length; i++) {
        if (notifData[i][0].toString().trim() === notifId) {
          notifTitle = notifData[i][1];
          break;
        }
      }
    } catch(e) {}
    
    // Calculate total requests for this email
    let requestCount = 0;
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][3] || "").toString().toLowerCase().trim() === emailLower) {
        requestCount++;
      }
    }
    requestCount++; // Include this new request
    
    const reqId = Utilities.getUuid();
    sheet.appendRow([
      ts,            // Timestamp
      reqId,         // RequestId
      studentName,   // Name
      emailLower,    // Email
      studentRoll,   // RollNumber
      studentYear,   // Year
      notifTitle,    // NotificationTitle
      data.reason || "", // Reason
      "",            // NewDeadline
      ts,            // RequestDate
      "",            // ResolvedDate
      "Pending",     // Status
      requestCount,  // ExtensionCount
      notifId        // NotificationId
    ]);
    return { status: "success", message: "Extension request submitted successfully." };
  } catch (err) {
    return { status: "error", message: "Request extension error: " + err.toString() };
  }
}

function getUserExtensions(email) {
  try {
    const sheet = getExtensionsSheet();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { status: "success", extensions: [] };
    
    const emailLower = email.toLowerCase().trim();
    const list = [];
    for (let i = 1; i < data.length; i++) {
      if ((data[i][3] || "").toString().toLowerCase().trim() === emailLower) {
        list.push({
          requestId: data[i][1],
          email: data[i][3],
          notificationId: data[i][13],
          reason: data[i][7],
          status: data[i][11],
          newDeadline: data[i][8],
          requestDate: data[i][9],
          resolvedDate: data[i][10]
        });
      }
    }
    return { status: "success", extensions: list };
  } catch(err) {
    return { status: "error", message: "Get user extensions error: " + err.toString() };
  }
}

function getAllExtensions() {
  try {
    const sheet = getExtensionsSheet();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { status: "success", extensions: [] };
    
    const list = [];
    for (let i = 1; i < data.length; i++) {
      list.push({
        requestId: data[i][1],
        email: data[i][3],
        notificationId: data[i][13],
        reason: data[i][7],
        status: data[i][11],
        newDeadline: data[i][8],
        requestDate: data[i][9],
        resolvedDate: data[i][10]
      });
    }
    return { status: "success", extensions: list.reverse() };
  } catch(err) {
    return { status: "error", message: "Get all extensions error: " + err.toString() };
  }
}

function approveExtension(requestId, newDeadline) {
  try {
    const sheet = getExtensionsSheet();
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const ts = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    
    for (let i = 1; i < data.length; i++) {
      if ((data[i][1] || "").toString() === requestId) {
        sheet.getRange(i + 1, 12).setValue("Approved");   // Column L (Status)
        sheet.getRange(i + 1, 9).setValue(newDeadline);  // Column I (NewDeadline)
        sheet.getRange(i + 1, 11).setValue(ts);          // Column K (ResolvedDate)
        return { status: "success", message: "Extension approved successfully." };
      }
    }
    return { status: "error", message: "Extension request not found." };
  } catch(err) {
    return { status: "error", message: "Approve extension error: " + err.toString() };
  }
}

function rejectExtension(requestId) {
  try {
    const sheet = getExtensionsSheet();
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const ts = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    
    for (let i = 1; i < data.length; i++) {
      if ((data[i][1] || "").toString() === requestId) {
        sheet.getRange(i + 1, 12).setValue("Rejected");   // Column L (Status)
        sheet.getRange(i + 1, 11).setValue(ts);          // Column K (ResolvedDate)
        return { status: "success", message: "Extension request rejected." };
      }
    }
    return { status: "error", message: "Extension request not found." };
  } catch(err) {
    return { status: "error", message: "Reject extension error: " + err.toString() };
  }
}

function getRewardPointsFromExternalCSV(email) {
  try {
    const url = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRuoa_2Si7e9QKvKoQEQ7kjg2LblBTqGMyuJZIEqMWS2vna_VcSrxFPQ1FIBRbyTyd8BMHrNghbE9xR/pub?output=csv";
    const response = UrlFetchApp.fetch(url + "&t=" + Date.now());
    const csvContent = response.getContentText();
    const rows = Utilities.parseCsv(csvContent);
    
    if (rows.length < 2) {
      return { status: "error", message: "Empty sheet data." };
    }
    
    const headers = rows[0].map(h => h.toLowerCase().trim().replace(/[\s_]/g, ''));
    const emailIdx = headers.findIndex(h => h.includes('email') || h.includes('mail') || h === 'id');
    const rollIdx = headers.findIndex(h => h.includes('roll') || h.includes('reg') || h.includes('register'));
    
    const earnedIdx = headers.findIndex(h => h.includes('earned') || h.includes('totalpoints') || (h.includes('points') && !h.includes('used') && !h.includes('balance')));
    const usedIdx = headers.findIndex(h => h.includes('used') || h.includes('redeem'));
    const balanceIdx = headers.findIndex(h => h.includes('balance') || h.includes('reward') || h.includes('current'));
    
    const queryVal = (email || "").toLowerCase().trim();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const emailVal = emailIdx !== -1 ? (row[emailIdx] || "").toLowerCase().trim() : "";
      const rollVal = rollIdx !== -1 ? (row[rollIdx] || "").toLowerCase().trim() : "";
      
      if (emailVal === queryVal || rollVal === queryVal) {
        const earned = earnedIdx !== -1 ? (row[earnedIdx] || "0").trim() : "0";
        const used = usedIdx !== -1 ? (row[usedIdx] || "0").trim() : "0";
        const balance = balanceIdx !== -1 ? (row[balanceIdx] || "0").trim() : "0";
        return {
          status: "success",
          student: {
            earned_points: earned,
            used_points: used,
            balance_points: balance
          }
        };
      }
    }
    return { status: "error", message: "Student not found in sheet rows." };
  } catch(e) {
    return { status: "error", message: "CSV parsing error: " + e.toString() };
  }
}
