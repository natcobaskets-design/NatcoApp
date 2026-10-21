import { readFile } from 'node:fs/promises'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'

const projectId = 'demo-natco-order-rules'
const phoneDigits = '967777777777'
const authEmail = `employee.${phoneDigits}@natco-edabc.firebaseapp.com`
const email = 'employee@example.com'
const uid = 'employee-test-uid'
const code = 'NATCO-1001'
const company = 'Natco'
const limit = 1_250_000
const spent = 0

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules: await readFile('firestore.rules', 'utf8') },
})

try {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'employee_auth_lookup', authEmail), {
      authEmail,
      email,
      phoneNumber: `+${phoneDigits}`,
      phoneDigits,
    })
    await setDoc(doc(db, 'employee_roster', email), {
      active: true,
      employeeCode: code,
      company,
      phoneE164: `+${phoneDigits}`,
      monthlySpendingLimit: limit,
      currentMonthlySpent: spent,
      spendingPeriod: '2026-10',
    })
    await setDoc(doc(db, 'admin_settings', 'basket_selection'), { maxTotalPerEmployee: 2 })
    await setDoc(doc(db, 'basket_types', 'essential'), {
      active: true,
      maxPerEmployee: 2,
    })
    await setDoc(doc(db, 'basket_types', 'family'), {
      active: true,
      maxPerEmployee: 1,
    })
  })

  const db = testEnv.authenticatedContext(uid, {
    email: authEmail,
    email_verified: false,
  }).firestore()
  const orderRef = doc(collection(db, 'orders'))
  const profile = {
    email,
    employeeCode: code,
    company,
    branch: 'صنعاء',
    name: 'موظف تجريبي',
    address: 'عنوان تجريبي',
    phone: '777777777',
    whatsapp: '777777777',
    monthlySpendingLimit: limit,
    currentMonthlySpent: spent,
    spendingPeriod: '2026-10',
  }
  const batch = writeBatch(db)
  batch.set(orderRef, {
    reference: `NATCO-${orderRef.id.slice(-6).toUpperCase()}`,
    uid,
    email,
    employeeCode: code,
    profile,
    baskets: { essential: 1, family: 1 },
    basketSelections: ['essential', 'family'],
    items: { rice: 1 },
    itemDetails: { rice: { name: 'أرز', agentPrice: 100, lineTotal: 100 } },
    excluded: [],
    pickupBranch: 'صنعاء',
    totalAmount: 100,
    currency: 'YER',
    editCount: 0,
    status: 'received',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  batch.update(doc(db, 'employee_roster', email), {
    currentMonthlySpent: 100,
    spendingPeriod: '2026-10',
    lastSpendOrderId: orderRef.id,
  })
  await assertSucceeds(batch.commit())

  const editBatch = writeBatch(db)
  editBatch.update(orderRef, {
    totalAmount: 120,
    updatedAt: serverTimestamp(),
    editCount: 1,
    profile: { ...profile, currentMonthlySpent: 100 },
    items: { rice: 1, sugar: 1 },
    itemDetails: {
      rice: { name: 'أرز', agentPrice: 100, lineTotal: 100 },
      sugar: { name: 'سكر', agentPrice: 20, lineTotal: 20 },
    },
  })
  editBatch.update(doc(db, 'employee_roster', email), {
    currentMonthlySpent: 120,
    spendingPeriod: '2026-10',
    lastSpendOrderId: orderRef.id,
  })
  await assertSucceeds(editBatch.commit())

  const invalidOrderRef = doc(collection(db, 'orders'))
  const invalidSelectionBatch = writeBatch(db)
  invalidSelectionBatch.set(invalidOrderRef, {
    reference: `NATCO-${invalidOrderRef.id.slice(-6).toUpperCase()}`,
    uid,
    email,
    employeeCode: code,
    profile: { ...profile, currentMonthlySpent: 120 },
    baskets: { essential: 0, family: 1 },
    basketSelections: ['family', 'family'],
    items: { rice: 1 },
    itemDetails: { rice: { name: 'أرز', agentPrice: 1, lineTotal: 1 } },
    excluded: [],
    pickupBranch: 'صنعاء',
    totalAmount: 1,
    currency: 'YER',
    editCount: 0,
    status: 'received',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  invalidSelectionBatch.update(doc(db, 'employee_roster', email), {
    currentMonthlySpent: 121,
    spendingPeriod: '2026-10',
    lastSpendOrderId: invalidOrderRef.id,
  })
  await assertFails(invalidSelectionBatch.commit())
  await assertFails(deleteDoc(orderRef))
  console.log(`ORDER_CREATE_EDIT_ALLOWED_INVALID_SELECTION_AND_DELETE_DENIED ${orderRef.id}`)
} finally {
  await testEnv.cleanup()
}
