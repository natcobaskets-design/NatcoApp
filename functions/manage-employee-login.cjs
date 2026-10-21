const readline = require('node:readline/promises')
const { stdin, stdout } = require('node:process')
const { applicationDefault, initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')

function normalizePhone(value) {
  const westernDigits = String(value || '')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
  const phone = westernDigits.trim().replace(/[()\s-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : ''
}

function passwordLoginEmail(phone, projectId) {
  return `employee.${phone.replace(/\D/g, '')}@${projectId.toLowerCase()}.firebaseapp.com`
}

function readSecret(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('شغّل الأداة من نافذة طرفية تفاعلية لإدخال كلمة المرور بأمان.'))
  }
  stdout.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    function finish(error) {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    function onData(buffer) {
      for (const character of buffer.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('أُلغيت العملية.'))
        if (character === '\r' || character === '\n') return finish()
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1)
        else value += character
      }
    }
    stdin.on('data', onData)
  })
}

async function main() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID
  if (!projectId) throw new Error('حدد GOOGLE_CLOUD_PROJECT باسم مشروع Firebase قبل التشغيل.')

  const prompt = readline.createInterface({ input: stdin, output: stdout })
  let phone = ''
  let authEmail = ''
  let employee
  let app
  let database
  let existingUser = null
  try {
    phone = normalizePhone(await prompt.question('رقم الهاتف المعتمد بصيغة دولية (+...): '))
    if (!phone) {
      throw new Error('رقم الهاتف غير صالح. استخدم الصيغة الدولية مثل +9677XXXXXXXX.')
    }

    app = initializeApp({ credential: applicationDefault(), projectId })
    database = getFirestore(app)
    const matchingEmployees = await database.collection('employee_roster')
      .where('phoneE164', '==', phone)
      .limit(2)
      .get()
    if (matchingEmployees.size !== 1) {
      throw new Error('لم يُعثر على سجل موظف واحد وفريد بهذا الرقم. حدّث سجل الموظف أو عالج التكرار أولاً.')
    }
    employee = matchingEmployees.docs[0]
    if (employee.data().active !== true) {
      throw new Error('سجل الموظف موقوف؛ لا يمكن تجهيز الدخول له.')
    }

    authEmail = passwordLoginEmail(phone, projectId)
    const linkRef = database.collection('employee_auth_lookup').doc(authEmail)
    const existingLink = await linkRef.get()
    if (existingLink.exists && existingLink.data().email !== employee.id) {
      throw new Error('عنوان الدخول مرتبط بسجل موظف آخر؛ أوقف العملية وراجع مسؤول النظام.')
    }
    try {
      existingUser = await getAuth(app).getUserByEmail(authEmail)
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error
    }
    if (existingUser) {
      const confirmed = await prompt.question(
        `الحساب ${authEmail} موجود. هل تريد تغيير كلمة مروره الآن؟ اكتب نعم للمتابعة: `,
      )
      if (confirmed.trim() !== 'نعم') {
        stdout.write('لم تُجرَ أي تغييرات.\n')
        return
      }
    }
  } finally {
    prompt.close()
  }

  const linkRef = database.collection('employee_auth_lookup').doc(authEmail)

  const password = await readSecret('كلمة المرور الجديدة (٨ أحرف على الأقل): ')
  if (password.length < 8 || password.length > 256) {
    throw new Error('يجب أن تكون كلمة المرور بين ٨ و٢٥٦ حرفاً.')
  }
  const confirmation = await readSecret('أعد إدخال كلمة المرور للتأكيد: ')
  if (password !== confirmation) throw new Error('كلمتا المرور غير متطابقتين.')

  if (existingUser) {
    await getAuth(app).updateUser(existingUser.uid, {
      password,
      disabled: false,
      emailVerified: false,
    })
  } else {
    await getAuth(app).createUser({
      email: authEmail,
      password,
      emailVerified: false,
      disabled: false,
    })
  }

  await linkRef.set({
    authEmail,
    email: employee.id,
    phoneNumber: phone,
    phoneDigits: phone.replace(/\D/g, ''),
    updatedAt: FieldValue.serverTimestamp(),
  })

  stdout.write(`تم تجهيز حساب الموظف وربطه. عنوان الدخول: ${authEmail}\n`)
  stdout.write('لم يُرسل أي بريد أو SMS، ولم تُطبع كلمة المرور.\n')
}

main().catch((error) => {
  console.error('تعذر تجهيز حساب الموظف:', error.message || error)
  process.exitCode = 1
})
