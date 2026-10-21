import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft, ArrowRight, BadgeCheck, Check, ChevronDown, Clock3, FileCheck2,
  LocateFixed, LogOut, MapPin, Minus, Package, Plus, ShieldCheck, ShoppingBasket,
  Trash2, X,
} from 'lucide-react'
import {
  basketIcons, formatYER, orderStatusLabels, productAgentPrice, productIcons,
  productDepartments, type BasketCounts, type BasketDefinition, type BasketSelectionSettings,
  type CatalogProduct, type EmployeeProfile, type Order, type OrganizationOptions, type ProductDepartmentId,
} from './domain'

export type LoginProps = {
  hasSession: boolean
  emailVerified: boolean
  identityReady: boolean
  identityIssue: string
  email: string
  setEmail: Dispatch<SetStateAction<string>>
  password: string
  setPassword: Dispatch<SetStateAction<string>>
  phone: string
  setPhone: Dispatch<SetStateAction<string>>
  busy: boolean
  configured: boolean
  onClearIssue: () => void
  onSignIn: (event: FormEvent<HTMLFormElement>) => void
  onEmployeeSignIn: (event: FormEvent<HTMLFormElement>) => void
  onReset: () => void
  onRetry: () => void
  onResend: () => void
  onSignOut: () => void
}

export function LoginPanel(props: LoginProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [adminLoginMode, setAdminLoginMode] = useState(false)
  return <div className="panel login-panel">
    <div className="login-illustration">
      <div className="login-orbit"><div className="login-basket"><ShoppingBasket size={42} /></div><span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" /><span className="orbit-dot dot-three" /></div>
      <strong>أهلاً بك في عائلة ناتكو</strong><p>طلبك أسهل، وسلتك أقرب.</p>
    </div>
    <div className="login-form">
      <span className="eyebrow">دخول الموظفين</span>
      {props.hasSession && !props.identityReady ? <div className="identity-loading"><strong>جارٍ التحقق من صلاحيات الحساب…</strong></div> :
        props.hasSession && props.identityIssue ? <div className="identity-message"><ShieldCheck size={22} /><strong>تعذر منح الوصول</strong><p>{props.identityIssue}</p>
          {!props.emailVerified && <button className="secondary-button" onClick={props.onResend}>إعادة إرسال رسالة التحقق</button>}
          {props.emailVerified && <button className="secondary-button" onClick={props.onRetry}>إعادة التحقق من الصلاحيات</button>}
          <button className="text-button" onClick={props.onSignOut}><LogOut size={15} /> تسجيل الخروج</button>
        </div> :
          <>
            <h3>أهلاً بك في بوابة ناتكو</h3>
            <p className="form-intro">{adminLoginMode
              ? 'دخول المشرفين والحسابات القديمة باستخدام البريد الإلكتروني.'
              : 'أدخل رقم الهاتف المعتمد وكلمة المرور التي سلّمها لك المشرف.'}</p>
            {!props.configured && <div className="firebase-warning"><strong>الخدمة غير متاحة حالياً</strong><small>يتعذر تسجيل الدخول الآن. حاول مرة أخرى لاحقاً أو تواصل مع الدعم.</small></div>}
            {props.identityIssue && !props.hasSession && <div className="auth-inline-error" role="alert">{props.identityIssue}<button onClick={props.onClearIssue} aria-label="إغلاق"><X size={14} /></button></div>}
            {adminLoginMode ? <>
              <form className="auth-fields" onSubmit={props.onSignIn}>
                <label className="field"><span>البريد الإلكتروني <b className="required">*</b></span>
                  <input autoComplete="username" type="email" required value={props.email} onChange={(event) => props.setEmail(event.target.value)} placeholder="name@company.com" dir="ltr" />
                </label>
                <label className="field"><span>كلمة المرور <b className="required">*</b></span>
                  <span className="password-input-wrap" dir="ltr">
                    <input autoComplete="current-password" type={showPassword ? 'text' : 'password'} required value={props.password} onChange={(event) => props.setPassword(event.target.value)} placeholder="••••••••" />
                    <button
                      className="password-visibility"
                      type="button"
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >{showPassword ? 'إخفاء' : 'إظهار'}</button>
                  </span>
                </label>
                <button className="primary-button" type="submit" disabled={!props.configured || props.busy}>{props.busy ? 'جارٍ التحقق…' : 'تسجيل الدخول'} <ArrowLeft size={18} /></button>
              </form>
              <div className="auth-secondary-actions">
                <button className="text-button" disabled={props.busy} onClick={() => setAdminLoginMode(false)}>العودة إلى دخول الموظفين بالهاتف وكلمة المرور</button>
                <button className="text-button" disabled={!props.configured || props.busy} onClick={props.onReset}>استعادة كلمة مرور المشرف بالبريد</button>
              </div>
            </> : <>
              <form className="auth-fields" onSubmit={props.onEmployeeSignIn}>
                <label className="field"><span>رقم الهاتف مع رمز الدولة <b className="required">*</b></span>
                  <input autoComplete="username" type="tel" inputMode="tel" required value={props.phone} onChange={(event) => props.setPhone(event.target.value)} placeholder="+9677XXXXXXXX" dir="ltr" />
                  <small>أدخل الرقم المسجل لدى الموارد البشرية بصيغته الدولية.</small>
                </label>
                <label className="field"><span>كلمة المرور <b className="required">*</b></span>
                  <span className="password-input-wrap" dir="ltr">
                    <input autoComplete="current-password" type={showPassword ? 'text' : 'password'} required value={props.password} onChange={(event) => props.setPassword(event.target.value)} placeholder="••••••••" />
                    <button
                      className="password-visibility"
                      type="button"
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >{showPassword ? 'إخفاء' : 'إظهار'}</button>
                  </span>
                </label>
                <button className="primary-button" type="submit" disabled={!props.configured || props.busy}>{props.busy ? 'جارٍ تسجيل الدخول…' : 'تسجيل الدخول'} <ArrowLeft size={18} /></button>
              </form>
              <div className="auth-secondary-actions">
                <button className="text-button" disabled={props.busy} onClick={() => setAdminLoginMode(true)}>دخول المشرف بالبريد الإلكتروني</button>
              </div>
              <div className="local-note"><ShieldCheck size={16} /> لا يُرسل رمز SMS. ينشئ المشرف حساب الموظف مسبقاً ويسلّمه كلمة المرور. عند نسيانها، تواصل مع المشرف لإعادة ضبطها من بيئة إدارية موثوقة.</div>
            </>}
          </>}
    </div>
  </div>
}

export type ProfileFormProps = {
  profile: EmployeeProfile
  organizationOptions?: OrganizationOptions
  assignedCompany?: string
  setProfile: Dispatch<SetStateAction<EmployeeProfile>>
  busy: boolean
  onSave: (event: FormEvent<HTMLFormElement>) => void
  onLocate: () => void
  onRequestChange: (message: string) => void
}

export function EmployeeProfileForm({
  profile, assignedCompany = '', setProfile, busy,
  onSave, onLocate, onRequestChange,
}: ProfileFormProps) {
  const [requestMessage, setRequestMessage] = useState('')
  const input = (label: string, key: keyof EmployeeProfile, placeholder: string) => (
    <label className="field" key={key}><span>{label} {(key !== 'phone' || profile.phone) && <b className="required">*</b>}</span>
      <input required={key !== 'phone' || Boolean(profile.phone)} readOnly={key === 'phone'} type="text" value={profile[key]} placeholder={placeholder} onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))} />
      {key === 'phone' && <small>تعديل رقم الهاتف المرتبط بتسجيل الدخول يتم عن طريق المشرف.</small>}
    </label>
  )
  return <form className="panel profile-panel" onSubmit={onSave}>
    <div className="form-grid">
      <label className="field"><span>الكود الوظيفي</span><input readOnly value={profile.employeeCode} placeholder="يحدده المشرف" /></label>
      {input('الاسم الكامل', 'name', 'الاسم كما في البطاقة الوظيفية')}
      <label className="field"><span>الشركة التابعة</span><input readOnly value={profile.company} placeholder="يحددها المشرف" /></label>
      <label className="field"><span>الفرع</span><input readOnly value={profile.branch} placeholder="يحدده المشرف" /></label>
      <label className="field"><span>المحافظة</span><input readOnly value={profile.province ?? ''} placeholder="يحددها المشرف" /></label>
      <label className="field field-wide"><span>العنوان التفصيلي للتوصيل <b className="required">*</b></span>
        <input required value={profile.address} onChange={(event) => setProfile((current) => ({ ...current, address: event.target.value }))} placeholder="الحي، الشارع، أقرب معلم" />
      </label>
      <div className="field field-wide"><span>موقع التوصيل على الخريطة</span>
        <button type="button" className="location-button" onClick={onLocate} disabled={busy}><span className="location-pin"><MapPin size={18} /></span><span className="location-text"><strong>{profile.coordinates || 'حدد موقعك بدقة'}</strong><small>{profile.coordinates ? 'الإحداثيات محفوظة مع بياناتك' : 'استخدم موقعك الحالي لتسهيل التوصيل'}</small></span><span className="gps-button"><LocateFixed size={17} />{busy ? 'جارٍ التحديد…' : 'تحديد الموقع'}</span></button>
      </div>
      {input('رقم الهاتف', 'phone', '+967 7XX XXX XXX')}
      {input('رقم واتساب', 'whatsapp', '+967 7XX XXX XXX')}
      {assignedCompany && <div className="employee-spending-note field-wide">
        <strong>الشركة المعتمدة: {assignedCompany}</strong>
        <span>{typeof profile.monthlySpendingLimit === 'number'
          ? `السقف الشهري ${formatYER(profile.monthlySpendingLimit)} — الإنفاق المسجل ${formatYER(profile.currentMonthlySpent ?? 0)}`
          : 'لم يحدد سقف شهري لهذا الحساب بعد.'}</span>
        <small>تغيير الشركة أو السقف يتم من لوحة المشرف.</small>
      </div>}
      <label className="field field-wide"><span>طلب تعديل البيانات الوظيفية</span>
        <textarea maxLength={1000} value={requestMessage} onChange={(event) => setRequestMessage(event.target.value)} placeholder="اكتب البيانات التي ترغب بتعديلها وسبب الطلب" />
        <button type="button" className="secondary-button" disabled={busy || !requestMessage.trim()} onClick={() => {
          onRequestChange(requestMessage)
          setRequestMessage('')
        }}>إرسال طلب تعديل إلى المشرف</button>
      </label>
    </div>
    <div className="form-footer"><span><i className="required">*</i> الحقول المطلوبة</span>
      <button className="primary-button" type="submit" disabled={busy}>حفظ ومتابعة <span className="button-icon"><ArrowLeft size={16} /></span></button>
    </div>
  </form>
}

export type BasketSelectionProps = {
  counts: BasketCounts
  total: number
  baskets: BasketDefinition[]
  settings: BasketSelectionSettings
  products: CatalogProduct[]
  onAdjust: (id: string, delta: number) => void
  onContinue: () => void
}

export function BasketSelection({ counts, total, baskets, settings, products, onAdjust, onContinue }: BasketSelectionProps) {
  const reduceMotion = useReducedMotion()
  return <div className="basket-layout">
    <div className="basket-cards">{baskets.filter((basket) => basket.active).map((basket, index) => {
      const Icon = basketIcons[basket.kind] ?? basketIcons.family
      const amount = counts[basket.id] ?? 0
      const basketProducts = products.filter((product) => basket.productIds.includes(product.id))
      return <motion.article
        className={`basket-card${amount > 0 ? ' basket-selected' : ''}`}
        key={basket.id}
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={reduceMotion ? undefined : { y: -3 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.32, delay: index * 0.08 }}
      >
        <div className={`basket-art ${basket.kind === 'family' ? 'peach' : 'sand'}`}><Icon size={32} strokeWidth={1.5} /><span className="art-tag">{amount > 0 ? <><Check size={12} /> تم الاختيار</> : 'اختيار مميز'}</span></div>
        <div className="basket-info"><span className="basket-kicker">سلال ناتكو</span><h3>{basket.name}</h3><p>{basket.description}</p>
          <div className="basket-includes"><span>تتضمن</span>{basketProducts.length ? basketProducts.map((product) => product.name).join(' · ') : 'لا توجد أصناف مرتبطة'}</div>
          <div className="basket-card-footer"><span className="basket-kind">الحد: {basket.maxPerEmployee} لكل موظف</span>
            <div className="counter"><button type="button" aria-label={`تقليل ${basket.name}`} disabled={amount === 0} onClick={() => onAdjust(basket.id, -1)}><Minus size={15} /></button>
              <span>{amount}<small> / {basket.maxPerEmployee}</small></span>
              <button type="button" aria-label={`إضافة ${basket.name}`} disabled={total >= settings.maxTotalPerEmployee || amount >= basket.maxPerEmployee} onClick={() => onAdjust(basket.id, 1)}><Plus size={16} /></button>
            </div>
          </div>
        </div>
      </motion.article>
    })}</div>
    <motion.div
      className={`basket-note${total >= settings.maxTotalPerEmployee ? ' basket-note-full' : ''}`}
      key={total >= settings.maxTotalPerEmployee ? 'limit-reached' : 'limit-available'}
      initial={reduceMotion ? false : { opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
      aria-live="polite"
    ><span className="note-icon"><ShieldCheck size={19} /></span><span><strong>{total >= settings.maxTotalPerEmployee ? 'وصلت إلى الحد المسموح' : 'اختيارك محفوظ لك'}</strong><small>{total >= settings.maxTotalPerEmployee ? `بلغت الحد الإجمالي ${settings.maxTotalPerEmployee} سلة.` : `الحد الإجمالي المسموح ${settings.maxTotalPerEmployee} سلة.`}</small></span></motion.div>
    <div className="bottom-action"><span>المجموع <strong>{total} سلة</strong></span><button className="primary-button" type="button" onClick={onContinue}>تخصيص السلة <ArrowLeft size={18} /></button></div>
  </div>
}

export type CustomizationProps = {
  products: CatalogProduct[]
  quantities: Record<string, number>
  excluded: string[]
  total: number
  selected: number
  progress: number
  busy: boolean
  company: string
  branches: string[]
  pickupBranch: string
  onPickupBranchChange: (branch: string) => void
  totalAmount: number
  hasUnpricedItems: boolean
  exceedsMonthlyLimit: boolean
  monthlySpendingLimit?: number
  currentMonthlySpent: number
  remainingMonthlyLimit: number | null
  onAdjust: (id: string, delta: number) => void
  onExclude: (id: string) => void
  onBack: () => void
  onConfirm: () => void
}

export function BasketCustomization(props: CustomizationProps) {
  const reduceMotion = useReducedMotion()
  const [departmentId, setDepartmentId] = useState<ProductDepartmentId>('consumables')
  const [subcategoryFilter, setSubcategoryFilter] = useState('all')
  const department = productDepartments.find((item) => item.id === departmentId) ?? productDepartments[0]
  const departmentProducts = props.products.filter((product) => product.department === departmentId)
  const visibleProducts = departmentProducts.filter((product) =>
    subcategoryFilter === 'all' || product.subcategory === subcategoryFilter)
  return <div className="customize-layout">
    <div className="included-banner"><span className="included-icon"><Package size={20} /></span><span><strong>سلتك بين يديك</strong><small>عدّل الكمية أو استبعد ما لا تحتاجه — من حقك تخصيصها.</small></span><span className="basket-summary">{props.total} سلة</span></div>
    {props.products.length === 0 && <div className="basket-note"><span className="note-icon"><Package size={19} /></span><span><strong>لا توجد منتجات في الكتالوج</strong><small>تواصل مع إدارة السلال لإضافة المنتجات أولاً.</small></span></div>}
    {props.products.length > 0 && <>
      <nav className="employee-catalog-tabs" aria-label="كتالوجات المنتجات">
        {productDepartments.map((item) => {
          const count = props.products.filter((product) => product.department === item.id).length
          return <button
            key={item.id}
            type="button"
            className={departmentId === item.id ? 'current' : ''}
            aria-pressed={departmentId === item.id}
            onClick={() => { setDepartmentId(item.id); setSubcategoryFilter('all') }}
          >
            <span>{item.name}</span><small>{count}</small>
          </button>
        })}
      </nav>
      <div className="employee-catalog-subcategories" aria-label={`تصنيفات ${department.name}`}>
        <button
          type="button"
          className={subcategoryFilter === 'all' ? 'current' : ''}
          aria-pressed={subcategoryFilter === 'all'}
          onClick={() => setSubcategoryFilter('all')}
        >الكل <small>{departmentProducts.length}</small></button>
        {department.categories.map((subcategory) => {
          const count = departmentProducts.filter((product) => product.subcategory === subcategory).length
          return <button
            type="button"
            key={subcategory}
            className={subcategoryFilter === subcategory ? 'current' : ''}
            aria-pressed={subcategoryFilter === subcategory}
            onClick={() => setSubcategoryFilter(subcategory)}
          >{subcategory}<small>{count}</small></button>
        })}
      </div>
      {visibleProducts.length === 0
        ? <div className="basket-note"><span className="note-icon"><Package size={19} /></span><span><strong>لا توجد منتجات في هذا التصنيف حالياً</strong><small>يمكنك اختيار كتالوج أو تصنيف آخر، وسيظهر هذا القسم عند إضافة منتجات إليه.</small></span></div>
        : <div className="products-grid">{visibleProducts.map((product, index) => {
      const Icon = productIcons[product.iconKey]
      const quantity = props.quantities[product.id] ?? 0
      const isExcluded = props.excluded.includes(product.id)
      return <motion.article
        className={`product-card${quantity === 0 ? ' product-empty' : ''}${isExcluded ? ' product-excluded' : ''}`}
        key={product.id}
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.24, delay: Math.min(index * 0.035, 0.28) }}
        layout={!reduceMotion}
      >
        <div className={`product-icon ${product.tone}`}>{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <Icon size={23} strokeWidth={1.7} />}</div>
        <div className="product-details"><h3>{product.name}</h3><span>{product.detail}</span>
          <strong className="product-agent-price">{productAgentPrice(product, props.company) === null
            ? 'السعر غير محدد'
            : `${formatYER(productAgentPrice(product, props.company) ?? 0)} / وحدة`}</strong>
          {isExcluded && <small className="excluded-label">مستبعد من السلة</small>}
        </div>
        <div className="product-actions">
          {quantity > 0 && <div className="counter product-counter"><button type="button" aria-label={`تقليل ${product.name}`} onClick={() => props.onAdjust(product.id, -1)}><Minus size={14} /></button><span>{quantity}</span><button type="button" aria-label={`زيادة ${product.name}`} onClick={() => props.onAdjust(product.id, 1)}><Plus size={15} /></button></div>}
          {quantity === 0 && <button className="add-product" type="button" onClick={() => props.onAdjust(product.id, 1)}><Plus size={15} /> إضافة</button>}
          <button className={`exclude-button${isExcluded ? ' is-excluded' : ''}`} type="button" onClick={() => props.onExclude(product.id)}>{isExcluded ? <><Check size={15} /> مستبعد</> : <><Trash2 size={15} /> استبعاد</>}</button>
        </div>
      </motion.article>
        })}</div>}
    </>}
    <section className="checkout-summary">
      <label className="field"><span>فرع / مكان الاستلام المفضل</span>
        <span className="select-wrap"><select required value={props.pickupBranch} onChange={(event) => props.onPickupBranchChange(event.target.value)}>
          <option value="">اختر فرع الاستلام</option>{props.branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
        </select><ChevronDown size={17} /></span>
      </label>
      <div className="checkout-total"><span>الإجمالي التقديري بسعر الوكيل</span><strong>{formatYER(props.totalAmount)}</strong></div>
      {props.monthlySpendingLimit !== undefined && <div className="monthly-limit-summary">
        <span>السقف الشهري: {formatYER(props.monthlySpendingLimit)}</span>
        <span>المسجل حالياً: {formatYER(props.currentMonthlySpent)}</span>
        <strong>المتبقي: {formatYER(props.remainingMonthlyLimit ?? 0)}</strong>
      </div>}
      {props.hasUnpricedItems && <small className="checkout-warning">يوجد صنف لم يحدد المشرف سعره؛ لا يمكن إرسال الطلب حتى تحديث الأسعار.</small>}
      {props.exceedsMonthlyLimit && <small className="checkout-warning">
        قيمة الأصناف ({formatYER(props.totalAmount)}) تتجاوز المتبقي من سقفك الشهري ({formatYER(props.remainingMonthlyLimit ?? 0)}).
        خفّض الكميات أو استبعد بعض الأصناف، أو اطلب من المشرف تعديل السقف.
      </small>}
      <small className="deposit-instruction">بعد تأكيد الطلب، أودع المبلغ في حساب الشركة حسب التعليمات المعروضة في الإيصال. يُنفذ الطلب بعد مراجعة الإيداع من الإدارة.</small>
    </section>
    <div className="progress-card"><div className="progress-top"><span>تأكيد الطلب</span><strong>{props.progress}% <small>مكتمل</small></strong></div><div className="progress-track"><span style={{ width: `${props.progress}%` }} /></div><small>راجع أصنافك ثم أكّد طلبك للاستلام.</small></div>
    <div className="bottom-action"><button className="text-button" type="button" onClick={props.onBack}><ArrowRight size={16} /> رجوع للسلال</button><button className="primary-button" type="button" disabled={props.busy || !props.products.length || props.hasUnpricedItems || props.exceedsMonthlyLimit || !props.pickupBranch} onClick={props.onConfirm}>{props.busy ? 'جارٍ الإرسال…' : 'تأكيد الطلب'} <span className="button-icon"><Check size={16} /></span></button></div>
  </div>
}

export type ReceiptProps = {
  activeOrder: Order | null
  orders: Order[]
  products: CatalogProduct[]
  depositInstructions: string
  onEdit: (order: Order) => void
  onNew: () => void
  onShare: () => void
  onSelect: (order: Order) => void
  onHistory: () => void
}

export function ReceiptView({ activeOrder, orders, products, depositInstructions, onEdit, onNew, onShare, onSelect, onHistory }: ReceiptProps) {
  const reduceMotion = useReducedMotion()
  return <div className="receipt-layout">
    {activeOrder ? <motion.article
      className="receipt-card"
      initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 25 }}
    >
      <div className="receipt-top"><div><Brand compact /><span className="receipt-tag"><BadgeCheck size={14} /> إيصال استلام إلكتروني</span></div>
        <div className={`status-pill status-${activeOrder.status}`}><span /> {orderStatusLabels[activeOrder.status]}</div>
      </div>
      <div className="receipt-reference"><div><small>رقم الطلب المرجعي</small><strong dir="ltr">{activeOrder.reference}</strong></div><div className="receipt-date"><small>تاريخ الطلب</small><strong>{new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium' }).format(new Date(activeOrder.createdAt))}</strong></div></div>
      <div className="receipt-divider" />
      <div className="receipt-body"><div className="receipt-details"><h3>معلومات الموظف</h3><div className="receipt-info-grid">
        <div><small>الاسم الكامل</small><strong>{activeOrder.profile.name}</strong></div><div><small>الرقم الوظيفي</small><strong>{activeOrder.profile.employeeCode}</strong></div>
        <div><small>الشركة</small><strong>{activeOrder.profile.company}</strong></div><div><small>الفرع</small><strong>{activeOrder.profile.branch}</strong></div>
        <div><small>مكان الاستلام</small><strong>{activeOrder.pickupBranch || activeOrder.profile.branch}</strong></div>
        <div className="receipt-address"><small>عنوان التوصيل</small><strong>{activeOrder.profile.address}</strong></div>
      </div><h3 className="receipt-products-title">ملخص السلة</h3>
        <div className="receipt-items">{Object.entries(activeOrder.items).filter(([, amount]) => amount > 0).map(([id, amount]) =>
          <span className="receipt-item" key={id}>{activeOrder.itemDetails[id]?.name ?? products.find((product) => product.id === id)?.name ?? 'منتج محذوف'}<b>× {amount} · {typeof activeOrder.itemDetails[id]?.lineTotal === 'number' ? formatYER(activeOrder.itemDetails[id].lineTotal) : '—'}</b></span>)}</div>
        <div className="receipt-total"><span>الإجمالي بسعر الوكيل</span><strong>{typeof activeOrder.totalAmount === 'number' ? formatYER(activeOrder.totalAmount) : 'غير متوفر للطلب القديم'}</strong></div>
        <section className="deposit-instructions-card"><h4>إيداع المبلغ لاستكمال الطلب</h4>
          <p>{depositInstructions || 'يرجى مراجعة إدارة ناتكو للحصول على بيانات حساب الشركة وتعليمات الإيداع.'}</p>
          <small>أرسل إثبات الإيداع إلى المسؤول المعتمد؛ الطلب لا يعني تأكيد استلام المبلغ.</small>
        </section>
        {activeOrder.excluded.length > 0 && <small className="receipt-exclusions">أصناف مستبعدة: {activeOrder.excluded.map((id) => activeOrder.itemDetails[id]?.name ?? products.find((product) => product.id === id)?.name ?? id).join('، ')}</small>}
      </div>
        <div className="qr-panel"><div className="qr-frame"><QRCodeSVG value={JSON.stringify({ id: activeOrder.reference, code: activeOrder.profile.employeeCode, branch: activeOrder.profile.branch })} size={126} level="M" /></div><strong>رمز الاستلام</strong><small>امسح الرمز عند استلام السلة</small></div>
      </div>
      <div className="receipt-footer"><span><ShieldCheck size={16} /> إيصال رقمي معتمد من ناتكو</span><strong dir="ltr">{activeOrder.reference}</strong></div>
    </motion.article> : <div className="panel history-panel"><div className="history-heading"><span className="section-icon"><Clock3 size={20} /></span><div><h3>سجل طلباتك</h3><p>يمكنك مراجعة طلباتك السابقة واختيار أي منها.</p></div></div>
      {orders.length === 0 ? <div className="empty-state"><FileCheck2 size={36} /><strong>لا توجد طلبات سابقة</strong><span>بعد تأكيد طلبك ستجده هنا.</span></div> :
        <div className="history-list">{orders.map((order) => <button className="history-row" key={order.id} onClick={() => onSelect(order)}>
          <span className="history-icon"><ShoppingBasket size={19} /></span><span className="history-main"><strong>{order.reference}</strong><small>{new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium' }).format(new Date(order.createdAt))} · {order.profile.branch}</small></span>
          <span className="history-status">{orderStatusLabels[order.status]}</span><ArrowLeft size={17} />
        </button>)}</div>}
    </div>}
    <div className="receipt-actions">
      {activeOrder && <button className="whatsapp-button" type="button" onClick={onShare}><span className="whatsapp-mark">◉</span> مشاركة الإيصال عبر واتساب</button>}
      {activeOrder?.status === 'received' && (activeOrder.editCount ?? 0) < 1 &&
        <button className="secondary-button" type="button" onClick={() => onEdit(activeOrder)}>
          <Package size={17} /> تعديل الطلب
        </button>}
      <button className="primary-button" type="button" onClick={onNew}>طلب جديد <ArrowLeft size={17} /></button>
      <button className="text-button history-toggle" type="button" onClick={onHistory}><Clock3 size={16} /> عرض الطلبات السابقة</button>
    </div>
  </div>
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand${compact ? ' brand-compact' : ''}`} role="img" aria-label="شعار ناتكو الاستهلاكية الرسمي">
    <img className="brand-logo" src={`${import.meta.env.BASE_URL}natco-logo.jpg`} alt="" draggable={false} />
  </div>
}
