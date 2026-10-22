import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { Ban, Check, Edit3, KeyRound, Phone, Search, Save, Trash2, Users, X } from 'lucide-react'
import { formatYER, type EmployeeProfile, type OrganizationOptions } from './domain'
import { createEmployeeLoginAccount, firebaseErrorMessage, firebaseProjectId, firestore } from './firebase'
import { normalizePhone, toE164PhoneNumber } from './rosterImport'
import { employeePasswordLoginEmail } from './employeeLogin'

type Props = {
  user: User
  organizationOptions: OrganizationOptions
  onNotice: (message: string) => void
}
type EmployeeRecord = EmployeeProfile & {
  active: boolean
  phoneE164: string
  monthlySpendingLimit?: number
  currentMonthlySpent: number
  spendingPeriod: string
}

type EmployeeSignupRequest = {
  uid: string
  authEmail: string
  phoneNumber: string
  phoneDigits: string
  name: string
  employeeCode: string
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
  phoneE164: '',
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
    phoneE164: typeof data.phoneE164 === 'string' ? data.phoneE164 : '',
    whatsapp: typeof data.whatsapp === 'string' ? data.whatsapp : '',
    ...(typeof data.monthlySpendingLimit === 'number' ? { monthlySpendingLimit: data.monthlySpendingLimit } : {}),
    currentMonthlySpent: typeof data.currentMonthlySpent === 'number' ? data.currentMonthlySpent : 0,
    spendingPeriod: typeof data.spendingPeriod === 'string' ? data.spendingPeriod : '',
    active: data.active === true,
  }
}

export function AdminEmployeeProfiles({ user, organizationOptions, onNotice }: Props) {
  const [currentPeriod] = useState(() => new Date().toISOString().slice(0, 7))
  const [records, setRecords] = useState<EmployeeRecord[]>([])
  const [search, setSearch] = useState('')
  const [selectedEmail, setSelectedEmail] = useState('')
  const [draft, setDraft] = useState<EmployeeRecord>(blankRecord)
  const [passwordLoginEmails, setPasswordLoginEmails] = useState<Set<string>>(new Set())
  const [signupRequests, setSignupRequests] = useState<EmployeeSignupRequest[]>([])
  const [signupEdits, setSignupEdits] = useState<Record<string, Pick<EmployeeSignupRequest, 'name' | 'employeeCode'>>>({})
  const [employeePassword, setEmployeePassword] = useState('')
  const [employeePasswordConfirmation, setEmployeePasswordConfirmation] = useState('')
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

  useEffect(() => {
    if (!firestore) return
    return onSnapshot(collection(firestore, 'employee_auth_lookup'), (snapshot) => {
      setPasswordLoginEmails(new Set(snapshot.docs.flatMap((item) =>
        typeof item.data().email === 'string' ? [item.data().email] : [])))
    }, (error) => {
      console.error('Unable to load employee password-login links.', error)
      onNotice(firebaseErrorMessage(error))
    })
  }, [onNotice])

  useEffect(() => {
    if (!firestore) return
    return onSnapshot(query(collection(firestore, 'employee_signup_requests'), where('status', '==', 'pending')), (snapshot) => {
      setSignupRequests(snapshot.docs.map((item) => {
        const data = item.data()
        return {
          uid: item.id,
          authEmail: typeof data.authEmail === 'string' ? data.authEmail : '',
          phoneNumber: typeof data.phoneNumber === 'string' ? data.phoneNumber : '',
          phoneDigits: typeof data.phoneDigits === 'string' ? data.phoneDigits : '',
          name: typeof data.name === 'string' ? data.name : '',
          employeeCode: typeof data.employeeCode === 'string' ? data.employeeCode : '',
        }
      }))
    }, (error) => {
      console.error('Unable to load employee signup approval requests.', error)
      onNotice(firebaseErrorMessage(error))
    })
  }, [onNotice])

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    if (!term) return records
    return records.filter((record) => [
      record.email, record.employeeCode, record.phone, record.name, record.company, record.branch, record.province,
    ].some((value) => (value ?? '').toLocaleLowerCase().includes(term)))
  }, [records, search])

  function chooseEmployee(record: EmployeeRecord) {
    setSelectedEmail(record.email)
    setEmployeePassword('')
    setEmployeePasswordConfirmation('')
    setDraft({
      ...record,
      currentMonthlySpent: record.spendingPeriod === currentPeriod ? record.currentMonthlySpent : 0,
      spendingPeriod: currentPeriod,
    })
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
          whatsapp: typeof saved.whatsapp === 'string' ? saved.whatsapp : current.whatsapp,
        } : current)
      } catch (error) {
        console.error(`Unable to load profile details for ${record.email}.`, error)
        onNotice(firebaseErrorMessage(error))
      }
    })()
  }

  function closeEditor() {
    setEditorOpen(false)
    setEmployeePassword('')
    setEmployeePasswordConfirmation('')
  }

  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!firestore || !selectedEmail) return
    const normalizedPhone = normalizePhone(draft.phone)
    const phoneE164 = toE164PhoneNumber(draft.phone)
    if (!draft.employeeCode.trim() || draft.employeeCode.trim().length > 80 ||
      !draft.name.trim() || draft.name.trim().length > 120 ||
      !draft.company || !draft.branch || !draft.province ||
      (draft.monthlySpendingLimit !== undefined &&
        (!Number.isFinite(draft.monthlySpendingLimit) || draft.monthlySpendingLimit < 0 || draft.monthlySpendingLimit > 1_000_000_000)) ||
      !Number.isFinite(draft.currentMonthlySpent) || draft.currentMonthlySpent < 0 || draft.currentMonthlySpent > 1_000_000_000 ||
      !/^\+?[\d\s()-]{8,30}$/.test(draft.phone) || !phoneE164 ||
      normalizedPhone.length < 8 || normalizedPhone.length > 18 ||
      !/^\+?[\d\s()-]{8,30}$/.test(draft.whatsapp) ||
      normalizePhone(draft.whatsapp).length < 8 || normalizePhone(draft.whatsapp).length > 18 ||
      draft.address.trim().length > 500 || draft.coordinates.trim().length > 100 ||
      !organizationOptions.companies.find((company) => company.name === draft.company)?.branches.includes(draft.branch) ||
      !organizationOptions.branches.includes(draft.province)) {
      onNotice('تحقق من الاسم والرقم الوظيفي والشركة والفرع والمحافظة والسقف والإنفاق والعنوان والإحداثيات وأرقام التواصل.')
      return
    }
    setWorking(true)
    try {
      const matchingCodes = await getDocs(query(
        collection(firestore, 'employee_roster'),
        where('employeeCode', '==', draft.employeeCode.trim()),
      ))
      if (matchingCodes.docs.some((item) => item.id !== selectedEmail)) {
        onNotice('هذا الرقم الوظيفي مرتبط بسجل موظف آخر.')
        return
      }
      const matchingPhones = await getDocs(query(
        collection(firestore, 'employee_roster'),
        where('phoneLookup', '==', normalizedPhone),
      ))
      if (matchingPhones.docs.some((item) => item.id !== selectedEmail)) {
        onNotice('رقم الهاتف مرتبط بسجل موظف آخر.')
        return
      }
      const profilesQuery = await getDocs(query(collection(firestore, 'employees'), where('email', '==', selectedEmail)))
      const period = currentPeriod
      const previousRecord = records.find((record) => record.email === selectedEmail)
      const previousPhoneE164 = previousRecord?.phoneE164 || toE164PhoneNumber(previousRecord?.phone ?? '')
      const protectedFields = {
        employeeCode: draft.employeeCode.trim(),
        company: draft.company,
        branch: draft.branch,
        province: draft.province,
        monthlySpendingLimit: draft.monthlySpendingLimit ?? deleteField(),
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
        phoneE164,
        phoneLookup: normalizedPhone,
        whatsapp: draft.whatsapp.trim(),
        active: draft.active,
        approvedBy: user.uid,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      batch.set(doc(firestore, 'employee_phone_lookup', phoneE164), {
        email: selectedEmail,
        phoneNumber: phoneE164,
        updatedAt: serverTimestamp(),
      })
      if (previousPhoneE164 && previousPhoneE164 !== phoneE164) {
        batch.delete(doc(firestore, 'employee_phone_lookup', previousPhoneE164))
        batch.delete(doc(firestore, 'employee_auth_lookup',
          employeePasswordLoginEmail(previousPhoneE164, firebaseProjectId)))
      }
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
      closeEditor()
      onNotice(`تم حفظ بيانات ${draft.name.trim()} ورقم الهاتف المعتمد لتسجيل الدخول.`)
    } catch (error) {
      console.error(`Unable to save employee profile ${selectedEmail}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function enablePasswordLogin() {
    if (!firestore || !selectedEmail) return
    const phoneNumber = draft.phoneE164 || toE164PhoneNumber(draft.phone)
    const authEmail = employeePasswordLoginEmail(phoneNumber, firebaseProjectId)
    if (!phoneNumber || !authEmail) {
      onNotice('صحح رقم الهاتف إلى الصيغة الدولية قبل تفعيل دخول كلمة المرور.')
      return
    }
    const savedRecord = records.find((record) => record.email === selectedEmail)
    const savedPhoneNumber = savedRecord?.phoneE164 || toE164PhoneNumber(savedRecord?.phone ?? '')
    if (!draft.active || savedPhoneNumber !== phoneNumber) {
      onNotice('احفظ رقم الهاتف المعتمد أولاً، وتأكد من تفعيل الموظف قبل ربط حساب الدخول.')
      return
    }
    setWorking(true)
    try {
      const existingLink = await getDoc(doc(firestore, 'employee_auth_lookup', authEmail))
      if (existingLink.exists() && existingLink.data().email !== selectedEmail) {
        onNotice('عنوان الدخول مرتبط بسجل موظف آخر. راجع مسؤول النظام قبل المتابعة.')
        return
      }
      await setDoc(doc(firestore, 'employee_auth_lookup', authEmail), {
        authEmail,
        email: selectedEmail,
        phoneNumber,
        phoneDigits: phoneNumber.replace(/\D/g, ''),
        updatedAt: serverTimestamp(),
      })
      setPasswordLoginEmails((current) => new Set(current).add(selectedEmail))
      onNotice('تم ربط حساب الدخول الموجود بسجل الموظف. هذا الإجراء لا ينشئ حساباً ولا يغيّر كلمة المرور.')
    } catch (error) {
      console.error(`Unable to enable password login for employee ${selectedEmail}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function createPasswordLogin() {
    if (!firestore || !selectedEmail) return
    if (employeePassword.length < 8 || employeePassword.length > 256) {
      onNotice('يجب أن تكون كلمة المرور بين ٨ و٢٥٦ حرفاً.')
      return
    }
    if (employeePassword !== employeePasswordConfirmation) {
      onNotice('كلمتا المرور غير متطابقتين.')
      return
    }
    const savedRecord = records.find((record) => record.email === selectedEmail)
    const phoneNumber = savedRecord?.phoneE164 || toE164PhoneNumber(savedRecord?.phone ?? '')
    const authEmail = employeePasswordLoginEmail(phoneNumber, firebaseProjectId)
    if (!savedRecord?.active || !authEmail || phoneNumber !== (draft.phoneE164 || toE164PhoneNumber(draft.phone))) {
      onNotice('احفظ الموظف ورقم هاتفه الدولي أولاً، وتأكد من أن سجل الموظف نشط.')
      return
    }

    setWorking(true)
    let accountCreated = false
    try {
      const existingLink = await getDoc(doc(firestore, 'employee_auth_lookup', authEmail))
      if (existingLink.exists() && existingLink.data().email !== selectedEmail) {
        onNotice('عنوان الدخول مرتبط بسجل موظف آخر. راجع مسؤول النظام قبل المتابعة.')
        return
      }
      await createEmployeeLoginAccount(authEmail, employeePassword)
      accountCreated = true
      await setDoc(doc(firestore, 'employee_auth_lookup', authEmail), {
        authEmail,
        email: selectedEmail,
        phoneNumber,
        phoneDigits: phoneNumber.replace(/\D/g, ''),
        updatedAt: serverTimestamp(),
      })
      setPasswordLoginEmails((current) => new Set(current).add(selectedEmail))
      setEmployeePassword('')
      setEmployeePasswordConfirmation('')
      onNotice(`تم إنشاء حساب الدخول للموظف ${draft.name || selectedEmail}. سلّمه كلمة المرور الآن؛ لن تُحفظ أو تُعرض مرة أخرى.`)
    } catch (error) {
      console.error(`Unable to create password login for employee ${selectedEmail}.`, error)
      onNotice(accountCreated
        ? `أُنشئ حساب الدخول لكن تعذر ربطه بسجل الموظف. استخدم «ربط حساب موجود» لإكمال الربط. ${firebaseErrorMessage(error)}`
        : firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function disablePasswordLogin() {
    if (!firestore || !selectedEmail) return
    const phoneNumber = draft.phoneE164 || toE164PhoneNumber(draft.phone)
    const authEmail = employeePasswordLoginEmail(phoneNumber, firebaseProjectId)
    if (!authEmail) return
    setWorking(true)
    try {
      await deleteDoc(doc(firestore, 'employee_auth_lookup', authEmail))
      setPasswordLoginEmails((current) => {
        const next = new Set(current)
        next.delete(selectedEmail)
        return next
      })
      onNotice('أُلغي ربط تسجيل الدخول لهذا الموظف. حساب المصادقة نفسه لم يُحذف.')
    } catch (error) {
      console.error(`Unable to disable password login for employee ${selectedEmail}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function approveSignupRequest(request: EmployeeSignupRequest, name: string, employeeCode: string) {
    if (!firestore) return
    const approvedName = name.trim()
    const approvedCode = employeeCode.trim()
    if (!approvedName || approvedName.length > 120 || !approvedCode || approvedCode.length > 80) {
      onNotice('أدخل الاسم الكامل والكود الوظيفي الصحيحين قبل اعتماد الطلب.')
      return
    }
    const matchingEmployees = records.filter((record) =>
      (record.phoneE164 || toE164PhoneNumber(record.phone)) === request.phoneNumber && record.active)
    if (matchingEmployees.length !== 1) {
      onNotice(matchingEmployees.length === 0
        ? 'لا يوجد موظف نشط مطابق لهذا الرقم. أضف الموظف أو حدّث رقم هاتفه في سجل الموظفين أولاً.'
        : 'رقم الهاتف مرتبط بأكثر من موظف. راجع سجلات الموظفين وصححها أولاً.')
      return
    }
    const employee = matchingEmployees[0]
    if (records.some((record) =>
      record.email !== employee.email && record.employeeCode.trim() === approvedCode)) {
      onNotice('الكود الوظيفي مرتبط بسجل موظف آخر؛ صححه قبل اعتماد الطلب.')
      return
    }
    const expectedAuthEmail = employeePasswordLoginEmail(request.phoneNumber, firebaseProjectId)
    if (!expectedAuthEmail || request.authEmail !== expectedAuthEmail ||
      request.phoneDigits !== request.phoneNumber.replace(/\D/g, '')) {
      onNotice('بيانات الحساب لا تتطابق مع رقم الهاتف. راجع تفاصيل طلب التسجيل.')
      return
    }

    setWorking(true)
    try {
      const lookupRef = doc(firestore, 'employee_auth_lookup', request.authEmail)
      const existingLink = await getDoc(lookupRef)
      if (existingLink.exists() && existingLink.data().email !== employee.email) {
        onNotice('حساب الدخول مرتبط بالفعل بسجل موظف آخر. راجع سجلات الموظفين قبل المتابعة.')
        return
      }
      const batch = writeBatch(firestore)
      batch.set(doc(firestore, 'employee_roster', employee.email), {
        name: approvedName,
        employeeCode: approvedCode,
        updatedAt: serverTimestamp(),
        approvedBy: user.uid,
      }, { merge: true })
      batch.set(doc(firestore, 'employee_sync_queue', employee.email), {
        email: employee.email,
        status: 'pending',
        updatedAt: serverTimestamp(),
      })
      batch.set(lookupRef, {
        authEmail: request.authEmail,
        email: employee.email,
        phoneNumber: request.phoneNumber,
        phoneDigits: request.phoneDigits,
        updatedAt: serverTimestamp(),
      })
      batch.set(doc(firestore, 'employees', request.uid), {
        email: employee.email,
        name: approvedName,
        employeeCode: approvedCode,
        address: employee.address,
        coordinates: employee.coordinates,
        phone: employee.phone,
        whatsapp: employee.whatsapp,
      }, { merge: true })
      batch.update(doc(firestore, 'employee_signup_requests', request.uid), {
        status: 'approved',
        reviewedBy: user.uid,
        reviewedAt: serverTimestamp(),
      })
      await batch.commit()
      setPasswordLoginEmails((current) => new Set(current).add(employee.email))
      setSignupEdits((current) => {
        const next = { ...current }
        delete next[request.uid]
        return next
      })
      onNotice(`تم اعتماد ${approvedName} بالكود الوظيفي ${approvedCode}، وربط حساب Firebase بسجل الموظف. يمكنه تسجيل الدخول الآن.`)
    } catch (error) {
      console.error(`Unable to approve employee signup request ${request.uid}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function rejectSignupRequest(request: EmployeeSignupRequest) {
    if (!firestore) return
    setWorking(true)
    try {
      await updateDoc(doc(firestore, 'employee_signup_requests', request.uid), {
        status: 'rejected',
        reviewedBy: user.uid,
        reviewedAt: serverTimestamp(),
      })
      onNotice(`تم رفض طلب التسجيل للرقم ${request.phoneNumber}.`)
    } catch (error) {
      console.error(`Unable to reject employee signup request ${request.uid}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function copyPasswordLoginEmail() {
    const phoneNumber = draft.phoneE164 || toE164PhoneNumber(draft.phone)
    const authEmail = employeePasswordLoginEmail(phoneNumber, firebaseProjectId)
    if (!authEmail) {
      onNotice('تعذر تكوين عنوان الدخول. تحقق من رقم الهاتف وإعداد المشروع.')
      return
    }
    try {
      await navigator.clipboard.writeText(authEmail)
      onNotice('نُسخ عنوان الدخول الداخلي.')
    } catch (error) {
      console.error('Unable to copy the employee password-login address.', error)
      onNotice('تعذر نسخ العنوان تلقائياً. حدده وانسخه يدوياً.')
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
      closeEditor()
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
      const savedRecord = records.find((record) => record.email === selectedEmail)
      const phoneE164 = savedRecord?.phoneE164 || toE164PhoneNumber(savedRecord?.phone ?? '')
      if (phoneE164) {
        batch.delete(doc(firestore, 'employee_phone_lookup', phoneE164))
        const authEmail = employeePasswordLoginEmail(phoneE164, firebaseProjectId)
        if (authEmail) batch.delete(doc(firestore, 'employee_auth_lookup', authEmail))
      }
      profiles.docs.forEach((profile) => batch.delete(profile.ref))
      batch.set(doc(firestore, 'employee_sync_queue', selectedEmail), {
        email: selectedEmail,
        status: 'pending',
        action: 'deleted',
        updatedAt: serverTimestamp(),
      })
      await batch.commit()
      closeEditor()
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
    <div className="admin-panel-heading"><div><h3>سجل الموظفين وتعديل بياناتهم</h3><p>تُدار بيانات الموظفين وأرقام الهواتف وحالة دخول كلمة المرور.</p></div><div><span>{records.length} موظف</span></div></div>
    <label className="admin-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالبريد أو الاسم أو الرقم الوظيفي أو الهاتف" /></label>
    {signupRequests.length > 0 && <section className="employee-signup-requests" aria-labelledby="employee-signup-requests-title">
      <h4 id="employee-signup-requests-title">طلبات التسجيل بانتظار المراجعة ({signupRequests.length})</h4>
      <p>اعتماد الطلب يربط حساب الهاتف بسجل موظف نشط مطابق. إذا لم يوجد سجل، أضف الموظف أولاً.</p>
      <div className="employee-signup-request-list">{signupRequests.map((request) => {
        const phoneMatches = records.filter((record) =>
          (record.phoneE164 || toE164PhoneNumber(record.phone)) === request.phoneNumber && record.active)
        const matchingEmployee = phoneMatches.length === 1 ? phoneMatches[0] : null
        const edits = signupEdits[request.uid]
        const requestName = edits?.name ?? request.name ?? matchingEmployee?.name ?? ''
        const requestCode = edits?.employeeCode ?? request.employeeCode ?? matchingEmployee?.employeeCode ?? ''
        return <article key={request.uid}>
          <div className="employee-signup-request-details">
            <strong>بيانات طلب التسجيل</strong><span dir="ltr">{request.phoneNumber}</span>
            <label className="field"><span>الاسم الكامل</span><input required maxLength={120} value={requestName} onChange={(event) => setSignupEdits((current) => ({ ...current, [request.uid]: { name: event.target.value, employeeCode: requestCode } }))} /></label>
            <label className="field"><span>الكود الوظيفي</span><input required maxLength={80} value={requestCode} onChange={(event) => setSignupEdits((current) => ({ ...current, [request.uid]: { name: requestName, employeeCode: event.target.value } }))} /></label>
            <small>{matchingEmployee ? `السجل المطابق بالهاتف: ${matchingEmployee.name || 'اسم غير مسجل'} (${matchingEmployee.employeeCode || 'كود غير مسجل'}).` : 'لا يوجد سجل موظف نشط وفريد يطابق رقم الهاتف.'} سيتم حفظ الاسم والكود المدخلين في ملف الموظف عند الاعتماد.</small>
          </div>
          <div className="employee-profile-editor-actions">
            <button type="button" className="admin-add-button" disabled={working || !matchingEmployee || !requestName.trim() || !requestCode.trim()} onClick={() => void approveSignupRequest(request, requestName, requestCode)}>اعتماد وربط الحساب</button>
            <button type="button" className="employee-profile-state-button" disabled={working} onClick={() => void rejectSignupRequest(request)}>رفض الطلب</button>
          </div>
        </article>
      })}</div>
    </section>}
    <div className="employee-profile-results">{filtered.map((record) => <article className="employee-profile-row" key={record.email}>
      <div><strong>{record.name || 'اسم غير متوفر'}</strong><span>الكود الوظيفي: {record.employeeCode || 'غير محدد'} · {record.phone || 'لا يوجد هاتف'}</span><small dir="ltr">{record.email}</small><small className={passwordLoginEmails.has(record.email) ? 'employee-login-status-ready' : 'employee-login-status-pending'}>{passwordLoginEmails.has(record.email) ? 'ربط الدخول موجود في Firestore' : 'لم يُنشأ ربط الدخول بعد'}</small></div>
      <button type="button" className="employee-profile-open" onClick={() => chooseEmployee(record)}><Edit3 size={15} /> تعديل الموظف</button>
    </article>)}{!filtered.length && <div className="admin-empty"><Users size={26} /><strong>لا توجد سجلات مطابقة</strong></div>}</div>
    {editorOpen && selectedEmail && <div className="admin-modal-backdrop employee-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) closeEditor() }}>
      <form className="employee-profile-admin-form employee-profile-editor" role="dialog" aria-modal="true" aria-labelledby="employee-editor-title" onSubmit={(event) => void saveEmployee(event)}>
        <div className="admin-form-heading"><div><h3 id="employee-editor-title">الملف الوظيفي</h3><p dir="ltr">{draft.email}</p></div><button type="button" aria-label="إغلاق" disabled={working} onClick={closeEditor}><X size={20} /></button></div>
        <label className="field"><span>اسم الموظف</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="field"><span>الرقم الوظيفي</span><input required value={draft.employeeCode} onChange={(event) => setDraft((current) => ({ ...current, employeeCode: event.target.value }))} /></label>
        <label className="field"><span>الشركة</span><select required value={draft.company} onChange={(event) => setDraft((current) => ({ ...current, company: event.target.value, branch: '' }))}><option value="">اختر الشركة</option>{organizationOptions.companies.map((company) => <option key={company.name}>{company.name}</option>)}</select></label>
        <label className="field"><span>الفرع</span><select required value={draft.branch} onChange={(event) => setDraft((current) => ({ ...current, branch: event.target.value }))}><option value="">اختر الفرع</option>{organizationOptions.companies.find((company) => company.name === draft.company)?.branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label>
        <label className="field"><span>المحافظة</span><select required value={draft.province} onChange={(event) => setDraft((current) => ({ ...current, province: event.target.value }))}><option value="">اختر المحافظة</option>{organizationOptions.branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label>
        <label className="field"><span>السقف الشهري (ر.ي)</span><input type="number" min="0" value={draft.monthlySpendingLimit ?? ''} onChange={(event) => setDraft((current) => ({ ...current, monthlySpendingLimit: event.target.value ? Number(event.target.value) : undefined }))} /><small>اتركه فارغاً أو أدخل 0 ليكون السقف غير محدود.</small></label>
        <label className="field"><span>الإنفاق الشهري الحالي (ر.ي)</span><input required type="number" min="0" value={draft.currentMonthlySpent} onChange={(event) => setDraft((current) => ({ ...current, currentMonthlySpent: Number(event.target.value) }))} /></label>
        <label className="field"><span>العنوان</span><input value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} /></label>
        <label className="field"><span>الإحداثيات</span><input value={draft.coordinates} onChange={(event) => setDraft((current) => ({ ...current, coordinates: event.target.value }))} /></label>
        <label className="field"><span>هاتف الموظف المسجل</span><input required type="tel" dir="ltr" value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value, phoneE164: toE164PhoneNumber(event.target.value) }))} /><small>استخدم الصيغة الدولية مع + ورمز الدولة، مثل +9677XXXXXXXX.</small></label>
        <label className="field"><span>واتساب</span><input value={draft.whatsapp} onChange={(event) => setDraft((current) => ({ ...current, whatsapp: event.target.value }))} /></label>
        <div className="employee-password-help"><strong><Phone size={15} /> دخول الهاتف وكلمة المرور</strong><small>إنشاء حساب الدخول يضيف المستخدم إلى Firebase Authentication وينشئ ربطاً خاصاً في Firestore؛ لا تُحفظ كلمة المرور في Firestore. سلّمها للموظف بطريقة آمنة. إعادة تعيين كلمة مرور حساب موجود تتطلب أداة المشرف الموثوقة.</small></div>
        <label className="field"><span>عنوان الدخول الداخلي (Email/Password)</span><span className="password-login-address" dir="ltr">{employeePasswordLoginEmail(draft.phoneE164 || toE164PhoneNumber(draft.phone), firebaseProjectId) || 'تحقق من رقم الهاتف وإعداد المشروع'}</span></label>
        <div className="employee-password-setup">
            <div className="employee-password-ready"><strong><Check size={15} /> {passwordLoginEmails.has(selectedEmail) ? 'رابط Firestore موجود' : 'لم يُنشأ رابط الدخول بعد'}</strong><small>لا يمكن للوحة التحقق من وجود المستخدم في Firebase Authentication. جرّب إنشاءه بكلمة مرور أولية؛ إذا كان موجوداً بالفعل فغيّر كلمة مروره بأداة المشرف، أو استخدم «ربط حساب موجود» إذا لم يكن رابط Firestore منشأً.</small></div>
            <label className="field"><span>كلمة المرور الأولية</span><input type="password" autoComplete="new-password" minLength={8} maxLength={256} value={employeePassword} onChange={(event) => setEmployeePassword(event.target.value)} placeholder="٨ أحرف على الأقل" /></label>
            <label className="field"><span>تأكيد كلمة المرور</span><input type="password" autoComplete="new-password" minLength={8} maxLength={256} value={employeePasswordConfirmation} onChange={(event) => setEmployeePasswordConfirmation(event.target.value)} placeholder="أعد كتابة كلمة المرور" /></label>
            <div className="employee-profile-editor-actions">
              <button type="button" className="admin-add-button" disabled={working || !employeePassword || !employeePasswordConfirmation} onClick={() => void createPasswordLogin()}><KeyRound size={14} /> إنشاء حساب وتعيين كلمة المرور</button>
              {!passwordLoginEmails.has(selectedEmail) && <button type="button" className="admin-export-button" disabled={working} onClick={() => void enablePasswordLogin()}>ربط حساب موجود</button>}
            </div>
          </div>
        <div className="employee-profile-editor-actions">
          <button type="button" className="admin-export-button" disabled={working} onClick={() => void copyPasswordLoginEmail()}>نسخ عنوان الدخول</button>
          {passwordLoginEmails.has(selectedEmail)
            ? <button type="button" className="employee-profile-state-button" disabled={working} onClick={() => void disablePasswordLogin()}>إلغاء ربط الدخول</button>
            : null}
        </div>
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
