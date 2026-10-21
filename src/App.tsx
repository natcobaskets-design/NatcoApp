import { useEffect, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import {
  onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut,
} from 'firebase/auth'
import {
  collection, doc, getDoc, onSnapshot, query, serverTimestamp, writeBatch,
  setDoc, where,
} from 'firebase/firestore'
import { AppLayout } from './AppLayout'
import { createEmployeeSignupAccount, firebaseAuth, firebaseConfigured, firebaseErrorMessage, firebaseProjectId, firestore } from './firebase'
import {
  blankProfile, parseCatalogProduct, parseOrder, parseProfile, productAgentPrice,
  defaultBasketDefinitions, defaultBasketSelectionSettings, defaultOrganizationOptions,
  parseBasketDefinition, parseOrganizationOptions, type BasketCounts, type CatalogProduct, type EmployeeProfile, type Order,
  type OrganizationOptions, type Screen,
} from './domain'
import { toE164PhoneNumber } from './rosterImport'
import { employeePasswordLoginEmail, isEmployeePasswordLoginEmail } from './employeeLogin'
import './App.css'

function buildEmployeeProfile(
  savedProfile: EmployeeProfile | null,
  rosterData: Record<string, unknown>,
  email: string,
): EmployeeProfile {
  const profile: EmployeeProfile = {
    ...(savedProfile ?? { ...blankProfile, email }),
    email,
    ...(typeof rosterData.employeeCode === 'string' ? { employeeCode: rosterData.employeeCode } : {}),
    ...(typeof rosterData.company === 'string' ? { company: rosterData.company } : {}),
    ...(typeof rosterData.branch === 'string' ? { branch: rosterData.branch } : {}),
    ...(typeof rosterData.province === 'string' ? { province: rosterData.province } : {}),
    ...(typeof rosterData.name === 'string' ? { name: rosterData.name } : {}),
    ...(typeof rosterData.address === 'string' ? { address: rosterData.address } : {}),
    ...(typeof rosterData.phone === 'string' ? { phone: rosterData.phone } : {}),
    ...(typeof rosterData.whatsapp === 'string' ? { whatsapp: rosterData.whatsapp } : {}),
    ...(typeof rosterData.monthlySpendingLimit === 'number'
      ? { monthlySpendingLimit: rosterData.monthlySpendingLimit } : {}),
    currentMonthlySpent: typeof rosterData.currentMonthlySpent === 'number'
      ? rosterData.currentMonthlySpent : 0,
    ...(typeof rosterData.spendingPeriod === 'string' ? { spendingPeriod: rosterData.spendingPeriod } : {}),
  }
  if (typeof rosterData.monthlySpendingLimit !== 'number') delete profile.monthlySpendingLimit
  if (typeof rosterData.spendingPeriod !== 'string') delete profile.spendingPeriod
  return profile
}

function currentSpendingPeriod(): string {
  return new Date().toISOString().slice(0, 7)
}

function withoutMonthlySpendingLimit(profile: EmployeeProfile): EmployeeProfile {
  const { monthlySpendingLimit, ...profileWithoutLimit } = profile
  return typeof monthlySpendingLimit === 'number' ? profileWithoutLimit : profile
}

function orderSubmissionErrorMessage(error: unknown, isEditing: boolean, traceId: string): string {
  const failure = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown }
    : null
  const errorCode = typeof failure?.code === 'string' ? failure.code : 'unknown'
  const action = isEditing ? 'تعديل' : 'تأكيد'
  const errorName = errorCode === 'permission-denied'
    ? 'NOT_ALLOWED'
    : errorCode === 'unavailable'
      ? 'TEMPORARILY_UNAVAILABLE'
      : errorCode === 'deadline-exceeded'
        ? 'TIMED_OUT'
        : errorCode === 'resource-exhausted'
          ? 'TRY_AGAIN_LATER'
          : 'FAILED'
  const errorCodeLabel = `ORDER_${isEditing ? 'EDIT' : 'SUBMISSION'}_${errorName}`
  return `تعذر ${action} الطلب. رمز الخطأ: ${errorCodeLabel}. رقم المتابعة: ${traceId}.`
}

function orderEditComparison(
  previous: Order,
  next: Pick<Order, 'baskets' | 'items' | 'itemDetails' | 'excluded' | 'pickupBranch' | 'totalAmount'>,
  basketNames: Record<string, string>,
): string {
  const changes: string[] = []
  const basketIds = new Set([...Object.keys(previous.baskets), ...Object.keys(next.baskets)])
  basketIds.forEach((id) => {
    const before = previous.baskets[id] ?? 0
    const after = next.baskets[id] ?? 0
    if (before !== after) changes.push(`${basketNames[id] ?? id}: قبل ${before}، بعد ${after}`)
  })
  const productIds = new Set([...Object.keys(previous.items), ...Object.keys(next.items)])
  productIds.forEach((id) => {
    const before = previous.items[id] ?? 0
    const after = next.items[id] ?? 0
    if (before !== after) {
      const name = next.itemDetails[id]?.name ?? previous.itemDetails[id]?.name ?? id
      changes.push(`${name}: قبل ${before}، بعد ${after}`)
    }
  })
  if (previous.pickupBranch !== next.pickupBranch) {
    changes.push(`فرع الاستلام: قبل ${previous.pickupBranch || previous.profile.branch}، بعد ${next.pickupBranch}`)
  }
  if (previous.totalAmount !== next.totalAmount) {
    changes.push(`الإجمالي: قبل ${previous.totalAmount ?? 0}، بعد ${next.totalAmount ?? 0} ر.ي`)
  }
  const previousExcluded = previous.excluded
    .map((id) => previous.itemDetails[id]?.name ?? id)
    .sort()
    .join('، ')
  const nextExcluded = next.excluded
    .map((id) => next.itemDetails[id]?.name ?? id)
    .sort()
    .join('، ')
  if (previousExcluded !== nextExcluded) {
    changes.push(`الأصناف المستبعدة: قبل ${previousExcluded || 'لا يوجد'}، بعد ${nextExcluded || 'لا يوجد'}`)
  }
  if (!changes.length) changes.push('لم تتغير الأصناف أو الكميات أو المبلغ.')
  return `تم التعديل على الطلب ${previous.reference}.\nقبل التعديل: ${previous.totalAmount ?? 0} ر.ي.\nبعد التعديل: ${next.totalAmount ?? 0} ر.ي.\nالتغييرات: ${changes.join('؛ ')}.`
}

function App() {
  const [screen, setScreen] = useState<Screen>('email')
  const [profile, setProfile] = useState<EmployeeProfile>(blankProfile)
  const [assignedCompany, setAssignedCompany] = useState('')
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [basketDefinitions, setBasketDefinitions] = useState(defaultBasketDefinitions)
  const [basketSelectionSettings, setBasketSelectionSettings] = useState(defaultBasketSelectionSettings)
  const [orders, setOrders] = useState<Order[]>([])
  const [organizationOptions, setOrganizationOptions] = useState<OrganizationOptions>(defaultOrganizationOptions)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(!firebaseAuth)
  const [resolvedIdentityUid, setResolvedIdentityUid] = useState('')
  const [identityIssue, setIdentityIssue] = useState('')
  const [identityRetry, setIdentityRetry] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isEmployee, setIsEmployee] = useState(false)
  const [counts, setCounts] = useState<BasketCounts>(() =>
    Object.fromEntries(defaultBasketDefinitions.map((basket) => [basket.id, 0])))
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [excluded, setExcluded] = useState<string[]>([])
  const [pickupBranch, setPickupBranch] = useState('')
  const [depositInstructions, setDepositInstructions] = useState('')
  const [supportPhone, setSupportPhone] = useState('')
  const [supportContactUnavailable, setSupportContactUnavailable] = useState(false)
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null)
  const [profileReturn, setProfileReturn] = useState<Screen>('baskets')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [currentYear] = useState(() => new Date().getFullYear())
  const identityReady = !authUser || resolvedIdentityUid === authUser.uid

  useEffect(() => {
    if (!firebaseAuth) return
    return onAuthStateChanged(firebaseAuth, (user) => {
      setIdentityIssue('')
      setAuthUser(user)
      setAuthReady(true)
      setResolvedIdentityUid('')
      if (!user) {
        setEmail('')
        setPhone('')
        setIsAdmin(false)
        setIsEmployee(false)
        setSupportPhone('')
        setSupportContactUnavailable(false)
        setIdentityIssue('')
        setProfile(blankProfile)
        setAssignedCompany('')
        setCounts(Object.fromEntries(defaultBasketDefinitions.map((basket) => [basket.id, 0])))
        setQuantities({})
        setExcluded([])
        setPickupBranch('')
        setActiveOrder(null)
        setProducts([])
        setOrders([])
        setScreen('email')
      }
    }, (error) => {
      console.error('Firebase authentication state listener failed.', error)
      setIdentityIssue(firebaseErrorMessage(error))
      setAuthReady(true)
    })
  }, [])

  useEffect(() => {
    if (!authReady) return
    if (!authUser) return
    if (!firestore || !firebaseAuth) return

    const database = firestore
    const user = authUser
    let current = true
    async function resolveIdentity() {
      const normalizedEmail = user.email?.trim().toLowerCase() ?? ''
      const passwordLogin = isEmployeePasswordLoginEmail(normalizedEmail, firebaseProjectId)
      const adminSnapshot = await getDoc(doc(database, 'admin_users', user.uid))
      const hasAdminAccess = adminSnapshot.exists() && adminSnapshot.data().active === true
      if (hasAdminAccess) {
        if (!current) return
        setEmail(normalizedEmail)
        setIsAdmin(true)
        setIsEmployee(false)
        setScreen('admin')

        if (!normalizedEmail || !user.emailVerified) return
        const rosterSnapshot = await getDoc(doc(database, 'employee_roster', normalizedEmail))
        const hasEmployeeAccess = rosterSnapshot.exists() && rosterSnapshot.data().active === true
        if (!current) return
        setIsEmployee(hasEmployeeAccess)
        if (hasEmployeeAccess) {
          const profileSnapshot = await getDoc(doc(database, 'employees', user.uid))
          if (!current) return
          const savedProfile = profileSnapshot.exists() ? parseProfile(profileSnapshot.data()) : null
          const rosterData = rosterSnapshot.data()
          setAssignedCompany(typeof rosterData.company === 'string' ? rosterData.company : '')
          const currentProfile = buildEmployeeProfile(savedProfile, rosterData, normalizedEmail)
          setProfile(currentProfile)
          setPickupBranch(currentProfile.branch)
          setProfileReturn('baskets')
        }
        return
      }
      if (!user.emailVerified && !user.phoneNumber && !passwordLogin) {
        if (current) setIdentityIssue('تحقق من بريدك الإلكتروني من الرسالة التي أرسلناها إليك، ثم سجّل الدخول مجدداً.')
        return
      }
      let employeeEmail = normalizedEmail
      let passwordLoginPhone = ''
      if (passwordLogin) {
        const signupSnapshot = await getDoc(doc(database, 'employee_signup_requests', user.uid))
        if (signupSnapshot.exists() && signupSnapshot.data().status === 'pending') {
          if (current) setIdentityIssue('هذا الحساب بانتظار موافقة الموارد البشرية. يرجى الانتظار حتى يراجع المسؤول طلبك.')
          return
        }
        if (signupSnapshot.exists() && signupSnapshot.data().status === 'rejected') {
          if (current) setIdentityIssue('تم رفض طلب التسجيل. تواصل مع مسؤول الموارد البشرية إذا كنت تعتقد أن هذا غير صحيح.')
          return
        }
        const loginSnapshot = await getDoc(doc(database, 'employee_auth_lookup', normalizedEmail))
        if (!loginSnapshot.exists() ||
          loginSnapshot.data().authEmail !== normalizedEmail ||
          typeof loginSnapshot.data().email !== 'string' ||
          typeof loginSnapshot.data().phoneNumber !== 'string') {
          if (current) setIdentityIssue('بيانات دخول الموظف غير مفعّلة. تواصل مع مسؤول الموارد البشرية.')
          return
        }
        employeeEmail = loginSnapshot.data().email.trim().toLowerCase()
        passwordLoginPhone = loginSnapshot.data().phoneNumber
      }
      if (!employeeEmail && user.phoneNumber) {
        const phoneLookup = await getDoc(doc(database, 'employee_phone_lookup', user.phoneNumber))
        if (!phoneLookup.exists() || phoneLookup.data().phoneNumber !== user.phoneNumber ||
          typeof phoneLookup.data().email !== 'string') {
          if (current) setIdentityIssue('رقم الهاتف غير معتمد للدخول. راجع مسؤول الموارد البشرية.')
          return
        }
        employeeEmail = phoneLookup.data().email.trim().toLowerCase()
      }
      if (!employeeEmail) throw new Error('The signed-in Firebase user has no approved phone or email identity.')
      const rosterSnapshot = await getDoc(doc(database, 'employee_roster', employeeEmail))
      const hasEmployeeAccess = rosterSnapshot.exists() && rosterSnapshot.data().active === true
      if (!hasEmployeeAccess) {
        if (current) setIdentityIssue('لم يُعتمد هذا الحساب كموظف بعد. راجع مسؤول الموارد البشرية.')
        return
      }
      if (!normalizedEmail && user.phoneNumber &&
        rosterSnapshot.data().phoneE164 !== user.phoneNumber) {
        if (current) setIdentityIssue('رقم الهاتف الموثّق لا يطابق الرقم المعتمد في سجل الموظفين. تواصل مع الموارد البشرية.')
        return
      }
      if (passwordLogin &&
        (rosterSnapshot.data().phoneE164 !== passwordLoginPhone ||
          employeePasswordLoginEmail(passwordLoginPhone, firebaseProjectId) !== normalizedEmail)) {
        if (current) setIdentityIssue('رقم الهاتف لا يطابق الحساب المعتمد. تواصل مع مسؤول الموارد البشرية.')
        return
      }
      const profileSnapshot = await getDoc(doc(database, 'employees', user.uid))
      if (!current) return
      const savedProfile = profileSnapshot.exists() ? parseProfile(profileSnapshot.data()) : null
      setEmail(employeeEmail)
      setIsAdmin(false)
      setIsEmployee(true)
      const rosterData = rosterSnapshot.data()
      setAssignedCompany(typeof rosterData.company === 'string' ? rosterData.company : '')
      const currentProfile = buildEmployeeProfile(savedProfile, rosterData, employeeEmail)
      setProfile(currentProfile)
      setPickupBranch(currentProfile.branch)
      setProfileReturn('baskets')
      setCounts(Object.fromEntries(defaultBasketDefinitions.map((basket) => [basket.id, 0])))
      setScreen(savedProfile ? 'baskets' : 'profile')
    }
    void resolveIdentity().catch((error: unknown) => {
      console.error('Unable to validate the signed-in Firebase identity.', error)
      if (current) setIdentityIssue(firebaseErrorMessage(error))
    }).finally(() => {
      if (current) setResolvedIdentityUid(user.uid)
    })
    return () => { current = false }
  }, [authReady, authUser, identityRetry])

  useEffect(() => {
    if (!authUser || !firestore) return
    const database = firestore
    const stopWatching = onSnapshot(
      doc(database, 'admin_users', authUser.uid),
      (snapshot) => {
        const hasAdminAccess = snapshot.exists() && snapshot.data().active === true
        setIsAdmin(hasAdminAccess)
        if (hasAdminAccess) setIdentityIssue('')
      },
      (error) => {
        console.error('Unable to refresh the signed-in account permissions.', error)
        setNotice(firebaseErrorMessage(error))
      },
    )
    return stopWatching
  }, [authUser])

  useEffect(() => {
    if (!authUser || !firestore || (!isAdmin && !isEmployee)) return
    let current = true
    void getDoc(doc(firestore, 'admin_settings', 'organization_options')).then((snapshot) => {
      if (!current) return
      if (!snapshot.exists()) {
        setOrganizationOptions(defaultOrganizationOptions)
        return
      }
      const options = parseOrganizationOptions(snapshot.data())
      if (!options) {
        console.error('Company and branch settings have an invalid format.')
        setNotice('تعذر تحميل قائمة الشركات والفروع؛ راجع مسؤول النظام.')
        return
      }
      setOrganizationOptions(options)
    }).catch((error: unknown) => {
      console.error('Unable to load company and branch options.', error)
      if (current) {
        setOrganizationOptions(defaultOrganizationOptions)
        setNotice(firebaseErrorMessage(error))
      }
    })
    return () => { current = false }
  }, [authUser, isAdmin, isEmployee])

  useEffect(() => {
    if (!authUser || !firestore || (!isAdmin && !isEmployee)) return
    const unsubscribeBaskets = onSnapshot(collection(firestore, 'basket_types'), (snapshot) => {
      if (snapshot.empty) {
        setBasketDefinitions(defaultBasketDefinitions)
        return
      }
      const parsed = snapshot.docs.flatMap((item) => {
        const definition = parseBasketDefinition(item.id, item.data())
        if (!definition) console.error(`Ignoring malformed basket definition ${item.id}.`)
        return definition ? [definition] : []
      })
      setBasketDefinitions(parsed)
    }, (error) => {
      console.error('Unable to load basket definitions.', error)
      setNotice(firebaseErrorMessage(error))
    })
    const unsubscribeSettings = onSnapshot(doc(firestore, 'admin_settings', 'basket_selection'), (snapshot) => {
      const maximum = snapshot.exists() ? snapshot.data().maxTotalPerEmployee : 2
      if (Number.isInteger(maximum) && Number(maximum) >= 1 && Number(maximum) <= 10) {
        setBasketSelectionSettings({ maxTotalPerEmployee: Number(maximum) })
      } else {
        setBasketSelectionSettings(defaultBasketSelectionSettings)
      }
    }, (error) => {
      console.error('Unable to load basket selection limits.', error)
      setNotice(firebaseErrorMessage(error))
    })
    return () => {
      unsubscribeBaskets()
      unsubscribeSettings()
    }
  }, [authUser, isAdmin, isEmployee])

  useEffect(() => {
    if (!isEmployee || !firestore) return
    let current = true
    void getDoc(doc(firestore, 'admin_settings', 'payment_instructions')).then((snapshot) => {
      if (current) setDepositInstructions(
        snapshot.exists() && typeof snapshot.data().instructions === 'string'
          ? snapshot.data().instructions : '',
      )
    }).catch((error: unknown) => {
      console.error('Unable to load payment instructions.', error)
      if (current) setNotice(firebaseErrorMessage(error))
    })
    return () => { current = false }
  }, [isEmployee])

  useEffect(() => {
    const employeeEmail = (profile.email || email).trim().toLowerCase()
    if (!isEmployee || !authUser || !employeeEmail || !firestore) return
    const rosterRef = doc(firestore, 'employee_roster', employeeEmail)
    const profileRef = doc(firestore, 'employees', authUser.uid)
    let rosterData: Record<string, unknown> | null = null
    let savedProfile: EmployeeProfile | null = null
    const applyLatestProfile = () => {
      if (!rosterData) return
      if (rosterData.active !== true) {
        setIsEmployee(false)
        setIdentityIssue('تم إيقاف اعتماد هذا الحساب. راجع مسؤول الموارد البشرية.')
        setScreen('email')
        return
      }
      const latest = buildEmployeeProfile(savedProfile, rosterData, employeeEmail)
      setAssignedCompany(typeof rosterData.company === 'string' ? rosterData.company : '')
      setProfile(latest)
      setPickupBranch((current) => current || latest.branch)
    }
    const unsubscribeRoster = onSnapshot(rosterRef, (snapshot) => {
      rosterData = snapshot.exists() ? snapshot.data() : null
      applyLatestProfile()
    }, (error) => {
      console.error('Unable to subscribe to employee roster changes.', error)
      setNotice(firebaseErrorMessage(error))
    })
    const unsubscribeProfile = onSnapshot(profileRef, (snapshot) => {
      savedProfile = snapshot.exists() ? parseProfile(snapshot.data()) : null
      applyLatestProfile()
    }, (error) => {
      console.error('Unable to subscribe to employee profile changes.', error)
      setNotice(firebaseErrorMessage(error))
    })
    return () => {
      unsubscribeRoster()
      unsubscribeProfile()
    }
  }, [authUser, isEmployee, email, profile.email])

  useEffect(() => {
    if (!isEmployee || !firestore) return
    return onSnapshot(doc(firestore, 'admin_settings', 'support_contact'), (snapshot) => {
      setSupportContactUnavailable(false)
      const phone = snapshot.exists() && typeof snapshot.data().phone === 'string'
        ? snapshot.data().phone.replace(/[^\d+]/g, '')
        : ''
      const digitCount = phone.replace(/\D/g, '').length
      setSupportPhone(digitCount >= 8 && digitCount <= 18 && /^\+?\d+$/.test(phone) ? phone : '')
    }, (error) => {
      console.error('Unable to subscribe to employee support contact.', error)
      setSupportPhone('')
      setSupportContactUnavailable(true)
    })
  }, [isEmployee])

  useEffect(() => {
    const employeeEmail = (profile.email || email).trim().toLowerCase()
    if (!isEmployee || !authUser || !firestore || !employeeEmail) return
    const unsubscribeProducts = onSnapshot(
      query(collection(firestore, 'products'), where('active', '==', true)),
      (snapshot) => {
        const nextProducts = snapshot.docs.flatMap((item) => {
          const product = parseCatalogProduct(item.id, item.data())
          if (!product) console.error(`Skipping malformed product ${item.id}.`)
          return product ? [product] : []
        })
        setProducts(nextProducts)
      },
      (error) => {
        console.error('Unable to load the employee product catalog.', error)
        setNotice(firebaseErrorMessage(error))
      },
    )
    const unsubscribeOrders = onSnapshot(
      query(collection(firestore, 'orders'), where('email', '==', employeeEmail)),
      (snapshot) => {
        const nextOrders = snapshot.docs.flatMap((item) => {
          const order = parseOrder(item.id, item.data())
          if (!order) console.error(`Skipping malformed order ${item.id}.`)
          return order ? [order] : []
        }).filter((order) => order.status !== 'deleted')
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        setOrders(nextOrders)
        setActiveOrder((current) => current ? nextOrders.find((item) => item.id === current.id) ?? null : null)
      },
      (error) => {
        console.error('Unable to load employee orders.', error)
        setNotice(firebaseErrorMessage(error))
      },
    )
    return () => {
      unsubscribeProducts()
      unsubscribeOrders()
    }
  }, [isEmployee, authUser, email, profile.email])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 3800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const totalBaskets = Object.values(counts).reduce((total, amount) => total + amount, 0)
  const selectedProducts = Object.values(quantities).filter((amount) => amount > 0).length
  const progress = products.length ? Math.min(100, Math.round((selectedProducts / products.length) * 100)) : 0
  const pricedItems = Object.entries(quantities)
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => {
      const product = products.find((entry) => entry.id === id)
      return product ? { id, amount, product, price: productAgentPrice(product, profile.company) } : null
    }).filter((item) => item !== null)
  const totalAmount = pricedItems.reduce((total, item) => total + (item.price ?? 0) * item.amount, 0)
  const hasUnpricedItems = pricedItems.some((item) => item.price === null)
  const currentMonthlySpent = profile.currentMonthlySpent ?? 0
  const editingOrderAllowance = editingOrderId ? activeOrder?.totalAmount ?? 0 : 0
  const remainingMonthlyLimit = typeof profile.monthlySpendingLimit === 'number'
    ? Math.max(0, profile.monthlySpendingLimit - currentMonthlySpent + editingOrderAllowance)
    : null
  const exceedsMonthlyLimit = remainingMonthlyLimit !== null && totalAmount > remainingMonthlyLimit
  const employeeOrders = orders
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!firebaseAuth || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !password) {
      setNotice(!firebaseAuth
        ? 'تسجيل الدخول غير متاح حالياً. حاول مجدداً لاحقاً.'
        : 'أدخل البريد الإلكتروني وكلمة المرور لحساب المشرف أو الحساب القديم.')
      return
    }
    setBusy(true)
    try {
      await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, password)
      setPassword('')
    } catch (error) {
      console.error('Employee sign-in failed.', error)
      setNotice(firebaseErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function signInEmployeeWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const phoneE164 = toE164PhoneNumber(phone)
    const loginEmail = employeePasswordLoginEmail(phoneE164, firebaseProjectId)
    if (!firebaseAuth || !loginEmail || !password) {
      setNotice(!firebaseAuth
        ? 'تسجيل الدخول غير متاح حالياً. حاول مجدداً لاحقاً.'
        : 'أدخل رقم الهاتف بالصيغة الدولية وكلمة المرور.')
      return
    }
    setBusy(true)
    try {
      await signInWithEmailAndPassword(firebaseAuth, loginEmail, password)
      setPassword('')
    } catch (error) {
      console.error('Employee phone and password sign-in failed.', error)
      setNotice(firebaseErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function registerEmployee(event: FormEvent<HTMLFormElement>, name: string, employeeCode: string): Promise<boolean> {
    event.preventDefault()
    const phoneE164 = toE164PhoneNumber(phone)
    const normalizedName = name.trim()
    const normalizedCode = employeeCode.trim()
    if (!firebaseAuth || !firestore || !firebaseConfigured) {
      setNotice('تعذر الاتصال بقاعدة البيانات. تحقق من إعداد Firebase.')
      return false
    }
    if (!phoneE164 || !normalizedName || normalizedName.length > 120 || normalizedCode.length > 80) {
      setNotice('أدخل رقم هاتف صحيحاً واسماً كاملاً ورقماً وظيفياً ضمن الحدود المحددة.')
      return false
    }
    if (password.length < 8 || password.length > 256) {
      setNotice('يجب أن يكون طول كلمة المرور من ٨ إلى ٢٥٦ حرفاً.')
      return false
    }

    setBusy(true)
    try {
      await createEmployeeSignupAccount(phoneE164, password, normalizedName, normalizedCode)
      setPassword('')
      setPhone(phoneE164)
      setNotice('تم إنشاء الحساب وإرسال طلب الاعتماد. لن تتمكن من استخدام التطبيق حتى يراجع مسؤول الموارد البشرية طلبك.')
      return true
    } catch (error) {
      console.error('Unable to create an employee account and approval request.', error)
      setNotice(firebaseErrorMessage(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword() {
    const resetEmail = email.trim().toLowerCase()
    if (!firebaseAuth || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail)) {
      setNotice('أدخل بريدك الإلكتروني لإرسال رابط إعادة تعيين كلمة المرور.')
      return
    }
    try {
      await sendPasswordResetEmail(firebaseAuth, resetEmail)
      setNotice('تم إرسال رابط إعادة تعيين كلمة المرور إذا كان الحساب مسجلاً.')
    } catch (error) {
      console.error('Firebase password reset request failed.', error)
      setNotice(firebaseErrorMessage(error))
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile.employeeCode.trim() || !profile.name.trim() || !profile.company ||
      !profile.branch || !profile.address.trim() || !profile.whatsapp.trim()) {
      setNotice('أكمل الحقول المطلوبة قبل المتابعة.')
      return
    }
    const phoneDigits = profile.phone.replace(/\D/g, '')
    if ((profile.phone && (!/^\+?[\d\s()-]{8,30}$/.test(profile.phone) ||
      phoneDigits.length < 8 || phoneDigits.length > 18)) ||
      !/^\+?[\d\s()-]{8,30}$/.test(profile.whatsapp) ||
      profile.whatsapp.replace(/\D/g, '').length < 8 ||
      profile.whatsapp.replace(/\D/g, '').length > 18) {
      setNotice('تحقق من إدخال رقم هاتف وواتساب صحيحين.')
      return
    }
    if (!firestore || !authUser) {
      setNotice('يجب تسجيل الدخول قبل حفظ بيانات الموظف.')
      return
    }
    setBusy(true)
    try {
      const savedProfile: EmployeeProfile = {
        ...profile,
        email: email.toLowerCase(),
        name: profile.name.trim(),
        address: profile.address.trim(),
        phone: profile.phone.trim(),
        whatsapp: profile.whatsapp.trim(),
        ...(typeof profile.monthlySpendingLimit === 'number' ? { monthlySpendingLimit: profile.monthlySpendingLimit } : {}),
        ...(typeof profile.currentMonthlySpent === 'number' ? { currentMonthlySpent: profile.currentMonthlySpent } : {}),
        ...(typeof profile.spendingPeriod === 'string' ? { spendingPeriod: profile.spendingPeriod } : {}),
      }
      const profileRef = doc(firestore, 'employees', authUser.uid)
      const syncRef = doc(firestore, 'employee_sync_queue', savedProfile.email)
      const batch = writeBatch(firestore)
      batch.set(profileRef, {
        email: savedProfile.email,
        name: savedProfile.name,
        address: savedProfile.address,
        coordinates: savedProfile.coordinates,
        phone: savedProfile.phone,
        whatsapp: savedProfile.whatsapp,
      }, { merge: true })
      batch.set(syncRef, {
        email: savedProfile.email,
        status: 'pending',
        updatedAt: serverTimestamp(),
      })
      await batch.commit()
      setProfile(savedProfile)
      setScreen(profileReturn)
      setNotice('تم حفظ بياناتك الوظيفية في حسابك.')
    } catch (error) {
      console.error('Unable to save employee profile to Firestore.', error)
      setNotice(firebaseErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function locateEmployee() {
    if (!navigator.geolocation) {
      setNotice('خدمة تحديد الموقع غير متاحة في هذا المتصفح.')
      return
    }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setProfile((current) => ({ ...current, coordinates: `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}` }))
        setNotice('تم تحديد موقع التوصيل بنجاح.')
        setBusy(false)
      },
      (error) => {
        setNotice(error.code === error.PERMISSION_DENIED
          ? 'يرجى السماح بالوصول إلى موقعك من إعدادات المتصفح.'
          : 'تعذر تحديد الموقع. أعد المحاولة أو اكتب العنوان يدوياً.')
        setBusy(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  function adjustBasket(id: string, delta: number) {
    const current = counts[id] ?? 0
    const basket = basketDefinitions.find((entry) => entry.id === id)
    if (delta > 0 && (totalBaskets >= basketSelectionSettings.maxTotalPerEmployee ||
      !basket || current >= basket.maxPerEmployee)) {
      setNotice(`وصلت إلى الحد المسموح؛ الحد الإجمالي ${basketSelectionSettings.maxTotalPerEmployee} سلة.`)
      return
    }
    if (current + delta < 0 || !basket || current + delta > basket.maxPerEmployee) return
    setCounts((previous) => ({ ...previous, [id]: current + delta }))
  }

  async function requestProfileChange(message: string) {
    if (!firestore || !authUser || !email) {
      setNotice('يجب تسجيل الدخول لإرسال طلب تعديل البيانات.')
      return
    }
    const requestText = message.trim()
    if (!requestText || requestText.length > 1000) {
      setNotice('اكتب سبب طلب التعديل (بحد أقصى ١٠٠٠ حرف).')
      return
    }
    try {
      await setDoc(doc(collection(firestore, 'profile_change_requests')), {
        uid: authUser.uid,
        email,
        employeeCode: profile.employeeCode,
        message: requestText,
        status: 'pending',
        createdAt: serverTimestamp(),
      })
      setNotice('تم إرسال طلب تعديل البيانات إلى إدارة الموارد البشرية.')
    } catch (error) {
      console.error('Unable to submit the employee profile change request.', error)
      setNotice(firebaseErrorMessage(error))
    }
  }

  async function requestOrderAction(order: Order, action: 'edit' | 'delete', message: string) {
    if (!firestore || !authUser || !email) {
      setNotice('يجب تسجيل الدخول لإرسال طلب متعلق بالطلب.')
      return false
    }
    const requestMessage = message.trim()
    if (!requestMessage || requestMessage.length > 1000) {
      setNotice('اكتب سبب الطلب (بحد أقصى ١٠٠٠ حرف).')
      return false
    }
    try {
      await setDoc(doc(collection(firestore, 'order_action_requests')), {
        uid: authUser.uid,
        email: email.trim().toLowerCase(),
        employeeCode: profile.employeeCode,
        orderId: order.id,
        reference: order.reference,
        action,
        message: requestMessage,
        status: 'pending',
        createdAt: serverTimestamp(),
      })
      setNotice(action === 'edit'
        ? `تم إرسال طلب تعديل الطلب ${order.reference} إلى الإدارة.`
        : `تم إرسال طلب حذف الطلب ${order.reference} إلى الإدارة.`)
      return true
    } catch (error) {
      console.error(`Unable to submit an employee ${action} request for order ${order.id}.`, error)
      setNotice(firebaseErrorMessage(error))
      return false
    }
  }

  function startCustomization() {
    if (totalBaskets === 0) {
      setNotice('اختر سلة واحدة على الأقل للمتابعة.')
      return
    }
    if (!products.length) {
      setNotice('لا توجد منتجات متاحة الآن. تواصل مع إدارة السلال.')
      return
    }
    const selectedBaskets = new Set(basketDefinitions.filter((basket) => (counts[basket.id] ?? 0) > 0).map((basket) => basket.id))
    const next = Object.fromEntries(products.map((product) => {
      const matchingBaskets = basketDefinitions.filter((basket) =>
        selectedBaskets.has(basket.id) && basket.productIds.includes(product.id))
      const amount = matchingBaskets.reduce((sum, basket) => sum + (counts[basket.id] ?? 0), 0)
      return [product.id, amount]
    }))
    setQuantities(next)
    setExcluded([])
    setScreen('customize')
  }

  function adjustProduct(id: string, delta: number) {
    setQuantities((current) => ({ ...current, [id]: Math.max(0, Math.min(9, (current[id] ?? 0) + delta)) }))
    setExcluded((current) => current.filter((item) => item !== id))
  }

  function toggleExcluded(id: string) {
    const isExcluded = excluded.includes(id)
    setExcluded((current) => isExcluded ? current.filter((item) => item !== id) : [...current, id])
    if (!isExcluded) setQuantities((current) => ({ ...current, [id]: 0 }))
    else setQuantities((current) => ({ ...current, [id]: 1 }))
  }

  async function confirmOrder() {
    if (selectedProducts === 0) {
      setNotice('أضف صنفاً واحداً على الأقل لتأكيد الطلب.')
      return
    }
    if (!firestore || !authUser) {
      setNotice('انتهت جلسة الدخول. سجّل الدخول مجدداً لتأكيد الطلب.')
      return
    }
    if (hasUnpricedItems) {
      setNotice('تعذر إكمال الطلب لأن سعر وكيل أحد الأصناف غير محدد. تواصل مع إدارة السلال.')
      return
    }
    if (!pickupBranch) {
      setNotice('اختر فرع الاستلام المفضل قبل تأكيد الطلب.')
      return
    }
    const currentPeriod = currentSpendingPeriod()
    if (editingOrderId && activeOrder?.profile.spendingPeriod &&
      activeOrder.profile.spendingPeriod !== currentPeriod) {
      setNotice('لا يمكن تعديل طلب من فترة شهرية سابقة بعد إغلاقها.')
      return
    }
    setBusy(true)
    let failureStage = 'تجهيز بيانات الطلب'
    let traceId = 'غير متاح'
    try {
      const itemDetails = Object.fromEntries(products
        .filter((product) => (quantities[product.id] ?? 0) > 0)
        .map((product) => {
          const agentPrice = productAgentPrice(product, profile.company) ?? 0
          const itemDetail: NonNullable<Order['itemDetails'][string]> = {
            name: product.name,
            agentPrice,
            lineTotal: agentPrice * (quantities[product.id] ?? 0),
          }
          if (product.imageUrl && !product.imageUrl.startsWith('data:') && product.imageUrl.length <= 2048) {
            itemDetail.imageUrl = product.imageUrl
          }
          return [product.id, itemDetail]
        }))
      const orderRef = editingOrderId
        ? doc(firestore, 'orders', editingOrderId)
        : doc(collection(firestore, 'orders'))
      traceId = orderRef.id
      const notificationRef = doc(firestore, 'order_notifications', orderRef.id)
      const employeeEmail = profile.email.trim().toLowerCase()
      if (!employeeEmail) {
        setNotice('تعذر تحديد سجل الموظف. سجّل الخروج ثم أعد التحقق من رقم الهاتف.')
        return
      }
      const rosterRef = doc(firestore, 'employee_roster', employeeEmail)
      const previousAmount = activeOrder?.totalAmount ?? 0
      failureStage = 'قراءة سجل الموظف والإنفاق الحالي'
      const rosterSnapshot = await getDoc(rosterRef)
      if (!rosterSnapshot.exists() || rosterSnapshot.data().active !== true ||
        rosterSnapshot.data().employeeCode !== profile.employeeCode) {
        setNotice('تعذر تأكيد الطلب لأن سجل الموظف غير نشط أو لا يطابق الرقم الوظيفي. تواصل مع الموارد البشرية.')
        return
      }
      const freshProfile = buildEmployeeProfile(profile, rosterSnapshot.data(), employeeEmail)
      if (freshProfile.company !== profile.company) {
        setNotice('تم تحديث الشركة المرتبطة بحسابك. حدّث الصفحة قبل متابعة الطلب لضمان تطبيق أسعار شركتك.')
        return
      }
      const rosterSpent = typeof rosterSnapshot.data().currentMonthlySpent === 'number'
        ? rosterSnapshot.data().currentMonthlySpent
        : 0
      const rosterPeriod = typeof rosterSnapshot.data().spendingPeriod === 'string'
        ? rosterSnapshot.data().spendingPeriod
        : ''
      if (typeof freshProfile.monthlySpendingLimit === 'number' &&
        rosterPeriod !== currentPeriod && (Boolean(rosterPeriod) || rosterSpent > 0)) {
        setNotice('انتهت فترة الإنفاق المسجلة في سجل الموظف. يرجى التواصل مع المشرف لتحديث رصيد الشهر قبل تأكيد الطلب.')
        return
      }
      if (typeof freshProfile.monthlySpendingLimit === 'number' &&
        totalAmount > freshProfile.monthlySpendingLimit - rosterSpent + previousAmount) {
        setNotice('إجمالي الطلب يتجاوز المتبقي من سقفك الشهري. راجع الأصناف أو تواصل مع مسؤول الموارد البشرية.')
        return
      }
      const nextMonthlySpent = rosterSpent + totalAmount - previousAmount
      if (nextMonthlySpent < 0) {
        setNotice('تعذر مطابقة قيمة الطلب السابق مع الإنفاق الشهري. راجع المشرف لتصحيح الرصيد.')
        return
      }
      const orderProfile = editingOrderId && activeOrder
        ? {
          ...withoutMonthlySpendingLimit(activeOrder.profile),
          currentMonthlySpent: rosterSpent,
          ...(typeof freshProfile.monthlySpendingLimit === 'number'
            ? { monthlySpendingLimit: freshProfile.monthlySpendingLimit }
            : {}),
          spendingPeriod: rosterPeriod || currentPeriod,
        }
        : freshProfile
      const orderData = {
        reference: editingOrderId
          ? activeOrder?.reference ?? `NATCO-${orderRef.id.slice(-6).toUpperCase()}`
          : `NATCO-${orderRef.id.slice(-6).toUpperCase()}`,
        uid: authUser.uid,
        email: employeeEmail,
        employeeCode: profile.employeeCode,
        profile: orderProfile,
        baskets: { ...counts },
        basketSelections: Object.entries(counts).flatMap(([basketId, amount]) =>
          Array.from({ length: amount }, () => basketId)),
        items: { ...quantities },
        itemDetails,
        excluded: [...excluded],
        pickupBranch,
        totalAmount,
        currency: 'YER',
        editCount: editingOrderId ? 1 : 0,
      }
      const ledgerUpdate = {
        currentMonthlySpent: nextMonthlySpent,
        spendingPeriod: rosterPeriod || currentPeriod,
        lastSpendOrderId: orderRef.id,
      }
      const syncRef = doc(firestore, 'employee_sync_queue', employeeEmail)
      const notificationData = {
        orderId: orderRef.id,
        uid: authUser.uid,
        status: 'pending',
        eventStatus: 'received',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      if (editingOrderId) {
        const batch = writeBatch(firestore)
        batch.update(orderRef, { ...orderData, updatedAt: serverTimestamp() })
        batch.update(rosterRef, ledgerUpdate)
        failureStage = 'حفظ تعديل الطلب وتحديث الإنفاق'
        await batch.commit()
      } else {
        const batch = writeBatch(firestore)
        batch.set(orderRef, {
          ...orderData,
          status: 'received',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        batch.update(rosterRef, ledgerUpdate)
        failureStage = 'حفظ الطلب وتحديث الإنفاق'
        await batch.commit()
      }
      setProfile((current) => ({
        ...current,
        currentMonthlySpent: nextMonthlySpent,
        spendingPeriod: rosterPeriod || currentPeriod,
      }))
      const order: Order = {
        ...orderData,
        id: orderRef.id,
        createdAt: activeOrder?.createdAt ?? new Date().toISOString(),
        status: editingOrderId ? activeOrder?.status ?? 'received' : 'received',
      }
      setEditingOrderId(null)
      setActiveOrder(order)
      setScreen('receipt')
      const editSummary = editingOrderId && activeOrder
        ? orderEditComparison(
          activeOrder,
          orderData,
          Object.fromEntries(basketDefinitions.map((basket) => [basket.id, basket.name])),
        )
        : ''
      setNotice(editingOrderId
        ? editSummary
        : 'تم تأكيد طلبك وإضافته إلى قائمة مزامنة Google Sheets.')
      try {
        const syncBatch = writeBatch(firestore)
        syncBatch.set(notificationRef, notificationData, { merge: true })
        syncBatch.set(syncRef, {
          email: employeeEmail,
          status: 'pending',
          updatedAt: serverTimestamp(),
        }, { merge: true })
        await syncBatch.commit()
      } catch (syncError) {
        console.error('The order was saved, but its Google Sheets sync queue could not be written.', {
          orderId: orderRef.id,
          employeeEmail,
          error: syncError,
        })
        setNotice(`تم حفظ الطلب ${order.reference} والانتقال إلى الإيصال، لكن تعذرت جدولة مزامنته مع Google Sheets. أبلغ المشرف بهذا الرقم: ${order.reference}.`)
      }
    } catch (error) {
      console.error('Unable to submit the employee order to Firestore.', {
        stage: failureStage,
        traceId,
        error,
      })
      setNotice(`${orderSubmissionErrorMessage(error, Boolean(editingOrderId), traceId)} المرحلة: ${failureStage}.`)
    } finally {
      setBusy(false)
    }
  }

  function editProfile() {
    setProfileReturn(screen)
    setScreen('profile')
  }

  function editOrder(order: Order) {
    if ((order.editCount ?? 0) >= 1) {
      setNotice('تم استخدام التعديل المسموح لهذا الطلب.')
      return
    }
    if (order.status !== 'received') {
      setNotice('بدأ تجهيز هذا الطلب. تواصل مع إدارة ناتكو لتعديله.')
      return
    }
    setCounts({ ...order.baskets })
    setQuantities({ ...order.items })
    setExcluded([...order.excluded])
    setPickupBranch(order.pickupBranch || order.profile.branch)
    setEditingOrderId(order.id)
    setScreen('customize')
  }

  function startNewOrder() {
    setCounts(Object.fromEntries(basketDefinitions.map((basket) => [basket.id, 0])))
    setQuantities({})
    setExcluded([])
    setActiveOrder(null)
    setEditingOrderId(null)
    setScreen('baskets')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function logOut() {
    if (firebaseAuth) {
      try {
        await signOut(firebaseAuth)
      } catch (error) {
        console.error('Unable to sign out from Firebase.', error)
        setNotice(firebaseErrorMessage(error))
      }
    }
    setProfile(blankProfile)
    setCounts(Object.fromEntries(basketDefinitions.map((basket) => [basket.id, 0])))
    setQuantities({})
    setExcluded([])
    setActiveOrder(null)
    setEditingOrderId(null)
    setPassword('')
    setPhone('')
    setScreen('email')
  }

  async function resendVerification() {
    if (!authUser || !firebaseAuth) return
    try {
      await sendEmailVerification(authUser)
      setNotice('أعدنا إرسال رابط التحقق إلى بريدك الإلكتروني.')
    } catch (error) {
      console.error('Unable to resend Firebase email verification.', error)
      setNotice(firebaseErrorMessage(error))
    }
  }

  return <AppLayout
    screen={screen}
    setScreen={setScreen}
    profile={profile}
    email={email}
    isAdmin={isAdmin}
    isEmployee={isEmployee}
    authUser={authUser}
    currentYear={currentYear}
    firebaseConfigured={firebaseConfigured}
    supportPhone={supportPhone}
    supportContactUnavailable={supportContactUnavailable}
    notice={notice}
    setNotice={setNotice}
    totalBaskets={totalBaskets}
    selectedProducts={selectedProducts}
    employeeOrders={employeeOrders}
    onOrganizationOptionsChange={setOrganizationOptions}
    loginProps={{
      hasSession: Boolean(authUser),
      emailVerified: authUser
        ? authUser.emailVerified || Boolean(authUser.phoneNumber) ||
          isEmployeePasswordLoginEmail(authUser.email ?? '', firebaseProjectId)
        : false,
      identityReady,
      identityIssue,
      email,
      setEmail,
      password,
      setPassword,
      phone,
      setPhone,
      busy,
      configured: firebaseConfigured,
      onClearIssue: () => setIdentityIssue(''),
      onSignIn: (event) => void signIn(event),
      onEmployeeSignIn: (event) => void signInEmployeeWithPassword(event),
      onEmployeeRegister: registerEmployee,
      onReset: () => void resetPassword(),
      onRetry: () => setIdentityRetry((version) => version + 1),
      onResend: () => void resendVerification(),
      onSignOut: () => void logOut(),
    }}
    profileProps={{ profile, organizationOptions, assignedCompany, setProfile, busy, onSave: (event) => void saveProfile(event), onLocate: locateEmployee, onRequestChange: (message) => void requestProfileChange(message) }}
    basketProps={{ counts, total: totalBaskets, baskets: basketDefinitions, settings: basketSelectionSettings, products, onAdjust: adjustBasket, onContinue: startCustomization }}
    customizationProps={{
      products, quantities, excluded, total: totalBaskets, selected: selectedProducts, progress, busy,
      company: profile.company, branches: organizationOptions.companies.find((company) => company.name === profile.company)?.branches ?? [],
      pickupBranch, onPickupBranchChange: setPickupBranch, totalAmount, hasUnpricedItems,
      exceedsMonthlyLimit, monthlySpendingLimit: profile.monthlySpendingLimit,
      currentMonthlySpent, remainingMonthlyLimit,
      onAdjust: adjustProduct, onExclude: toggleExcluded, onBack: () => setScreen('baskets'),
      onConfirm: () => void confirmOrder(),
    }}
    receiptProps={{
      activeOrder, orders: employeeOrders, products, depositInstructions, onEdit: editOrder,
      onRequestAction: requestOrderAction, onNew: startNewOrder,
      onSelect: setActiveOrder, onHistory: () => setActiveOrder(null),
    }}
    onProfileEdit={editProfile}
    onSwitchWorkspace={() => setScreen((current) => current === 'admin'
      ? profile.name ? 'baskets' : 'profile'
      : 'admin')}
    onSignOut={() => void logOut()}
  />
}

export default App
