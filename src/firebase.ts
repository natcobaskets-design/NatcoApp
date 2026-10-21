import { FirebaseError, initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const missingFirebaseSettings = Object.entries(config)
  .filter(([, value]) => !value)
  .map(([key]) => `VITE_FIREBASE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`)

export const firebaseConfigured = missingFirebaseSettings.length === 0
const firebaseApp = firebaseConfigured
  ? getApps()[0] ?? initializeApp(config)
  : null

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null
export const firestore = firebaseApp ? getFirestore(firebaseApp) : null

export function firebaseErrorMessage(error: unknown): string {
  if (!(error instanceof FirebaseError)) {
    return 'تعذر إكمال العملية. تحقق من الاتصال وحاول مجدداً.'
  }
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    'auth/user-not-found': 'لا يوجد حساب بهذا البريد الإلكتروني.',
    'auth/wrong-password': 'كلمة المرور غير صحيحة.',
    'auth/email-already-in-use': 'هذا البريد مسجل مسبقاً. سجّل الدخول بدلاً من إنشاء حساب جديد.',
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
