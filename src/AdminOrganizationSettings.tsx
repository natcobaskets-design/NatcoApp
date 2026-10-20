import { useEffect, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { Building2, Edit3, LoaderCircle, MapPin, Plus, Save, Trash2, X } from 'lucide-react'
import {
  defaultOrganizationOptions, parseOrganizationOptions,
  type OrganizationCompany, type OrganizationOptions,
} from './domain'
import { firebaseErrorMessage, firestore } from './firebase'

type Props = {
  user: User
  onNotice: (message: string) => void
  onOptionsSaved: (options: OrganizationOptions) => void
}
const documentId = 'organization_options'
const maximumOptions = 50
const maximumOptionLength = 80

function normalizedNames(names: string[]) {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))]
}

function validateOptions(options: OrganizationOptions) {
  if (!options.companies.length || options.companies.length > maximumOptions ||
    !options.branches.length || options.branches.length > maximumOptions) return false
  const companyNames = options.companies.map((company) => company.name.trim())
  if (companyNames.some((name) => !name || name.length > maximumOptionLength) ||
    new Set(companyNames.map((name) => name.toLocaleLowerCase())).size !== companyNames.length) return false
  if (options.branches.some((branch) => !branch || branch.length > maximumOptionLength) ||
    new Set(options.branches.map((branch) => branch.toLocaleLowerCase())).size !== options.branches.length) return false
  return options.companies.every((company) =>
    company.branches.length > 0 &&
    company.branches.every((branch) => options.branches.includes(branch)))
}

export function AdminOrganizationSettings({ user, onNotice, onOptionsSaved }: Props) {
  const [options, setOptions] = useState<OrganizationOptions>(defaultOrganizationOptions)
  const [branchDraft, setBranchDraft] = useState('')
  const [editingCompanyIndex, setEditingCompanyIndex] = useState<number | null>(null)
  const [companyDraft, setCompanyDraft] = useState<OrganizationCompany>({ name: '', branches: [] })
  const [loading, setLoading] = useState(Boolean(firestore))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!firestore) return
    let current = true
    void getDoc(doc(firestore, 'admin_settings', documentId)).then((snapshot) => {
      if (!current) return
      if (snapshot.exists()) {
        const parsed = parseOrganizationOptions(snapshot.data())
        if (!parsed) {
          onNotice('إعدادات الشركات والفروع المحفوظة غير صالحة. راجع مسؤول النظام.')
          setLoading(false)
          return
        }
        setOptions(parsed)
      }
      setSaved(snapshot.exists())
      setLoading(false)
    }).catch((error: unknown) => {
      console.error('Unable to load company and branch options.', error)
      if (current) {
        onNotice(firebaseErrorMessage(error))
        setLoading(false)
      }
    })
    return () => { current = false }
  }, [onNotice])

  function addCompany() {
    const index = options.companies.length
    const company = { name: '', branches: options.branches.length ? [options.branches[0]] : [] }
    setOptions((current) => ({
      ...current,
      companies: [...current.companies, company],
    }))
    setCompanyDraft(company)
    setEditingCompanyIndex(index)
  }

  function editCompany(index: number) {
    const company = options.companies[index]
    if (!company) return
    setCompanyDraft({ ...company, branches: [...company.branches] })
    setEditingCompanyIndex(index)
  }

  function saveCompanyDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editingCompanyIndex === null) return
    const name = companyDraft.name.trim()
    const branches = normalizedNames(companyDraft.branches)
    const duplicate = options.companies.some((company, index) =>
      index !== editingCompanyIndex && company.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())
    if (!name || name.length > maximumOptionLength || duplicate || !branches.length) {
      onNotice('أدخل اسماً غير مكرر للشركة واختر فرعاً واحداً على الأقل.')
      return
    }
    setOptions((current) => ({
      ...current,
      companies: current.companies.map((company, index) =>
        index === editingCompanyIndex ? { name, branches } : company),
    }))
    setEditingCompanyIndex(null)
  }

  function addCompanyBranch() {
    const name = branchDraft.trim()
    if (!name || editingCompanyIndex === null) return
    if (name.length > maximumOptionLength) {
      onNotice(`لا يمكن أن يتجاوز اسم الفرع ${maximumOptionLength} حرفاً.`)
      return
    }
    if (options.branches.some((branch) => branch.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      onNotice('هذا الفرع موجود بالفعل.')
      return
    }
    if (options.branches.length >= maximumOptions) {
      onNotice(`الحد الأعلى هو ${maximumOptions} فرعاً.`)
      return
    }
    setOptions((current) => ({ ...current, branches: [...current.branches, name] }))
    setCompanyDraft((current) => ({ ...current, branches: [...current.branches, name] }))
    setBranchDraft('')
  }

  function addBranch() {
    const name = branchDraft.trim()
    if (!name) return
    if (name.length > maximumOptionLength) {
      onNotice(`لا يمكن أن يتجاوز اسم الفرع ${maximumOptionLength} حرفاً.`)
      return
    }
    if (options.branches.some((branch) => branch.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      onNotice('هذا الفرع موجود بالفعل.')
      return
    }
    if (options.branches.length >= maximumOptions) {
      onNotice(`الحد الأعلى هو ${maximumOptions} فرعاً.`)
      return
    }
    setOptions((current) => ({ ...current, branches: [...current.branches, name] }))
    setBranchDraft('')
  }

  async function saveOptions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!firestore) {
      onNotice('خدمة قاعدة البيانات غير متاحة حالياً.')
      return
    }
    const normalized: OrganizationOptions = {
      companies: options.companies.map((company) => ({
        name: company.name.trim(),
        branches: normalizedNames(company.branches),
      })),
      branches: normalizedNames(options.branches),
    }
    if (!validateOptions(normalized)) {
      onNotice('أدخل أسماء شركات وفروع صحيحة وغير مكررة، واربط فرعاً واحداً على الأقل بكل شركة.')
      return
    }

    setSaving(true)
    try {
      await setDoc(doc(firestore, 'admin_settings', documentId), {
        ...normalized,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      })
      setOptions(normalized)
      onOptionsSaved(normalized)
      setSaved(true)
      onNotice('تم حفظ الشركات وفروعها وتحديث قوائم الموظفين.')
    } catch (error) {
      console.error('Unable to save company and branch options.', error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return <section className="admin-panel integration-settings organization-settings">
    <div className="admin-panel-heading">
      <div><h3>إدارة الشركات والفروع</h3><p>أضف كل شركة منفردة، ثم حدّد المحافظات التي لديها فروع فيها. تظهر للموظف فروع الشركة المختارة فقط.</p></div>
    </div>
    <div className="integration-status" role="status">
      <Building2 size={17} />
      <span>{saved ? 'تُستخدم الشركات وفروعها المحفوظة في نموذج بيانات الموظف.' : 'لم تُخصص القوائم بعد؛ تظهر الخيارات الافتراضية حتى تحفظ تغييراتك.'}</span>
    </div>
    {loading ? <div className="admin-loading"><LoaderCircle size={19} /> جارٍ تحميل القوائم…</div> :
      <form className="integration-form" onSubmit={(event) => void saveOptions(event)}>
        <div className="organization-section-heading">
          <div><strong>الشركات وفروعها</strong><small>اختر فرعاً واحداً أو أكثر لكل شركة.</small></div>
          <button className="admin-add-button" type="button" onClick={addCompany} disabled={options.companies.length >= maximumOptions}>
            <Plus size={15} /> إضافة شركة
          </button>
        </div>
        <div className="organization-company-list">
          {options.companies.map((company, index) => <article className="organization-company-card" key={`company-${index}`}>
            <div className="organization-company-heading">
              <strong>{company.name || 'شركة جديدة — أكمل بياناتها'}</strong>
              <button className="organization-edit-button" type="button" aria-label={`تعديل الشركة ${company.name || index + 1}`} onClick={() => editCompany(index)}>
                <Edit3 size={16} /><span>تعديل</span>
              </button>
              <button
                className="organization-remove-button"
                type="button"
                aria-label={`حذف الشركة ${company.name || index + 1}`}
                disabled={options.companies.length <= 1}
                onClick={() => setOptions((current) => ({
                  ...current,
                  companies: current.companies.filter((_, itemIndex) => itemIndex !== index),
                }))}
              ><Trash2 size={16} /></button>
            </div>
          </article>)}
        </div>

        <div className="organization-branch-manager">
          <div><strong>المحافظات المتاحة</strong><small>أضف محافظة مرة واحدة، ثم اربطها بالشركات المناسبة.</small></div>
          <div className="organization-branch-list">
            {options.branches.map((branch) => <span className="organization-branch-chip" key={branch}>
              {branch}
              <button
                type="button"
                aria-label={`حذف المحافظة ${branch}`}
                onClick={() => setOptions((current) => ({
                  branches: current.branches.filter((item) => item !== branch),
                  companies: current.companies.map((company) => ({
                    ...company, branches: company.branches.filter((item) => item !== branch),
                  })),
                }))}
              ><Trash2 size={12} /></button>
            </span>)}
          </div>
          <div className="organization-add-branch">
            <input
              value={branchDraft}
              onChange={(event) => setBranchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addBranch()
                }
              }}
              maxLength={maximumOptionLength}
              placeholder="اسم محافظة أو فرع جديد"
              aria-label="اسم محافظة أو فرع جديد"
            />
            <button className="admin-add-button" type="button" onClick={addBranch}><Plus size={15} /> إضافة محافظة</button>
          </div>
        </div>
        <button className="admin-add-button integration-save" type="submit" disabled={saving}>
          {saving ? <LoaderCircle size={15} /> : <Save size={15} />}
          {saving ? 'جارٍ الحفظ…' : 'حفظ الشركات والفروع'}
        </button>
      </form>}
    {editingCompanyIndex !== null && <div className="admin-modal-backdrop organization-editor-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setEditingCompanyIndex(null)
    }}>
      <form className="organization-company-editor" role="dialog" aria-modal="true" aria-labelledby="organization-editor-title" onSubmit={saveCompanyDraft}>
        <div className="admin-form-heading">
          <div><h3 id="organization-editor-title">تعديل بيانات الشركة</h3><p>اختر الفروع التي تتبع لهذه الشركة.</p></div>
          <button type="button" aria-label="إغلاق" onClick={() => setEditingCompanyIndex(null)}><X size={20} /></button>
        </div>
        <label className="field"><span>اسم الشركة</span><input required autoFocus maxLength={maximumOptionLength} value={companyDraft.name} onChange={(event) => setCompanyDraft((current) => ({ ...current, name: event.target.value }))} placeholder="اسم الشركة" /></label>
        <fieldset className="organization-branches">
          <legend><MapPin size={14} /> فروع الشركة</legend>
          {options.branches.map((branch) => <label className="organization-branch-option" key={branch}>
            <input type="checkbox" checked={companyDraft.branches.includes(branch)} onChange={(event) => setCompanyDraft((current) => ({
              ...current,
              branches: event.target.checked
                ? [...current.branches, branch]
                : current.branches.filter((item) => item !== branch),
            }))} />
            <span>{branch}</span>
          </label>)}
        </fieldset>
        <div className="organization-add-branch">
          <input value={branchDraft} onChange={(event) => setBranchDraft(event.target.value)} maxLength={maximumOptionLength} placeholder="أضف فرعاً جديداً لهذه الشركة" aria-label="أضف فرعاً جديداً لهذه الشركة" />
          <button className="admin-add-button" type="button" onClick={addCompanyBranch}><Plus size={15} /> إضافة فرع</button>
        </div>
        <div className="admin-form-actions"><button className="admin-cancel-button" type="button" onClick={() => setEditingCompanyIndex(null)}>إلغاء</button><button className="admin-add-button" type="submit"><Save size={14} /> حفظ الشركة</button></div>
      </form>
    </div>}
  </section>
}
