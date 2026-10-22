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
const ORDER_ITEM_SHEET_NAME = 'تفاصيل الطلبات';
const SUMMARY_SHEET_NAME = 'ملخص';
const SYNC_LOG_SHEET_NAME = 'سجل المزامنة';
const SHEET_SCHEMA_VERSION = '3';
const QUEUE_BATCH_SIZE = 3;
const URLFETCH_QUOTA_PAUSE_PROPERTY = 'URLFETCH_QUOTA_PAUSED_UNTIL';
const URLFETCH_QUOTA_PAUSE_MS = 24 * 60 * 60 * 1000;
const EMPLOYEE_HEADERS = [
  'اسم الموظف', 'البريد الإلكتروني', 'الرقم الوظيفي', 'الشركة/الشركة التابعة',
  'الفرع', 'المحافظة', 'السقف الشهري المعتمد', 'الإنفاق الشهري الحالي', 'حالة الحساب',
  'فترة الإنفاق', 'العنوان', 'الهاتف', 'واتساب', 'بصمة المزامنة',
];
const PRODUCT_HEADERS = [
  'معرّف المنتج', 'اسم المنتج', 'الوصف', 'القسم الرئيسي', 'التصنيف الفرعي',
  'نوع السلة', 'سعر الوكيل الأساسي (ر.ي)', 'أسعار الشركات (JSON)', 'حالة العرض', 'الصورة متوفرة',
  'بصمة المزامنة',
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
  'نوع الحركة', 'عدد التعديلات', 'آخر تحديث',
];
const ORDER_ITEM_HEADERS = [
  'معرّف الطلب', 'رقم الطلب', 'تاريخ الطلب', 'حالة الطلب', 'اسم المنتج',
  'معرّف المنتج', 'الكمية', 'سعر الوحدة (ر.ي)', 'الإجمالي (ر.ي)',
];
const SYNC_LOG_HEADERS = ['وقت العملية', 'الاتجاه', 'نوع البيانات', 'المعرّف', 'النتيجة'];
const ORDER_STATUS_OPTIONS = [
  'وصل الطلب (RECEIVED)', 'قيد التجهيز (PREPARING)', 'جاهز للصرف (READY)',
  'تم التسليم (FULFILLED)', 'ملغي (CANCELLED)', 'محذوف (DELETED)',
];

function initializeNatcoIntegration() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('تعذر بدء التهيئة لأن عملية مزامنة أخرى ما زالت تعمل بعد الانتظار. أعد المحاولة بعد انتهائها.');
  try {
    initializeNatcoIntegration_();
  } finally {
    lock.releaseLock();
  }
}

function initializeNatcoIntegration_() {
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
  rebuildNatcoSheetsIfNeeded_(spreadsheet);
  ensureEmployeeSheet_(spreadsheet);
  ensureCatalogSheet_(spreadsheet);
  ensureOrderItemSheet_(spreadsheet);
  ensureSyncLogSheet_(spreadsheet);
  ensureSummarySheet_(spreadsheet);
  ensureOrderSheet_(spreadsheet);
  removeDuplicateDataRows_(spreadsheet);
  ensureQueueTrigger_();
  ensureSpreadsheetEditTrigger_(spreadsheetId);
  initializeEmployeeSpendingPeriod_();

  console.log(
    'تم تجهيز Google Sheets والمزامنة المحدودة للصفوف الجديدة كل خمس دقائق. ' +
    'لم تُشغّل مزامنة تاريخية شاملة تلقائياً. رابط الجدول: ' + spreadsheetUrl,
  );
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('إدارة ناتكو')
    .addItem('مزامنة كاملة مع التطبيق', 'syncAllNatcoData')
    .addToUi();
}

function syncAllNatcoData() {
  const settings = getSettingsDocument_();
  const spreadsheetId = settings && spreadsheetIdFromUrl_(settings.spreadsheetUrl);
  if (!spreadsheetId) throw new Error('احفظ رابط Google Sheets من لوحة المشرف قبل المزامنة.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('تعذر بدء المزامنة لأن عملية أخرى ما زالت تعمل بعد الانتظار. أعد المحاولة بعد انتهائها.');
  try {
    removeDuplicateDataRows_(SpreadsheetApp.openById(spreadsheetId));
    syncEmployeesFromSheet_(spreadsheetId);
    syncCatalogFromSheet_(spreadsheetId);
    syncAllNatcoEmployees(false);
    syncAllNatcoProducts();
    syncAllNatcoOrders();
    console.log('اكتملت المزامنة الشاملة بين Google Sheets والتطبيق.');
  } finally {
    lock.releaseLock();
  }
}

function repairNatcoTriggersNow() {
  const resumeAt = Date.now() + URLFETCH_QUOTA_PAUSE_MS;
  PropertiesService.getScriptProperties()
    .setProperty(URLFETCH_QUOTA_PAUSE_PROPERTY, String(resumeAt));
  ensureQueueTrigger_();
  console.log(
    'أزيلت مشغلات المسح الكامل والمشغلات المتكررة. أوقفت طلبات Firestore حتى ' +
    new Date(resumeAt).toISOString() + ' لتجنب تكرار خطأ الحصة اليومية.',
  );
}

function processNatcoOrderQueue() {
  if (urlFetchQuotaPauseUntil_() > Date.now()) {
    console.warn('توقفت المزامنة مؤقتاً بعد بلوغ حصة UrlFetch اليومية؛ ستستأنف تلقائياً بعد انتهاء فترة التوقف.');
    return;
  }
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
          limit: QUEUE_BATCH_SIZE,
        },
      },
      {
        structuredQuery: {
          from: [{ collectionId: NOTIFICATION_COLLECTION }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'status' },
              op: 'EQUAL',
              value: { stringValue: 'retry' },
            },
          },
          limit: QUEUE_BATCH_SIZE,
        },
      },
    ];
    let processedOrders = 0;
    queries.forEach(function (query) {
      const response = firestoreRequest_('post', ':runQuery', query);
      (response || []).forEach(function (entry) {
        if (entry.error) throw new Error('Firestore query failed: ' + JSON.stringify(entry.error).slice(0, 300));
        if (entry.document && processedOrders < QUEUE_BATCH_SIZE) {
          const queue = decodeFields_(entry.document.fields || {});
          if (queue.status === 'pending' || queue.status === 'retry') {
            processedOrders += 1;
            deliverOrder_(entry.document, recipients, spreadsheetId);
          }
        }
      });
    });
    processEmployeeSyncQueue_(spreadsheetId, QUEUE_BATCH_SIZE);
    processCatalogSyncQueue_(spreadsheetId, QUEUE_BATCH_SIZE);
    rolloverEmployeeSpending_(spreadsheetId);
  } catch (error) {
    if (isUrlFetchQuotaError_(error)) {
      console.error('أُوقفت دورات المزامنة المجدولة حتى تجدد حصة UrlFetch اليومية.');
      return;
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function retryNatcoOrderQueueNow() {
  processNatcoOrderQueue();
}

function deliverOrder_(queueDocument, recipients, spreadsheetId) {
  const queueId = queueDocument.name.split('/').pop();
  const queue = decodeFields_(queueDocument.fields || {});
  if (queue.status === 'retry' && queue.nextAttemptAt instanceof Date &&
    queue.nextAttemptAt.getTime() > Date.now()) return;

  const attempts = Number(queue.attempts || 0) + 1;

  try {
    if (queue.eventStatus === 'deleted') {
      deleteOrderRows_(queueId, spreadsheetId);
      patchDocument_(NOTIFICATION_COLLECTION, queueId, {
        status: 'delivered',
        deletedAt: new Date(),
        lastError: '',
      });
      logSync_('التطبيق → Google Sheets', 'طلب محذوف نهائياً', queueId, 'حُذفت صفوف الطلب', spreadsheetId);
      return;
    }
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
      patchDocument_(NOTIFICATION_COLLECTION, queueId, {
        sheetRow: sheetRow,
        sheetWrittenAt: new Date(),
      });
      logSync_('التطبيق → Google Sheets', 'طلب', queueId, 'تمت المزامنة', spreadsheetId);
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
    if (isUrlFetchQuotaError_(error)) throw error;
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

function syncAllNatcoOrders() {
  const settings = getSettingsDocument_();
  const spreadsheetId = settings && spreadsheetIdFromUrl_(settings.spreadsheetUrl);
  if (!spreadsheetId) throw new Error('احفظ رابط Google Sheets من لوحة المشرف قبل مزامنة الطلبات.');
  const response = firestoreRequest_('post', ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: 'orders' }],
      limit: 1000,
    },
  });
  let count = 0;
  (response || []).forEach(function (entry) {
    if (entry.error) throw new Error('Orders query failed: ' + JSON.stringify(entry.error).slice(0, 300));
    if (!entry.document) return;
    const orderId = entry.document.name.split('/').pop();
    syncOrderRow_(orderId, decodeFields_(entry.document.fields || {}), spreadsheetId);
    count += 1;
  });
  console.log('تمت مزامنة ' + count + ' طلباً في Google Sheets.');
}

function syncOrderRow_(orderId, order, spreadsheetId) {
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ensureOrderSheet_(spreadsheet);
  const existingRow = findOrderRow_(sheet, orderId);
  const values = orderSheetRow_(orderId, order);
  const row = existingRow || sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  sheet.getRange(row, 1, 1, ORDER_HEADERS.length)
    .setBackgrounds([Array(ORDER_HEADERS.length).fill(orderStatusColor_(order.status))]);
  const itemSheet = ensureOrderItemSheet_(spreadsheet);
  syncOrderItemRows_(itemSheet, orderId, order);
  return row;
}

function syncOrderItemRows_(sheet, orderId, order) {
  const items = order.items && typeof order.items === 'object' ? order.items : {};
  const details = order.itemDetails && typeof order.itemDetails === 'object' ? order.itemDetails : {};
  const wanted = {};
  Object.keys(items).forEach(function (productId) {
    const quantity = Number(items[productId]);
    if (!Number.isInteger(quantity) || quantity <= 0) return;
    const detail = details[productId] || {};
    wanted[productId] = [
      orderId,
      order.reference || '',
      order.createdAt instanceof Date ? order.createdAt : '',
      orderStatus_(order.status),
      detail.name || productId,
      productId,
      quantity,
      typeof detail.agentPrice === 'number' ? detail.agentPrice : '',
      typeof detail.agentPrice === 'number' ? detail.agentPrice * quantity : '',
    ].map(safeSheetValue_);
  });

  const existing = {};
  const duplicates = [];
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues().forEach(function (row, index) {
      if (String(row[0]) !== String(orderId)) return;
      const productId = String(row[5]);
      if (existing[productId]) duplicates.push(index + 2);
      else existing[productId] = index + 2;
    });
  }
  duplicates.sort(function (left, right) { return right - left; })
    .forEach(function (row) { sheet.deleteRow(row); });
  Object.keys(wanted).forEach(function (productId) {
    const row = existing[productId] || sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, ORDER_ITEM_HEADERS.length).setValues([wanted[productId]]);
    sheet.getRange(row, 1, 1, ORDER_ITEM_HEADERS.length)
      .setBackground(orderStatusColor_(order.status));
    delete existing[productId];
  });
  Object.keys(existing).map(function (productId) { return existing[productId]; })
    .sort(function (left, right) { return right - left; })
    .forEach(function (row) { sheet.deleteRow(row); });
}

function deleteOrderRows_(orderId, spreadsheetId) {
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const orderSheet = ensureOrderSheet_(spreadsheet);
  const orderRow = findOrderRow_(orderSheet, orderId);
  if (orderRow) orderSheet.deleteRow(orderRow);

  const itemSheet = ensureOrderItemSheet_(spreadsheet);
  if (itemSheet.getLastRow() < 2) return;
  const rows = itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, 1).getDisplayValues();
  rows.map(function (row, index) {
    return String(row[0]) === orderId ? index + 2 : 0;
  }).filter(function (row) { return row > 0; })
    .sort(function (left, right) { return right - left; })
    .forEach(function (row) { itemSheet.deleteRow(row); });
}

function processEmployeeSyncQueue_(spreadsheetId, batchSize) {
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
      limit: batchSize,
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
      logSync_('التطبيق → Google Sheets', 'موظف', queue.email || queueId, 'تمت المزامنة', spreadsheetId);
    } catch (error) {
      if (isUrlFetchQuotaError_(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.error('Employee sheet synchronization failed for ' + queueId + '.', error);
      patchDocument_(EMPLOYEE_SYNC_COLLECTION, queueId, {
        lastError: message.slice(0, 500),
      });
    }
  });
}

function processCatalogSyncQueue_(spreadsheetId, batchSize) {
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
      limit: batchSize,
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
      logSync_('التطبيق → Google Sheets', 'منتج', queue.productId || queueId, 'تمت المزامنة', spreadsheetId);
    } catch (error) {
      if (isUrlFetchQuotaError_(error)) throw error;
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
  values.push(productRowFingerprint_(values));
  const row = existingRow || sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, PRODUCT_HEADERS.length).setValues([values]);
  sheet.getRange(row, 1, 1, PRODUCT_HEADERS.length)
    .setBackground(product.active === false ? '#f0f1f4' : '#ffffff');
}

function findCatalogProductRow_(sheet, productId) {
  if (sheet.getLastRow() < 2) return 0;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  return keepFirstMatchingRow_(sheet, rows, String(productId));
}

function syncCatalogFromSheet_(spreadsheetId) {
  const sheet = ensureCatalogSheet_(SpreadsheetApp.openById(spreadsheetId));
  if (sheet.getLastRow() < 2) return;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, PRODUCT_HEADERS.length).getValues();
  let imported = 0;
  rows.forEach(function (row, index) {
    const productId = String(row[0] || '').trim();
    if (!productId || productRowFingerprint_(row) === String(row[10] || '')) return;
    try {
      importCatalogSheetRow_(sheet, index + 2);
      imported += 1;
    } catch (error) {
      sheet.getRange(index + 2, 1, 1, PRODUCT_HEADERS.length).setBackground('#fce4e4');
      logSync_('Google Sheets ← التطبيق', 'منتج', productId,
        'فشل: ' + errorMessage_(error));
      console.error('Unable to synchronize product row ' + (index + 2) + '.', error);
    }
  });
  if (imported) console.log('تمت مزامنة ' + imported + ' تعديلات أسعار من Google Sheets.');
}

function handleCatalogSheetEdit(event) {
  if (urlFetchQuotaPauseUntil_() > Date.now()) return;
  if (!event || !event.range || event.range.getRow() < 2) return;
  const sheet = event.range.getSheet();
  if (sheet.getName() !== PRODUCT_SHEET_NAME) return;
  const firstColumn = event.range.getColumn();
  const lastColumn = firstColumn + event.range.getNumColumns() - 1;
  const editsEditableField = firstColumn <= 9 && lastColumn >= 7;
  for (let offset = 0; offset < event.range.getNumRows(); offset += 1) {
    const rowNumber = event.range.getRow() + offset;
    const productId = String(sheet.getRange(rowNumber, 1).getValue() || '').trim();
    if (!productId) continue;
    try {
      if (editsEditableField) importCatalogSheetRow_(sheet, rowNumber);
      else syncCatalogProductRow_(productId, '', null, sheet);
      logSync_('Google Sheets → التطبيق', 'منتج', productId, 'تمت المزامنة');
    } catch (error) {
      if (isUrlFetchQuotaError_(error)) return;
      syncCatalogProductRow_(productId, '', null, sheet);
      sheet.getRange(rowNumber, 1, 1, PRODUCT_HEADERS.length).setBackground('#fce4e4');
      logSync_('Google Sheets → التطبيق', 'منتج', productId,
        'فشل: ' + errorMessage_(error));
      console.error('Unable to import catalog row ' + rowNumber + '.', error);
    }
  }
}

function importCatalogSheetRow_(sheet, rowNumber) {
  const row = sheet.getRange(rowNumber, 1, 1, PRODUCT_HEADERS.length).getValues()[0];
  const productId = String(row[0] || '').trim();
  const product = getDocument_('products', productId);
  if (!product) throw new Error('المنتج غير موجود في التطبيق.');
  const price = row[6] === '' || row[6] === null ? null : Number(row[6]);
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1000000000)) {
    throw new Error('سعر الوكيل يجب أن يكون رقماً بين صفر ومليار.');
  }
  let companyPrices = {};
  const companyPricesText = String(row[7] || '').trim();
  if (companyPricesText) {
    try {
      companyPrices = JSON.parse(companyPricesText);
    } catch (error) {
      throw new Error('صيغة أسعار الشركات JSON غير صحيحة.');
    }
    if (!companyPrices || typeof companyPrices !== 'object' || Array.isArray(companyPrices) ||
      Object.keys(companyPrices).length > 50 ||
      Object.keys(companyPrices).some(function (company) {
        const value = companyPrices[company];
        return !company || company.length > 80 || typeof value !== 'number' ||
          !Number.isFinite(value) || value < 0 || value > 1000000000;
      })) {
      throw new Error('تحقق من أن أسعار الشركات أرقام صحيحة غير سالبة.');
    }
  }
  const statusText = String(row[8] || '').trim().toLowerCase();
  const active = ['نشط', 'active', 'true', '1'].indexOf(statusText) >= 0;
  const inactive = ['مخفي', 'غير نشط', 'inactive', 'false', '0'].indexOf(statusText) >= 0;
  if (!active && !inactive) throw new Error('حالة العرض يجب أن تكون «نشط» أو «مخفي».');
  const fields = {
    companyAgentPrices: companyPrices,
    active: active,
    updatedAt: new Date(),
  };
  const fieldPaths = ['companyAgentPrices', 'active', 'updatedAt'];
  if (price !== null) {
    fields.agentPrice = price;
    fieldPaths.push('agentPrice');
  }
  patchDocumentFields_('products', productId, fields, fieldPaths);
  syncCatalogProductRow_(productId, '', null, sheet);
}

function productRowFingerprint_(values) {
  const editableValues = [values[6], values[7], values[8]].map(function (value) {
    return value instanceof Date ? value.toISOString() : value;
  });
  return digestFingerprint_(JSON.stringify(editableValues));
}

function digestFingerprint_(data) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, data),
  ).replace(/=+$/, '');
}

function syncAllNatcoEmployees(preserveExistingRows) {
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
    syncEmployeeRow_(email, spreadsheetId, sheet, preserveExistingRows);
    count += 1;
  });
  console.log('تمت مزامنة ' + count + ' سجلاً في تبويب "' + EMPLOYEE_SHEET_NAME + '".');
}

function syncEmployeeRow_(email, spreadsheetId, existingSheet, preserveExistingRow) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return;
  const roster = getDocument_(EMPLOYEE_ROSTER_COLLECTION, normalizedEmail);
  if (!roster) return;
  const spreadsheet = existingSheet ? null : SpreadsheetApp.openById(spreadsheetId);
  const sheet = existingSheet || ensureEmployeeSheet_(spreadsheet);
  const profile = findEmployeeProfile_(normalizedEmail);
  const profileMirror = {};
  ['name', 'address', 'phone', 'whatsapp'].forEach(function (field) {
    if (typeof profile[field] === 'string' && profile[field] !== String(roster[field] || '')) {
      profileMirror[field] = profile[field];
      roster[field] = profile[field];
    }
  });
  const phoneLookup = String(roster.phone || profile.phone || '').replace(/\D/g, '');
  if (phoneLookup.length >= 8 && phoneLookup.length <= 18) {
    if (phoneLookup !== String(roster.phoneLookup || '')) {
      const phoneOwners = findEmployeeEmailsByField_('phoneLookup', phoneLookup, 1000);
      const conflicts = phoneOwners.filter(function (ownerEmail) { return ownerEmail !== normalizedEmail; });
      if (conflicts.length) {
        Array.from(new Set(phoneOwners.concat([normalizedEmail]))).forEach(function (ownerEmail) {
          patchDocumentFields_(EMPLOYEE_ROSTER_COLLECTION, ownerEmail, {}, ['phoneLookup']);
        });
        delete roster.phoneLookup;
      } else {
        profileMirror.phoneLookup = phoneLookup;
        roster.phoneLookup = phoneLookup;
      }
    }
  } else if (roster.phoneLookup) {
    delete roster.phoneLookup;
    patchDocumentFields_(EMPLOYEE_ROSTER_COLLECTION, normalizedEmail, {}, ['phoneLookup']);
  }
  if (Object.keys(profileMirror).length) {
    patchDocumentFields_(EMPLOYEE_ROSTER_COLLECTION, normalizedEmail,
      profileMirror, Object.keys(profileMirror));
  }
  const values = [
    roster.name || profile.name || '',
    normalizedEmail,
    roster.employeeCode || '',
    roster.company || '',
    roster.branch || '',
    roster.province || '',
    typeof roster.monthlySpendingLimit === 'number' ? roster.monthlySpendingLimit : '',
    typeof roster.currentMonthlySpent === 'number' ? roster.currentMonthlySpent : 0,
    roster.active === true ? 'نشط' : 'موقوف',
    roster.spendingPeriod || '',
    roster.address || profile.address || '',
    roster.phone || profile.phone || '',
    roster.whatsapp || profile.whatsapp || '',
  ].map(safeSheetValue_);
  values.push(employeeRowFingerprint_(values));
  const row = findEmployeeRow_(sheet, normalizedEmail);
  if (row && preserveExistingRow) return;
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
  if (urlFetchQuotaPauseUntil_() > Date.now()) return;
  if (!event || !event.range) return;
  const sheet = event.range.getSheet();
  if (sheet.getName() !== EMPLOYEE_SHEET_NAME || event.range.getRow() < 2) return;
  if (!ensureEmployeeHeaders_(sheet)) {
    throw new Error('تعذر تحديد أعمدة الموظفين؛ صحح عناوين الصف الأول ثم أعد التعديل.');
  }
  const firstRow = event.range.getRow();
  const rowCount = event.range.getNumRows();
  const firstColumn = event.range.getColumn();
  const lastColumn = firstColumn + event.range.getNumColumns() - 1;
  const changedColumns = [];
  for (let column = firstColumn; column <= lastColumn; column += 1) changedColumns.push(column);
  const editableColumns = [1, 3, 4, 5, 6, 7, 9, 11, 12, 13];
  const onlyEditableColumns = changedColumns.every(function (column) {
    return editableColumns.indexOf(column) >= 0;
  });
  for (let offset = 0; offset < rowCount; offset += 1) {
    const rowNumber = firstRow + offset;
    let email = String(sheet.getRange(rowNumber, 2).getValue() || '').trim().toLowerCase();
    try {
      if (changedColumns.indexOf(2) >= 0) {
        const employeeCode = String(sheet.getRange(rowNumber, 3).getValue() || '').trim();
        email = typeof event.oldValue === 'string' && event.range.getNumRows() === 1
          ? event.oldValue.trim().toLowerCase()
          : findEmployeeEmailByCode_(employeeCode);
        if (!email) throw new Error('لا يمكن تغيير البريد الإلكتروني من الجدول.');
        sheet.getRange(rowNumber, 1, 1, EMPLOYEE_HEADERS.length).clearContent();
        syncEmployeeRow_(email, '', sheet);
        throw new Error('البريد الإلكتروني معرّف ثابت ولا يمكن تغييره من الجدول.');
      }
      if (!onlyEditableColumns) {
        if (email) syncEmployeeRow_(email, '', sheet);
        throw new Error('هذا العمود للعرض فقط؛ لم تُحفظ التغييرات عليه.');
      }
      importEmployeeSheetRow_(sheet, rowNumber);
      logSync_('Google Sheets → التطبيق', 'موظف', email, 'تمت المزامنة');
    } catch (error) {
      if (isUrlFetchQuotaError_(error)) return;
      console.error('Unable to import edited employee row ' + rowNumber + '.', error);
      const visibleEmail = String(sheet.getRange(rowNumber, 2).getValue() || '').trim().toLowerCase();
      if (visibleEmail && visibleEmail !== email) syncEmployeeRow_(visibleEmail, '', sheet);
      else if (email) syncEmployeeRow_(email, '', sheet);
      sheet.getRange(rowNumber, 1, 1, EMPLOYEE_HEADERS.length).setBackground('#fce4e4');
      logSync_('Google Sheets → التطبيق', 'موظف', email, 'فشل: ' + errorMessage_(error));
    }
  }
}

function findEmployeeEmailByCode_(employeeCode) {
  if (!employeeCode) return '';
  const emails = findEmployeeEmailsByField_('employeeCode', employeeCode);
  return emails.length === 1 ? emails[0] : '';
}

function findEmployeeEmailsByField_(fieldPath, value, resultLimit) {
  if (!fieldPath || !value) return [];
  const response = firestoreRequest_('post', ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: EMPLOYEE_ROSTER_COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: fieldPath },
          op: 'EQUAL',
          value: { stringValue: String(value) },
        },
      },
      limit: resultLimit || 2,
    },
  });
  const documents = (response || []).filter(function (entry) { return entry.document; });
  return documents.map(function (entry) {
    return entry.document.name.split('/').pop();
  });
}

function handleNatcoSheetEdit(event) {
  if (urlFetchQuotaPauseUntil_() > Date.now()) return;
  if (!event || !event.range) return;
  const name = event.range.getSheet().getName();
  if (name === EMPLOYEE_SHEET_NAME) handleEmployeeSheetEdit(event);
  else if (name === PRODUCT_SHEET_NAME) handleCatalogSheetEdit(event);
  else if (name === 'طلبات الموظفين') handleOrderSheetEdit(event);
  else if (name === ORDER_ITEM_SHEET_NAME) handleOrderItemSheetEdit(event);
}

function handleOrderSheetEdit(event) {
  if (!event || !event.range || event.range.getRow() < 2) return;
  const sheet = event.range.getSheet();
  const firstRow = event.range.getRow();
  for (let offset = 0; offset < event.range.getNumRows(); offset += 1) {
    const rowNumber = firstRow + offset;
    const orderId = String(sheet.getRange(rowNumber, 1).getValue() || '').trim();
    if (!orderId) continue;
    try {
      if (event.range.getColumn() <= 4 &&
        event.range.getColumn() + event.range.getNumColumns() - 1 >= 4) {
        updateOrderStatusFromSheet_(orderId, sheet.getRange(rowNumber, 4).getValue());
      } else {
        syncOrderRowFromFirestore_(orderId);
      }
      logSync_('Google Sheets → التطبيق', 'طلب', orderId, 'تمت المزامنة');
    } catch (error) {
      if (isUrlFetchQuotaError_(error)) return;
      syncOrderRowFromFirestore_(orderId);
      sheet.getRange(rowNumber, 1, 1, ORDER_HEADERS.length).setBackground('#fce4e4');
      logSync_('Google Sheets → التطبيق', 'طلب', orderId, 'فشل: ' + errorMessage_(error));
      console.error('Unable to import order row ' + rowNumber + '.', error);
    }
  }
}

function handleOrderItemSheetEdit(event) {
  if (!event || !event.range || event.range.getRow() < 2) return;
  const sheet = event.range.getSheet();
  const firstRow = event.range.getRow();
  const rowCount = event.range.getNumRows();
  const orders = {};
  for (let offset = 0; offset < rowCount; offset += 1) {
    const rowNumber = firstRow + offset;
    const orderId = String(sheet.getRange(rowNumber, 1).getValue() || '').trim();
    if (orderId) orders[orderId] = rowNumber;
  }
  Object.keys(orders).forEach(function (orderId) {
    const rowNumber = orders[orderId];
    try {
      if (event.range.getColumn() === 7 && event.range.getNumColumns() === 1) {
        updateOrderItemsFromSheet_(orderId, sheet);
      } else {
        syncOrderRowFromFirestore_(orderId);
      }
      logSync_('Google Sheets → التطبيق', 'محتوى طلب', orderId, 'تمت المزامنة');
    } catch (error) {
      if (isUrlFetchQuotaError_(error)) return;
      syncOrderRowFromFirestore_(orderId);
      sheet.getRange(rowNumber, 1, 1, ORDER_ITEM_HEADERS.length).setBackground('#fce4e4');
      logSync_('Google Sheets → التطبيق', 'محتوى طلب', orderId, 'فشل: ' + errorMessage_(error));
      console.error('Unable to import order item row ' + rowNumber + '.', error);
    }
  });
}

function syncOrderRowFromFirestore_(orderId) {
  const settings = getSettingsDocument_();
  const spreadsheetId = settings && spreadsheetIdFromUrl_(settings.spreadsheetUrl);
  const order = getDocument_('orders', orderId);
  if (!spreadsheetId || !order) throw new Error('تعذر العثور على إعدادات الجدول أو الطلب.');
  syncOrderRow_(orderId, order, spreadsheetId);
}

function updateOrderStatusFromSheet_(orderId, statusValue) {
  const status = parseOrderStatus_(statusValue);
  if (!status) throw new Error('اختر حالة صحيحة من القائمة المنسدلة.');
  const orderSnapshot = getDocumentSnapshot_('orders', orderId);
  if (!orderSnapshot) throw new Error('الطلب غير موجود في التطبيق.');
  const notificationSnapshot = getDocumentSnapshot_(NOTIFICATION_COLLECTION, orderId);
  const now = new Date();
  const writes = [updateWrite_('orders', orderId, {
    status: status,
    updatedAt: now,
  }, ['status', 'updatedAt'], orderSnapshot.updateTime)];
  writes.push(notificationWrite_(orderId, orderSnapshot.data.uid, status, notificationSnapshot, now));
  commitFirestoreWrites_(writes);
  syncOrderRowFromFirestore_(orderId);
}

function updateOrderItemsFromSheet_(orderId, sheet) {
  const orderSnapshot = getDocumentSnapshot_('orders', orderId);
  if (!orderSnapshot) throw new Error('الطلب غير موجود في التطبيق.');
  const order = orderSnapshot.data;
  if (order.status !== 'received' || Number(order.editCount || 0) >= 1) {
    throw new Error('لا يمكن تعديل محتوى هذا الطلب؛ حالة الطلب لا تسمح أو استُخدمت فرصة التعديل.');
  }
  const orderPeriod = order.profile && order.profile.spendingPeriod;
  const currentPeriod = currentEmployeeSpendingPeriod_();
  if (orderPeriod && orderPeriod !== currentPeriod) {
    throw new Error('لا يمكن تعديل طلب من فترة شهرية مغلقة.');
  }

  const itemMap = {};
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, ORDER_ITEM_HEADERS.length).getValues().forEach(function (row) {
      if (String(row[0]) !== String(orderId)) return;
      const productId = String(row[5] || '').trim();
      const quantity = Number(row[6]);
      if (!productId || !Number.isInteger(quantity) || quantity < 0 || quantity > 50) {
        throw new Error('الكمية يجب أن تكون عدداً صحيحاً من صفر إلى ٥٠.');
      }
      if (Object.prototype.hasOwnProperty.call(itemMap, productId)) {
        throw new Error('يوجد أكثر من صف للصنف نفسه في تفاصيل الطلب.');
      }
      if (quantity > 0) itemMap[productId] = quantity;
    });
  }
  if (!Object.keys(itemMap).length || Object.keys(itemMap).length > 50) {
    throw new Error('يجب أن يتضمن الطلب صنفاً واحداً على الأقل وبحد أقصى ٥٠ صنفاً.');
  }

  const oldDetails = order.itemDetails || {};
  const itemDetails = {};
  let totalAmount = 0;
  Object.keys(itemMap).forEach(function (productId) {
    const detail = oldDetails[productId];
    if (!detail || typeof detail.agentPrice !== 'number' ||
      !Number.isFinite(detail.agentPrice) || detail.agentPrice < 0) {
      throw new Error('لا يتوفر سعر معتمد لأحد الأصناف. راجع كتالوج المنتجات.');
    }
    const lineTotal = detail.agentPrice * itemMap[productId];
    totalAmount += lineTotal;
    itemDetails[productId] = Object.assign({}, detail, { lineTotal: lineTotal });
  });
  if (!Number.isFinite(totalAmount) || totalAmount < 0 || totalAmount > 1000000000) {
    throw new Error('إجمالي الطلب خارج النطاق المسموح.');
  }

  const email = String(order.email || '').trim().toLowerCase();
  const rosterSnapshot = getDocumentSnapshot_(EMPLOYEE_ROSTER_COLLECTION, email);
  if (!rosterSnapshot) throw new Error('سجل الموظف المالي غير موجود.');
  const roster = rosterSnapshot.data;
  if (roster.spendingPeriod && roster.spendingPeriod !== currentPeriod) {
    throw new Error('فترة الإنفاق الشهرية غير متطابقة؛ راجع مسؤول النظام.');
  }
  const currentSpent = Number(roster.currentMonthlySpent || 0);
  const previousAmount = Number(order.totalAmount || 0);
  const nextSpent = currentSpent - previousAmount + totalAmount;
  if (!Number.isFinite(nextSpent) || nextSpent < 0) {
    throw new Error('تعذر مطابقة قيمة الطلب مع الإنفاق الشهري.');
  }
  if (typeof roster.monthlySpendingLimit === 'number' &&
    nextSpent > roster.monthlySpendingLimit) {
    throw new Error('التعديل يتجاوز السقف المالي الشهري للموظف.');
  }

  const now = new Date();
  const profile = Object.assign({}, order.profile || {}, {
    currentMonthlySpent: nextSpent,
    spendingPeriod: currentPeriod,
  });
  if (typeof roster.monthlySpendingLimit === 'number') {
    profile.monthlySpendingLimit = roster.monthlySpendingLimit;
  }
  const notificationSnapshot = getDocumentSnapshot_(NOTIFICATION_COLLECTION, orderId);
  const writes = [
    updateWrite_('orders', orderId, {
      items: itemMap,
      itemDetails: itemDetails,
      totalAmount: totalAmount,
      profile: profile,
      editCount: 1,
      updatedAt: now,
    }, ['items', 'itemDetails', 'totalAmount', 'profile', 'editCount', 'updatedAt'],
    orderSnapshot.updateTime),
    updateWrite_(EMPLOYEE_ROSTER_COLLECTION, email, {
      currentMonthlySpent: nextSpent,
      spendingPeriod: currentPeriod,
      lastSpendOrderId: orderId,
      updatedAt: now,
    }, ['currentMonthlySpent', 'spendingPeriod', 'lastSpendOrderId', 'updatedAt'],
    rosterSnapshot.updateTime),
    notificationWrite_(orderId, order.uid, order.status, notificationSnapshot, now),
  ];
  commitFirestoreWrites_(writes);
  syncOrderRowFromFirestore_(orderId);
  syncEmployeeRow_(email, '', null);
}

function parseOrderStatus_(value) {
  const text = String(value || '').trim();
  const statuses = {
    'وصل الطلب (RECEIVED)': 'received',
    received: 'received',
    'قيد التجهيز (PREPARING)': 'preparing',
    preparing: 'preparing',
    'جاهز للصرف (READY)': 'ready',
    ready: 'ready',
    'تم التسليم (FULFILLED)': 'fulfilled',
    fulfilled: 'fulfilled',
    'ملغي (CANCELLED)': 'cancelled',
    cancelled: 'cancelled',
    'محذوف (DELETED)': 'deleted',
    deleted: 'deleted',
  };
  return statuses[text] || null;
}

function notificationWrite_(orderId, uid, status, snapshot, now) {
  const name = firestoreDocumentName_(NOTIFICATION_COLLECTION, orderId);
  if (snapshot) {
    return updateWrite_(NOTIFICATION_COLLECTION, orderId, {
      status: 'pending',
      eventStatus: status,
      updatedAt: now,
    }, ['status', 'eventStatus', 'updatedAt'], snapshot.updateTime);
  }
  return {
    update: {
      name: name,
      fields: encodeFields_({
        orderId: orderId,
        uid: uid,
        status: 'pending',
        eventStatus: status,
        emailSentAt: new Date(0),
        createdAt: now,
        updatedAt: now,
      }),
    },
    currentDocument: { exists: false },
  };
}

function updateWrite_(collection, documentId, values, fieldPaths, updateTime) {
  return {
    update: {
      name: firestoreDocumentName_(collection, documentId),
      fields: encodeFields_(values),
    },
    updateMask: { fieldPaths: fieldPaths },
    currentDocument: { updateTime: updateTime },
  };
}

function firestoreDocumentName_(collection, documentId) {
  const projectId = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
  return 'projects/' + projectId + '/databases/(default)/documents/' +
    collection + '/' + documentId;
}

function commitFirestoreWrites_(writes) {
  const projectId = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
  const url = 'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(projectId) + '/databases/(default)/documents:commit';
  const response = firestoreFetch_(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ writes: writes }),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('تعذر حفظ التغييرات معاً. أعد تحميل الصفوف وتحقق من عدم وجود تعديل متزامن. ' +
      response.getContentText().slice(0, 250));
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
  const requestedSpent = values[7];
  const statusText = String(values[8] || '').trim().toLowerCase();
  const address = String(values[10] || '').trim();
  const phone = String(values[11] || '').trim();
  const whatsapp = String(values[12] || '').trim();
  const active = ['نشط', 'active', 'true', '1', 'معتمد'].indexOf(statusText) >= 0;
  const inactive = ['موقوف', 'inactive', 'false', '0', 'غير نشط'].indexOf(statusText) >= 0;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !employeeCode || employeeCode.length > 80 ||
    (!active && !inactive)) {
    throw new Error('أكمل البريد والكود الوظيفي وحالة الحساب بشكل صحيح.');
  }
  const codeOwners = findEmployeeEmailsByField_('employeeCode', employeeCode);
  if (codeOwners.some(function (ownerEmail) { return ownerEmail !== email; })) {
    throw new Error('الكود الوظيفي مرتبط بسجل موظف آخر.');
  }
  const phoneLookup = phone.replace(/\D/g, '');
  if (phone && (!/^\+?[\d\s()-]{8,40}$/.test(phone) ||
    phoneLookup.length < 8 || phoneLookup.length > 18)) {
    throw new Error('رقم الهاتف يجب أن يتضمن من 8 إلى 18 رقماً مع رمز الدولة.');
  }
  if (phoneLookup.length >= 8 && phoneLookup.length <= 18) {
    const phoneOwners = findEmployeeEmailsByField_('phoneLookup', phoneLookup, 1000);
    if (phoneOwners.some(function (ownerEmail) { return ownerEmail !== email; })) {
      throw new Error('رقم الهاتف مرتبط بسجل موظف آخر.');
    }
  }
  const limit = limitValue === '' || limitValue === null ? null : Number(limitValue);
  const existingRoster = getDocument_(EMPLOYEE_ROSTER_COLLECTION, email);
  const spent = existingRoster && typeof existingRoster.currentMonthlySpent === 'number'
    ? existingRoster.currentMonthlySpent : 0;
  if ((limit !== null && (!Number.isFinite(limit) || limit < 0 || limit > 1000000000)) ||
    !Number.isFinite(spent) || spent < 0 || spent > 1000000000) {
    throw new Error('السقف والإنفاق يجب أن يكونا أرقاماً غير سالبة ضمن الحد المسموح.');
  }
  if (requestedSpent !== '' && requestedSpent !== null &&
    Number(requestedSpent) !== spent) {
    sheet.getRange(rowNumber, 8).setValue(spent);
  }
  const period = existingRoster && existingRoster.spendingPeriod
    ? existingRoster.spendingPeriod
    : Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM');
  const fields = {
    employeeCode: employeeCode.slice(0, 80),
    currentMonthlySpent: spent,
    spendingPeriod: period,
    active: active,
    updatedAt: new Date(),
  };
  const deletedFields = [];
  [
    ['name', employeeName, 120],
    ['company', company, 80],
    ['branch', branch, 80],
    ['province', province, 80],
    ['address', address, 240],
    ['phone', phone, 40],
    ['whatsapp', whatsapp, 40],
  ].forEach(function (field) {
    if (field[1]) fields[field[0]] = field[1].slice(0, field[2]);
    else deletedFields.push(field[0]);
  });
  if (phoneLookup.length >= 8 && phoneLookup.length <= 18) fields.phoneLookup = phoneLookup;
  else deletedFields.push('phoneLookup');
  if (limit !== null) fields.monthlySpendingLimit = limit;
  else deletedFields.push('monthlySpendingLimit');
  const rosterFields = Object.assign({}, fields);
  const rosterMask = Object.keys(rosterFields).concat(deletedFields);
  if (existingRoster) {
    patchDocumentFields_(EMPLOYEE_ROSTER_COLLECTION, email, rosterFields, rosterMask);
  } else {
    writeDocument_(EMPLOYEE_ROSTER_COLLECTION, email, rosterFields, false);
  }
  const profiles = findEmployeeDocuments_(email);
  profiles.forEach(function (profileDocument) {
    const profileId = profileDocument.name.split('/').pop();
    const profileFields = Object.assign({}, fields);
    if (limit !== null) profileFields.monthlySpendingLimit = limit;
    patchDocumentFields_(EMPLOYEE_COLLECTION, profileId, profileFields,
      Object.keys(profileFields).concat(deletedFields));
  });
  syncEmployeeRow_(email, '', sheet);
}

function syncEmployeesFromSheet_(spreadsheetId) {
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ensureEmployeeSheet_(spreadsheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const rows = sheet.getRange(2, 1, lastRow - 1, EMPLOYEE_HEADERS.length).getValues();
  let synced = 0;
  let failures = 0;
  let processed = 0;
  for (let index = 0; index < rows.length && processed < 100; index += 1) {
    const row = rows[index];
    if (!row[1] || !row[2] || employeeRowFingerprint_(row) === String(row[13] || '')) continue;
    const rowNumber = index + 2;
    processed += 1;
    try {
      importEmployeeSheetRow_(sheet, rowNumber);
      synced += 1;
    } catch (error) {
      failures += 1;
      sheet.getRange(rowNumber, 1, 1, EMPLOYEE_HEADERS.length).setBackground('#fce4e4');
      console.error('Unable to synchronize employee row ' + rowNumber + '.', error);
    }
  }
  if (synced) console.log('تمت مزامنة ' + synced + ' تغييرات موظفين من Google Sheets.');
  if (failures) throw new Error('تعذرت مزامنة ' + failures + ' صفوف موظفين. راجع الصفوف الملوّنة بالأحمر.');
}

function employeeRowFingerprint_(values) {
  const data = JSON.stringify([0, 2, 3, 4, 5, 6, 8, 10, 11, 12].map(function (index) {
    const value = values[index];
    return value instanceof Date ? value.toISOString() : value;
  }));
  return digestFingerprint_(data);
}

function currentEmployeeSpendingPeriod_() {
  return Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM');
}

function initializeEmployeeSpendingPeriod_() {
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty('EMPLOYEE_SPENDING_PERIOD')) {
    properties.setProperty('EMPLOYEE_SPENDING_PERIOD', currentEmployeeSpendingPeriod_());
  }
}

function rolloverEmployeeSpending_(spreadsheetId) {
  const properties = PropertiesService.getScriptProperties();
  const currentPeriod = currentEmployeeSpendingPeriod_();
  const previousPeriod = properties.getProperty('EMPLOYEE_SPENDING_PERIOD');
  if (!previousPeriod) {
    properties.setProperty('EMPLOYEE_SPENDING_PERIOD', currentPeriod);
    return;
  }
  if (previousPeriod === currentPeriod) return;

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ensureEmployeeSheet_(spreadsheet);
  const archiveName = 'أرشيف الموظفين ' + previousPeriod;
  if (!spreadsheet.getSheetByName(archiveName)) {
    sheet.copyTo(spreadsheet).setName(archiveName).hideColumns(EMPLOYEE_HEADERS.length);
  }
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const range = sheet.getRange(2, 1, lastRow - 1, EMPLOYEE_HEADERS.length);
    const rows = range.getValues();
    rows.forEach(function (row) {
      if (!row[1]) return;
      row[7] = 0;
      row[9] = currentPeriod;
      row[13] = '';
    });
    range.setValues(rows);
  }
  properties.setProperty('EMPLOYEE_SPENDING_PERIOD', currentPeriod);
  console.log('أُنشئ ' + archiveName + ' وصُفّر إنفاق الموظفين للفترة ' + currentPeriod + '.');
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
  const createdAt = order.createdAt instanceof Date ? order.createdAt : null;
  const updatedAt = order.updatedAt instanceof Date ? order.updatedAt : createdAt;
  const action = Number(order.editCount || 0) > 0
    ? 'تم تعديل الطلب'
    : createdAt && updatedAt && updatedAt.getTime() > createdAt.getTime() + 1000
      ? 'تم تحديث الحالة'
      : 'تم إنشاء الطلب';
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
    action,
    Number(order.editCount || 0),
    updatedAt || '',
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

function orderStatus_(status) {
  const labels = {
    received: 'وصل الطلب (RECEIVED)',
    preparing: 'قيد التجهيز (PREPARING)',
    ready: 'جاهز للصرف (READY)',
    fulfilled: 'تم التسليم (FULFILLED)',
    cancelled: 'ملغي (CANCELLED)',
    deleted: 'محذوف (DELETED)',
  };
  return labels[status] || String(status || '');
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
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  return keepFirstMatchingRow_(sheet, rows, 0, String(orderId));
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
  if (!ensureEmployeeHeaders_(sheet)) {
    const foundHeaders = sheet.getLastColumn()
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
        .map(function (header) { return String(header || '').trim(); })
        .filter(function (header) { return Boolean(header); })
        .join(' | ')
      : '(الصف الأول فارغ)';
    throw new Error(
      'تعذر التعرّف على عناوين تبويب الموظفين. لم تُحذف البيانات ولم يُنشأ تبويب بديل. ' +
      'يجب وجود عمود للبريد الإلكتروني وعمود للرقم الوظيفي. العناوين المقروءة: ' +
      foundHeaders.slice(0, 500),
    );
  }
  styleDataSheet_(sheet, EMPLOYEE_HEADERS, {
    widths: [180, 230, 130, 230, 130, 130, 170, 170, 130, 130, 250, 150, 150, 60],
    hiddenColumns: [14],
    numberColumns: [7, 8],
  });
  return sheet;
}

function ensureCatalogSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(PRODUCT_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(PRODUCT_SHEET_NAME);
  styleDataSheet_(sheet, PRODUCT_HEADERS, {
    widths: [150, 210, 260, 150, 200, 120, 170, 250, 120, 120, 60],
    hiddenColumns: [11],
    numberColumns: [7],
  });
  return sheet;
}

function ensureOrderSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName('طلبات الموظفين');
  if (!sheet) sheet = spreadsheet.insertSheet('طلبات الموظفين');
  styleDataSheet_(sheet, ORDER_HEADERS, {
    widths: [150, 150, 165, 190, 180, 130, 220, 220, 130, 140, 140, 260, 160, 110, 110, 320, 300, 150, 90, 150, 110, 165],
    hiddenColumns: [1],
    numberColumns: [18, 20],
    dateColumns: [3, 22],
  });
  const validation = SpreadsheetApp.newDataValidation()
    .requireValueInList(ORDER_STATUS_OPTIONS, true)
    .setAllowInvalid(false)
    .build();
  if (sheet.getMaxRows() > 1) {
    sheet.getRange(2, 4, sheet.getMaxRows() - 1, 1).setDataValidation(validation);
  }
  return sheet;
}

function ensureOrderItemSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(ORDER_ITEM_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(ORDER_ITEM_SHEET_NAME);
  styleDataSheet_(sheet, ORDER_ITEM_HEADERS, {
    widths: [150, 150, 165, 190, 230, 180, 110, 150, 150],
    hiddenColumns: [1, 6],
    numberColumns: [7, 8, 9],
    dateColumns: [3],
  });
  return sheet;
}

function ensureSyncLogSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(SYNC_LOG_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SYNC_LOG_SHEET_NAME);
  styleDataSheet_(sheet, SYNC_LOG_HEADERS, {
    widths: [170, 180, 150, 260, 420],
    dateColumns: [1],
  });
  return sheet;
}

function ensureSummarySheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(SUMMARY_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SUMMARY_SHEET_NAME, 0);
  sheet.clear();
  sheet.setRightToLeft(false);
  sheet.getRange(1, 1, sheet.getMaxRows(), 2)
    .setTextDirection(SpreadsheetApp.TextDirection.LEFT_TO_RIGHT);
  sheet.getRange(1, 1, 1, 2).setValues([['مؤشرات بوابة السلال الغذائية', 'القيمة']]);
  sheet.getRange(2, 1, 4, 2).setValues([
    ['عدد الطلبات المسجلة', '=MAX(0,COUNTA(\'طلبات الموظفين\'!B:B)-1)'],
    ['إجمالي قيمة الطلبات (ر.ي)', '=SUM(\'طلبات الموظفين\'!R:R)'],
    ['الموظفون النشطون', '=COUNTIF(\'سجل الموظفين\'!I:I,"نشط")'],
    ['المنتجات النشطة', '=COUNTIF(\'كتالوج المنتجات\'!I:I,"نشط")'],
  ]);
  sheet.getRange(1, 1, 1, 2).setBackground('#162766').setFontColor('#ffffff').setFontWeight('bold');
  sheet.getRange(2, 1, 4, 2).setBackground('#f3f6fb');
  sheet.getRange(2, 2, 4, 1).setNumberFormat('#,##0.00');
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, 1, 260);
  sheet.setColumnWidths(2, 1, 220);
  sheet.setRowHeight(1, 36);
  return sheet;
}

function styleDataSheet_(sheet, headers, options) {
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (!headers.every(function (header, index) { return current[index] === header; })) {
    throw new Error('عناوين تبويب "' + sheet.getName() + '" لا تطابق قالب المزامنة.');
  }
  sheet.setRightToLeft(false);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 38);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#162766')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setWrap(true);
  sheet.getRange(1, 1, sheet.getMaxRows(), headers.length)
    .setTextDirection(SpreadsheetApp.TextDirection.LEFT_TO_RIGHT);
  if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).createFilter();
  (options.widths || []).forEach(function (width, index) {
    sheet.setColumnWidth(index + 1, width);
  });
  (options.hiddenColumns || []).forEach(function (column) {
    if (!sheet.isColumnHiddenByUser(column)) sheet.hideColumns(column);
  });
  (options.numberColumns || []).forEach(function (column) {
    if (sheet.getMaxRows() > 1) sheet.getRange(2, column, sheet.getMaxRows() - 1, 1)
      .setNumberFormat('#,##0.00;[Red]-#,##0.00');
  });
  (options.dateColumns || []).forEach(function (column) {
    if (sheet.getMaxRows() > 1) sheet.getRange(2, column, sheet.getMaxRows() - 1, 1)
      .setNumberFormat('yyyy-mm-dd hh:mm');
  });
}

function rebuildNatcoSheetsIfNeeded_(spreadsheet) {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('SHEET_SCHEMA_VERSION') === SHEET_SCHEMA_VERSION) return;
  spreadsheet.getSheets().forEach(function (sheet) {
    sheet.setRightToLeft(false);
  });
  properties.setProperty('SHEET_SCHEMA_VERSION', SHEET_SCHEMA_VERSION);
}

function uniqueSheetName_(spreadsheet, baseName) {
  let name = baseName.slice(0, 95);
  let suffix = 1;
  while (spreadsheet.getSheetByName(name)) {
    name = baseName.slice(0, 90) + ' ' + suffix;
    suffix += 1;
  }
  return name;
}

function logSync_(direction, dataType, id, result, knownSpreadsheetId) {
  try {
    const settings = knownSpreadsheetId ? null : getSettingsDocument_();
    const spreadsheetId = knownSpreadsheetId || (settings && spreadsheetIdFromUrl_(settings.spreadsheetUrl));
    if (!spreadsheetId) return;
    const sheet = ensureSyncLogSheet_(SpreadsheetApp.openById(spreadsheetId));
    sheet.appendRow([new Date(), direction, dataType, safeSheetValue_(id), safeSheetValue_(result)]);
    const excess = sheet.getLastRow() - 501;
    if (excess > 0) sheet.deleteRows(2, excess);
  } catch (error) {
    console.error('Unable to write a sync log entry.', error);
  }
}

function errorMessage_(error) {
  return String(error && error.message ? error.message : error).replace(/\s+/g, ' ').slice(0, 300);
}

function ensureEmployeeHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, EMPLOYEE_HEADERS.length).setValues([EMPLOYEE_HEADERS]);
    return true;
  }
  const columnCount = Math.max(sheet.getLastColumn(), 1);
  const rawHeaders = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0];
  const headers = rawHeaders.map(normalizeSheetHeader_);
  const aliases = [
    ['اسم الموظف', 'اسم الموظفة', 'اسم الموظف الكامل', 'الاسم الكامل', 'الموظف', 'الاسم', 'employee name', 'full name', 'name'],
    ['البريد الإلكتروني', 'البريد الالكتروني', 'البريد الإلكتروني للموظف', 'البريد', 'الايميل', 'الإيميل', 'email', 'email address', 'employee email'],
    ['الرقم الوظيفي', 'الكود الوظيفي', 'كود الموظف', 'رقم الموظف', 'معرف الموظف', 'معرّف الموظف', 'employee id', 'employee code'],
    ['الشركة/الشركة التابعة', 'الشركة التابعة', 'اسم الشركة', 'جهة العمل', 'الشركة', 'company', 'organization'],
    ['الفرع', 'اسم الفرع', 'فرع', 'branch'],
    ['المحافظة', 'المدينة', 'المدينة/المحافظة', 'governorate', 'city'],
    ['السقف الشهري المعتمد', 'الحد الشهري', 'السقف الشهري', 'السقف', 'monthly limit', 'monthly cap'],
    ['الإنفاق الشهري الحالي', 'الإنفاق الشهري', 'المصروف الشهري', 'الإنفاق الحالي', 'الإنفاق', 'monthly spending', 'monthly spend'],
    ['حالة الحساب', 'حالة الموظف', 'الحالة', 'account status', 'status'],
    ['فترة الإنفاق', 'الشهر الحالي', 'الشهر', 'spending period', 'period', 'month'],
    ['العنوان', 'العنوان التفصيلي', 'عنوان التوصيل', 'address', 'delivery address'],
    ['الهاتف', 'رقم الهاتف', 'رقم الجوال', 'الجوال', 'phone', 'phone number'],
    ['واتساب', 'رقم الواتساب', 'whatsapp'],
    ['بصمة المزامنة', 'بصمة'],
  ].map(function (options) { return options.map(normalizeSheetHeader_); });
  const positions = aliases.map(function (options) {
    return headers.findIndex(function (header) { return options.indexOf(header) >= 0; });
  });
  if (positions[1] < 0 || positions[2] < 0) return false;
  if (EMPLOYEE_HEADERS.every(function (header, index) {
    return headers[index] === normalizeSheetHeader_(header);
  })) return true;

  const lastRow = sheet.getLastRow();
  const oldValues = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, columnCount).getValues()
    : [];
  const recognizedPositions = positions.filter(function (position) { return position >= 0; });
  const extraPositions = headers.map(function (header, index) { return index; })
    .filter(function (index) {
      if (recognizedPositions.indexOf(index) >= 0) return false;
      return Boolean(headers[index]) || oldValues.some(function (row) {
        return row[index] !== '' && row[index] !== null;
      });
    });
  const migratedHeaders = EMPLOYEE_HEADERS.concat(extraPositions.map(function (position) {
    return String(rawHeaders[position] || '').trim() || 'حقل إضافي ' + (position + 1);
  }));
  const migrated = oldValues.map(function (row) {
    const values = positions.map(function (position) { return position < 0 ? '' : row[position]; });
    values[13] = employeeRowFingerprint_(values);
    return values.concat(extraPositions.map(function (position) { return row[position]; }));
  });
  sheet.getRange(1, 1, 1, migratedHeaders.length).setValues([migratedHeaders]);
  if (migrated.length) {
    sheet.getRange(2, 1, migrated.length, migratedHeaders.length).setValues(migrated);
  }
  return true;
}

function findEmployeeRow_(sheet, email) {
  if (sheet.getLastRow() < 2) return 0;
  const rows = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getDisplayValues();
  return keepFirstMatchingRow_(sheet, rows, String(email).trim().toLowerCase(), true);
}

function normalizeSheetHeader_(value) {
  return String(value || '').trim().toLocaleLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\s_\-./\\()]+/g, '');
}

function keepFirstMatchingRow_(sheet, values, target, ignoreCase) {
  const normalizedTarget = ignoreCase ? String(target).trim().toLowerCase() : String(target).trim();
  const matches = [];
  values.forEach(function (row, index) {
    let value = String(row[0] || '').trim();
    if (ignoreCase) value = value.toLowerCase();
    if (value === normalizedTarget) matches.push(index + 2);
  });
  if (!matches.length) return 0;
  matches.slice(1).sort(function (left, right) { return right - left; })
    .forEach(function (row) { sheet.deleteRow(row); });
  return matches[0];
}

function deduplicateDataRowsByKey_(sheet, keyColumns) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return 0;
  const width = Math.max.apply(null, keyColumns) + 1;
  const values = sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues();
  const seen = {};
  const duplicates = [];
  values.forEach(function (row, index) {
    const keyParts = keyColumns.map(function (column) { return String(row[column] || '').trim(); });
    if (keyParts.some(function (part) { return !part; })) return;
    const key = JSON.stringify(keyParts);
    if (seen[key]) duplicates.push(index + 2);
    else seen[key] = true;
  });
  duplicates.sort(function (left, right) { return right - left; })
    .forEach(function (row) { sheet.deleteRow(row); });
  return duplicates.length;
}

function removeDuplicateDataRows_(spreadsheet) {
  const keyedSheets = [
    [EMPLOYEE_SHEET_NAME, [1]],
    [PRODUCT_SHEET_NAME, [0]],
    ['طلبات الموظفين', [0]],
    [ORDER_ITEM_SHEET_NAME, [0, 5]],
  ];
  let removed = 0;
  keyedSheets.forEach(function (entry) {
    const sheet = spreadsheet.getSheetByName(entry[0]);
    if (sheet) removed += deduplicateDataRowsByKey_(sheet, entry[1]);
  });
  if (removed) console.warn('أزيلت ' + removed + ' صفوف مكررة من التبويبات الأساسية مع الاحتفاظ بأول سجل لكل معرّف.');
  return removed;
}

function ensureEmployeeEditTrigger_(spreadsheetId) {
  ensureSpreadsheetEditTrigger_(spreadsheetId);
}

function ensureSpreadsheetEditTrigger_(spreadsheetId) {
  const triggers = ScriptApp.getProjectTriggers();
  let exists = false;
  triggers.forEach(function (trigger) {
    if (trigger.getTriggerSourceId() !== spreadsheetId) return;
    const handler = trigger.getHandlerFunction();
    if (handler === 'handleNatcoSheetEdit') {
      if (exists) ScriptApp.deleteTrigger(trigger);
      else exists = true;
    }
    if (handler === 'handleEmployeeSheetEdit' || handler === 'handleCatalogSheetEdit') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  if (!exists) {
    ScriptApp.newTrigger('handleNatcoSheetEdit')
      .forSpreadsheet(spreadsheetId)
      .onEdit()
      .create();
  }
}

function ensureQueueTrigger_() {
  const obsoleteFullSyncHandlers = [
    'syncAllNatcoData',
    'syncAllNatcoEmployees',
    'syncAllNatcoProducts',
    'syncAllNatcoOrders',
    'syncDeletedNatcoOrdersNow',
  ];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    const handler = trigger.getHandlerFunction();
    if (handler === 'processNatcoOrderQueue' || obsoleteFullSyncHandlers.indexOf(handler) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('processNatcoOrderQueue').timeBased().everyMinutes(5).create();
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

function getDocumentSnapshot_(collection, documentId) {
  const document = firestoreRequest_(
    'get',
    '/' + collection + '/' + encodeURIComponent(documentId),
    null,
    true,
  );
  if (!document) return null;
  const data = decodeFields_(document.fields || {});
  data.id = document.name.split('/').pop();
  return { data: data, updateTime: document.updateTime, name: document.name };
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

  const response = firestoreFetch_(url, {
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

function firestoreFetch_(url, options) {
  const pauseUntil = urlFetchQuotaPauseUntil_();
  if (pauseUntil > Date.now()) {
    throw urlFetchQuotaError_(
      'توقفت مزامنة Firestore مؤقتاً حتى ' + new Date(pauseUntil).toISOString() +
      ' بسبب بلوغ حصة UrlFetch اليومية.',
    );
  }
  try {
    return UrlFetchApp.fetch(url, options);
  } catch (error) {
    if (isUrlFetchQuotaError_(error)) {
      const until = Date.now() + URLFETCH_QUOTA_PAUSE_MS;
      PropertiesService.getScriptProperties()
        .setProperty(URLFETCH_QUOTA_PAUSE_PROPERTY, String(until));
      throw urlFetchQuotaError_(
        'بلغ مشروع Apps Script حصة UrlFetch اليومية. أوقفت المزامنة المجدولة حتى ' +
        new Date(until).toISOString() + '.',
      );
    }
    throw error;
  }
}

function urlFetchQuotaPauseUntil_() {
  return Number(
    PropertiesService.getScriptProperties().getProperty(URLFETCH_QUOTA_PAUSE_PROPERTY) || 0,
  );
}

function isUrlFetchQuotaError_(error) {
  const message = error instanceof Error ? error.message : String(error);
  return Boolean(error && error.name === 'NatcoUrlFetchQuotaError') ||
    /Service invoked too many times for one day:\s*urlfetch/i.test(message);
}

function urlFetchQuotaError_(message) {
  const error = new Error(message);
  error.name = 'NatcoUrlFetchQuotaError';
  return error;
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
