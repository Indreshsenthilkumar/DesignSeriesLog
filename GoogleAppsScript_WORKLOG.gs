/**
 * GOOGLE APPS SCRIPT - WORKLOG DATABASE BACKEND WITH ACCURATE TIMESTAMP, STATUS, AND REMARKS UPDATES
 * Spreadsheet ID: 1-e439waUAycWoMHW-WzGEt4hUvkh0zvIaRaY9wHwNwk
 * Sheet Name: DesignSeries_Worklog
 */
const SPREADSHEET_ID = "1-e439waUAycWoMHW-WzGEt4hUvkh0zvIaRaY9wHwNwk";
const SHEET_NAME = "DesignSeries_Worklog";

function getSpreadsheet() {
  let ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {}
  if (!ss) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return ss;
}

function doGet(e) {
  try {
    const email = e.parameter.email || e.parameter.emailId || "";
    const rollNo = e.parameter.rollNo || "";
    const cmd = e.parameter.cmd;
    
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    
    // Auto-create headers if sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Timestamp", "Date", "Name", "Roll Number", "Mail", "Year",
        "S1( 8:45 AM to 10:25 AM )", "S2(10:40 AM to 12:30 PM )",
        "S3(1:30 PM to 3:10 PM)", "S4(3:25 PM to 4:25 PM)",
        "S5(Custom Slot)", "STATUS", "Remarks"
      ]);
    }
    
    const rows = sheet.getDataRange().getDisplayValues();
    const history = [];
    
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[1]) continue; // Date is in Column B (index 1)
      
      const dateVal = String(r[1]).trim();
      const timestampVal = String(r[0] || "").trim();
      
      const name = String(r[2] || "");
      const roll = String(r[3] || "");
      const mail = String(r[4] || "").toLowerCase().trim();
      const year = String(r[5] || "");
      const s1 = String(r[6] || "");
      const s2 = String(r[7] || "");
      const s3 = String(r[8] || "");
      const s4 = String(r[9] || "");
      const s5 = String(r[10] || "");
      const status = String(r[11] || "Review Pending");
      const remarks = String(r[12] || "");
      
      // Build consolidated description for frontend parsing compatibility
      const worklogDesc = [
        s1 ? `[8:45 AM - 10:25 AM] ${s1}` : "",
        s2 ? `[10:40 AM - 12:30 PM] ${s2}` : "",
        s3 ? `[1:30 PM - 3:10 PM] ${s3}` : "",
        s4 ? `[3:25 PM - 4:25 PM] ${s4}` : "",
        s5 ? `[Custom Slot] ${s5}` : ""
      ].filter(Boolean).join("\n");
      
      const item = {
        timestamp: timestampVal,
        date: dateVal,
        name: name,
        rollNo: roll,
        email: mail,
        year: year,
        s1: s1,
        s2: s2,
        s3: s3,
        s4: s4,
        s5: s5,
        worklog: worklogDesc,
        progress: status,
        remarks: remarks,
        title: "Hourly Log",
        deadline: ""
      };
      
      const target = (email || rollNo).toLowerCase().trim();
      if (target) {
        if (mail === target || roll.toLowerCase().trim() === target) {
          history.push(item);
        }
      } else {
        history.push(item);
      }
    }
    
    // Sort history (newest first)
    history.sort((a, b) => {
      const parseDate = (dStr) => {
        try {
          const parts = dStr.split('-');
          if (parts.length === 3) {
            return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10)).getTime();
          }
        } catch(e) {}
        return 0;
      };
      return parseDate(b.date) - parseDate(a.date);
    });
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      history: history
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return response({ status: 'error', message: 'ERROR: Empty request body.' });
    }
    
    const postData = JSON.parse(e.postData.contents);
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    
    // Auto-create headers if sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Timestamp", "Date", "Name", "Roll Number", "Mail", "Year",
        "S1( 8:45 AM to 10:25 AM )", "S2(10:40 AM to 12:30 PM )",
        "S3(1:30 PM to 3:10 PM)", "S4(3:25 PM to 4:25 PM)",
        "S5(Custom Slot)", "STATUS", "Remarks"
      ]);
    }
    
    const tz = Session.getScriptTimeZone() || "GMT+5:30";
    
    // Handle admin status updates directly
    if (postData.type === 'updateStatus') {
      const mail = String(postData.email || "").toLowerCase().trim();
      const dateStr = String(postData.date || "").trim();
      const timestamp = String(postData.timestamp || "").trim();
      const newStatus = String(postData.status || "Review Pending").trim();
      
      let targetObj;
      if (dateStr.includes('-') || dateStr.includes('/')) {
        const separator = dateStr.includes('-') ? '-' : '/';
        const parts = dateStr.split(separator);
        if (parts.length === 3) {
          if (parts[2].length === 4) {
            targetObj = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
          } else if (parts[0].length === 4) {
            targetObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          }
        }
      }
      if (!targetObj || isNaN(targetObj.getTime())) {
        targetObj = new Date(dateStr);
      }
      const targetISO = Utilities.formatDate(targetObj, tz, "yyyy-MM-dd");
      
      const rows = sheet.getDataRange().getDisplayValues();
      let rowIndex = -1;
      
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        
        // 1. Try matching by timestamp first (Column A) if available
        if (timestamp && String(r[0] || "").trim() === timestamp) {
          rowIndex = i + 1;
          break;
        }
        
        // 2. Fallback to matching by date and email/rollNo
        if (!r[1]) continue;
        const rDateVal = String(r[1]).trim();
        const rMailVal = String(r[4] || "").toLowerCase().trim();
        const rRollVal = String(r[3] || "").toLowerCase().trim();
        
        if ((rMailVal === mail || rRollVal === mail) && rDateVal === dateStr) {
          rowIndex = i + 1;
          break;
        }
      }
      
      if (rowIndex > 0) {
        sheet.getRange(rowIndex, 12).setValue(newStatus); // Column L
        return response({ status: "success", message: "Status updated successfully" });
      } else {
        return response({ status: "error", message: "Entry not found" });
      }
    }
    
    // Handle admin remarks updates directly
    if (postData.type === 'updateRemarks') {
      const mail = String(postData.email || "").toLowerCase().trim();
      const dateStr = String(postData.date || "").trim();
      const timestamp = String(postData.timestamp || "").trim();
      const newRemarks = String(postData.remarks || "").trim();
      
      let targetObj;
      if (dateStr.includes('-') || dateStr.includes('/')) {
        const separator = dateStr.includes('-') ? '-' : '/';
        const parts = dateStr.split(separator);
        if (parts.length === 3) {
          if (parts[2].length === 4) {
            targetObj = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
          } else if (parts[0].length === 4) {
            targetObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          }
        }
      }
      if (!targetObj || isNaN(targetObj.getTime())) {
        targetObj = new Date(dateStr);
      }
      const targetISO = Utilities.formatDate(targetObj, tz, "yyyy-MM-dd");
      
      const rows = sheet.getDataRange().getDisplayValues();
      let rowIndex = -1;
      
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        
        // 1. Try matching by timestamp first (Column A) if available
        if (timestamp && String(r[0] || "").trim() === timestamp) {
          rowIndex = i + 1;
          break;
        }
        
        // 2. Fallback to matching by date and email/rollNo
        if (!r[1]) continue;
        const rDateVal = String(r[1]).trim();
        const rMailVal = String(r[4] || "").toLowerCase().trim();
        const rRollVal = String(r[3] || "").toLowerCase().trim();
        
        if ((rMailVal === mail || rRollVal === mail) && rDateVal === dateStr) {
          rowIndex = i + 1;
          break;
        }
      }
      
      if (rowIndex > 0) {
        sheet.getRange(rowIndex, 13).setValue(newRemarks); // Column M (Remarks)
        return response({ status: "success", message: "Remarks updated successfully" });
      } else {
        return response({ status: "error", message: "Entry not found" });
      }
    }
    
    const mail = String(postData.mail || postData.email || "").toLowerCase().trim();
    const dateStr = String(postData.date || "").trim(); // YYYY-MM-DD or DD-MM-YYYY
    const name = String(postData.name || "").trim();
    const rollNo = String(postData.rollNo || "").trim();
    const year = String(postData.year || "").trim();
    
    const s1 = String(postData.s1 || "").trim();
    const s2 = String(postData.s2 || "").trim();
    const s3 = String(postData.s3 || "").trim();
    const s4 = String(postData.s4 || "").trim();
    const s5 = String(postData.s5 || "").trim();
    
    const status = String(postData.status || "Review Pending").trim();
    const remarks = String(postData.remarks || "").trim();
    
    // Standardize input date to Date object
    let dateObj;
    if (dateStr.includes('-') || dateStr.includes('/')) {
      const separator = dateStr.includes('-') ? '-' : '/';
      const parts = dateStr.split(separator);
      if (parts.length === 3) {
        if (parts[2].length === 4) {
          dateObj = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        } else if (parts[0].length === 4) {
          dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        }
      }
    }
    if (!dateObj || isNaN(dateObj.getTime())) {
      dateObj = new Date(dateStr);
    }
    
    if (isNaN(dateObj.getTime())) {
      return response({ status: 'error', message: 'Invalid Date format received: ' + dateStr });
    }
    
    const targetISO = Utilities.formatDate(dateObj, tz, "yyyy-MM-dd");
    
    // Check if entry exists for this mail/roll and date
    const rows = sheet.getDataRange().getValues();
    let rowIndex = -1;
    
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[1]) continue; // Date is in Column B (index 1)
      
      let rDateISO = "";
      if (r[1] instanceof Date) {
        rDateISO = Utilities.formatDate(r[1], tz, "yyyy-MM-dd");
      } else {
        // Try parsing string date
        try {
          const parts = String(r[1]).split('-');
          if (parts.length === 3) {
            rDateISO = `${parts[2]}-${parts[1]}-${parts[0]}`;
          }
        } catch(err) {}
      }
      
      const rMailVal = String(r[4] || "").toLowerCase().trim(); // Mail is index 4
      const rRollVal = String(r[3] || "").toLowerCase().trim(); // Roll is index 3
      
      if ((rMailVal === mail || rRollVal === rollNo.toLowerCase().trim()) && rDateISO === targetISO) {
        rowIndex = i + 1;
        break;
      }
    }
    
    const timestampStr = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss"); // Accurate Real DateTime String
    
    if (rowIndex > 0) {
      // Update existing row
      sheet.getRange(rowIndex, 1).setValue(timestampStr);
      sheet.getRange(rowIndex, 2).setValue(dateObj);
      sheet.getRange(rowIndex, 3).setValue(name || rows[rowIndex-1][2]);
      sheet.getRange(rowIndex, 4).setValue(rollNo || rows[rowIndex-1][3]);
      sheet.getRange(rowIndex, 5).setValue(mail || rows[rowIndex-1][4]);
      sheet.getRange(rowIndex, 6).setValue(year || rows[rowIndex-1][5]);
      sheet.getRange(rowIndex, 7).setValue(s1);
      sheet.getRange(rowIndex, 8).setValue(s2);
      sheet.getRange(rowIndex, 9).setValue(s3);
      sheet.getRange(rowIndex, 10).setValue(s4);
      sheet.getRange(rowIndex, 11).setValue(s5);
      sheet.getRange(rowIndex, 12).setValue(status);
      sheet.getRange(rowIndex, 13).setValue(remarks);
    } else {
      // Append new row
      sheet.appendRow([
        timestampStr, dateObj, name, rollNo, mail, year,
        s1, s2, s3, s4, s5, status, remarks
      ]);
    }
    
    return response({
      status: "success",
      message: "Worklog saved successfully"
    });
  } catch (error) {
    return response({
      status: "error",
      message: error.toString()
    });
  }
}

function response(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
