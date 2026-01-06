// --- 1. CONFIGURATION ---
const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const SHEET_TRANSACTIONS = 'Transactions';
const SHEET_CATEGORIES = 'Categories';
const SHEET_SETTINGS = 'Settings';
const SHEET_USERS = 'Users';

// **************************************************************************
// 2. GEMINI API KEY
// **************************************************************************
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'); 
// **************************************************************************

// --- 3. REQUIRED FOR WEB APP ---
function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Money Tracker App')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// --- 4. DATABASE SETUP ---
function setupDatabase() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  if (!ss.getSheetByName(SHEET_USERS)) {
    ss.insertSheet(SHEET_USERS).appendRow(['Username', 'Password', 'Name', 'Email', 'Created', 'IsLoggedIn']);
  }
  if (!ss.getSheetByName(SHEET_TRANSACTIONS)) {
    ss.insertSheet(SHEET_TRANSACTIONS).appendRow(['ID', 'Date', 'Type', 'CategoryID', 'Amount', 'Note', 'Timestamp', 'Username']);
  }
  if (!ss.getSheetByName(SHEET_CATEGORIES)) {
    ss.insertSheet(SHEET_CATEGORIES).appendRow(['ID', 'Name', 'Type', 'Budget', 'Color', 'Username']);
  }
  if (!ss.getSheetByName(SHEET_SETTINGS)) {
    ss.insertSheet(SHEET_SETTINGS).appendRow(['Key', 'Value', 'Username']);
  }
}

function findColumnIndex(headers, name) {
  const normalize = s => String(s).toLowerCase().trim();
  const target = normalize(name);
  return headers.findIndex(h => normalize(h) === target);
}

// --- HELPER: HASH PASSWORD ---
function hashPassword(password) {
  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  let txtHash = '';
  for (let i = 0; i < rawHash.length; i++) {
    let hashVal = rawHash[i];
    if (hashVal < 0) {
      hashVal += 256;
    }
    if (hashVal.toString(16).length == 1) {
      txtHash += '0';
    }
    txtHash += hashVal.toString(16);
  }
  return txtHash;
}

// --- 5. AUTH FUNCTIONS ---
function doLogin(username, password) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const userSheet = ss.getSheetByName(SHEET_USERS);
    if (!userSheet) { setupDatabase(); return { success: false, message: 'Database Setup... Try again.' }; }
    const data = userSheet.getDataRange().getValues();
    const headers = data[0];
    const uIdx = findColumnIndex(headers, 'Username');
    const pIdx = findColumnIndex(headers, 'Password');
    const nIdx = findColumnIndex(headers, 'Name');
    for (let i = 1; i < data.length; i++) {
      const storedUser = String(data[i][uIdx]);
      const storedPass = String(data[i][pIdx]);
      
      if (storedUser === String(username)) {
        // 1. Try comparing hash
        const inputHash = hashPassword(password);
        if (storedPass === inputHash) {
           return { success: true, user: { username: data[i][uIdx], name: data[i][nIdx] } };
        }
        // 2. Try comparing plain text (Legacy Migration)
        if (storedPass === String(password)) {
           // Migrate to hash immediately
           userSheet.getRange(i + 1, pIdx + 1).setValue(inputHash);
           return { success: true, user: { username: data[i][uIdx], name: data[i][nIdx] } };
        }
      }
    }
    return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  } catch (e) { return { success: false, message: e.toString() }; }
}

function doSignup(username, password, name, email) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let userSheet = ss.getSheetByName(SHEET_USERS);
    if (!userSheet) { setupDatabase(); userSheet = ss.getSheetByName(SHEET_USERS); }
    const data = userSheet.getDataRange().getValues();
    const headers = data[0];
    const uIdx = findColumnIndex(headers, 'Username');
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][uIdx]) === String(username)) return { success: false, message: 'ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว' };
    }
    userSheet.appendRow([username, hashPassword(password), name, email, new Date(), 'TRUE']);
    createDefaultCategories(username);
    return { success: true, user: { username, name, email } };
  } catch (e) { return { success: false, message: e.toString() }; }
}

/**
 * ฟังก์ชันสำหรับระบบลืมรหัสผ่าน (Forgot Password)
 */
function sendResetOTP(identifier) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let userSheet = ss.getSheetByName(SHEET_USERS);
    if (!userSheet) { setupDatabase(); return { success: false, message: 'ระบบฐานข้อมูลยังไม่พร้อม' }; }
    
    const data = userSheet.getDataRange().getValues();
    const headers = data[0];
    const uIdx = findColumnIndex(headers, 'Username');
    const eIdx = findColumnIndex(headers, 'Email');
    
    if (uIdx === -1 || eIdx === -1) return { success: false, message: 'โครงสร้างฐานข้อมูลผิดพลาด' };

    let userEmail = '';
    let username = '';
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][uIdx]) === identifier || String(data[i][eIdx]) === identifier) {
        username = data[i][uIdx];
        userEmail = data[i][eIdx];
        break;
      }
    }
    
    if (!userEmail) return { success: false, message: 'ไม่พบข้อมูลผู้ใช้นี้ในระบบ' };
    
    // สร้างรหัส OTP 6 หลัก
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // เก็บ OTP ไว้ในหน่วยความจำชั่วคราว
    const props = PropertiesService.getScriptProperties();
    props.setProperty('RESET_OTP_' + username, otp);
    props.setProperty('RESET_TIME_' + username, new Date().getTime().toString());
    
    // ส่งอีเมล
    const subject = "รหัสกู้คืนรหัสผ่าน - Money Tracker";
    const body = `สวัสดีครับ,\n\nรหัสสำหรับกู้คืนรหัสผ่านของคุณคือ: ${otp}\nรหัสนี้จะหมดอายุภายใน 10 นาที\n\nหากคุณไม่ได้เป็นคนส่งคำขอนี้ โปรดระวังความปลอดภัยของบัญชีครับ`;
    
    MailApp.sendEmail(userEmail, subject, body);
    
    // สร้าง Hint เช่น j***@gmail.com
    const emailHint = userEmail.replace(/(.{1})(.*)(?=@)/, (gp1, gp2, gp3) => gp2 + "*".repeat(gp3.length));
    
    return { success: true, username: username, emailHint: emailHint };
  } catch (e) { return { success: false, message: e.toString() }; }
}

function verifyAndResetPassword(username, otp, newPassword) {
  try {
    const props = PropertiesService.getScriptProperties();
    const savedOtp = props.getProperty('RESET_OTP_' + username);
    const savedTime = props.getProperty('RESET_TIME_' + username);
    
    if (!savedOtp || savedOtp !== otp) return { success: false, message: 'รหัส OTP ไม่ถูกต้อง' };
    
    // ตรวจสอบเวลา (10 นาที)
    const now = new Date().getTime();
    if (now - parseInt(savedTime) > 600000) return { success: false, message: 'รหัส OTP หมดอายุแล้ว' };
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const userSheet = ss.getSheetByName(SHEET_USERS);
    const data = userSheet.getDataRange().getValues();
    const headers = data[0];
    const uIdx = findColumnIndex(headers, 'Username');
    const pIdx = findColumnIndex(headers, 'Password');
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][uIdx]) === username) {
        userSheet.getRange(i + 1, pIdx + 1).setValue(hashPassword(newPassword));
        // ล้าง OTP ออกหลังใช้เสร็จ
        props.deleteProperty('RESET_OTP_' + username);
        props.deleteProperty('RESET_TIME_' + username);
        return { success: true };
      }
    }
    return { success: false, message: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล' };
  } catch (e) { return { success: false, message: e.toString() }; }
}

function checkSession(username) {
  return { success: true, user: { username: username } };
}

function createDefaultCategories(username) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_CATEGORIES);
  const defaults = [
    ['c1_' + Date.now(), 'อาหาร', 'expense', 6000, '#FF6B6B', username],
    ['c2_' + Date.now(), 'เดินทาง', 'expense', 3000, '#4ECDC4', username],
    ['c3_' + Date.now(), 'ช้อปปิ้ง', 'expense', 2000, '#FFE66D', username],
    ['c4_' + Date.now(), 'อื่นๆ', 'expense', 1000, '#A0AEC0', username],
    ['c5_' + Date.now(), 'เงินเดือน', 'income', 0, '#95D5B2', username]
  ];
  defaults.forEach(row => sheet.appendRow(row));
}

// --- 6. DATA FUNCTIONS ---
function getInitialData(username) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const getSheetData = (name) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return [];
    const rows = sheet.getDataRange().getValues();
    if (rows.length < 2) return []; 
    const headers = rows.shift(); 
    let userIndex = findColumnIndex(headers, 'Username');
    if (userIndex === -1) userIndex = headers.length - 1;
    return rows.filter(r => String(r[userIndex]) === String(username)).map(r => {
      let obj = {};
      headers.forEach((h, i) => {
        let key = String(h).toLowerCase().trim().replace('categoryid','categoryId');
        let val = r[i];
        if (val instanceof Date) val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
        obj[key] = (val === undefined) ? "" : val;
      });
      return obj;
    });
  };
  const transactions = getSheetData(SHEET_TRANSACTIONS);
  const categories = getSheetData(SHEET_CATEGORIES);
  const settingsRaw = getSheetData(SHEET_SETTINGS);
  const settings = { cutoffDay: 1 };
  settingsRaw.forEach(s => settings[s.key] = s.value);
  return { status: 'success', transactions, categories, settings };
}

function exportData(username) {
  try {
    const data = getInitialData(username);
    if (data.status !== 'success') return { success: false, error: 'Could not fetch data' };
    
    const transactions = data.transactions;
    const categories = data.categories;
    const catMap = {};
    categories.forEach(c => catMap[c.id] = c.name);
    
    let csv = 'วันที่,ประเภท,หมวดหมู่,จำนวนเงิน,หมายเหตุ\n';
    transactions.forEach(t => {
      const catName = catMap[t.categoryId] || 'ไม่ระบุ';
      const typeText = t.type === 'income' ? 'รายรับ' : 'รายจ่าย';
      // Escape quotes and handle commas
      const note = t.note ? `"${t.note.replace(/"/g, '""')}"` : '';
      const catNameEscaped = catName.includes(',') ? `"${catName}"` : catName;
      csv += `${t.date},${typeText},${catNameEscaped},${t.amount},${note}\n`;
    });
    
    return { success: true, csv: csv };
  } catch (e) { return { success: false, error: e.toString() }; }
}

function saveTransaction(tx, username) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_TRANSACTIONS);
  sheet.appendRow([tx.id, tx.date, tx.type, tx.categoryId, tx.amount, tx.note, new Date(), username]);
  return { success: true };
}

function editTransaction(tx, username) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_TRANSACTIONS);
  const data = sheet.getDataRange().getValues();
  const idIdx = findColumnIndex(data[0], 'ID');
  const uIdx = findColumnIndex(data[0], 'Username');
  for(let i=1; i<data.length; i++) {
    if(String(data[i][idIdx]) == String(tx.id) && String(data[i][uIdx]) == String(username)) { 
       sheet.getRange(i+1, 1, 1, 8).setValues([[tx.id, tx.date, tx.type, tx.categoryId, tx.amount, tx.note, new Date(), username]]);
       return { success: true };
    }
  }
  return { success: false, error: 'Not found' };
}

function deleteTransaction(id, username) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_TRANSACTIONS);
  const data = sheet.getDataRange().getValues();
  const idIdx = findColumnIndex(data[0], 'ID');
  for(let i=1; i<data.length; i++) {
    if(String(data[i][idIdx]) == String(id)) {
       sheet.deleteRow(i+1);
       return { success: true };
    }
  }
  return { success: false };
}

function updateCategories(cats, username) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_CATEGORIES);
  const data = sheet.getDataRange().getValues();
  let uIdx = findColumnIndex(data[0], 'Username');
  if (uIdx === -1) uIdx = data[0].length - 1;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][uIdx]) === String(username)) sheet.deleteRow(i + 1);
  }
  cats.forEach(c => sheet.appendRow([c.id, c.name, c.type, c.budget || 0, c.color, username]));
  return { success: true };
}

function saveSettings(key, value, username) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SETTINGS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  let uIdx = findColumnIndex(headers, 'Username');
  let kIdx = findColumnIndex(headers, 'Key');
  let found = false;
  for(let i=1; i<data.length; i++){
    if(data[i][kIdx] === key && data[i][uIdx] === username) {
      sheet.getRange(i+1, 2).setValue(value);
      found = true;
      break;
    }
  }
  if(!found) sheet.appendRow([key, value, username]);
  return { success: true };
}
function doLogout(username) { return { success: true }; }

/**
 * ระบบประมวลผล Gemini AI
 */
function processWithGemini(text, username) {
  let apiKey = GEMINI_API_KEY; 
  if (!apiKey) apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) return { success: false, error: "API Key ไม่ถูกต้อง (กรุณาตั้งค่า Script Properties)" };

  let catsString = "อื่นๆ";
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const catSheet = ss.getSheetByName(SHEET_CATEGORIES);
    if (catSheet) {
      const catData = catSheet.getDataRange().getValues();
      const headers = catData[0];
      const uIdx = findColumnIndex(headers, 'Username');
      const nIdx = findColumnIndex(headers, 'Name');
      const tIdx = findColumnIndex(headers, 'Type');
      let info = [];
      for (let i = 1; i < catData.length; i++) {
        if (String(catData[i][uIdx]) === String(username)) {
          info.push(`${catData[i][nIdx]} (${catData[i][tIdx]})`);
        }
      }
      if (info.length > 0) catsString = info.join(", ");
    }
  } catch (e) {}

  const today = new Date();
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const dayName = Utilities.formatDate(today, Session.getScriptTimeZone(), "EEEE");

  const modelName = PropertiesService.getScriptProperties().getProperty('GEMINI_MODELS') || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const systemInstruction = `คุณคือผู้ช่วยวิเคราะห์รายรับรายจ่ายภาษาไทย ตอบกลับเป็น JSON เท่านั้น ห้ามใช้ Markdown code block

## ข้อมูลสำคัญ
- วันที่ปัจจุบัน: ${dateStr} (${dayName})
- หมวดหมู่ที่มี: ${catsString}

## กฎการวิเคราะห์
1. **ชื่อคน vs สิ่งของ**: หากมีคำที่อาจเป็นชื่อคน (เช่น ข้าวหอม, มะลิ, น้ำผึ้ง) ให้พิจารณาบริบท:
   - "ให้เงินข้าวหอมไปโรงเรียน" → ข้าวหอม = ชื่อคน, หมวด = การศึกษา/ลูก
   - "ซื้อข้าวหอมมะลิ 5 กิโล" → ข้าวหอมมะลิ = สินค้า, หมวด = อาหาร

2. **การจัดหมวดหมู่ตามบริบท**:
   - "ให้เงิน/ค่าขนม + ไปโรงเรียน" → การศึกษา, ลูก, หรือ อื่นๆ
   - "ให้เงินแม่/พ่อ" → ครอบครัว หรือ อื่นๆ
   - "ค่ารถ/แท็กซี่/Grab" → เดินทาง
   - "กินข้าว/อาหาร/ชานม" → อาหาร

3. **เกี่ยวกับวันที่**
   - ไม่มีข้อมูลวันที่ในประโยค → วันที่ปัจจุบัน
   - คำที่บอกวันที่แบบภาษาพูดทั่วไปเช่น เมื่อวาน → วันที่ปัจจุบัน - 1 วัน
   - คำที่บอกวันที่แบบภาษาพูดทั่วไปเช่น เมื่อวานซืน → วันที่ปัจจุบัน - 2 วัน
   - บอกวันที่มาอย่างเดียวเช่น เมื่อวันที่ 5 → ให้หมายถึงวันที่ 5 เดือนปัจจุบัน ยกเว้นจะระบุเดือนด้วย

4. **note**: ใส่รายละเอียดที่เป็นประโยชน์ เช่น "ให้ข้าวหอมไปโรงเรียน", "ค่าอาหารกลางวัน"

5. **ถ้าไม่แน่ใจหมวด**: ให้ใช้ "อื่นๆ" แทนการเดาผิด

## Format JSON (ต้องตอบ JSON เท่านั้น)
{
  "amount": number,
  "type": "expense" | "income",
  "categoryName": string (ต้องเป็นหมวดที่มีอยู่หรือ "อื่นๆ"),
  "date": "YYYY-MM-DD",
  "note": string (สรุปสั้นๆ)
}`;

  const payload = {
    "contents": [{ "parts": [{ "text": text }] }],
    "systemInstruction": { "parts": [{ "text": systemInstruction }] },
    "generationConfig": { "response_mime_type": "application/json" }
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const responseText = response.getContentText();
    console.log("Gemini Response:", responseText); // Log raw response
    const result = JSON.parse(responseText);
    
    if (response.getResponseCode() !== 200) {
      console.error("Gemini API Error:", responseText);
      return { success: false, error: `API Error: ${result.error?.message || response.getResponseCode()}` };
    }

    if (result.candidates && result.candidates.length > 0) {
      return { success: true, data: JSON.parse(result.candidates[0].content.parts[0].text) };
    }
    return { success: false, error: "AI ไม่สามารถวิเคราะห์ได้ (No candidates)" };
  } catch (e) { 
    console.error("Exception:", e.toString());
    return { success: false, error: `System Error: ${e.toString()}` }; 
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
