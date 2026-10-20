const SETTINGS_COLLECTION = 'admin_settings';
const SETTINGS_DOCUMENT = 'order_delivery';
const NOTIFICATION_COLLECTION = 'order_notifications';
const EMPLOYEE_SYNC_COLLECTION = 'employee_sync_queue';
const CATALOG_SYNC_COLLECTION = 'catalog_sync_queue';
const EMPLOYEE_COLLECTION = 'employees';
const EMPLOYEE_ROSTER_COLLECTION = 'employee_roster';
const DEFAULT_RECIPIENT = 'Moath.khaled.h@gmail.com';
const DEFAULT_FIREBASE_PROJECT_ID = 'natco-edabc';
const EMPLOYEE_SHEET_NAME = 'سجل الموظفين';
const PRODUCT_SHEET_NAME = 'كتالوج المنتجات';
const EMPLOYEE_HEADERS = [
  'اسم الموظف', 'البريد الإلكتروني', 'الرقم الوظيفي', 'الشركة/الشركة التابعة',
  'الفرع', 'المحافظة', 'السقف الشهري المعتمد', 'الإنفاق الشهري الحالي', 'حالة الحساب',
];
const PRODUCT_HEADERS = [
  'معرّف المنتج', 'اسم المنتج', 'الوصف', 'القسم الرئيسي', 'التصنيف الفرعي',
  'نوع السلة', 'سعر الوكيل الأساسي (ر.ي)', 'أسعار الشركات (JSON)', 'حالة العرض', 'الصورة متوفرة',
];
const LEGACY_ORDER_HEADERS = [
  'معرف الطلب', 'رقم الطلب', 'تاريخ الطلب', 'الحالة', 'اسم الموظف',
  'الكود الوظيفي', 'البريد الإلكتروني', 'الشركة', 'الفرع', 'الهاتف',
  'واتساب', 'العنوان', 'السلة الأساسية', 'السلة العائلية', 'الأصناف والكميات',
  'الأصناف المستبعدة',
];
const ORDER_HEADERS = [
  'معرف الطلب', 'رقم الطلب', 'تاريخ الطلب', 'الحالة', 'اسم الموظف',
  'الكود الوظيفي', 'البريد الإلكتروني', 'الشركة', 'الفرع', 'الهاتف',
  'واتساب', 'العنوان', 'فرع الاستلام', 'السلة الأساسية', 'السلة العائلية',
  'الأصناف والكميات', 'الأصناف المستبعدة', 'الإجمالي (ر.ي)', 'العملة',
];

function initializeNatcoIntegration() {
  const projectId = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID')
    || DEFAULT_FIREBASE_PROJECT_ID;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error('تحقق من Script Property باسم FIREBASE_PROJECT_ID في إعدادات مشروع Apps Script.');
  }
  PropertiesService.getScriptProperties().setProperty('FIREBASE_PROJECT_ID', projectId);
  let settings = getSettingsDocument_();
  if (!settings) {
    settings = { notificationEmails: [DEFAULT_RECIPIENT], spreadsheetUrl: '' };
  }

  let spreadsheetUrl = typeof settings.spreadsheetUrl === 'string' ? settings.spreadsheetUrl : '';
  if (!spreadsheetIdFromUrl_(spreadsheetUrl)) {
    const properties = PropertiesService.getScriptProperties();
    spreadsheetUrl = properties.getProperty('INITIAL_SHEET_URL') || '';
    if (!spreadsheetIdFromUrl_(spreadsheetUrl)) {
      const spreadsheet = SpreadsheetApp.create('طلبات السلال الغذائية - ناتكو');
      const sheet = spreadsheet.getSheets()[0];
      sheet.setName('طلبات الموظفين');
      sheet.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]);
      sheet.setFrozenRows(1);
      spreadsheetUrl = spreadsheet.getUrl();
      properties.setProperty('INITIAL_SHEET_URL', spreadsheetUrl);
    }
  }

  const recipients = Array.isArray(settings.notificationEmails) && settings.notificationEmails.length
    ? settings.notificationEmails
    : [DEFAULT_RECIPIENT];
  writeDocument_(
    SETTINGS_COLLECTION,
    SETTINGS_DOCUMENT,
    { notificationEmails: recipients, spreadsheetUrl },
    Boolean(getSettingsDocument_()),
  );
  PropertiesService.getScriptProperties().deleteProperty('INITIAL_SHEET_URL');
  const spreadsheetId = spreadsheetIdFromUrl_(spreadsheetUrl);
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  ensureEmployeeSheet_(spreadsheet);
  ensureCatalogSheet_(spreadsheet);
  ensureQueueTrigger_();
  ensureEmployeeEditTrigger_(spreadsheetId);
  syncAllNatcoEmployees();
  syncAllNatcoProducts();
  syncDeletedNatcoOrdersNow();

  console.log(
    'تم تجهيز Google Sheets ومزامنة الطلبات كل دقيقة تقريباً. رابط الجدول: ' + spreadsheetUrl,
  );
}

function processNatcoOrderQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const settings = getSettingsDocument_();
    if (!settings) throw new Error('احفظ إعدادات الإشعارات من لوحة المشرف ثم أعد تشغيل الإعداد الأولي.');

    const recipients = normalizeRecipients_(settings.notificationEmails);
    const spreadsheetId = spreadsheetIdFromUrl_(settings.spreadsheetUrl);
    if (!recipients.length || !spreadsheetId) {
      throw new Error('تحقق من عناوين المستلمين ورابط Google Sheets في إعدادات لوحة المشرف.');
    }

    const now = new Date();
    const queries = [
      {
        structuredQuery: {
          from: [{ collectionId: NOTIFICATION_COLLECTION }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'status' },
              op: 'EQUAL',
              value: { stringValue: 'pending' },
            },
          },
          limit: 100,
        },
      },
      {
        structuredQuery: {
          from: [{ collectionId: NOTIFICATION_COLLECTION }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'nextAttemptAt' },
              op: 'LESS_THAN_OR_EQUAL',
              value: { timestampValue: now.toISOString() },
            },
          },
          limit: 100,
        },
      },
    ];
    queries.forEach(function (query) {
      const response = firestoreRequest_('post', ':runQuery', query);
      (response || []).forEach(function (entry) {
        if (entry.error) throw new Error('Firestore query failed: ' + JSON.stringify(entry.error).slice(0, 300));
        if (entry.document) {
          const queue = decodeFields_(entry.document.fields || {});
          if (queue.status === 'pending' || queue.status === 'retry') {
            deliverOrder_(entry.document, recipients, spreadsheetId);
          }
        }
      });
    });
    processEmployeeSyncQueue_(spreadsheetId);
    processCatalogSyncQueue_(spreadsheetId);
  } finally {
    lock.releaseLock();
  }
}

function retryNatcoOrderQueueNow() {
  const response = firestoreRequest_('post', ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: NOTIFICATION_COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'retry' },
        },
      },
      limit: 100,
    },
  });
  let resetCount = 0;
  (response || []).forEach(function (entry) {
    if (entry.error) throw new Error('Firestore retry query failed: ' + JSON.stringify(entry.error).slice(0, 300));
    if (!entry.document) return;
    const queueId = entry.document.name.split('/').pop();
    patchDocument_(NOTIFICATION_COLLECTION, queueId, {
      status: 'pending',
      nextAttemptAt: new Date(0),
    });
    resetCount += 1;
  });
  console.log('أُعيدت جدولة ' + resetCount + ' إشعارات فاشلة للمحاولة الآن.');
  processNatcoOrderQueue();
}

function deliverOrder_(queueDocument, recipients, spreadsheetId) {
  const queueId = queueDocument.name.split('/').pop();
  const queue = decodeFields_(queueDocument.fields || {});
  if (queue.status === 'retry' && queue.nextAttemptAt instanceof Date &&
    queue.nextAttemptAt.getTime() > Date.now()) return;

  const attempts = Number(queue.attempts || 0) + 1;

  try {
    patchDocument_(NOTIFICATION_COLLECTION, queueId, {
      attempts: attempts,
      lastError: '',
    });
    const order = getDocument_('orders', queueId);
    if (!order || order.uid !== queue.uid || order.id && order.id !== queueId) {
      throw new Error('الطلب المرتبط بإشعار المزامنة غير موجود أو لا يطابق صاحبه.');
    }

    const deliveryErrors = [];
    if (!queue.emailSentAt) {
      try {
        sendOrderEmail_(order, recipients);
        patchDocument_(NOTIFICATION_COLLECTION, queueId, { emailSentAt: new Date() });
      } catch (emailError) {
        const message = emailError instanceof Error ? emailError.message : String(emailError);
        deliveryErrors.push('البريد: ' + message);
        console.error('Order email delivery failed for ' + queueId + '.', emailError);
      }
    }

    let sheetRow = queue.sheetRow || 0;
    try {
      sheetRow = syncOrderRow_(queueId, order, spreadsheetId);
      syncEmployeeRow_(order.email, spreadsheetId);
      patchDocument_(NOTIFICATION_COLLECTION, queueId, {
        sheetRow: sheetRow,
        sheetWrittenAt: new Date(),
      });
    } catch (sheetError) {
      const message = sheetError instanceof Error ? sheetError.message : String(sheetError);
      deliveryErrors.push('Google Sheets: ' + message);
      console.error('Order sheet synchronization failed for ' + queueId + '.', sheetError);
    }

    if (deliveryErrors.length) {
      throw new Error(deliveryErrors.join(' | '));
    }
    patchDocument_(NOTIFICATION_COLLECTION, queueId, {
      status: 'delivered',
      sheetRow: sheetRow,
      deliveredAt: new Date(),
      lastError: '',
    });
  } catch (error) {
    const delayMinutes = Math.min(60, Math.pow(2, Math.min(attempts - 1, 6)));
    const message = error instanceof Error ? error.message : String(error);
    try {
      patchDocument_(NOTIFICATION_COLLECTION, queueId, {
        status: 'retry',
        attempts: attempts,
        lastError: message.slice(0, 500),
        nextAttemptAt: new Date(Date.now() + delayMinutes * 60 * 1000),
      });
    } catch (updateError) {
      console.error('Unable to store order delivery retry state.', updateError);
    }
    console.error('Order notification delivery failed for ' + queueId + '.', error);
  }
}

function syncDeletedNatcoOrdersNow() {
  const settings = getSettingsDocument_();
  const spreadsheetId = settings && spreadsheetIdFromUrl_(settings.spreadsheetUrl);
  if (!spreadsheetId) throw new Error('احفظ رابط Google Sheets من لوحة المشرف قبل مزامنة الطلبات المحذوفة.');
  const response = firestoreRequest_('post', ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: 'orders' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'deleted' },
        },
      },
      limit: 1000,
    },
  });
  let count = 0;
  (response || []).forEach(function (entry) {
    if (entry.error) throw new Error('Deleted orders query failed: ' + JSON.stringify(entry.error).slice(0, 300));
    if (!entry.document) return;
    const orderId = entry.document.name.split('/').pop();
    const order = decodeFields_(entry.document.fields || {});
    syncOrderRow_(orderId, order, spreadsheetId);
    count += 1;
  });
  console.log('تمت مزامنة ' + count + ' طلباً محذوفاً كسجلات حمراء في Google Sheets.');
}

function syncOrderRow_(orderId, order, spreadsheetId) {
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName('طلبات الموظفين') || spreadsheet.getSheets()[0];
  ensureSheetHeaders_(sheet);
  const existingRow = findOrderRow_(sheet, orderId);
  const values = orderSheetRow_(orderId, order);
  const row = existingRow || sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  sheet.getRange(row, 1, 1, ORDER_HEADERS.length)
    .setBackgrounds([Array(ORDER_HEADERS.length).fill(orderStatusColor_(order.status))]);
  return row;
}

function processEmployeeSyncQueue_(spreadsheetId) {
  const response = firestoreRequest_('post', ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: EMPLOYEE_SYNC_COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'pending' },
        },
      },
      limit: 100,
    },
  });
  (response || []).forEach(function (entry) {
    if (entry.error) throw new Error('Employee sync queue query failed: ' + JSON.stringify(entry.error).slice(0, 300));
    if (!entry.document) return;
    const queueId = entry.document.name.split('/').pop();
    const queue = decodeFields_(entry.document.fields || {});
    try {
      if (queue.action === 'deleted') {
        const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
        const sheet = ensureEmployeeSheet_(spreadsheet);
        const row = findEmployeeRow_(sheet, queue.email || queueId);
        if (row) sheet.deleteRow(row);
      } else {
        syncEmployeeRow_(queue.email || queueId, spreadsheetId);
      }
      patchDocument_(EMPLOYEE_SYNC_COLLECTION, queueId, {
        status: 'delivered',
        syncedAt: new Date(),
        lastError: '',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Employee sheet synchronization failed for ' + queueId + '.', error);
      patchDocument_(EMPLOYEE_SYNC_COLLECTION, queueId, {
        lastError: message.slice(0, 500),
      });
    }
  });
}

function processCatalogSyncQueue_(spreadsheetId) {
  const response = firestoreRequest_('post', ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: CATALOG_SYNC_COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'pending' },
        },
      },
      limit: 100,
    },
  });
  (response || []).forEach(function (entry) {
    if (entry.error) throw new Error('Catalog sync queue query failed: ' + JSON.stringify(entry.error).slice(0, 300));
    if (!entry.document) return;
    const queueId = entry.document.name.split('/').pop();
    const queue = decodeFields_(entry.document.fields || {});
    try {
      if (queue.action === 'deleted') {
        const sheet = ensureCatalogSheet_(SpreadsheetApp.openById(spreadsheetId));
        const row = findCatalogProductRow_(sheet, queue.productId || queueId);
        if (row) sheet.deleteRow(row);
      } else {
        syncCatalogProductRow_(queue.productId || queueId, spreadsheetId);
      }
      patchDocument_(CATALOG_SYNC_COLLECTION, queueId, {
        status: 'delivered',
        syncedAt: new Date(),
        lastError: '',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Catalog sheet synchronization failed for ' + queueId + '.', error);
      patchDocument_(CATALOG_SYNC_COLLECTION, queueId, { lastError: message.slice(0, 500) });
    }
  });
}

function syncAllNatcoProducts() {
  const settings = getSettingsDocument_();
  const spreadsheetId = settings && spreadsheetIdFromUrl_(settings.spreadsheetUrl);
  if (!spreadsheetId) throw new Error('احفظ رابط Google Sheets من لوحة المشرف قبل مزامنة الكتالوج.');
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ensureCatalogSheet_(spreadsheet);
  const response = firestoreRequest_('post', ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: 'products' }],
      limit: 1000,
    },
  });
  let count = 0;
  (response || []).forEach(function (entry) {
    if (entry.error) throw new Error('Products query failed: ' + JSON.stringify(entry.error).slice(0, 300));
    if (!entry.document) return;
    const productId = entry.document.name.split('/').pop();
    const product = decodeFields_(entry.document.fields || {});
    syncCatalogProductRow_(productId, spreadsheetId, product, sheet);
    count += 1;
  });
  console.log('تمت مزامنة ' + count + ' منتجاً في تبويب "' + PRODUCT_SHEET_NAME + '".');
}

function syncCatalogProductRow_(productId, spreadsheetId, suppliedProduct, existingSheet) {
  const product = suppliedProduct || getDocument_('products', productId);
  const spreadsheet = existingSheet ? null : SpreadsheetApp.openById(spreadsheetId);
  const sheet = existingSheet || ensureCatalogSheet_(spreadsheet);
  const existingRow = findCatalogProductRow_(sheet, productId);
  if (!product) {
    if (existingRow) sheet.deleteRow(existingRow);
    return;
  }
  const prices = product.companyAgentPrices && typeof product.companyAgentPrices === 'object'
    ? JSON.stringify(product.companyAgentPrices)
    : '{}';
  const values = [
    productId,
    product.name || '',
    product.detail || '',
    product.department || '',
    product.subcategory || '',
    product.category || 'both',
    typeof product.agentPrice === 'number' ? product.agentPrice : '',
    prices,
    product.active === false ? 'مخفي' : 'نشط',
    product.imageUrl ? 'نعم' : 'لا',
  ].map(safeSheetValue_);
  const row = existingRow || sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, PRODUCT_HEADERS.length).setValues([values]);
  sheet.getRange(row, 1, 1, PRODUCT_HEADERS.length)
    .setBackground(product.active === false ? '#f0f1f4' : '#ffffff');
}

function findCatalogProductRow_(sheet, productId) {
  if (sheet.getLastRow() < 2) return 0;
  const match = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(productId))
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function syncAllNatcoEmployees() {
  const settings = getSettingsDocument_();
  const spreadsheetId = settings && spreadsheetIdFromUrl_(settings.spreadsheetUrl);
  if (!spreadsheetId) throw new Error('احفظ رابط Google Sheets من لوحة المشرف قبل مزامنة الموظفين.');
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ensureEmployeeSheet_(spreadsheet);
  const response = firestoreRequest_('post', ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: EMPLOYEE_ROSTER_COLLECTION }],
      limit: 1000,
    },
  });
  let count = 0;
  (response || []).forEach(function (entry) {
    if (entry.error) throw new Error('Employee roster query failed: ' + JSON.stringify(entry.error).slice(0, 300));
    if (!entry.document) return;
    const email = entry.document.name.split('/').pop();
    syncEmployeeRow_(email, spreadsheetId, sheet);
    count += 1;
  });
  console.log('تمت مزامنة ' + count + ' سجلاً في تبويب "' + EMPLOYEE_SHEET_NAME + '".');
}

function syncEmployeeRow_(email, spreadsheetId, existingSheet) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return;
  const roster = getDocument_(EMPLOYEE_ROSTER_COLLECTION, normalizedEmail);
  if (!roster) return;
  const spreadsheet = existingSheet ? null : SpreadsheetApp.openById(spreadsheetId);
  const sheet = existingSheet || ensureEmployeeSheet_(spreadsheet);
  const profile = findEmployeeProfile_(normalizedEmail);
  const values = [
    profile.name || roster.name || '',
    normalizedEmail,
    roster.employeeCode || '',
    roster.company || '',
    roster.branch || '',
    roster.province || '',
    typeof roster.monthlySpendingLimit === 'number' ? roster.monthlySpendingLimit : '',
    typeof roster.currentMonthlySpent === 'number' ? roster.currentMonthlySpent : 0,
    roster.active === true ? 'نشط' : 'موقوف',
  ].map(safeSheetValue_);
  const row = findEmployeeRow_(sheet, normalizedEmail);
  if (row) sheet.getRange(row, 1, 1, EMPLOYEE_HEADERS.length).setValues([values]);
  else sheet.appendRow(values);
  const targetRow = row || sheet.getLastRow();
  const statusColor = roster.active === true ? '#e7f4ea' : '#f0f1f4';
  sheet.getRange(targetRow, 1, 1, EMPLOYEE_HEADERS.length)
    .setBackgrounds([Array(EMPLOYEE_HEADERS.length).fill(statusColor)]);
}

function findEmployeeProfile_(email) {
  const response = firestoreRequest_('post', ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: EMPLOYEE_COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'email' },
          op: 'EQUAL',
          value: { stringValue: email },
        },
      },
      limit: 1,
    },
  });
  const document = (response || []).find(function (entry) { return entry.document; });
  return document ? decodeFields_(document.document.fields || {}) : {};
}

function handleEmployeeSheetEdit(event) {
  if (!event || !event.range) return;
  const sheet = event.range.getSheet();
  if (sheet.getName() !== EMPLOYEE_SHEET_NAME || event.range.getRow() < 2) return;
  ensureEmployeeHeaders_(sheet);
  const firstRow = event.range.getRow();
  const rowCount = event.range.getNumRows();
  for (let offset = 0; offset < rowCount; offset += 1) {
    try {
      importEmployeeSheetRow_(sheet, firstRow + offset);
    } catch (error) {
      console.error('Unable to import edited employee row ' + (firstRow + offset) + '.', error);
      sheet.getRange(firstRow + offset, 1, 1, EMPLOYEE_HEADERS.length).setBackground('#fce4e4');
      throw error;
    }
  }
}

function importEmployeeSheetRow_(sheet, rowNumber) {
  const values = sheet.getRange(rowNumber, 1, 1, EMPLOYEE_HEADERS.length).getValues()[0];
  const employeeName = String(values[0] || '').trim();
  const email = String(values[1] || '').trim().toLowerCase();
  const employeeCode = String(values[2] || '').trim();
  const company = String(values[3] || '').trim();
  const branch = String(values[4] || '').trim();
  const province = String(values[5] || '').trim();
  const limitValue = values[6];
  const spentValue = values[7];
  const statusText = String(values[8] || '').trim().toLowerCase();
  const active = ['نشط', 'active', 'true', '1', 'معتمد'].indexOf(statusText) >= 0;
  const inactive = ['موقوف', 'inactive', 'false', '0', 'غير نشط'].indexOf(statusText) >= 0;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !employeeCode || !company || !branch ||
    !province || (!active && !inactive)) {
    throw new Error('أكمل البريد والرقم الوظيفي والشركة والفرع والمحافظة وحالة الحساب.');
  }
  const limit = limitValue === '' || limitValue === null ? null : Number(limitValue);
  const spent = spentValue === '' || spentValue === null ? 0 : Number(spentValue);
  if ((limit !== null && (!Number.isFinite(limit) || limit < 0 || limit > 1000000000)) ||
    !Number.isFinite(spent) || spent < 0 || spent > 1000000000) {
    throw new Error('السقف والإنفاق يجب أن يكونا أرقاماً غير سالبة ضمن الحد المسموح.');
  }
  const fields = {
    employeeCode: employeeCode.slice(0, 80),
    company: company.slice(0, 80),
    branch: branch.slice(0, 80),
    province: province.slice(0, 80),
    name: employeeName.slice(0, 120),
    currentMonthlySpent: spent,
    spendingPeriod: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM'),
    active: active,
    updatedAt: new Date(),
  };
  if (limit !== null) fields.monthlySpendingLimit = limit;
  const rosterFields = Object.assign({}, fields);
  const existingRoster = getDocument_(EMPLOYEE_ROSTER_COLLECTION, email);
  if (existingRoster) {
    patchDocumentFields_(EMPLOYEE_ROSTER_COLLECTION, email, rosterFields,
      Object.keys(rosterFields).concat(limit === null ? ['monthlySpendingLimit'] : []));
  } else {
    writeDocument_(EMPLOYEE_ROSTER_COLLECTION, email, rosterFields, false);
  }
  const profiles = findEmployeeDocuments_(email);
  profiles.forEach(function (profileDocument) {
    const profileId = profileDocument.name.split('/').pop();
    const profileFields = Object.assign({}, fields);
    if (limit !== null) profileFields.monthlySpendingLimit = limit;
    patchDocumentFields_(EMPLOYEE_COLLECTION, profileId, profileFields,
      Object.keys(profileFields).concat(limit === null ? ['monthlySpendingLimit'] : []));
  });
  syncEmployeeRow_(email, '', sheet);
}

function findEmployeeDocuments_(email) {
  const response = firestoreRequest_('post', ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: EMPLOYEE_COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'email' },
          op: 'EQUAL',
          value: { stringValue: email },
        },
      },
      limit: 10,
    },
  });
  return (response || []).filter(function (entry) { return entry.document; })
    .map(function (entry) { return entry.document; });
}


function sendOrderEmail_(order, recipients) {
  if (MailApp.getRemainingDailyQuota() < recipients.length) {
    throw new Error('وصل حساب Google إلى حد إرسال البريد اليومي. ستُعاد المحاولة تلقائياً.');
  }
  const profile = order.profile || {};
  const items = order.items || {};
  const details = order.itemDetails || {};
  const itemSummary = Object.keys(items)
    .filter(function (id) { return Number(items[id]) > 0; })
    .map(function (id) {
      return ((details[id] && details[id].name) || id) + ' × ' + items[id];
    })
    .join('، ') || 'لا توجد تفاصيل أصناف';
  const subject = 'طلب سلة غذائية جديد ' + (order.reference || '');
  const body = [
    'وصل طلب سلة غذائية جديد إلى بوابة ناتكو.',
    'رقم الطلب: ' + (order.reference || ''),
    'الموظف: ' + (profile.name || ''),
    'الكود الوظيفي: ' + (order.employeeCode || ''),
    'الشركة والفرع: ' + [profile.company, profile.branch].filter(Boolean).join(' - '),
    'الهاتف: ' + (profile.phone || ''),
    'واتساب: ' + (profile.whatsapp || ''),
    'السلال: أساسية ' + ((order.baskets || {}).essential || 0) +
      '، عائلية ' + ((order.baskets || {}).family || 0),
    'الأصناف: ' + itemSummary,
    'العنوان: ' + (profile.address || ''),
    '',
    'تُدار حالة الطلب من لوحة مشرف ناتكو.',
  ].join('\n');
  MailApp.sendEmail(recipients.join(','), subject, body);
}

function orderSheetRow_(orderId, order) {
  const profile = order.profile || {};
  const items = order.items || {};
  const details = order.itemDetails || {};
  const itemSummary = Object.keys(items)
    .filter(function (id) { return Number(items[id]) > 0; })
    .map(function (id) {
      return ((details[id] && details[id].name) || id) + ' × ' + items[id];
    })
    .join('، ');
  const excluded = (order.excluded || []).map(function (id) {
    return (details[id] && details[id].name) || id;
  }).join('، ');
  return [
    orderId,
    order.reference || '',
    order.createdAt instanceof Date ? order.createdAt : new Date(),
    orderSheetStatus_(order.status),
    profile.name || '',
    order.employeeCode || '',
    order.email || '',
    profile.company || '',
    profile.branch || '',
    profile.phone || '',
    profile.whatsapp || '',
    profile.address || '',
    order.pickupBranch || profile.branch || '',
    String((order.baskets || {}).essential || 0),
    String((order.baskets || {}).family || 0),
    itemSummary,
    excluded,
    typeof order.totalAmount === 'number' ? order.totalAmount : '',
    order.currency || 'YER',
  ].map(safeSheetValue_);
}

function orderSheetStatus_(status) {
  const labels = {
    received: 'وصل الطلب (RECEIVED)',
    preparing: 'قيد التجهيز (PREPARING)',
    ready: 'جاهز للصرف (READY)',
    fulfilled: 'تم التسليم (FULFILLED)',
    cancelled: 'ملغي (CANCELLED)',
    deleted: 'محذوف (DELETED)',
  };
  return labels[status] || String(status || 'received');
}

function orderStatusColor_(status) {
  const colors = {
    received: '#e7f4ea',
    preparing: '#fff2d9',
    ready: '#e5f1ff',
    fulfilled: '#e5f3f3',
    cancelled: '#f0f1f4',
    deleted: '#fce4e4',
  };
  return colors[status] || '#ffffff';
}

function ensureSheetHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }
  const columnCount = Math.max(sheet.getLastColumn(), ORDER_HEADERS.length);
  const existingHeaders = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0];
  const matchesCurrent = ORDER_HEADERS.every(function (header, index) {
    return existingHeaders[index] === header;
  });
  const matchesLegacy = LEGACY_ORDER_HEADERS.every(function (header, index) {
    return existingHeaders[index] === header;
  });
  if (matchesCurrent) return;
  if (matchesLegacy && existingHeaders.slice(LEGACY_ORDER_HEADERS.length)
    .every(function (header) { return !header; })) {
    const additionalHeaders = ORDER_HEADERS.slice(LEGACY_ORDER_HEADERS.length);
    sheet.getRange(1, LEGACY_ORDER_HEADERS.length + 1, 1, additionalHeaders.length)
      .setValues([additionalHeaders]);
    return;
  }
  throw new Error('الجدول المحدد يحتوي على أعمدة مختلفة. اختر ورقة متوافقة مع قالب طلبات ناتكو.');
}

function findOrderRow_(sheet, orderId) {
  if (sheet.getLastRow() < 2) return 0;
  const match = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(orderId)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function safeSheetValue_(value) {
  if (typeof value !== 'string') return value;
  return /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
}

function normalizeRecipients_(values) {
  if (!Array.isArray(values)) return [];
  return values.map(function (value) { return String(value).trim().toLowerCase(); })
    .filter(function (value, index, list) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && list.indexOf(value) === index;
    })
    .slice(0, 20);
}

function spreadsheetIdFromUrl_(url) {
  const match = typeof url === 'string'
    ? url.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)
    : null;
  return match ? match[1] : '';
}

function ensureEmployeeSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(EMPLOYEE_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(EMPLOYEE_SHEET_NAME);
  ensureEmployeeHeaders_(sheet);
  return sheet;
}

function ensureCatalogSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(PRODUCT_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(PRODUCT_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, PRODUCT_HEADERS.length).setValues([PRODUCT_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, PRODUCT_HEADERS.length)
      .setBackground('#162766')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sheet.autoResizeColumns(1, PRODUCT_HEADERS.length);
    return sheet;
  }
  const headers = sheet.getRange(1, 1, 1, PRODUCT_HEADERS.length).getDisplayValues()[0];
  if (!PRODUCT_HEADERS.every(function (header, index) { return headers[index] === header; })) {
    throw new Error('عناوين تبويب كتالوج المنتجات غير مطابقة للقالب. لا تغيّر صف العناوين.');
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function ensureEmployeeHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, EMPLOYEE_HEADERS.length).setValues([EMPLOYEE_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, EMPLOYEE_HEADERS.length)
      .setBackground('#162766')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sheet.autoResizeColumns(1, EMPLOYEE_HEADERS.length);
    return;
  }
  const headers = sheet.getRange(1, 1, 1, EMPLOYEE_HEADERS.length).getDisplayValues()[0];
  if (!EMPLOYEE_HEADERS.every(function (header, index) { return headers[index] === header; })) {
    throw new Error('عناوين تبويب سجل الموظفين غير مطابقة للقالب. لا تغيّر صف العناوين.');
  }
  sheet.setFrozenRows(1);
}

function findEmployeeRow_(sheet, email) {
  if (sheet.getLastRow() < 2) return 0;
  const match = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1)
    .createTextFinder(email)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function ensureEmployeeEditTrigger_(spreadsheetId) {
  const exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'handleEmployeeSheetEdit' &&
      trigger.getTriggerSourceId() === spreadsheetId;
  });
  if (!exists) {
    ScriptApp.newTrigger('handleEmployeeSheetEdit')
      .forSpreadsheet(spreadsheetId)
      .onEdit()
      .create();
  }
}

function ensureQueueTrigger_() {
  const exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'processNatcoOrderQueue';
  });
  if (!exists) {
    ScriptApp.newTrigger('processNatcoOrderQueue').timeBased().everyMinutes(1).create();
  }
}

function getSettingsDocument_() {
  return getDocument_(SETTINGS_COLLECTION, SETTINGS_DOCUMENT);
}

function getDocument_(collection, documentId) {
  const response = firestoreRequest_('get', '/' + collection + '/' + encodeURIComponent(documentId), null, true);
  if (!response) return null;
  const result = decodeFields_(response.fields || {});
  result.id = documentId;
  return result;
}

function writeDocument_(collection, documentId, values, update) {
  if (update) {
    patchDocument_(collection, documentId, values);
    return;
  }
  firestoreRequest_('post', '/' + collection, {
    documentId: documentId,
  }, { fields: encodeFields_(values) });
}

function patchDocument_(collection, documentId, values) {
  patchDocumentFields_(collection, documentId, values, Object.keys(values));
}

function patchDocumentFields_(collection, documentId, values, fieldPaths) {
  const mask = fieldPaths.map(function (key) {
    return 'updateMask.fieldPaths=' + encodeURIComponent(key);
  }).join('&');
  firestoreRequest_('patch', '/' + collection + '/' + encodeURIComponent(documentId) + '?' + mask, null, {
    fields: encodeFields_(values),
  });
}

function firestoreRequest_(method, path, queryOrBody, bodyOrOptional) {
  const projectId = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
  if (!projectId) throw new Error('شغّل initializeNatcoIntegration أولاً لإعداد Firebase Project ID.');
  let url = 'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(projectId) + '/databases/(default)/documents' + path;
  let body = null;
  let optional = false;
  if (method === 'post' && path === ':runQuery') {
    body = queryOrBody;
  } else if (method === 'get') {
    optional = Boolean(bodyOrOptional);
  } else if (method === 'post') {
    const query = queryOrBody || {};
    url += '?documentId=' + encodeURIComponent(query.documentId || '');
    body = bodyOrOptional;
  } else if (method === 'patch') {
    body = bodyOrOptional;
  }

  const response = UrlFetchApp.fetch(url, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (optional && status === 404) return null;
  if (status < 200 || status >= 300) {
    throw new Error('Firestore API request failed (' + status + '): ' + response.getContentText().slice(0, 300));
  }
  const content = response.getContentText();
  return content ? JSON.parse(content) : null;
}

function encodeFields_(fields) {
  const result = {};
  Object.keys(fields).forEach(function (key) {
    result[key] = encodeValue_(fields[key]);
  });
  return result;
}

function encodeValue_(value) {
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue_) } };
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFields_(value) } };
  return { nullValue: null };
}

function decodeFields_(fields) {
  const result = {};
  Object.keys(fields).forEach(function (key) {
    result[key] = decodeValue_(fields[key]);
  });
  return result;
}

function decodeValue_(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('mapValue' in value) return decodeFields_((value.mapValue || {}).fields || {});
  if ('arrayValue' in value) return ((value.arrayValue || {}).values || []).map(decodeValue_);
  return null;
}
