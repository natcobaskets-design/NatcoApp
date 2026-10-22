const crypto = require('node:crypto')
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore')
const { getMessaging } = require('firebase-admin/messaging')
const { defineSecret } = require('firebase-functions/params')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { HttpsError, onCall } = require('firebase-functions/v2/https')

initializeApp()

const database = getFirestore()
const webApiKey = defineSecret('FIREBASE_WEB_API_KEY')
const loginWindowMs = 15 * 60 * 1000
const loginIpLimit = 30
const loginIdentifierLimit = 10
const natcoAppUrl = 'https://natcobaskets-design.github.io/NatcoApp/'
const notificationStatusLabels = {
  received: 'تم استلام الطلب',
  preparing: 'جارٍ تجهيز الطلب',
  ready: 'الطلب جاهز للاستلام',
  fulfilled: 'تم تسليم الطلب',
  cancelled: 'تم إلغاء الطلب',
  deleted: 'تم حذف الطلب',
}

function timestampMillis(value) {
  return value && typeof value.toMillis === 'function' ? value.toMillis() : 0
}

function pushNotificationUrl(orderId) {
  const url = new URL(natcoAppUrl)
  url.searchParams.set('notificationOrderId', orderId)
  return url.toString()
}

async function claimPushDelivery(eventId, notification) {
  const ref = database.collection('push_delivery_events').doc(hash(eventId))
  return database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (snapshot.exists && snapshot.data().status === 'sent') return null
    if (snapshot.exists && snapshot.data().status === 'processing' &&
      timestampMillis(snapshot.data().leaseUntil) > Date.now()) return null

    const attempts = Number(snapshot.data()?.attempts || 0) + 1
    transaction.set(ref, {
      orderId: notification.orderId,
      status: 'processing',
      attempts,
      leaseUntil: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return ref
  })
}

async function sendPushToUser(uid, orderId, status, isAdminRecipient) {
  const tokens = await database.collection('push_tokens').where('uid', '==', uid).get()
  if (tokens.empty) return { sent: 0, failed: 0 }

  const label = notificationStatusLabels[status] || 'تحديث جديد للطلب'
  const title = isAdminRecipient
    ? status === 'received' ? 'طلب جديد في ناتكو' : 'تحديث حالة طلب'
    : 'تحديث طلبك من ناتكو'
  const body = isAdminRecipient && status === 'received'
    ? 'وصل طلب جديد أو تعديل من أحد الموظفين.'
    : label
  const link = pushNotificationUrl(orderId)
  let sent = 0
  let failed = 0

  for (let offset = 0; offset < tokens.docs.length; offset += 500) {
    const tokenDocs = tokens.docs.slice(offset, offset + 500)
    const response = await getMessaging().sendEachForMulticast({
      tokens: tokenDocs.map((item) => item.data().token),
      data: {
        title,
        body,
        orderId,
        status,
        url: link,
        tag: `natco-${orderId}`,
      },
      webpush: {
        fcmOptions: { link },
      },
    })

    const invalidTokenRefs = []
    let transientFailures = 0
    response.responses.forEach((result, index) => {
      if (result.success) {
        sent += 1
        return
      }
      failed += 1
      const code = result.error?.code || ''
      if (code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token') {
        invalidTokenRefs.push(tokenDocs[index].ref)
      } else {
        transientFailures += 1
      }
    })

    for (let index = 0; index < invalidTokenRefs.length; index += 500) {
      const batch = database.batch()
      invalidTokenRefs.slice(index, index + 500).forEach((ref) => batch.delete(ref))
      await batch.commit()
    }

    if (transientFailures === response.responses.length) {
      throw new Error('All push delivery attempts failed transiently.')
    }
  }

  return { sent, failed }
}

exports.sendNatcoOrderPushNotifications = onDocumentWritten(
  {
    document: 'order_notifications/{orderId}',
    retry: true,
    maxInstances: 10,
  },
  async (event) => {
    const before = event.data?.before
    const after = event.data?.after
    if (!after?.exists) return

    const notification = after.data()
    if (notification.status !== 'pending' ||
      typeof notification.uid !== 'string' ||
      typeof notification.eventStatus !== 'string' ||
      !notificationStatusLabels[notification.eventStatus]) return

    if (before?.exists) {
      const previous = before.data()
      const sameEvent = previous.status === notification.status &&
        previous.eventStatus === notification.eventStatus &&
        timestampMillis(previous.updatedAt) === timestampMillis(notification.updatedAt)
      if (sameEvent) return
    }

    const deliveryRef = await claimPushDelivery(event.id, notification)
    if (!deliveryRef) return

    try {
      const [adminSnapshot, orderSnapshot] = await Promise.all([
        database.collection('admin_users').where('active', '==', true).get(),
        database.collection('orders').doc(event.params.orderId).get(),
      ])
      const adminUids = new Set(adminSnapshot.docs.map((item) => item.id))
      const recipientUids = new Set(adminUids)
      const order = orderSnapshot.exists ? orderSnapshot.data() : null
      const employeeEmail = order?.email || order?.profile?.email || notification.email
      if ((order?.uid === notification.uid || notification.eventStatus === 'deleted') &&
        typeof employeeEmail === 'string') {
        const roster = await database.collection('employee_roster')
          .doc(employeeEmail.toLowerCase()).get()
        if (roster.exists && roster.data().active === true) recipientUids.add(notification.uid)
      }
      let sent = 0
      let failed = 0

      for (const uid of recipientUids) {
        const result = await sendPushToUser(
          uid,
          event.params.orderId,
          notification.eventStatus,
          adminUids.has(uid),
        )
        sent += result.sent
        failed += result.failed
      }

      await deliveryRef.update({
        status: 'sent',
        sent,
        failed,
        leaseUntil: FieldValue.delete(),
        sentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      if (sent === 0) {
        console.info('Order push event had no registered devices.', {
          orderId: event.params.orderId,
          eventId: event.id,
        })
      }
    } catch (error) {
      await deliveryRef.update({
        status: 'failed',
        leaseUntil: FieldValue.delete(),
        error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown push failure.',
        updatedAt: FieldValue.serverTimestamp(),
      })
      console.error('Unable to send the Natco order push notification.', {
        orderId: event.params.orderId,
        eventId: event.id,
        error,
      })
      throw error
    }
  },
)

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '')
}

function genericLoginFailure() {
  return new HttpsError('unauthenticated', 'تعذر التحقق من بيانات الدخول.')
}

async function enforceLoginLimits(identifier, ip) {
  const keys = [
    { key: 'login-ip-' + hash(ip || 'unknown'), max: loginIpLimit },
    { key: 'login-id-' + hash(identifier + '|' + (ip || 'unknown')), max: loginIdentifierLimit },
  ]
  await Promise.all(keys.map(async ({ key, max }) => {
    const ref = database.collection('auth_rate_limits').doc(key)
    await database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const now = Date.now()
      const current = snapshot.exists ? snapshot.data() : {}
      const startedAt = Number(current.windowStartedAt || 0)
      const count = startedAt + loginWindowMs > now ? Number(current.count || 0) : 0
      if (count >= max) {
        throw new HttpsError('resource-exhausted', 'تعذر التحقق من بيانات الدخول.')
      }
      transaction.set(ref, {
        count: count + 1,
        windowStartedAt: startedAt + loginWindowMs > now ? startedAt : now,
        expiresAt: new Date(now + loginWindowMs),
      })
    })
  }))
}

async function findRoster(identifier) {
  const codeMatches = await database.collection('employee_roster')
    .where('employeeCode', '==', identifier).limit(2).get()
  const phone = normalizePhone(identifier)
  const phoneMatches = phone.length >= 8 && phone.length <= 18
    ? await database.collection('employee_roster').where('phoneLookup', '==', phone).limit(2).get()
    : null
  if (codeMatches.size > 1 || (phoneMatches && phoneMatches.size > 1)) throw genericLoginFailure()
  if (!codeMatches.empty && phoneMatches?.size === 1 &&
    codeMatches.docs[0].id !== phoneMatches.docs[0].id) throw genericLoginFailure()
  if (!codeMatches.empty) return codeMatches.docs[0]
  if (!phoneMatches || phoneMatches.size !== 1) throw genericLoginFailure()
  return phoneMatches.docs[0]
}

exports.signInWithEmployeeIdentifier = onCall(
  { secrets: [webApiKey], maxInstances: 10 },
  async (request) => {
    const identifier = String(request.data?.identifier || '').trim()
    const password = String(request.data?.password || '')
    if (!identifier || !password || identifier.length > 120 || password.length > 256) {
      throw genericLoginFailure()
    }
    await enforceLoginLimits(identifier, request.rawRequest.ip)

    let roster
    try {
      roster = await findRoster(identifier)
    } catch (error) {
      if (error instanceof HttpsError) throw error
      console.error('Employee identifier lookup failed.', error)
      throw genericLoginFailure()
    }
    const rosterData = roster.data()
    if (rosterData.active !== true || typeof rosterData.email !== 'string') {
      throw genericLoginFailure()
    }

    let verification
    try {
      const response = await fetch(
        'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' +
          encodeURIComponent(webApiKey.value()),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: rosterData.email.toLowerCase(),
            password,
            returnSecureToken: true,
          }),
        },
      )
      verification = await response.json()
      if (!response.ok || typeof verification.localId !== 'string') {
        throw genericLoginFailure()
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error
      console.error('Employee credentials could not be verified.')
      throw genericLoginFailure()
    }

    try {
      const user = await getAuth().getUser(verification.localId)
      if (user.email?.toLowerCase() !== rosterData.email.toLowerCase()) throw genericLoginFailure()
      if (!user.emailVerified && user.customClaims?.mustChangePassword !== true) {
        throw new HttpsError('failed-precondition', 'تحقق من البريد الإلكتروني المرتبط بالحساب أولاً.')
      }
      const customToken = await getAuth().createCustomToken(user.uid)
      return { customToken }
    } catch (error) {
      if (error instanceof HttpsError) throw error
      console.error('Unable to create an employee authentication token.', error)
      throw genericLoginFailure()
    }
  },
)

exports.registerEmployeeAccount = onCall(
  { maxInstances: 10 },
  async (request) => {
    const identifier = String(request.data?.identifier || '').trim()
    const email = String(request.data?.email || '').trim().toLowerCase()
    const password = String(request.data?.password || '')
    if (!identifier || identifier.length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 8 || password.length > 128) {
      throw new HttpsError('invalid-argument', 'تحقق من رقم الموظف والبريد وكلمة المرور.')
    }
    await enforceLoginLimits('register|' + identifier, request.rawRequest.ip)

    let roster
    try {
      roster = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
        ? await database.collection('employee_roster').doc(identifier.toLowerCase()).get()
        : await findRoster(identifier)
    } catch (error) {
      if (error instanceof HttpsError) throw error
      console.error('Employee registration lookup failed.', error)
      throw genericLoginFailure()
    }
    const rosterData = roster.data()
    if (!roster.exists || rosterData?.active !== true ||
      typeof rosterData.email !== 'string' || rosterData.email.toLowerCase() !== email) {
      throw genericLoginFailure()
    }

    let user
    try {
      user = await getAuth().createUser({ email, password, emailVerified: false })
    } catch (error) {
      if (error.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'يوجد حساب بهذا البريد. سجّل الدخول أو أعد تعيين كلمة المرور.')
      }
      console.error('Unable to create the approved employee account.', error)
      throw new HttpsError('internal', 'تعذر إنشاء الحساب حالياً.')
    }
    try {
      return { customToken: await getAuth().createCustomToken(user.uid) }
    } catch (error) {
      console.error('Unable to create a registration token for the employee.', error)
      try {
        await getAuth().deleteUser(user.uid)
      } catch (cleanupError) {
        console.error('Unable to remove the unissued employee account.', cleanupError)
      }
      throw new HttpsError('internal', 'تعذر إكمال إنشاء الحساب حالياً.')
    }
  },
)

async function requireActiveAdmin(uid) {
  if (!uid) throw new HttpsError('unauthenticated', 'يلزم تسجيل دخول المشرف.')
  const authUser = await getAuth().getUser(uid)
  if (authUser.customClaims?.mustChangePassword === true) {
    throw new HttpsError('failed-precondition', 'يجب تغيير كلمة المرور قبل استخدام صلاحيات المشرف.')
  }
  const snapshot = await database.collection('admin_users').doc(uid).get()
  if (!snapshot.exists || snapshot.data().active !== true) {
    throw new HttpsError('permission-denied', 'لا تملك صلاحية تنفيذ هذا الإجراء.')
  }
}

exports.setEmployeeTemporaryPassword = onCall(
  { maxInstances: 10 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'يلزم تسجيل دخول المشرف.')
    await requireActiveAdmin(request.auth.uid)
    const email = String(request.data?.email || '').trim().toLowerCase()
    const password = String(request.data?.password || '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 12 || password.length > 128) {
      throw new HttpsError('invalid-argument', 'أدخل بريداً صحيحاً وكلمة مرور مؤقتة من ١٢ حرفاً على الأقل.')
    }
    const roster = await database.collection('employee_roster').doc(email).get()
    if (!roster.exists || roster.data().active !== true) {
      throw new HttpsError('not-found', 'الموظف غير موجود في السجل النشط.')
    }
    let user
    try {
      user = await getAuth().getUserByEmail(email)
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        user = await getAuth().createUser({ email, password, emailVerified: false })
      } else {
        throw error
      }
    }
    if (user.email?.toLowerCase() !== email) {
      throw new HttpsError('failed-precondition', 'تعذر مطابقة الحساب مع البريد المعتمد.')
    }
    const previousClaims = user.customClaims || {}
    await getAuth().setCustomUserClaims(user.uid, {
      ...previousClaims,
      mustChangePassword: true,
    })
    try {
      await getAuth().updateUser(user.uid, { password })
    } catch (error) {
      try {
        await getAuth().setCustomUserClaims(user.uid, previousClaims)
      } catch (rollbackError) {
        console.error(`Unable to restore claims after a temporary-password update failure for ${email}.`, rollbackError)
      }
      throw error
    }
    await getAuth().revokeRefreshTokens(user.uid)
    await database.collection('admin_audit_log').add({
      action: 'set-temporary-password',
      actorUid: request.auth.uid,
      targetUid: user.uid,
      targetEmail: email,
      createdAt: FieldValue.serverTimestamp(),
    })
    return { updated: true }
  },
)

exports.checkTemporaryPassword = onCall(
  { maxInstances: 20 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'يلزم تسجيل الدخول.')
    const user = await getAuth().getUser(request.auth.uid)
    return { required: user.customClaims?.mustChangePassword === true }
  },
)

exports.changeTemporaryPassword = onCall(
  { maxInstances: 20 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'يلزم تسجيل الدخول.')
    const password = String(request.data?.password || '')
    if (password.length < 8 || password.length > 128) {
      throw new HttpsError('invalid-argument', 'كلمة المرور الجديدة يجب ألا تقل عن ٨ أحرف.')
    }
    const user = await getAuth().getUser(request.auth.uid)
    if (user.customClaims?.mustChangePassword !== true) {
      throw new HttpsError('failed-precondition', 'لا يوجد تغيير كلمة مرور مطلوب لهذا الحساب.')
    }
    const claims = { ...(user.customClaims || {}) }
    delete claims.mustChangePassword
    await getAuth().updateUser(user.uid, { password })
    await getAuth().setCustomUserClaims(user.uid, claims)
    await getAuth().revokeRefreshTokens(user.uid)
    return { changed: true }
  },
)

exports.backfillEmployeePhoneLookup = onCall(
  { maxInstances: 2, timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'يلزم تسجيل دخول المشرف.')
    await requireActiveAdmin(request.auth.uid)
    const snapshot = await database.collection('employee_roster').get()
    const phoneOwners = new Map()
    for (const record of snapshot.docs) {
      const phone = normalizePhone(record.data().phone)
      if (phone.length < 8 || phone.length > 18) continue
      const owners = phoneOwners.get(phone) || []
      owners.push(record)
      phoneOwners.set(phone, owners)
    }

    let updated = 0
    let skipped = 0
    let batch = database.batch()
    let writes = 0
    for (const record of snapshot.docs) {
      const data = record.data()
      const phone = normalizePhone(data.phone)
      const uniquePhone = phone.length >= 8 && phone.length <= 18 &&
        phoneOwners.get(phone)?.length === 1
      const desiredLookup = uniquePhone ? phone : undefined
      const alreadyMatches = desiredLookup
        ? data.phoneLookup === desiredLookup
        : typeof data.phoneLookup !== 'string'
      if (alreadyMatches) {
        if (uniquePhone) updated += 1
        else skipped += 1
        continue
      }
      batch.update(record.ref, {
        phoneLookup: desiredLookup ?? FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      writes += 1
      if (desiredLookup) updated += 1
      else skipped += 1
      if (writes === 400) {
        await batch.commit()
        batch = database.batch()
        writes = 0
      }
    }
    if (writes) await batch.commit()
    return { updated, skipped }
  },
)
