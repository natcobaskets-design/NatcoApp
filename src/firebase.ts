import { deleteApp, FirebaseError, initializeApp, getApps } from 'firebase/app'
import { createUserWithEmailAndPassword, deleteUser, getAuth, initializeAuth, inMemoryPersistence } from 'firebase/auth'
import { doc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore'
import { employeePasswordLoginEmail } from './employeeLogin'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseProjectId = config.projectId ?? ''

export const missingFirebaseSettings = Object.entries(config)
  .filter(([, value]) => !value)
  .map(([key]) => `VITE_FIREBASE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`)

export const firebaseConfigured = missingFirebaseSettings.length === 0
export const firebaseApp = firebaseConfigured
  ? getApps()[0] ?? initializeApp(config)
  : null

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null
export const firestore = firebaseApp ? getFirestore(firebaseApp) : null

export async function createEmployeeLoginAccount(email: string, password: string): Promise<void> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured.')
  const provisioningApp = initializeApp(
    config,
    `employee-provisioning-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  try {
    const provisioningAuth = initializeAuth(provisioningApp, { persistence: inMemoryPersistence })
    await createUserWithEmailAndPassword(provisioningAuth, email, password)
  } finally {
    await deleteApp(provisioningApp)
  }
}

export async function createEmployeeSignupAccount(
  phoneNumber: string,
  password: string,
  name: string,
  employeeCode: string,
): Promise<void> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured.')
  const phoneDigits = phoneNumber.replace(/\D/g, '')
  const authEmail = employeePasswordLoginEmail(phoneNumber, firebaseProjectId)
  if (!authEmail || !phoneDigits) throw new Error('Invalid employee phone number.')

  const provisioningApp = initializeApp(
    config,
    `employee-signup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  let createdUser: import('firebase/auth').User | null = null
  try {
    const provisioningAuth = initializeAuth(provisioningApp, { persistence: inMemoryPersistence })
    createdUser = (await createUserWithEmailAndPassword(provisioningAuth, authEmail, password)).user
    await setDoc(doc(getFirestore(provisioningApp), 'employee_signup_requests', createdUser.uid), {
      uid: createdUser.uid,
      authEmail,
      phoneNumber,
      phoneDigits,
      name: name.trim(),
      employeeCode: employeeCode.trim(),
      status: 'pending',
      createdAt: serverTimestamp(),
    })
  } catch (error) {
    if (createdUser) {
      try {
        await deleteUser(createdUser)
      } catch (cleanupError) {
        console.error('Unable to remove an employee account after its signup request failed.', cleanupError)
      }
    }
    throw error
  } finally {
    await deleteApp(provisioningApp)
  }
}

export function firebaseErrorMessage(error: unknown): string {
  if (!(error instanceof FirebaseError)) {
    return 'تعذر إكمال العملية. تحقق من الاتصال وحاول مجدداً.'
  }
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'رقم الهاتف أو كلمة المرور غير صحيحة، أو لم يُجهّز الحساب بعد.',
    'auth/user-not-found': 'تعذر التحقق من بيانات الدخول. راجع المشرف.',
    'auth/wrong-password': 'رقم الهاتف أو كلمة المرور غير صحيحة.',
    'auth/email-already-in-use': 'حساب الدخول موجود مسبقاً. استخدم خيار ربط الحساب الموجود أو أعد ضبط كلمة مروره بأداة المشرف.',
    'auth/weak-password': 'اختر كلمة مرور من ٨ أحرف على الأقل.',
    'auth/invalid-email': 'أدخل بريداً إلكترونياً صحيحاً.',
    'auth/invalid-phone-number': 'أدخل رقم الهاتف بالصيغة الدولية مع رمز الدولة، مثل +9677XXXXXXXX.',
    'auth/invalid-verification-code': 'رمز التحقق غير صحيح. راجعه ثم حاول مجدداً.',
    'auth/code-expired': 'انتهت صلاحية رمز التحقق. أرسل رمزاً جديداً.',
    'auth/captcha-check-failed': 'تعذر التحقق من أمان الطلب. أعد تحميل الصفحة وحاول مجدداً.',
    'auth/invalid-app-credential': 'تعذر التحقق من هذا الطلب. أعد تحميل الصفحة ثم اطلب رمزاً جديداً.',
    'auth/quota-exceeded': 'وصل إرسال رسائل التحقق إلى الحد المتاح حالياً. حاول لاحقاً أو تواصل مع المشرف.',
    'auth/missing-phone-number': 'أدخل رقم الهاتف مع رمز الدولة.',
    'auth/too-many-requests': 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.',
    'auth/network-request-failed': 'تعذر الاتصال. تحقق من الإنترنت وحاول مجدداً.',
    'auth/operation-not-allowed': 'تسجيل الدخول بهذه الطريقة غير متاح حالياً. تواصل مع الدعم.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'تعذر الاتصال بالخدمة حالياً. حاول مجدداً لاحقاً.',
    'auth/unauthorized-domain': 'هذا الموقع غير مفعّل لتسجيل الدخول. تواصل مع الدعم.',
    'permission-denied': 'لا تملك صلاحية لهذه العملية. تواصل مع مسؤول النظام.',
    'resource-exhausted': 'وصل الاستخدام إلى الحد المجاني المتاح حالياً. أعد المحاولة بعد تجدد الحصة أو تواصل مع مسؤول النظام.',
  }
  return messages[error.code] ?? 'تعذر إكمال العملية. تحقق من بيانات الدخول والاتصال وحاول مجدداً.'
}
