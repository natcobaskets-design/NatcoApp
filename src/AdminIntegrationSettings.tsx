import { useEffect, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { ExternalLink, LoaderCircle, Mail, Phone, Save, Sheet } from 'lucide-react'
import { firebaseErrorMessage, firestore } from './firebase'

type Props = { user: User; onNotice: (message: string) => void }

const settingsId = 'order_delivery'
const paymentSettingsId = 'payment_instructions'
const supportSettingsId = 'support_contact'
const defaultEmail = 'Moath.khaled.h@gmail.com'
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function AdminIntegrationSettings({ user, onNotice }: Props) {
  const [recipientText, setRecipientText] = useState(defaultEmail)
  const [spreadsheetUrl, setSpreadsheetUrl] = useState('')
  const [paymentInstructions, setPaymentInstructions] = useState('')
  const [supportPhone, setSupportPhone] = useState('')
  const [loading, setLoading] = useState(Boolean(firestore))
  const [loadingSupport, setLoadingSupport] = useState(Boolean(firestore))
  const [saving, setSaving] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [savingSupport, setSavingSupport] = useState(false)
  const [loadedSettings, setLoadedSettings] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!firestore) return
    let current = true
    void getDoc(doc(firestore, 'admin_settings', settingsId)).then((snapshot) => {
      if (!current) return
      if (snapshot.exists()) {
        const data = snapshot.data()
        const recipients = Array.isArray(data.notificationEmails)
          ? data.notificationEmails.filter((value): value is string => typeof value === 'string')
          : []
        setRecipientText(recipients.join(', '))
        setSpreadsheetUrl(typeof data.spreadsheetUrl === 'string' ? data.spreadsheetUrl : '')
      }
      setLoadedSettings(snapshot.exists())
    }).catch((error: unknown) => {
      console.error('Unable to load order delivery settings.', error)
      if (current) {
        const message = firebaseErrorMessage(error)
        setLoadError(message)
        onNotice(message)
      }
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [onNotice])

  useEffect(() => {
    if (!firestore) return
    let current = true
    void getDoc(doc(firestore, 'admin_settings', supportSettingsId)).then((snapshot) => {
      if (current && snapshot.exists() && typeof snapshot.data().phone === 'string') {
        setSupportPhone(snapshot.data().phone)
      }
    }).catch((error: unknown) => {
      console.error('Unable to load employee support contact.', error)
      if (current) onNotice(firebaseErrorMessage(error))
    }).finally(() => {
      if (current) setLoadingSupport(false)
    })
    return () => { current = false }
  }, [onNotice])

  useEffect(() => {
    if (!firestore) return
    let current = true
    void getDoc(doc(firestore, 'admin_settings', paymentSettingsId)).then((snapshot) => {
      if (current && snapshot.exists() && typeof snapshot.data().instructions === 'string') {
        setPaymentInstructions(snapshot.data().instructions)
      }
    }).catch((error: unknown) => {
      console.error('Unable to load deposit instructions.', error)
      if (current) onNotice(firebaseErrorMessage(error))
    })
    return () => { current = false }
  }, [onNotice])

  async function savePaymentInstructions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!firestore) {
      onNotice('خدمة قاعدة البيانات غير متاحة حالياً.')
      return
    }
    const instructions = paymentInstructions.trim()
    if (instructions.length > 1200) {
      onNotice('لا يمكن أن تتجاوز تعليمات الإيداع ١٢٠٠ حرف.')
      return
    }
    setSavingPayment(true)
    try {
      await setDoc(doc(firestore, 'admin_settings', paymentSettingsId), {
        instructions,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      })
      onNotice('تم حفظ تعليمات الإيداع التي ستظهر للموظفين.')
    } catch (error) {
      console.error('Unable to save deposit instructions.', error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setSavingPayment(false)
    }
  }

  async function saveSupportPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!firestore) {
      onNotice('خدمة قاعدة البيانات غير متاحة حالياً.')
      return
    }
    const phone = supportPhone.trim()
    const digits = phone.replace(/\D/g, '')
    if (phone && (!/^\+?[0-9\s()-]{8,24}$/.test(phone) || digits.length < 8 || digits.length > 18)) {
      onNotice('أدخل رقم هاتف صحيحاً مع رمز الدولة إن توفر، أو اترك الحقل فارغاً لإخفاء رابط الاتصال.')
      return
    }
    setSavingSupport(true)
    try {
      await setDoc(doc(firestore, 'admin_settings', supportSettingsId), {
        phone,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      })
      onNotice(phone ? 'تم حفظ رقم المساعدة وسيظهر للموظفين مباشرة.' : 'تم إخفاء رقم المساعدة من حسابات الموظفين.')
    } catch (error) {
      console.error('Unable to save employee support contact.', error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setSavingSupport(false)
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!firestore) {
      onNotice('خدمة قاعدة البيانات غير متاحة حالياً.')
      return
    }
    const recipients = [...new Set(recipientText
      .split(/[,\n;]+/)
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean))]
    if (!recipients.length || recipients.length > 20 || recipients.some((address) => !emailPattern.test(address))) {
      onNotice('أدخل بريداً واحداً على الأقل وبحد أقصى ٢٠ بريداً صحيحاً، وافصل بينها بفاصلة أو سطر جديد.')
      return
    }
    const normalizedSheetUrl = spreadsheetUrl.trim()
    if (normalizedSheetUrl && !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/|$)/.test(normalizedSheetUrl)) {
      onNotice('أدخل رابط Google Sheets كاملاً من نوع https://docs.google.com/spreadsheets/d/...')
      return
    }

    setSaving(true)
    try {
      await setDoc(doc(firestore, 'admin_settings', settingsId), {
        notificationEmails: recipients,
        spreadsheetUrl: normalizedSheetUrl,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      })
      onNotice('تم حفظ مستلمي الإشعار ورابط Google Sheets.')
    } catch (error) {
      console.error('Unable to save order delivery settings.', error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return <section className="admin-panel integration-settings">
    <div className="admin-panel-heading">
      <div><h3>إشعارات الطلبات وGoogle Sheets</h3><p>بعد إعداد Apps Script، تظهر الطلبات والموظفون والكتالوج في تبويبات منفصلة داخل ملف Google Sheets نفسه.</p></div>
    </div>
    <div className="integration-status" role="status">
      <Mail size={17} />
      <span>{loadError
        ? `تعذر تحميل الإعدادات: ${loadError} تحقق من نشر قواعد Firestore المحدّثة ومنح المشرف صلاحية قراءة admin_settings/order_delivery.`
        : loadedSettings
        ? 'الإعدادات محفوظة. تأكد من تشغيل initializeNatcoIntegration في Apps Script لإنشاء تبويبات الطلبات والموظفين والكتالوج، ثم معالجة قوائم المزامنة كل دقيقة.'
        : 'لم يُنشأ إعداد الربط بعد. احفظ الإعدادات أولاً، ثم شغّل initializeNatcoIntegration من Apps Script.'}</span>
    </div>
    <p className="integration-privacy-note">تحتوي الطلبات على بيانات موظفين وعناوين توصيل؛ استخدم حساب Google مؤسسياً مخصصاً للتكامل، ولا تمنحه صلاحية Firestore لحساب شخصي.</p>
    {loading ? <div className="admin-loading"><LoaderCircle size={19} /> جارٍ تحميل إعدادات الربط…</div> : <form className="integration-form" onSubmit={(event) => void saveSettings(event)}>
      <label className="field">
        <span>بريد المسؤولين المستلمين</span>
        <textarea
          rows={3}
          value={recipientText}
          onChange={(event) => setRecipientText(event.target.value)}
          placeholder="admin@natco.com, manager@natco.com"
          aria-describedby="integration-email-help"
          required
        />
        <small id="integration-email-help">أدخل حتى ٢٠ عنواناً، وافصل بينها بفاصلة أو سطر جديد. البريد الافتراضي المحدد: {defaultEmail}</small>
      </label>
      <label className="field">
        <span>رابط Google Sheets</span>
        <input
          type="url"
          dir="ltr"
          value={spreadsheetUrl}
          onChange={(event) => setSpreadsheetUrl(event.target.value)}
          placeholder="سيظهر الرابط هنا بعد إعداد Apps Script"
          aria-describedby="integration-sheet-help"
        />
        <small id="integration-sheet-help">اتركه فارغاً قبل الإعداد الأولي ليُنشئ Apps Script جدولاً جديداً. عند تغييره، امنح حساب Google المشغّل صلاحية التعديل على الجدول الجديد.</small>
      </label>
      {spreadsheetUrl && <a className="integration-sheet-link" href={spreadsheetUrl} target="_blank" rel="noreferrer"><Sheet size={15} /> فتح Google Sheets <ExternalLink size={13} /></a>}
      <button className="admin-add-button integration-save" type="submit" disabled={saving}>
        {saving ? <LoaderCircle size={15} /> : <Save size={15} />}
        {saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
      </button>
    </form>}
    <section className="payment-instructions-settings">
      <div className="admin-panel-heading"><div><h3>تعليمات إيداع المبلغ</h3><p>تظهر هذه التعليمات للموظف في شاشة الإيصال؛ لا تضع بيانات لا ترغب بمشاركتها مع الموظفين.</p></div></div>
      <form className="integration-form" onSubmit={(event) => void savePaymentInstructions(event)}>
        <label className="field"><span>البنك واسم المستفيد ورقم الحساب / الآيبان وآلية إرسال الإثبات</span>
          <textarea rows={5} maxLength={1200} value={paymentInstructions} onChange={(event) => setPaymentInstructions(event.target.value)} placeholder="اكتب تعليمات الإيداع المعتمدة..." />
          <small>{paymentInstructions.length}/1200 حرف</small>
        </label>
        <button className="admin-add-button integration-save" type="submit" disabled={savingPayment}>
          {savingPayment ? <LoaderCircle size={15} /> : <Save size={15} />}
          {savingPayment ? 'جارٍ الحفظ…' : 'حفظ تعليمات الإيداع'}
        </button>
      </form>
    </section>
    <section className="payment-instructions-settings">
      <div className="admin-panel-heading"><div><h3>رقم مساعدة الموظفين</h3><p>يظهر زر المساعدة في حساب الموظف كرابط اتصال مباشر، ويتحدّث تلقائياً عند تغيير الرقم.</p></div></div>
      <form className="integration-form" onSubmit={(event) => void saveSupportPhone(event)}>
        <label className="field"><span>رقم الهاتف مع رمز الدولة</span>
          <input type="tel" dir="ltr" maxLength={24} value={supportPhone} onChange={(event) => setSupportPhone(event.target.value)} placeholder="+967 7XX XXX XXX" />
          <small>{loadingSupport ? 'جارٍ تحميل الرقم المحفوظ…' : 'اتركه فارغاً لإظهار رسالة التواصل مع الموارد البشرية بدلاً من الاتصال.'}</small>
        </label>
        <button className="admin-add-button integration-save" type="submit" disabled={savingSupport || loadingSupport}>
          {savingSupport ? <LoaderCircle size={15} /> : <Phone size={15} />}
          {savingSupport ? 'جارٍ الحفظ…' : 'حفظ رقم المساعدة'}
        </button>
      </form>
    </section>
  </section>
}
