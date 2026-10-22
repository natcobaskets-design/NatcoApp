import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
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
  type OrganizationOptions, type Screen,
} from './domain'

export type PageTitle = { eyebrow: string; title: string; description: string }
export type Stage = { title: string; active: boolean; done: boolean }

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
  totalBaskets: number
  selectedProducts: number
  employeeOrders: Order[]
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
  const accountMenuRef = useRef<HTMLDivElement>(null)
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
  useEffect(() => {
    if (!accountMenuOpen) return
    function closeOnOutsideClick(event: MouseEvent) {
      if (event.target instanceof Node && !accountMenuRef.current?.contains(event.target)) {
        setAccountMenuOpen(false)
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setAccountMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountMenuOpen])

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
          <button className="notification-button" aria-label="التنبيهات" onClick={() => setNotice('لا توجد تنبيهات جديدة.')}><Bell size={19} /><span /></button>
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
            user={authUser}
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
