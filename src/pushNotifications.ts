import type { User } from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging'
import { firebaseApp, firebaseProjectId, firestore } from './firebase'

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY ?? ''

function tokenDocumentId(token: string): Promise<string> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  )
}

export function hasSavedPushSubscription(uid: string): boolean {
  try {
    return localStorage.getItem(`natco.push-enabled.${uid}`) === 'true'
  } catch (error) {
    console.warn('Unable to read push subscription state.', error)
    return false
  }
}

export async function enablePushSubscription(user: Pick<User, 'uid'>): Promise<void> {
  if (!firebaseApp || !firestore || !firebaseProjectId) {
    throw new Error('إعداد Firebase غير مكتمل.')
  }
  if (!vapidKey) {
    throw new Error('أضف مفتاح Web Push من Firebase إلى إعداد VITE_FIREBASE_VAPID_KEY ثم أعد النشر.')
  }
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    throw new Error('هذا المتصفح لا يدعم إشعارات Push.')
  }
  if (!await isSupported()) {
    throw new Error('إشعارات Firebase غير مدعومة في هذا المتصفح.')
  }

  const scriptUrl = new URL(
    `${import.meta.env.BASE_URL}firebase-messaging-sw.js`,
    window.location.href,
  )
  const scopeUrl = new URL(import.meta.env.BASE_URL, window.location.href)
  const registration = await navigator.serviceWorker.register(scriptUrl, {
    scope: scopeUrl.pathname,
  })
  const token = await getToken(getMessaging(firebaseApp), {
    vapidKey,
    serviceWorkerRegistration: registration,
  })
  if (!token) throw new Error('لم يصدر Firebase رمز تسجيل Push لهذا الجهاز.')

  const tokenId = await tokenDocumentId(token)
  await setDoc(doc(firestore, 'push_tokens', tokenId), {
    uid: user.uid,
    token,
    updatedAt: serverTimestamp(),
  }, { merge: true })

  try {
    localStorage.setItem(`natco.push-token.${user.uid}`, tokenId)
    localStorage.setItem(`natco.push-enabled.${user.uid}`, 'true')
  } catch (error) {
    console.warn('Push was enabled, but local subscription state could not be stored.', error)
  }
}

export async function disablePushSubscription(uid: string): Promise<void> {
  if (!firebaseApp || !firestore) return
  let tokenId = ''
  try {
    tokenId = localStorage.getItem(`natco.push-token.${uid}`) ?? ''
  } catch (error) {
    console.warn('Unable to read push token state during sign-out.', error)
  }

  const cleanup: Promise<unknown>[] = []
  if (tokenId) cleanup.push(deleteDoc(doc(firestore, 'push_tokens', tokenId)))
  try {
    if (await isSupported()) cleanup.push(deleteToken(getMessaging(firebaseApp)))
  } catch (error) {
    if (!(error instanceof FirebaseError)) {
      console.warn('Unable to remove the local Firebase push token.', error)
    } else {
      console.warn('Unable to remove the local Firebase push token.', error.code)
    }
  }
  const results = await Promise.allSettled(cleanup)
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('Unable to clean up a push subscription during sign-out.', result.reason)
    }
  }
  try {
    localStorage.removeItem(`natco.push-token.${uid}`)
    localStorage.removeItem(`natco.push-enabled.${uid}`)
  } catch (error) {
    console.warn('Unable to clear local push subscription state.', error)
  }
}
