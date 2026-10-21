import { useEffect, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signOut,
} from 'firebase/auth'
import {
  collection, doc, getDoc, onSnapshot, query, serverTimestamp, writeBatch,
  setDoc, where,
} from 'firebase/firestore'
import { AppLayout } from './AppLayout'
import { firebaseAuth, firebaseConfigured, firebaseErrorMessage, firestore } from './firebase'
import {
  blankProfile, parseCatalogProduct, parseOrder, parseProfile, productAgentPrice,
  defaultBasketDefinitions, defaultBasketSelectionSettings, defaultOrganizationOptions,
  parseBasketDefinition, parseOrganizationOptions, type BasketCounts, type CatalogProduct, type EmployeeProfile, type Order,
  type OrganizationOptions, type Screen,
} from './domain'
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
    ...(typeof rosterData.name === 'string' && !savedProfile?.name ? { name: rosterData.name } : {}),
    ...(typeof rosterData.address === 'string' && !savedProfile?.address ? { address: rosterData.address } : {}),
    ...(typeof rosterData.phone === 'string' && !savedProfile?.phone ? { phone: rosterData.phone } : {}),
    ...(typeof rosterData.whatsapp === 'string' && !savedProfile?.whatsapp ? { whatsapp: rosterData.whatsapp } : {}),
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

function orderSubmissionErrorMessage(error: unknown, stage: string, traceId: string): string {
  const failure = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown }
    : null
  const code = typeof failure?.code === 'string' ? failure.code : 'unknown'
  const details = typeof failure?.message === 'string'
    ? failure.message.replace(/\s+/g, ' ').trim().slice(0, 180)
    : firebaseErrorMessage(error)
  const cause = code === 'permission-denied'
    ? 'رفضت قواعد Firestore الكتابة.'
    : 'تعذر حفظ الطلب في Firestore.'
  return `${cause} رمز Firebase: ${code}. المرحلة: ${stage}. رقم التتبع: ${traceId}. التفاصيل: ${details}`
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
      const normalizedEmail = user.email?.trim().toLowerCase()
      if (!normalizedEmail) throw new Error('The signed-in Firebase user has no email address.')
      const adminSnapshot = await getDoc(doc(database, 'admin_users', user.uid))
      const hasAdminAccess = adminSnapshot.exists() && adminSnapshot.data().active === true
      if (hasAdminAccess) {
        if (!current) return
        setEmail(normalizedEmail)
        setIsAdmin(true)
        setIsEmployee(false)
        setScreen('admin')

        if (!user.emailVerified) return
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
      if (!user.emailVerified) {
        if (current) setIdentityIssue('تحقق من بريدك الإلكتروني من الرسالة التي أرسلناها إليك، ثم سجّل الدخول مجدداً.')
        return
      }
      const rosterSnapshot = await getDoc(doc(database, 'employee_roster', normalizedEmail))
      const hasEmployeeAccess = rosterSnapshot.exists() && rosterSnapshot.data().active === true
      if (!hasEmployeeAccess) {
        if (current) setIdentityIssue('لم يُعتمد هذا الحساب كموظف بعد. راجع مسؤول الموارد البشرية.')
        return
      }
      const profileSnapshot = await getDoc(doc(database, 'employees', user.uid))
      if (!current) return
      const savedProfile = profileSnapshot.exists() ? parseProfile(profileSnapshot.data()) : null
      setEmail(normalizedEmail)
      setIsAdmin(false)
      setIsEmployee(true)
      const rosterData = rosterSnapshot.data()
      setAssignedCompany(typeof rosterData.company === 'string' ? rosterData.company : '')
      const currentProfile = buildEmployeeProfile(savedProfile, rosterData, normalizedEmail)
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
    return onSnapshot(
      doc(firestore, 'admin_users', authUser.uid),
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
    if (!isEmployee || !authUser || !firestore) return
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
      query(collection(firestore, 'orders'), where('uid', '==', authUser.uid)),
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
  }, [isEmployee, authUser])

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
      setNotice(!firebaseAuth ? 'تسجيل الدخول غير متاح حالياً. حاول مجدداً لاحقاً.' : 'أدخل بريداً إلكترونياً وكلمة مرور صحيحة.')
      return
    }
    setBusy(true)
    try {
      await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, password)
      setPassword('')
    } catch (error) {
      console.error('Firebase sign-in failed.', error)
      setNotice(firebaseErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function registerEmployee() {
    if (!firebaseAuth || !email.trim() || password.length < 8) {
      setNotice('أدخل بريدك الإلكتروني وكلمة مرور من ٨ أحرف على الأقل.')
      return
    }
    setBusy(true)
    try {
      const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password)
      await sendEmailVerification(credential.user)
      await signOut(firebaseAuth)
      setPassword('')
      setNotice('أرسلنا رسالة تحقق إلى بريدك. بعد التحقق، سجّل الدخول وانتظر اعتماد الموارد البشرية.')
    } catch (error) {
      console.error('Firebase employee account registration failed.', error)
      setNotice(firebaseErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword() {
    if (!firebaseAuth || !email.trim()) {
      setNotice('أدخل بريدك الإلكتروني لإرسال رابط إعادة تعيين كلمة المرور.')
      return
    }
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase())
      setNotice('تم إرسال رابط إعادة تعيين كلمة المرور إذا كان الحساب مسجلاً.')
    } catch (error) {
      console.error('Firebase password reset request failed.', error)
      setNotice(firebaseErrorMessage(error))
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile.employeeCode.trim() || !profile.name.trim() || !profile.company ||
      !profile.branch || !profile.address.trim() || !profile.phone.trim() || !profile.whatsapp.trim()) {
      setNotice('أكمل الحقول المطلوبة قبل المتابعة.')
      return
    }
    if (!/^\+?[\d\s()-]{8,18}$/.test(profile.phone) || !/^\+?[\d\s()-]{8,18}$/.test(profile.whatsapp)) {
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
        email: authUser.email?.toLowerCase() ?? '',
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
    if (!firestore || !authUser?.email) {
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
        email: authUser.email.toLowerCase(),
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
    if (exceedsMonthlyLimit) {
      setNotice('إجمالي الطلب يتجاوز المتبقي من سقفك الشهري. راجع الأصناف أو تواصل مع مسؤول الموارد البشرية.')
      return
    }
    if (!pickupBranch) {
      setNotice('اختر فرع الاستلام المفضل قبل تأكيد الطلب.')
      return
    }
    const currentPeriod = currentSpendingPeriod()
    if (typeof profile.monthlySpendingLimit === 'number' &&
      profile.spendingPeriod !== currentPeriod &&
      (Boolean(profile.spendingPeriod) || currentMonthlySpent > 0)) {
      setNotice('انتهت فترة الإنفاق المسجلة. يرجى التواصل مع المشرف لتصفير رصيد الشهر الجديد قبل تأكيد الطلب.')
      return
    }
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
      const rosterRef = doc(firestore, 'employee_roster', authUser.email?.trim().toLowerCase() ?? profile.email)
      const previousAmount = activeOrder?.totalAmount ?? 0
      const nextMonthlySpent = (profile.currentMonthlySpent ?? 0) + totalAmount - previousAmount
      if (nextMonthlySpent < 0) {
        setNotice('تعذر مطابقة قيمة الطلب السابق مع الإنفاق الشهري. راجع المشرف لتصحيح الرصيد.')
        return
      }
      const orderData = {
        reference: editingOrderId
          ? activeOrder?.reference ?? `NATCO-${orderRef.id.slice(-6).toUpperCase()}`
          : `NATCO-${orderRef.id.slice(-6).toUpperCase()}`,
        uid: authUser.uid,
        email: authUser.email?.toLowerCase() ?? profile.email.toLowerCase(),
        employeeCode: profile.employeeCode,
        profile,
        baskets: { ...counts },
        basketSelections: Object.entries(counts).flatMap(([basketId, amount]) =>
          Array.from({ length: amount }, () => basketId)),
        items: { ...quantities },
        itemDetails,
        excluded: [...excluded],
        pickupBranch,
        totalAmount,
        currency: 'YER',
      }
      const ledgerUpdate = {
        currentMonthlySpent: nextMonthlySpent,
        spendingPeriod: profile.spendingPeriod || currentPeriod,
        lastSpendOrderId: orderRef.id,
      }
      if (editingOrderId) {
        const batch = writeBatch(firestore)
        batch.update(orderRef, { ...orderData, updatedAt: serverTimestamp() })
        batch.update(rosterRef, ledgerUpdate)
        failureStage = 'حفظ تعديل الطلب وتحديث سجل الإنفاق ذرياً'
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
        failureStage = 'حفظ الطلب وتحديث سجل الإنفاق ذرياً'
        await batch.commit()
      }
      failureStage = 'إضافة إشعار الإدارة'
      let notificationQueued = true
      try {
        await setDoc(notificationRef, {
          orderId: orderRef.id,
          uid: authUser.uid,
          status: 'pending',
          ...(editingOrderId ? { eventStatus: 'received', updatedAt: serverTimestamp() } : {}),
          createdAt: serverTimestamp(),
        }, { merge: true })
      } catch (error) {
        notificationQueued = false
        console.error('The order was saved, but its notification could not be queued.', error)
      }
      failureStage = 'إضافة تحديث مزامنة Google Sheets'
      let sheetSyncQueued = true
      try {
        await setDoc(doc(firestore, 'employee_sync_queue', profile.email.toLowerCase()), {
          email: profile.email.toLowerCase(),
          status: 'pending',
          updatedAt: serverTimestamp(),
        })
      } catch (error) {
        sheetSyncQueued = false
        console.error('The order was saved, but employee Sheet synchronization could not be queued.', error)
      }
      setProfile((current) => ({
        ...current,
        currentMonthlySpent: nextMonthlySpent,
        spendingPeriod: profile.spendingPeriod || currentPeriod,
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
      setNotice(!notificationQueued
        ? 'تم تأكيد طلبك وحُفظ الإنفاق، لكن تعذر إرسال إشعار الإدارة. سيظل الطلب ظاهرًا في لوحة الإدارة.'
        : !sheetSyncQueued
          ? 'تم تأكيد طلبك وحُفظ الإنفاق، لكن تعذرت إضافة تحديث Google Sheets. أبلغ مسؤول النظام لمزامنة السجل.'
          : 'تم تأكيد طلبك. سيظهر للمسؤولين في لوحة الإدارة ويُرسل إشعارهم بعد المزامنة.')
    } catch (error) {
      console.error('Unable to submit the employee order to Firestore.', {
        stage: failureStage,
        traceId,
        error,
      })
      setNotice(orderSubmissionErrorMessage(error, failureStage, traceId))
    } finally {
      setBusy(false)
    }
  }

  function editProfile() {
    setProfileReturn(screen)
    setScreen('profile')
  }

  function editOrder(order: Order) {
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
      emailVerified: authUser?.emailVerified ?? false,
      identityReady,
      identityIssue,
      email,
      setEmail,
      password,
      setPassword,
      busy,
      configured: firebaseConfigured,
      onClearIssue: () => setIdentityIssue(''),
      onSignIn: (event) => void signIn(event),
      onRegister: () => void registerEmployee(),
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
      activeOrder, orders: employeeOrders, products, depositInstructions, onEdit: editOrder, onNew: startNewOrder,
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
