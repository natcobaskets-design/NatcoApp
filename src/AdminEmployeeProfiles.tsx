import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { collection, doc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore'
import { Ban, Check, Edit3, Search, Save, Trash2, Users, X } from 'lucide-react'
import { formatYER, type EmployeeProfile, type OrganizationOptions } from './domain'
import { firebaseErrorMessage, firestore } from './firebase'

type Props = {
  user: User
  organizationOptions: OrganizationOptions
  onNotice: (message: string) => void
}
type EmployeeRecord = EmployeeProfile & {
  active: boolean
  monthlySpendingLimit?: number
  currentMonthlySpent: number
  spendingPeriod: string
}

const blankRecord = (): EmployeeRecord => ({
  email: '',
  employeeCode: '',
  name: '',
  company: '',
  branch: '',
  province: '',
  address: '',
  coordinates: '',
  phone: '',
  whatsapp: '',
  currentMonthlySpent: 0,
  spendingPeriod: '',
  active: true,
})

function parseRosterProfile(id: string, data: Record<string, unknown>): EmployeeRecord {
  return {
    ...blankRecord(),
    email: id,
    employeeCode: typeof data.employeeCode === 'string' ? data.employeeCode : '',
    name: typeof data.name === 'string' ? data.name : '',
    company: typeof data.company === 'string' ? data.company : '',
    branch: typeof data.branch === 'string' ? data.branch : '',
    province: typeof data.province === 'string' ? data.province : '',
    address: typeof data.address === 'string' ? data.address : '',
    coordinates: typeof data.coordinates === 'string' ? data.coordinates : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    whatsapp: typeof data.whatsapp === 'string' ? data.whatsapp : '',
    ...(typeof data.monthlySpendingLimit === 'number' ? { monthlySpendingLimit: data.monthlySpendingLimit } : {}),
    currentMonthlySpent: typeof data.currentMonthlySpent === 'number' ? data.currentMonthlySpent : 0,
    spendingPeriod: typeof data.spendingPeriod === 'string' ? data.spendingPeriod : '',
    active: data.active === true,
  }
}

export function AdminEmployeeProfiles({ user, organizationOptions, onNotice }: Props) {
  const [records, setRecords] = useState<EmployeeRecord[]>([])
  const [search, setSearch] = useState('')
  const [selectedEmail, setSelectedEmail] = useState('')
  const [draft, setDraft] = useState<EmployeeRecord>(blankRecord)
  const [working, setWorking] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)

  useEffect(() => {
    if (!firestore) return
    return onSnapshot(collection(firestore, 'employee_roster'), (snapshot) => {
      setRecords(snapshot.docs.map((item) => parseRosterProfile(item.id, item.data())))
    }, (error) => {
      console.error('Unable to load employee records for profile management.', error)
      onNotice(firebaseErrorMessage(error))
    })
  }, [onNotice])

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    if (!term) return records
    return records.filter((record) => [
      record.email, record.employeeCode, record.name, record.company, record.branch, record.province,
    ].some((value) => (value ?? '').toLocaleLowerCase().includes(term)))
  }, [records, search])

  function chooseEmployee(record: EmployeeRecord) {
    setSelectedEmail(record.email)
    setDraft({ ...record })
    setEditorOpen(true)
    if (!firestore) return
    void (async () => {
      try {
        const profiles = await getDocs(query(collection(firestore, 'employees'), where('email', '==', record.email)))
        if (profiles.empty) return
        const saved = profiles.docs[0].data()
        setDraft((current) => current.email === record.email ? {
          ...current,
          name: typeof saved.name === 'string' ? saved.name : current.name,
          address: typeof saved.address === 'string' ? saved.address : current.address,
          coordinates: typeof saved.coordinates === 'string' ? saved.coordinates : current.coordinates,
          phone: typeof saved.phone === 'string' ? saved.phone : current.phone,
          whatsapp: typeof saved.whatsapp === 'string' ? saved.whatsapp : current.whatsapp,
        } : current)
      } catch (error) {
        console.error(`Unable to load profile details for ${record.email}.`, error)
        onNotice(firebaseErrorMessage(error))
      }
    })()
  }

  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!firestore || !selectedEmail) return
    if (!draft.employeeCode.trim() || !draft.company || !draft.branch || !draft.province ||
      (draft.monthlySpendingLimit !== undefined &&
        (!Number.isFinite(draft.monthlySpendingLimit) || draft.monthlySpendingLimit < 0)) ||
      !Number.isFinite(draft.currentMonthlySpent) || draft.currentMonthlySpent < 0 ||
      !/^\+?[\d\s()-]{8,18}$/.test(draft.phone) ||
      !/^\+?[\d\s()-]{8,18}$/.test(draft.whatsapp)) {
      onNotice('أكمل الحقول الوظيفية، وتحقق من السقف والإنفاق وأرقام التواصل.')
      return
    }
    setWorking(true)
    try {
      const profilesQuery = await getDocs(query(collection(firestore, 'employees'), where('email', '==', selectedEmail)))
      const period = new Date().toISOString().slice(0, 7)
      const protectedFields = {
        employeeCode: draft.employeeCode.trim(),
        company: draft.company,
        branch: draft.branch,
        province: draft.province,
        ...(draft.monthlySpendingLimit === undefined ? {} : { monthlySpendingLimit: draft.monthlySpendingLimit }),
        currentMonthlySpent: draft.currentMonthlySpent,
        spendingPeriod: period,
      }
      const batch = writeBatch(firestore)
      batch.set(doc(firestore, 'employee_roster', selectedEmail), {
        ...protectedFields,
        name: draft.name.trim(),
        address: draft.address.trim(),
        coordinates: draft.coordinates.trim(),
        phone: draft.phone.trim(),
        whatsapp: draft.whatsapp.trim(),
        active: draft.active,
        approvedBy: user.uid,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      profilesQuery.docs.forEach((profileSnapshot) => batch.set(profileSnapshot.ref, {
        email: selectedEmail,
        ...protectedFields,
        name: draft.name.trim(),
        address: draft.address.trim(),
        coordinates: draft.coordinates.trim(),
        phone: draft.phone.trim(),
        whatsapp: draft.whatsapp.trim(),
      }, { merge: true }))
      batch.set(doc(firestore, 'employee_sync_queue', selectedEmail), {
        email: selectedEmail,
        status: 'pending',
        updatedAt: serverTimestamp(),
      })
      await batch.commit()
      setDraft((current) => ({ ...current, spendingPeriod: period }))
      setEditorOpen(false)
      onNotice(`تم تحديث الملف الوظيفي للموظف ${selectedEmail}.`)
    } catch (error) {
      console.error(`Unable to save employee profile ${selectedEmail}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function setEmployeeActive(active: boolean) {
    if (!firestore || !selectedEmail) return
    setWorking(true)
    try {
      const batch = writeBatch(firestore)
      batch.set(doc(firestore, 'employee_roster', selectedEmail), {
        active,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      batch.set(doc(firestore, 'employee_sync_queue', selectedEmail), {
        email: selectedEmail,
        status: 'pending',
        updatedAt: serverTimestamp(),
      })
      await batch.commit()
      setEditorOpen(false)
      onNotice(active ? 'تم تفعيل حساب الموظف.' : 'تم إيقاف حساب الموظف.')
    } catch (error) {
      console.error(`Unable to ${active ? 'activate' : 'deactivate'} employee ${selectedEmail}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function deleteEmployee() {
    if (!firestore || !selectedEmail) return
    setWorking(true)
    try {
      const profiles = await getDocs(query(collection(firestore, 'employees'), where('email', '==', selectedEmail)))
      const batch = writeBatch(firestore)
      batch.delete(doc(firestore, 'employee_roster', selectedEmail))
      profiles.docs.forEach((profile) => batch.delete(profile.ref))
      batch.set(doc(firestore, 'employee_sync_queue', selectedEmail), {
        email: selectedEmail,
        status: 'pending',
        action: 'deleted',
        updatedAt: serverTimestamp(),
      })
      await batch.commit()
      setEditorOpen(false)
      setSelectedEmail('')
      onNotice('تم حذف سجل الموظف وملفه الوظيفي. قد يبقى حساب تسجيل الدخول غير نشط في Firebase Auth.')
    } catch (error) {
      console.error(`Unable to delete employee ${selectedEmail}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function markRequestHandled(requestId: string) {
    if (!firestore) return
    try {
      await updateDoc(doc(firestore, 'profile_change_requests', requestId), {
        status: 'reviewed',
        reviewedBy: user.uid,
        reviewedAt: serverTimestamp(),
      })
      onNotice('تم تعليم طلب التعديل بأنه تمت مراجعته.')
    } catch (error) {
      console.error(`Unable to update profile change request ${requestId}.`, error)
      onNotice(firebaseErrorMessage(error))
    }
  }

  return <section className="admin-panel employee-profile-management">
    <div className="admin-panel-heading"><div><h3>إدارة الملفات الوظيفية</h3><p>ابحث بالبريد أو الاسم أو الرقم الوظيفي؛ بيانات الشركة والفرع والسقف تحت إدارة المشرف حصراً.</p></div><span>{records.length} موظف</span></div>
    <label className="admin-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالبريد أو الاسم أو الرقم الوظيفي أو الفرع" /></label>
    <div className="employee-profile-results">{filtered.map((record) => <article className="employee-profile-row" key={record.email}>
      <div><strong>{record.name || 'اسم غير متوفر'}</strong><span>الكود الوظيفي: {record.employeeCode || 'غير محدد'}</span></div>
      <button type="button" className="employee-profile-open" onClick={() => chooseEmployee(record)}><Edit3 size={15} /> فتح الملف</button>
    </article>)}{!filtered.length && <div className="admin-empty"><Users size={26} /><strong>لا توجد سجلات مطابقة</strong></div>}</div>
    {editorOpen && selectedEmail && <div className="admin-modal-backdrop employee-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setEditorOpen(false) }}>
      <form className="employee-profile-admin-form employee-profile-editor" role="dialog" aria-modal="true" aria-labelledby="employee-editor-title" onSubmit={(event) => void saveEmployee(event)}>
        <div className="admin-form-heading"><div><h3 id="employee-editor-title">الملف الوظيفي</h3><p dir="ltr">{draft.email}</p></div><button type="button" aria-label="إغلاق" disabled={working} onClick={() => setEditorOpen(false)}><X size={20} /></button></div>
        <label className="field"><span>اسم الموظف</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="field"><span>الرقم الوظيفي</span><input required value={draft.employeeCode} onChange={(event) => setDraft((current) => ({ ...current, employeeCode: event.target.value }))} /></label>
        <label className="field"><span>الشركة</span><select required value={draft.company} onChange={(event) => setDraft((current) => ({ ...current, company: event.target.value, branch: '' }))}><option value="">اختر الشركة</option>{organizationOptions.companies.map((company) => <option key={company.name}>{company.name}</option>)}</select></label>
        <label className="field"><span>الفرع</span><select required value={draft.branch} onChange={(event) => setDraft((current) => ({ ...current, branch: event.target.value }))}><option value="">اختر الفرع</option>{organizationOptions.companies.find((company) => company.name === draft.company)?.branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label>
        <label className="field"><span>المحافظة</span><select required value={draft.province} onChange={(event) => setDraft((current) => ({ ...current, province: event.target.value }))}><option value="">اختر المحافظة</option>{organizationOptions.branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label>
        <label className="field"><span>السقف الشهري (ر.ي)</span><input type="number" min="0" value={draft.monthlySpendingLimit ?? ''} onChange={(event) => setDraft((current) => ({ ...current, monthlySpendingLimit: event.target.value ? Number(event.target.value) : undefined }))} /></label>
        <label className="field"><span>الإنفاق الشهري الحالي (ر.ي)</span><input required type="number" min="0" value={draft.currentMonthlySpent} onChange={(event) => setDraft((current) => ({ ...current, currentMonthlySpent: Number(event.target.value) }))} /></label>
        <label className="field"><span>العنوان</span><input value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} /></label>
        <label className="field"><span>الإحداثيات</span><input value={draft.coordinates} onChange={(event) => setDraft((current) => ({ ...current, coordinates: event.target.value }))} /></label>
        <label className="field"><span>الهاتف</span><input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
        <label className="field"><span>واتساب</span><input value={draft.whatsapp} onChange={(event) => setDraft((current) => ({ ...current, whatsapp: event.target.value }))} /></label>
        <small>الإنفاق: {formatYER(draft.currentMonthlySpent)} · فترة الشهر: {draft.spendingPeriod || 'غير محددة'}</small>
        <div className="employee-profile-editor-actions">
          <button className="admin-add-button" disabled={working}><Save size={14} /> حفظ</button>
          <button type="button" disabled={working} className="employee-profile-state-button" onClick={() => void setEmployeeActive(!draft.active)}>{draft.active ? <><Ban size={14} /> إيقاف الموظف</> : <><Check size={14} /> تفعيل الموظف</>}</button>
          <button type="button" disabled={working} className="employee-profile-delete-button" onClick={() => {
            if (window.confirm(`سيتم حذف سجل ${draft.name || draft.email} وملفه الوظيفي، ولن يتم حذف مستخدمه من Firebase Auth. هل تريد المتابعة؟`)) void deleteEmployee()
          }}><Trash2 size={14} /> حذف الموظف</button>
        </div>
      </form>
    </div>}
    <ProfileChangeRequests onHandled={(id) => void markRequestHandled(id)} />
  </section>
}

function ProfileChangeRequests({ onHandled }: { onHandled: (id: string) => void }) {
  const [requests, setRequests] = useState<Array<{ id: string; email: string; employeeCode: string; message: string }>>([])
  useEffect(() => {
    if (!firestore) return
    return onSnapshot(query(collection(firestore, 'profile_change_requests'), where('status', '==', 'pending')), (snapshot) => {
      setRequests(snapshot.docs.map((item) => ({
        id: item.id,
        email: typeof item.data().email === 'string' ? item.data().email : '',
        employeeCode: typeof item.data().employeeCode === 'string' ? item.data().employeeCode : '',
        message: typeof item.data().message === 'string' ? item.data().message : '',
      })))
    }, (error) => {
      console.error('Unable to load employee profile change requests.', error)
    })
  }, [])
  return <div className="profile-change-requests">
    <h4>طلبات تعديل البيانات ({requests.length})</h4>
    {!requests.length ? <small>لا توجد طلبات معلقة.</small> : requests.map((request) => <article key={request.id}>
      <strong>{request.email} · {request.employeeCode}</strong><p>{request.message}</p>
      <button className="admin-export-button" type="button" onClick={() => onHandled(request.id)}>تعليم كمراجع</button>
    </article>)}
  </div>
}
