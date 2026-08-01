/**
 * FINAL HISTORY FIX VERSION - WORKLOG SUBMISSION SHEET BACKEND
 * Spreadsheet ID: 1yh30raFudB0HDcM3w7WztdL0i8yV-urCMVvHSMF5Jro
 * Tab Name: ( Sem 5)Task Progress
 */
const WORKLOG_CONFIG = {
  SPREADSHEET_ID: "1yh30raFudB0HDcM3w7WztdL0i8yV-urCMVvHSMF5Jro",
  TAB_NAME: "( Sem 5)Task Progress" 
};

function doGet(e) {
  const cmd = e.parameter.cmd;
  if (cmd === "initialize") {
    return response({ status: 'success', message: initializeSheetFormat() });
  }
  if (cmd === "getAllWorklogs") {
    return response(getAllWorklogs());
  }

  let email = e.parameter.email || "";
  let rollNo = e.parameter.rollNo || "";
  
  if (rollNo === "undefined" || rollNo === "null") {
    rollNo = "";
  }
  if (email === "undefined" || email === "null") {
    email = "";
  }
  
  const identifier = rollNo || email;
  const worklogSheet = getWorklogSheet();
  let debugInfo = {};
  if (worklogSheet) {
    const rows = worklogSheet.getDataRange().getValues();
    const headers = rows[0];
    let userRow = rows.find(r => 
      r[1].toString().toLowerCase().trim() === identifier.toString().toLowerCase().trim() ||
      r.join(',').toLowerCase().includes(identifier.toLowerCase())
    );
    debugInfo = {
      headers: headers,
      userRowExists: !!userRow,
      userRow: userRow ? userRow : null,
      identifier: identifier,
      parameter: e.parameter
    };
  }

  const logs = fetchUserWorklogs(identifier);
  
  return response({ status: 'success', worklogs: logs, debug: debugInfo });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return response({ status: 'error', message: 'ERROR: Empty request body received on server.' });
    }
    const data = JSON.parse(e.postData.contents);
    if (data.type === 'worklog') {
      return response(handleWorklogSave(data));
    }
    return response({ status: 'error', message: 'ERROR: Unknown post request type: ' + data.type });
  } catch (err) {
    return response({ status: 'error', message: 'doPost exception: ' + err.message });
  }
}

function getWorklogSheet() {
  const ss = SpreadsheetApp.openById(WORKLOG_CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(WORKLOG_CONFIG.TAB_NAME);
  if (sheet) return sheet;
  
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].getName();
    if (name.includes("Sem 5") && name.includes("Task Progress")) return sheets[i];
  }
  return null;
}

function handleWorklogSave(data) {
  const sheet = getWorklogSheet();
  if (!sheet) return { status: 'error', message: 'ERROR: Tab not found' };

  const rollNo = data.rollNo;
  const activityDate = data.date; 
  const worklogDesc = data.worklog;
  const deadline = data.deadline;
  const progress = data.progress;
  const title = data.title;

  let formattedHeaderDate;
  try {
    let dateObj;
    if (activityDate && (activityDate.includes('-') || activityDate.includes('/'))) {
      const separator = activityDate.includes('-') ? '-' : '/';
      const parts = activityDate.split(separator);
      if (parts.length === 3) {
        if (parts[2].length === 4) {
          dateObj = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        } else if (parts[0].length === 4) {
          dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        }
      }
    }
    if (!dateObj || isNaN(dateObj.getTime())) {
      dateObj = new Date(activityDate);
    }
    if (isNaN(dateObj.getTime())) {
      return { status: 'error', message: 'Invalid Date format received: ' + activityDate };
    }
    formattedHeaderDate = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "dd-MM-yyyy");
  } catch (err) {
    return { status: 'error', message: 'Date parsing exception: ' + err.message };
  }

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  
  let userRowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1].toString().trim() === rollNo.toString().trim()) {
      userRowIndex = i + 1;
      break;
    }
  }

  if (userRowIndex === -1) return { status: 'error', message: 'Roll number ' + rollNo + ' not found' };

  let colIndex = -1;
  for (let j = 3; j < headers.length; j += 5) {
    if (headers[j].toString().includes(formattedHeaderDate)) {
      colIndex = j + 1;
      break;
    }
  }

  const isNewColumn = (colIndex === -1);
  if (isNewColumn) {
    colIndex = headers.length + 1;
    if (headers.length > 3) {
      colIndex = headers.length + 2; // Leaves a 1-column gap!
    }
    sheet.getRange(1, colIndex).setValue(formattedHeaderDate);
    sheet.getRange(1, colIndex + 1).setValue("Work Log");
    sheet.getRange(1, colIndex + 2).setValue("Deadline");
    sheet.getRange(1, colIndex + 3).setValue("Progress");
    sheet.getRange(1, colIndex, 1, 4).setBackground("#F1F5F9").setFontWeight("bold");
    
    // Add dropdown validation to the progress column for all student rows
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["Completed", "On going", "Review Pendening", "Review Completed", "Absent", "On duty"], true)
        .setAllowInvalid(true)
        .build();
      sheet.getRange(2, colIndex + 3, lastRow - 1).setDataValidation(rule);
    }
  }

  sheet.getRange(userRowIndex, colIndex).setValue(title || formattedHeaderDate); 
  sheet.getRange(userRowIndex, colIndex + 1).setValue(worklogDesc);
  sheet.getRange(userRowIndex, colIndex + 2).setValue(deadline || "");
  sheet.getRange(userRowIndex, colIndex + 3).setValue(progress);

  // Sort columns chronologically and lock formatting
  sortWorklogColumns(sheet);

  return { status: 'success', message: 'Synced Successfully!' };
}

function fetchUserWorklogs(identifier) {
  if (!identifier) return [];
  const worklogSheet = getWorklogSheet();
  if (!worklogSheet) return [];
  
  const rows = worklogSheet.getDataRange().getValues();
  const headers = rows[0];
  
  // Search row by Roll Number or Email/Name match
  let userRow = rows.find(r => 
    r[1].toString().toLowerCase().trim() === identifier.toString().toLowerCase().trim() ||
    r.join(',').toLowerCase().includes(identifier.toLowerCase())
  );
  
  if (!userRow) return [];

  let logs = [];
  for (let j = 3; j < headers.length; j += 5) {
    if (userRow[j+1]) { 
      logs.push({ 
        date: headers[j], 
        title: userRow[j], 
        worklog: userRow[j+1], 
        deadline: userRow[j+2], 
        progress: userRow[j+3] 
      });
    }
  }
  return logs;
}

function response(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 🛠️ SPREADSHEET UTILITY: Reset & Format sheet columns with the 1-column gap structure
 * Adds a custom menu when opening the spreadsheet for easy, one-click layout setup.
 */
function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('Worklog Portal')
        .addItem('Reset & Format Worklog Columns', 'initializeSheetFormat')
        .addToUi();
  } catch (e) {
    // Fail-safe if not opened inside container document UI context
  }
}

function initializeSheetFormat() {
  const sheet = getWorklogSheet();
  if (!sheet) return "Error: Sheet tab not found.";
  
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  
  // Keep S.No, Roll Number, Name (Columns A, B, C)
  // Clear columns D onwards to prepare for a clean layout
  if (lastCol >= 4) {
    sheet.getRange(1, 4, lastRow || 1, lastCol - 3)
      .clearContent()
      .clearFormat()
      .clearDataValidations();
  }
  
  // Set up the first worklog block starting at Column D
  sheet.getRange(1, 4).setValue("Date");
  sheet.getRange(1, 5).setValue("Work Log");
  sheet.getRange(1, 6).setValue("Deadline");
  sheet.getRange(1, 7).setValue("Progress");
  
  // Apply visual styling to header row (light gray background, bold text)
  sheet.getRange(1, 4, 1, 4).setBackground("#F1F5F9").setFontWeight("bold");
  
  // Populate the progress validation rule dropdowns for all student rows
  if (lastRow > 1) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Completed", "On going", "Review Pendening", "Review Completed", "Absent", "On duty"], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 7, lastRow - 1).setDataValidation(rule);
  }
  
  // Apply row height locking, clip wrapping and conditional formatting
  applyFormattingAndWrapping(sheet);
  
  return "Sheet initialized successfully with 3-column metadata, and the first worklog block has been formatted in Columns D-G.";
}

function applyFormattingAndWrapping(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  
  // 🔒 Enforce Row Heights (Header = 28px, Data Rows = 20px)
  try {
    sheet.setRowHeight(1, 28);
    if (lastRow > 1) {
      sheet.setRowHeights(2, lastRow - 1, 20);
    }
  } catch(e) {}

  // 🔒 Enforce Metadata Column Widths (S.No = 45px, Roll = 100px, Name = 160px)
  try {
    sheet.setColumnWidth(1, 45);
    sheet.setColumnWidth(2, 100);
    sheet.setColumnWidth(3, 160);
  } catch(e) {}
  
  if (lastCol >= 4) {
    // Set wrap strategy to CLIP for all columns from D onwards so text doesn't wrap or resize rows
    const dataRange = sheet.getRange(1, 4, lastRow || 1, lastCol - 3);
    dataRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

    // 🔒 Enforce Dynamic Column Widths for Worklog blocks and Gaps
    try {
      for (let col = 4; col <= lastCol; col++) {
        const blockColIdx = (col - 4) % 5;
        if (blockColIdx === 0) {
          sheet.setColumnWidth(col, 130); // Date / Title column
        } else if (blockColIdx === 1) {
          sheet.setColumnWidth(col, 280); // Work Log description column
        } else if (blockColIdx === 2) {
          sheet.setColumnWidth(col, 100); // Deadline column
        } else if (blockColIdx === 3) {
          sheet.setColumnWidth(col, 120); // Progress column
        } else if (blockColIdx === 4) {
          sheet.setColumnWidth(col, 25);  // Gap column width
        }
      }
    } catch(e) {}
  }
  
  // Clean up any incorrect validations: only progress columns should have validation dropdowns
  if (lastRow > 1 && lastCol >= 4) {
    for (let col = 4; col <= lastCol; col++) {
      // Progress column is (col - 4) % 5 === 3 (e.g. Column 7 (G), 12 (L), etc.)
      if ((col - 4) % 5 !== 3) {
        sheet.getRange(2, col, lastRow - 1).clearDataValidations();
      }
    }
  }
  
  // Apply conditional color styling to the dropdown progress values
  try {
    sheet.clearConditionalFormatRules();
    const rules = [];
    const colorSpecs = [
      { text: "Completed", bg: "#dcfce7", fg: "#137333" },
      { text: "completed", bg: "#dcfce7", fg: "#137333" },
      { text: "Review Completed", bg: "#fef9c3", fg: "#b06000" },
      { text: "Review Complete", bg: "#fef9c3", fg: "#b06000" },
      { text: "On going", bg: "#fce8e6", fg: "#c5221f" },
      { text: "Review Pending", bg: "#e8f0fe", fg: "#1a73e8" },
      { text: "Review Pendening", bg: "#e8f0fe", fg: "#1a73e8" },
      { text: "Absent", bg: "#fce8e6", fg: "#c5221f" },
      { text: "On duty", bg: "#e8f0fe", fg: "#1a73e8" },
      { text: "On Duty", bg: "#e8f0fe", fg: "#1a73e8" }
    ];
    
    // Set range from D2 across all worklog columns and rows
    const cfRange = sheet.getRange(2, 4, Math.max(lastRow - 1, 1), Math.max(lastCol - 3, 4));
    
    colorSpecs.forEach(item => {
      const rule = SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(item.text)
        .setBackground(item.bg)
        .setFontColor(item.fg)
        .setRanges([cfRange])
        .build();
      rules.push(rule);
    });
    
    sheet.setConditionalFormatRules(rules);
  } catch (e) {
    // Fail-safe
  }
}

/**
 * 📅 Chronologically sorts all worklog columns (metadata blocks) in ascending order.
 * Clears and regenerates columns D+ with a clean structure, then locks their formats.
 */
function sortWorklogColumns(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastCol < 4) return;
  
  const blocks = [];
  for (let j = 4; j <= lastCol; j += 5) {
    const dateVal = sheet.getRange(1, j).getValue();
    if (!dateVal) continue;
    
    // Parse date (dd-MM-yyyy) to get a sorting value (timestamp)
    let timestamp = 0;
    try {
      const parts = dateVal.toString().split('-');
      if (parts.length === 3) {
        const dateObj = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        timestamp = dateObj.getTime();
      } else {
        timestamp = new Date(dateVal).getTime();
      }
    } catch(e) {
      timestamp = 0;
    }
    
    // Extract values, formats, alignments, and validations for this 4-column block
    const blockRange = sheet.getRange(1, j, lastRow, 4);
    const blockValues = blockRange.getValues();
    const blockFormats = blockRange.getNumberFormats();
    const blockAlignments = blockRange.getHorizontalAlignments();
    const blockValidations = blockRange.getDataValidations();
    
    blocks.push({
      dateStr: dateVal.toString(),
      timestamp: isNaN(timestamp) ? 0 : timestamp,
      values: blockValues,
      formats: blockFormats,
      alignments: blockAlignments,
      validations: blockValidations
    });
  }
  
  // Sort blocks in ascending chronological order
  blocks.sort((a, b) => a.timestamp - b.timestamp);
  
  // Clear existing columns from D onwards
  sheet.getRange(1, 4, lastRow, lastCol - 3)
    .clearContent()
    .clearFormat()
    .clearDataValidations();
  
  // Re-write blocks in chronological order with a 1-column gap
  let currentCol = 4;
  blocks.forEach((block, idx) => {
    if (idx > 0) {
      currentCol += 1; // Leave a 1-column gap
    }
    
    const blockRange = sheet.getRange(1, currentCol, lastRow, 4);
    blockRange.setValues(block.values);
    blockRange.setNumberFormats(block.formats);
    blockRange.setHorizontalAlignments(block.alignments);
    
    // Restore validations for Progress column (index 3 inside the block values)
    for (let r = 0; r < lastRow; r++) {
      if (block.validations[r][3]) {
        sheet.getRange(r + 1, currentCol + 3).setDataValidation(block.validations[r][3]);
      }
    }
    
    // Format headers
    sheet.getRange(1, currentCol, 1, 4).setBackground("#F1F5F9").setFontWeight("bold");
    
    currentCol += 4;
  });
  
  // Re-apply conditional formatting, wrapping, and height/width locks
  applyFormattingAndWrapping(sheet);
}

/**
 * 📊 ADMIN DATA: Fetch all student worklogs across all columns chronologically.
 */
function getAllWorklogs() {
  try {
    const sheet = getWorklogSheet();
    if (!sheet) return { status: 'error', message: 'Worklog sheet not found.' };
    
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { status: 'success', history: [] };
    
    const headers = data[0];
    const logs = [];
    
    // Rows 1 onwards are students (index 1 to data.length - 1)
    for (let i = 1; i < data.length; i++) {
      const rollNo = data[i][1];
      const name = data[i][2];
      
      // Columns from index 3 (Column D) onwards, step by 5
      for (let j = 3; j < headers.length; j += 5) {
        const title = data[i][j];      // Date/Title cell
        const worklog = data[i][j+1];  // Work Log desc cell
        const deadline = data[i][j+2]; // Deadline cell
        const progress = data[i][j+3]; // Progress cell
        
        // If there's a worklog description, add it to the list
        if (worklog) {
          logs.push({
            rollNo: rollNo || "N/A",
            name: name || "N/A",
            date: headers[j] ? headers[j].toString() : "",
            title: title || (headers[j] ? headers[j].toString() : ""),
            worklog: worklog,
            deadline: deadline || "",
            progress: progress || ""
          });
        }
      }
    }
    
    // Sort logs by date (newest first)
    logs.sort((a, b) => {
      const parseDate = (dStr) => {
        try {
          const parts = dStr.toString().split('-');
          if (parts.length === 3) {
            return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10)).getTime();
          }
        } catch(e) {}
        return 0;
      };
      return parseDate(b.date) - parseDate(a.date);
    });
    
    return { status: 'success', history: logs };
  } catch(e) {
    return { status: 'error', message: e.toString() };
  }
}
