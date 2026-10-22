import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { User } from 'firebase/auth'
import {
  Bell, Check, ChevronDown, CircleHelp, ClipboardList, Gift, Home, LogOut, Package,
  Pencil, Settings, ShieldCheck, ShoppingBasket, UserRound, X,
} from 'lucide-react'
import { AdminConsole } from './AdminConsole'
import {
  BasketCustomization, BasketSelection, Brand, EmployeeProfileForm, LoginPanel, ReceiptView,
  type BasketSelectionProps, type CustomizationProps, type LoginProps, type ProfileFormProps,
  type ReceiptProps,
} from './EmployeeScreens'
import {
  defaultOrganizationOptions, orderStatusLabels, type CatalogProduct, type EmployeeProfile, type Order,
  type OrderStatus, type OrganizationOptions, type Screen,
} from './domain'

export type PageTitle = { eyebrow: string; title: string; description: string }
export type Stage = { title: string; active: boolean; done: boolean }
export type AppNotification = {
  id: string
  orderId: string
  status: OrderStatus
  updatedAt: string
}

type NotificationPopup = { key: string; notification: AppNotification }

let notificationAudioContext: AudioContext | null = null

async function playNotificationSound(): Promise<void> {
  if (typeof window === 'undefined' || !window.AudioContext) return
  notificationAudioContext ??= new AudioContext()
  const context = notificationAudioContext
  if (context.state === 'suspended') await context.resume()
  const oscillator = context.createOscillator()
  const volume = context.createGain()
  const start = context.currentTime
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(740, start)
  oscillator.frequency.setValueAtTime(880, start + 0.09)
  volume.gain.setValueAtTime(0.0001, start)
  volume.gain.exponentialRampToValueAtTime(0.07, start + 0.015)
  volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.24)
  oscillator.connect(volume)
  volume.connect(context.destination)
  oscillator.start(start)
  oscillator.stop(start + 0.25)
}

function loadReadNotificationKeys(uid?: string): Set<string> {
  if (!uid) return new Set()
  try {
    const saved = localStorage.getItem(`natco.notifications.read.${uid}`)
    if (!saved) return new Set()
    const parsed: unknown = JSON.parse(saved)
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')
      ? new Set(parsed.slice(-100))
      : new Set()
  } catch (error) {
    console.warn('Unable to restore notification read state.', error)
    return new Set()
  }
}

function loadDismissedNotificationKeys(uid?: string): Set<string> {
  if (!uid) return new Set()
  try {
    const saved = localStorage.getItem(`natco.notifications.dismissed.${uid}`)
    if (!saved) return new Set()
    const parsed: unknown = JSON.parse(saved)
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')
      ? new Set(parsed.slice(-100))
      : new Set()
  } catch (error) {
    console.warn('Unable to restore dismissed notification state.', error)
    return new Set()
  }
}

const mainTitles: Partial<Record<Screen, PageTitle>> = {
  admin: { eyebrow: 'إدارة مركزية', title: 'لوحة المشرف', description: 'تابع طلبات الموظفين وأدر صور المنتجات والصلاحيات.' },
  profile: { eyebrow: 'خطوتك الأولى', title: 'بيانات الموظف', description: 'معلوماتك تساعدنا نوصل السلة لمكانك بكل سهولة.' },
  baskets: { eyebrow: 'اختيارك يصنع الفرق', title: 'اختر السلال الغذائية', description: 'مسموح لك باختيار سلتين كحد أقصى.' },
  customize: { eyebrow: 'على ذوقك', title: 'تخصيص محتويات السلة', description: 'عدّل الأصناف والكميات بما يناسب احتياجات أسرتك.' },
  receipt: { eyebrow: 'تم بنجاح', title: 'إيصال الاستلام', description: 'احتفظ بالإيصال وأبرزه عند استلام سلتك.' },
  orders: { eyebrow: 'سجل الموظف', title: 'طلباتي السابقة', description: 'اختر رقم الطلب لعرض الإيصال وتفاصيل السلة.' },
}

type AppLayoutProps = {
  screen: Screen
  setScreen: Dispatch<SetStateAction<Screen>>
  profile: EmployeeProfile
  email: string
  isAdmin: boolean
  isEmployee: boolean
  authUser: User | null
  currentYear: number
  firebaseConfigured: boolean
  supportPhone: string
  supportContactUnavailable: boolean
  notice: string
  setNotice: (notice: string) => void
  notificationsLoaded: boolean
  totalBaskets: number
  selectedProducts: number
  employeeOrders: Order[]
  notifications: AppNotification[]
  loginProps: LoginProps
  profileProps: ProfileFormProps
  basketProps: BasketSelectionProps
  customizationProps: CustomizationProps
  receiptProps: Omit<ReceiptProps, 'onShare'>
  onProfileEdit: () => void
  onOrganizationOptionsChange: (options: OrganizationOptions) => void
  onSwitchWorkspace: () => void
  onSignOut: () => void
}

export function AppLayout(props: AppLayoutProps) {
  const { screen, setScreen, profile, email, isAdmin, isEmployee, authUser, currentYear, firebaseConfigured,
    notice, setNotice, totalBaskets, selectedProducts, employeeOrders } = props
  const reduceMotion = useReducedMotion()
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [focusedOrderId, setFocusedOrderId] = useState('')
  const [notificationNavigationRevision, setNotificationNavigationRevision] = useState(0)
  const [readNotificationKeys, setReadNotificationKeys] = useState<Set<string>>(
    () => loadReadNotificationKeys(authUser?.uid),
  )
  const [dismissedNotificationKeys, setDismissedNotificationKeys] = useState<Set<string>>(
    () => loadDismissedNotificationKeys(authUser?.uid),
  )
  const [incomingNotification, setIncomingNotification] = useState<NotificationPopup | null>(null)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    () => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const notificationsRef = useRef<HTMLDivElement>(null)
  const seenNotificationsRef = useRef<{ mode: string; keys: Set<string> } | null>(null)
  const popupTimeoutRef = useRef<number | null>(null)
  const accountName = isEmployee && profile.name
    ? profile.name
    : authUser?.displayName || authUser?.email?.split('@')[0] || 'الحساب'
  const avatarLabel = accountName.trim().charAt(0) || 'م'
  const stages = [
    { title: 'بيانات الموظف', active: screen === 'profile', done: ['baskets', 'customize', 'receipt'].includes(screen) },
    { title: 'اختيار السلال', active: screen === 'baskets', done: ['customize', 'receipt'].includes(screen) },
    { title: 'تخصيص الطلب', active: screen === 'customize', done: screen === 'receipt' },
  ]
  function showPreviousOrders() {
    props.receiptProps.onHistory()
    setScreen('orders')
  }

  const notificationKey = useCallback(
    (notification: AppNotification) =>
      `${authUser?.uid ?? 'anonymous'}:${notification.id}:${notification.updatedAt}`,
    [authUser?.uid],
  )
  const visibleNotifications = props.notifications.filter(
    (notification) => !dismissedNotificationKeys.has(notificationKey(notification)),
  )
  const showAdminNotifications = isAdmin && (!isEmployee || screen === 'admin')
  const unreadCount = visibleNotifications.filter(
    (notification) => !readNotificationKeys.has(notificationKey(notification)),
  ).length

  useEffect(() => {
    if (!accountMenuOpen && !notificationsOpen) return
    function closeOnOutsideClick(event: MouseEvent) {
      if (event.target instanceof Node) {
        if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false)
        if (!notificationsRef.current?.contains(event.target)) setNotificationsOpen(false)
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setAccountMenuOpen(false)
        setNotificationsOpen(false)
      }
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountMenuOpen, notificationsOpen])

  useEffect(() => {
    if (!authUser || !props.notificationsLoaded) {
      seenNotificationsRef.current = null
      return
    }
    const mode = showAdminNotifications ? 'admin' : 'employee'
    const currentKeys = new Set(props.notifications.map(notificationKey))
    const previous = seenNotificationsRef.current
    seenNotificationsRef.current = { mode, keys: currentKeys }
    if (!previous || previous.mode !== mode) return

    const newestNotification = props.notifications.find(
      (notification) => !previous.keys.has(notificationKey(notification)),
    )
    if (!newestNotification) return

    const key = notificationKey(newestNotification)
    if (dismissedNotificationKeys.has(key)) return
    setIncomingNotification({ key, notification: newestNotification })
    if (popupTimeoutRef.current !== null) window.clearTimeout(popupTimeoutRef.current)
    popupTimeoutRef.current = window.setTimeout(() => {
      setIncomingNotification((current) => current?.key === key ? null : current)
    }, 2200)
    void playNotificationSound().catch((error: unknown) => {
      console.warn('Unable to play the new-notification sound. Enable sound from the notification menu.', error)
    })
    if (document.hidden && notificationPermission === 'granted' && typeof Notification !== 'undefined') {
      try {
        new Notification(showAdminNotifications ? 'إشعار جديد من ناتكو' : 'تحديث جديد لطلبك', {
          body: newestNotification.status === 'received'
            ? 'تم استلام طلب جديد.'
            : `حالة الطلب: ${orderStatusLabels[newestNotification.status]}`,
          icon: `${import.meta.env.BASE_URL}natco-logo.jpg`,
          tag: key,
        })
      } catch (error) {
        console.warn('Unable to show the browser notification.', error)
      }
    }
  }, [
    authUser,
    dismissedNotificationKeys,
    notificationKey,
    notificationPermission,
    props.notifications,
    props.notificationsLoaded,
    showAdminNotifications,
  ])

  useEffect(() => () => {
    if (popupTimeoutRef.current !== null) window.clearTimeout(popupTimeoutRef.current)
  }, [])

  function markNotificationsRead(notifications: AppNotification[]) {
    if (!authUser) return
    setReadNotificationKeys((current) => {
      const next = new Set([...current, ...notifications.map(notificationKey)].values())
      const bounded = new Set([...next].slice(-100))
      try {
        localStorage.setItem(
          `natco.notifications.read.${authUser.uid}`,
          JSON.stringify([...bounded]),
        )
      } catch (error) {
        console.warn('Unable to save notification read state.', error)
      }
      return bounded
    })
  }

  function dismissNotifications(notifications: AppNotification[]) {
    if (!authUser || notifications.length === 0) return
    setDismissedNotificationKeys((current) => {
      const next = new Set([...current, ...notifications.map(notificationKey)].values())
      const bounded = new Set([...next].slice(-100))
      try {
        localStorage.setItem(
          `natco.notifications.dismissed.${authUser.uid}`,
          JSON.stringify([...bounded]),
        )
      } catch (error) {
        console.warn('Unable to save dismissed notifications.', error)
      }
      return bounded
    })
  }

  async function enablePhoneNotifications() {
    if (typeof Notification === 'undefined') {
      setNotificationPermission('unsupported')
      setNotice('هذا المتصفح لا يدعم إشعارات النظام. تبقى تنبيهات الجرس داخل التطبيق متاحة.')
      return
    }
    try {
      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)
      if (permission === 'granted') {
        await playNotificationSound()
        setNotice('تم تفعيل إشعارات المتصفح والصوت. يلزم إبقاء التطبيق مفتوحاً لاستقبال التحديثات.')
      } else {
        setNotice('لم يتم منح إذن إشعارات الجهاز. يمكنك تغييره من إعدادات المتصفح.')
      }
    } catch (error) {
      console.error('Unable to request browser notification permission.', error)
      setNotice('تعذر طلب إذن الإشعارات من المتصفح. تحقق من إعدادات الموقع وحاول مجدداً.')
    }
  }

  function openNotification(notification: AppNotification) {
    markNotificationsRead([notification])
    setNotificationsOpen(false)
    if (showAdminNotifications) {
      setFocusedOrderId(notification.orderId)
      setNotificationNavigationRevision((revision) => revision + 1)
      setScreen('admin')
      return
    }

    const order = employeeOrders.find((item) => item.id === notification.orderId)
    if (order) props.receiptProps.onSelect(order)
    else {
      setScreen('orders')
      setNotice('تعذر تحميل تفاصيل هذا الطلب الآن. حدّث سجل الطلبات ثم حاول مجدداً.')
    }
  }

  function openIncomingNotification() {
    if (!incomingNotification) return
    const notification = props.notifications.find(
      (item) => notificationKey(item) === incomingNotification.key,
    )
    setIncomingNotification(null)
    if (popupTimeoutRef.current !== null) window.clearTimeout(popupTimeoutRef.current)
    if (notification) openNotification(notification)
  }

  function switchWorkspace() {
    setAccountMenuOpen(false)
    props.onSwitchWorkspace()
  }

  function editProfile() {
    setAccountMenuOpen(false)
    props.onProfileEdit()
  }

  function signOut() {
    setAccountMenuOpen(false)
    props.onSignOut()
  }

  function contactSupport() {
    if (!props.supportPhone) {
      setNotice(props.supportContactUnavailable
        ? 'تعذر تحميل رقم المساعدة. تحقق من صلاحيات إعدادات Firestore أو تواصل مع إدارة الموارد البشرية.'
        : 'لم يتم إعداد رقم المساعدة بعد. تواصل مع إدارة الموارد البشرية.')
      return
    }
    window.location.href = `tel:${props.supportPhone}`
  }

  return <div className={`app-shell${authUser ? ' has-auth-session' : ''}${authUser && screen !== 'admin' ? ' has-mobile-nav' : ''}`} dir="rtl">
    <aside className="sidebar">
      <div className="sidebar-brand"><Brand /></div>
      <div className="sidebar-caption">{screen === 'admin' ? 'إدارة ناتكو المركزية' : 'بوابة خدمات الموظفين'}</div>
      <nav className="side-nav" aria-label="التنقل الرئيسي">
        {authUser && (screen === 'admin' ? <button className="nav-link selected" onClick={() => setScreen('admin')}><ShieldCheck size={19} /><span>لوحة المشرف</span><span className="nav-dot" /></button> : <>
          <button className={['profile', 'baskets', 'customize', 'receipt'].includes(screen) ? 'nav-link selected' : 'nav-link'} onClick={() => screen !== 'email' && setScreen('baskets')}>
            <Home size={19} /><span>السلال الغذائية</span>{screen !== 'email' && <span className="nav-dot" />}
          </button>
          <button className={screen === 'orders' ? 'nav-link selected' : 'nav-link'} onClick={showPreviousOrders}>
            <ClipboardList size={19} /><span>طلباتي السابقة</span>
            {employeeOrders.length > 0 && <span className="nav-count">{employeeOrders.length}</span>}
          </button>
          <button className="nav-link" onClick={contactSupport}>
            <CircleHelp size={19} /><span>المساعدة والدعم</span>
          </button>
        </>)}
      </nav>
      <div className="side-bottom">
        <div className="privacy-card">
          <span className="privacy-icon"><ShieldCheck size={18} /></span>
          <strong>{firebaseConfigured ? 'خدمات الحساب نشطة' : 'الخدمة غير متاحة حالياً'}</strong>
          <p>{firebaseConfigured ? 'بيانات حسابك وطلباتك محمية.' : 'تسجيل الدخول غير متاح الآن. حاول مجدداً لاحقاً.'}</p>
        </div>
        <span className="side-version">Natco Consumables <span>© {currentYear}</span></span>
      </div>
    </aside>

    <div className="page-column">
      <header className="topbar">
        <div className="mobile-brand"><Brand compact /></div>
        <div className="breadcrumb"><span>بوابة الموظفين</span><i>/</i><b>{screen === 'email' ? 'الرئيسية' : mainTitles[screen]?.title}</b></div>
        <div className="topbar-actions">
          <span className="topbar-season"><span className="season-dot" /> برنامج السلال الدوري</span>
          {authUser && (isAdmin || isEmployee) && <div className="notification-wrap" ref={notificationsRef}>
            <button
              className="notification-button"
              type="button"
              aria-label={unreadCount ? `الإشعارات، ${unreadCount} غير مقروءة` : 'الإشعارات'}
              aria-haspopup="dialog"
              aria-expanded={notificationsOpen}
              onClick={() => {
                const nextOpen = !notificationsOpen
                setNotificationsOpen(nextOpen)
                if (nextOpen) markNotificationsRead(props.notifications)
              }}
            >
              <Bell size={19} />
              {unreadCount > 0 && <span className="notification-count">{unreadCount > 9 ? '٩+' : unreadCount.toLocaleString('ar')}</span>}
            </button>
            <AnimatePresence>
              {incomingNotification && <motion.div
                className="notification-popup"
                initial={reduceMotion ? false : { opacity: 0, y: -14, scale: 0.92, height: 0 }}
                animate={{ opacity: 1, y: 8, scale: 1, height: 'auto' }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96, height: 0 }}
                transition={reduceMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 350, damping: 26 }}
                aria-live="polite"
              >
                <button type="button" className="notification-popup-open" onClick={openIncomingNotification}>
                  <span className={`notification-item-icon status-${incomingNotification.notification.status}`}><Bell size={16} /></span>
                  <span className="notification-item-copy">
                    <strong>{showAdminNotifications ? 'إشعار جديد من الموظفين' : 'لديك تحديث جديد'}</strong>
                    <small>
                      {incomingNotification.notification.status === 'received'
                        ? showAdminNotifications ? 'تم استلام طلب جديد أو تعديل.' : 'تم استلام طلبك بنجاح.'
                        : `حالة الطلب: ${orderStatusLabels[incomingNotification.notification.status]}`}
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  className="notification-popup-close"
                  aria-label="إغلاق الإشعار"
                  onClick={(event) => {
                    event.stopPropagation()
                    setIncomingNotification(null)
                  }}
                ><X size={14} /></button>
              </motion.div>}
            </AnimatePresence>
            {notificationsOpen && <motion.div
              className="notification-panel"
              role="dialog"
              aria-label="آخر الإشعارات"
              initial={reduceMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            >
              <div className="notification-panel-heading">
                <div><strong>الإشعارات</strong><small>{showAdminNotifications ? 'مستجدات الطلبات' : 'تحديثات طلباتك'}</small></div>
                <div className="notification-heading-actions">
                  {unreadCount > 0 && <button type="button" onClick={() => markNotificationsRead(visibleNotifications)}>تمت القراءة</button>}
                  {visibleNotifications.length > 0 && <button type="button" className="notification-clear-button" onClick={() => dismissNotifications(visibleNotifications)}>حذف الكل</button>}
                </div>
              </div>
              <div className="notification-settings">
                {notificationPermission === 'default' && <button type="button" onClick={() => void enablePhoneNotifications()}>تفعيل إشعارات الجهاز</button>}
                {notificationPermission === 'granted' && <span><Check size={13} /> إذن إشعارات المتصفح مفعّل</span>}
                {notificationPermission === 'denied' && <span>إذن إشعارات الجهاز مرفوض؛ فعّله من إعدادات المتصفح.</span>}
                {notificationPermission === 'unsupported' && <span>إشعارات النظام غير مدعومة في هذا المتصفح.</span>}
                <button type="button" onClick={() => void playNotificationSound().catch(() => setNotice('تعذر تشغيل الصوت؛ تحقق من إعدادات الصوت في الجهاز.'))}>اختبار الصوت</button>
              </div>
              {visibleNotifications.length === 0
                ? <div className="notification-empty"><Bell size={20} /><span>لا توجد إشعارات حتى الآن.</span></div>
                : <div className="notification-list">
                  {visibleNotifications.map((notification) => {
                    const order = employeeOrders.find((item) => item.id === notification.orderId)
                    const reference = order?.reference ?? `NATCO-${notification.orderId.slice(-6).toUpperCase()}`
                    const isReceived = notification.status === 'received'
                    const title = showAdminNotifications
                      ? isReceived ? 'طلب جديد أو تعديل من الموظف' : 'تحديث حالة طلب'
                      : isReceived ? 'تم استلام طلبك' : 'تحديث حالة طلبك'
                    const message = showAdminNotifications
                      ? `${reference} · ${isReceived ? 'بانتظار المراجعة' : orderStatusLabels[notification.status]}`
                      : `${reference} · ${orderStatusLabels[notification.status]}`
                    return <div className="notification-row" key={notificationKey(notification)}>
                      <button
                        type="button"
                        className="notification-item"
                        onClick={() => openNotification(notification)}
                      >
                        <span className={`notification-item-icon status-${notification.status}`}><ClipboardList size={16} /></span>
                        <span className="notification-item-copy">
                          <strong>{title}</strong><small>{message}</small>
                          <time>{new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.updatedAt))}</time>
                        </span>
                        <ChevronDown className="notification-item-arrow" size={15} />
                      </button>
                      <button
                        className="notification-dismiss"
                        type="button"
                        aria-label={`حذف إشعار ${reference}`}
                        onClick={() => dismissNotifications([notification])}
                      ><X size={14} /></button>
                    </div>
                  })}
                </div>}
            </motion.div>}
          </div>}
          {authUser && <div className="account-menu-wrap" ref={accountMenuRef}>
            <button
              className="account-menu-trigger"
              type="button"
              aria-label="فتح إعدادات الحساب"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              <span className="avatar">{avatarLabel}</span>
              <span className="account-trigger-name">{accountName}</span>
              <ChevronDown size={14} />
            </button>
            {accountMenuOpen && <div className="account-menu" role="menu" aria-label="إعدادات الحساب">
              <div className="account-menu-heading">
                <span><Settings size={13} /> إعدادات الحساب</span>
                <strong>{accountName}</strong>
                <small dir="ltr">{authUser.email ?? email}</small>
              </div>
              {isEmployee && <button type="button" role="menuitem" onClick={editProfile}><Pencil size={15} /> الملف الشخصي</button>}
              {isAdmin && (screen !== 'admin' || isEmployee) && <button type="button" role="menuitem" onClick={switchWorkspace}>
                {screen === 'admin'
                  ? <><UserRound size={15} /> حساب الموظف</>
                  : <><ShieldCheck size={15} /> لوحة المشرف</>}
              </button>}
              <button className="account-menu-signout" type="button" role="menuitem" onClick={signOut}><LogOut size={15} /> تسجيل الخروج</button>
            </div>}
          </div>}
        </div>
      </header>

      <main className="main-content">
        {screen !== 'admin' && <motion.div
          className="welcome-banner"
          initial={reduceMotion ? false : { opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="banner-copy">
            <span className="banner-label"><Gift size={15} /> عطاء يوصل لبيتك</span>
            <h1>{profile.name ? `مرحباً بك، ${profile.name.split(' ')[0]}` : 'مرحباً بك!'}</h1>
            <p>نهتم براحتك وبراحة أسرتك — سلتك على بُعد خطوات.</p>
          </div>
          <div className="banner-art" aria-hidden="true">
            <div className="art-sun" /><div className="art-bag"><ShoppingBasket size={76} strokeWidth={1.15} /></div>
            <div className="art-leaf art-leaf-one" /><div className="art-leaf art-leaf-two" />
            <span className="art-spark spark-one">✳</span><span className="art-spark spark-two">✳</span>
          </div>
        </motion.div>}

        {screen !== 'email' && screen !== 'admin' && screen !== 'orders' && <motion.div
          className="stepper"
          aria-label="مراحل الطلب"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.3 }}
        >
          {stages.map((stage, index) => <div className={`step ${stage.active ? 'active' : ''} ${stage.done ? 'done' : ''}`} key={stage.title}>
            <span className="step-circle">{stage.done ? <Check size={15} /> : `0${index + 1}`}</span>
            <span className="step-label">{stage.title}</span>
            {index < stages.length - 1 && <span className={`step-line${stage.done ? ' complete' : ''}`} />}
          </div>)}
        </motion.div>}

        <motion.section
          key={screen}
          className="content-section"
          initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.995 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 280, damping: 28 }}
        >
          {screen !== 'admin' && <div className="section-heading">
            <div>
              {mainTitles[screen] && <span className="eyebrow">{mainTitles[screen]?.eyebrow}</span>}
              <h2>{mainTitles[screen]?.title ?? 'ابدأ رحلتك مع ناتكو'}</h2>
              <p>{mainTitles[screen]?.description ?? 'سجّل دخولك برقم الهاتف وكلمة المرور للوصول إلى سلتك الغذائية.'}</p>
            </div>
            {screen === 'baskets' && <span className="quota-chip"><ShoppingBasket size={15} /> {totalBaskets} من 2 سلة</span>}
            {screen === 'customize' && <span className="quota-chip"><Package size={15} /> {selectedProducts} أصناف مختارة</span>}
          </div>}

          {screen === 'email' && <LoginPanel {...props.loginProps} />}
          {screen === 'profile' && <EmployeeProfileForm {...props.profileProps} />}
          {screen === 'baskets' && <BasketSelection {...props.basketProps} />}
          {screen === 'customize' && <BasketCustomization {...props.customizationProps} />}
          {(screen === 'receipt' || screen === 'orders') && <ReceiptView
            {...props.receiptProps}
            onShare={() => shareOrderReceipt(props.receiptProps.activeOrder, props.receiptProps.products)}
            showHistory={screen === 'orders'}
          />}
          {screen === 'admin' && isAdmin && authUser && <AdminConsole
            key={notificationNavigationRevision}
            user={authUser}
            focusOrderId={focusedOrderId}
            onNotice={setNotice}
            onOrganizationOptionsChange={props.onOrganizationOptionsChange}
            organizationOptions={props.profileProps.organizationOptions ?? defaultOrganizationOptions}
          />}
        </motion.section>

        <footer className="page-footer"><span>© {currentYear} Natco Consumables</span><span><i /> جزء من مجموعة هائل سعيد أنعم</span></footer>
      </main>
      {authUser && screen !== 'admin' && <nav className="mobile-nav" aria-label="التنقل السريع">
        <button onClick={() => screen !== 'email' && setScreen('baskets')}><Home size={17} /><span>السلال</span></button>
        <button onClick={showPreviousOrders}><ClipboardList size={17} /><span>طلباتي</span></button>
        <button onClick={contactSupport}><CircleHelp size={17} /><span>مساعدة</span></button>
      </nav>}
    </div>
    {notice && <div className="toast" role="status"><span className="toast-mark"><Check size={15} /></span>{notice}<button aria-label="إغلاق التنبيه" onClick={() => setNotice('')}><X size={15} /></button></div>}
  </div>
}

function shareOrderReceipt(activeOrder: Order | null, products: CatalogProduct[]) {
  if (!activeOrder) return
  const itemSummary = Object.entries(activeOrder.items)
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => `${activeOrder.itemDetails[id]?.name ?? products.find((product) => product.id === id)?.name ?? 'صنف'} × ${amount}`)
    .join('، ')
  const message = `إيصال استلام ناتكو الاستهلاكية\nرقم الطلب: ${activeOrder.reference}\nالموظف: ${activeOrder.profile.name}\nالفرع: ${activeOrder.profile.branch}\nالأصناف: ${itemSummary}\nالحالة: ${orderStatusLabels[activeOrder.status]}`
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
}
