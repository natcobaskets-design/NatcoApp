import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import {
  Archive, Check, ChevronDown, CircleAlert, Download, Edit3, Eye, LoaderCircle, Package,
  Plus, Save, Search, ShieldCheck, Trash2, Upload, X,
} from 'lucide-react'
import {
  basketIncludesProduct, basketSubcategoryKey, defaultBasketDefinitions,
  defaultBasketSelectionSettings, parseBasketDefinition, productDepartments,
  type BasketDefinition, type CatalogProduct,
} from './domain'
import { firebaseErrorMessage, firestore } from './firebase'

type Props = {
  products: CatalogProduct[]
  onNotice: (message: string) => void
  userId: string
}

type Draft = Omit<BasketDefinition, 'id'>
type BasketImportRow = Omit<BasketDefinition, 'id'> & { id: string }
type BasketImportPreview = { fileName: string; rows: BasketImportRow[]; issues: string[] }

const basketCsvHeaders = [
  'id', 'name', 'kind', 'maxPerEmployee', 'description', 'active',
  'includedSubcategories', 'productIds', 'excludedProductIds',
]

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        value += character
      }
    } else if (character === '"' && value.length === 0) {
      quoted = true
    } else if (character === ',') {
      row.push(value)
      value = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }
  if (quoted) throw new Error('يوجد اقتباس غير مكتمل في ملف CSV.')
  row.push(value)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function basketCsv(baskets: BasketDefinition[]): string {
  const rows = [basketCsvHeaders]
  baskets.forEach((basket) => rows.push([
    basket.id,
    basket.name,
    basket.kind,
    String(basket.maxPerEmployee),
    basket.description,
    String(basket.active),
    basket.includedSubcategories.join('|'),
    basket.productIds.join('|'),
    basket.excludedProductIds.join('|'),
  ]))
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`
}

function downloadCsv(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const emptyDraft: Draft = {
  name: '',
  kind: 'custom',
  description: '',
  maxPerEmployee: 1,
  productIds: [],
  includedSubcategories: [],
  excludedProductIds: [],
  active: true,
}

function permissionHelp(error: unknown): string {
  const message = firebaseErrorMessage(error)
  if (message.includes('صلاحية')) {
    return 'رفض Firestore العملية. تأكد أن حسابك نشط في admin_users/{UID} وأن حقل active يساوي true، ثم أعد تحميل الصفحة.'
  }
  return message
}

function productCount(basket: BasketDefinition, products: CatalogProduct[]): number {
  return products.filter((product) => basketIncludesProduct(basket, product)).length
}

export function AdminBasketManagement({ products, onNotice, userId }: Props) {
  const [baskets, setBaskets] = useState<BasketDefinition[]>([])
  const [maxTotal, setMaxTotal] = useState(defaultBasketSelectionSettings.maxTotalPerEmployee)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState('')
  const [search, setSearch] = useState('')
  const [working, setWorking] = useState(false)
  const [loadingBaskets, setLoadingBaskets] = useState(true)
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [importPreview, setImportPreview] = useState<BasketImportPreview | null>(null)

  const filteredBaskets = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    if (!term) return baskets
    return baskets.filter((basket) =>
      `${basket.name} ${basket.description} ${basket.kind}`.toLocaleLowerCase().includes(term))
  }, [baskets, search])

  useEffect(() => {
    if (!firestore) return
    const database = firestore
    const stopBaskets = onSnapshot(collection(database, 'basket_types'), (snapshot) => {
      setBaskets(snapshot.docs.flatMap((item) => {
        const basket = parseBasketDefinition(item.id, item.data())
        if (!basket) console.error(`Ignoring malformed basket definition ${item.id}.`)
        return basket ? [basket] : []
      }))
      setLoadingBaskets(false)
    }, (error) => {
      console.error('Unable to load basket definitions for administration.', error)
      setLoadError(permissionHelp(error))
      setLoadingBaskets(false)
    })
    const stopSettings = onSnapshot(doc(database, 'admin_settings', 'basket_selection'), (snapshot) => {
      const maximum = snapshot.exists() ? snapshot.data().maxTotalPerEmployee : 2
      setMaxTotal(Number.isInteger(maximum) && Number(maximum) >= 1 && Number(maximum) <= 6
        ? Number(maximum)
        : defaultBasketSelectionSettings.maxTotalPerEmployee)
      setLoadingSettings(false)
    }, (error) => {
      console.error('Unable to load basket selection settings.', error)
      setLoadError(permissionHelp(error))
      setLoadingSettings(false)
    })
    return () => {
      stopBaskets()
      stopSettings()
    }
  }, [])

  function editBasket(basket: BasketDefinition) {
    setEditingId(basket.id)
    setDraft({
      name: basket.name,
      kind: basket.kind,
      description: basket.description,
      maxPerEmployee: basket.maxPerEmployee,
      productIds: [...basket.productIds],
      includedSubcategories: [...basket.includedSubcategories],
      excludedProductIds: [...basket.excludedProductIds],
      active: basket.active,
    })
    document.getElementById('basket-definition-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function resetDraft() {
    setDraft(emptyDraft)
    setEditingId('')
  }

  function startNewBasket() {
    resetDraft()
    document.getElementById('basket-definition-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function toggleSubcategory(departmentId: string, subcategory: string, selected: boolean) {
    const key = basketSubcategoryKey(departmentId, subcategory)
    setDraft((current) => ({
      ...current,
      includedSubcategories: selected
        ? [...new Set([...current.includedSubcategories, key])]
        : current.includedSubcategories.filter((item) => item !== key),
    }))
  }

  function toggleProduct(product: CatalogProduct, selected: boolean) {
    const categorySelected = draft.includedSubcategories.includes(
      basketSubcategoryKey(product.department, product.subcategory),
    )
    setDraft((current) => {
      const excludedProductIds = current.excludedProductIds.filter((id) => id !== product.id)
      if (!selected && categorySelected) excludedProductIds.push(product.id)
      return {
        ...current,
        productIds: categorySelected
          ? current.productIds
          : selected
            ? [...new Set([...current.productIds, product.id])]
            : current.productIds.filter((id) => id !== product.id),
        excludedProductIds,
      }
    })
  }

  async function prepareBasketImport(file: File) {
        if (file.size > 2 * 1024 * 1024) {
          onNotice('حجم ملف CSV يتجاوز الحد المسموح (2 ميغابايت).')
          return
        }
        try {
          const records = parseCsvRows((await file.text()).replace(/^\uFEFF/, ''))
          if (records.length < 2) throw new Error('يجب أن يحتوي الملف على صف عناوين وصف سلة واحد على الأقل.')
          const headers = records[0].map((header) => header.trim().toLowerCase())
          if (new Set(headers).size !== headers.length) throw new Error('توجد أعمدة مكررة في صف العناوين.')
          const indexes = new Map(headers.map((header, index) => [header, index]))
          const missing = basketCsvHeaders.filter((header) => !indexes.has(header))
          if (missing.length) throw new Error(`أعمدة القالب المطلوبة غير موجودة: ${missing.join(', ')}`)
          const unsupported = headers.filter((header) => !basketCsvHeaders.includes(header))
          if (unsupported.length) throw new Error(`أعمدة غير مدعومة في الملف: ${unsupported.join(', ')}`)
          if (records.length - 1 > 200) throw new Error('الحد الأقصى للاستيراد هو 200 سلة في الملف الواحد.')

          const categoryOptions = new Set(productDepartments.flatMap((department) =>
            department.categories.map((subcategory) => basketSubcategoryKey(department.id, subcategory))))
          const productIds = new Set(products.map((product) => product.id))
          const rows: BasketImportRow[] = []
          const issues: string[] = []
          const seenIds = new Set<string>()
          const seenNames = new Set<string>()
          records.slice(1).forEach((record, index) => {
            const line = index + 2
            const cell = (key: string) => (record[indexes.get(key) ?? -1] ?? '').trim()
            if (record.slice(basketCsvHeaders.length).some((value) => value.trim())) {
              issues.push(`السطر ${line}: يحتوي على قيم إضافية خارج الأعمدة المعتمدة.`)
              return
            }
            const id = cell('id') || `basket-${globalThis.crypto.randomUUID()}`
            const name = cell('name')
            const kind = cell('kind')
            const maxPerEmployee = Number(cell('maxPerEmployee'))
            const description = cell('description')
            const activeValue = cell('active').toLowerCase()
            const includedSubcategories = cell('includedSubcategories').split('|').map((item) => item.trim()).filter(Boolean)
            const selectedProductIds = cell('productIds').split('|').map((item) => item.trim()).filter(Boolean)
            const excludedProductIds = cell('excludedProductIds').split('|').map((item) => item.trim()).filter(Boolean)
            const errors: string[] = []
            if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) errors.push('معرّف السلة غير صالح')
            if (!name || name.length > 80) errors.push('اسم السلة مطلوب وبحد أقصى 80 حرفاً')
            if (!['essential', 'family', 'custom'].includes(kind)) errors.push('النوع يجب أن يكون essential أو family أو custom')
            if (!Number.isInteger(maxPerEmployee) || maxPerEmployee < 0 || maxPerEmployee > 6) errors.push('الحد يجب أن يكون رقماً من 0 إلى 6')
            if (description.length > 160) errors.push('الوصف يتجاوز 160 حرفاً')
            if (!['true', 'false'].includes(activeValue)) errors.push('active يجب أن تكون true أو false')
            if (includedSubcategories.some((category) => !categoryOptions.has(category))) errors.push('يوجد تصنيف غير معرف؛ استخدم departmentId::اسم التصنيف')
            if (selectedProductIds.some((productId) => !productIds.has(productId))) errors.push('يوجد معرّف منتج غير موجود في كتالوج Firebase')
            if (excludedProductIds.some((productId) => !productIds.has(productId))) errors.push('يوجد منتج مستثنى غير موجود في كتالوج Firebase')
            if (selectedProductIds.length > 50 || excludedProductIds.length > 50 || includedSubcategories.length > 60) errors.push('تجاوز الملف حد الأصناف أو التصنيفات')
            if (!selectedProductIds.length && !includedSubcategories.length) errors.push('اختر منتجاً أو تصنيفاً واحداً على الأقل')
            const nameKey = `${kind}:${name.toLocaleLowerCase()}`
            if (seenIds.has(id)) errors.push('معرّف السلة مكرر في الملف')
            if (seenNames.has(nameKey)) errors.push('اسم السلة ونوعها مكرران في الملف')
            if (baskets.some((basket) => basket.id !== id && basket.kind === kind &&
              basket.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())) {
              errors.push('توجد سلة محفوظة بالاسم والنوع نفسيهما')
            }
            if (errors.length) {
              issues.push(`السطر ${line}: ${errors.join('؛ ')}`)
              return
            }
            seenIds.add(id)
            seenNames.add(nameKey)
            rows.push({
              id,
              name,
              kind: kind as BasketDefinition['kind'],
              maxPerEmployee,
              description,
              active: activeValue === 'true',
              includedSubcategories: [...new Set(includedSubcategories)],
              productIds: [...new Set(selectedProductIds)],
              excludedProductIds: [...new Set(excludedProductIds)],
            })
          })
          setImportPreview({ fileName: file.name, rows, issues })
        } catch (error) {
          console.error('Unable to parse basket CSV import.', error)
          onNotice(error instanceof Error ? error.message : 'تعذرت قراءة ملف CSV.')
          setImportPreview(null)
        }
      }

  async function importBaskets() {
        if (!firestore || !importPreview || importPreview.issues.length || !importPreview.rows.length) return
        const database = firestore
        setWorking(true)
        try {
          const batch = writeBatch(database)
          importPreview.rows.forEach((basket) => {
            const { id, ...data } = basket
            batch.set(doc(database, 'basket_types', id), {
              ...data,
              updatedAt: serverTimestamp(),
              updatedBy: userId,
            }, { merge: true })
          })
          await batch.commit()
          onNotice(`تم استيراد ${importPreview.rows.length} سلة إلى Firebase.`)
          setImportPreview(null)
        } catch (error) {
          console.error('Unable to import basket definitions.', error)
          onNotice(permissionHelp(error))
        } finally {
          setWorking(false)
        }
  }

  async function saveBasket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!firestore) {
      onNotice('اتصال Firestore غير مهيأ. لم يتم حفظ السلة.')
      return
    }
    const name = draft.name.trim()
    const productIds = [...new Set(draft.productIds)]
    const includedSubcategories = [...new Set(draft.includedSubcategories)]
    const excludedProductIds = [...new Set(draft.excludedProductIds)]
    if (!name || name.length > 80 || draft.description.length > 160 ||
      !Number.isInteger(draft.maxPerEmployee) || draft.maxPerEmployee < 0 ||
      draft.maxPerEmployee > 6 || productIds.length > 50 ||
      includedSubcategories.length > 60 || excludedProductIds.length > 50 ||
      (productIds.length === 0 && includedSubcategories.length === 0)) {
      onNotice('أكمل اسم السلة، وحدد حداً ضمن الحد الإجمالي واختر تصنيفاً أو صنفاً واحداً على الأقل.')
      return
    }
    const normalizedName = name.trim().toLocaleLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
      .replace(/[أإآ]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/\s+/g, ' ')
    const duplicate = baskets.find((basket) =>
      basket.id !== editingId &&
      basket.kind === draft.kind &&
      basket.name.trim().toLocaleLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
        .replace(/[أإآ]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/\s+/g, ' ') === normalizedName)
    if (duplicate) {
      onNotice(`توجد سلة من النوع نفسه باسم «${duplicate.name}». افتحها للتعديل بدلاً من إضافة نسخة مكررة.`)
      return
    }
    setWorking(true)
    try {
      const id = editingId || `basket-${globalThis.crypto.randomUUID()}`
      await setDoc(doc(firestore, 'basket_types', id), {
        ...draft,
        name,
        productIds,
        includedSubcategories,
        excludedProductIds,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      }, { merge: true })
      onNotice(editingId ? 'تم تحديث السلة في Firebase.' : 'تمت إضافة السلة إلى Firebase.')
      resetDraft()
    } catch (error) {
      console.error('Unable to save basket definition.', error)
      onNotice(permissionHelp(error))
    } finally {
      setWorking(false)
    }
  }

  async function initializeDefaultBaskets() {
    if (!firestore || baskets.length || loadingBaskets) return
    const database = firestore
    setWorking(true)
    try {
      const batch = writeBatch(database)
      defaultBasketDefinitions.forEach((basket) =>
        batch.set(doc(database, 'basket_types', basket.id), {
          ...basket,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        }, { merge: true }))
      await batch.commit()
      onNotice('تم إنشاء السلال الافتراضية في Firebase.')
    } catch (error) {
      console.error('Unable to initialize default basket definitions.', error)
      onNotice(permissionHelp(error))
    } finally {
      setWorking(false)
    }
  }

  async function saveGlobalMaximum(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!firestore || !Number.isInteger(maxTotal) || maxTotal < 1 || maxTotal > 6) {
      onNotice('الحد الإجمالي يجب أن يكون من 1 إلى 6 سلال.')
      return
    }
    setWorking(true)
    try {
      await setDoc(doc(firestore, 'admin_settings', 'basket_selection'), {
        maxTotalPerEmployee: maxTotal,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      })
      onNotice('تم حفظ الحد الإجمالي للسلال لكل موظف في Firebase.')
    } catch (error) {
      console.error('Unable to save the global basket selection limit.', error)
      onNotice(permissionHelp(error))
    } finally {
      setWorking(false)
    }
  }

  async function removeBasket(basket: BasketDefinition) {
    if (!firestore || !window.confirm(`حذف «${basket.name}» من خيارات الطلب؟ ستبقى الطلبات السابقة كما هي.`)) return
    setWorking(true)
    try {
      await deleteDoc(doc(firestore, 'basket_types', basket.id))
      onNotice('تم حذف السلة من Firebase. لم تتأثر الطلبات السابقة.')
      if (editingId === basket.id) resetDraft()
    } catch (error) {
      console.error(`Unable to delete basket definition ${basket.id}.`, error)
      onNotice(permissionHelp(error))
    } finally {
      setWorking(false)
    }
  }

  const selectedProductCount = products.filter((product) => basketIncludesProduct(draft, product)).length
  const visibleLoadError = loadError || (!firestore
    ? 'اتصال Firestore غير مهيأ. تحقق من إعدادات Firebase قبل إدارة السلال.'
    : '')

  return <section className="admin-panel basket-management" aria-labelledby="basket-management-title">
    <header className="basket-admin-header">
      <div className="basket-admin-title">
        <span className="basket-admin-icon"><Archive size={20} /></span>
        <div>
          <span className="basket-admin-eyebrow"><ShieldCheck size={13} /> إعدادات الطلبات</span>
          <h2 id="basket-management-title">إدارة السلال الغذائية</h2>
          <p>تحكم في عدد السلال لكل موظف، وحدد محتويات كل سلة من أقسام وتصنيفات الكتالوج.</p>
        </div>
      </div>
      <button type="button" className="basket-primary-action" onClick={startNewBasket} disabled={working}>
        <Plus size={16} /> سلة جديدة
      </button>
    </header>

    {visibleLoadError && <div className="basket-admin-alert" role="alert">
      <CircleAlert size={18} /><div><strong>تعذر تحميل إعدادات السلال</strong><span>{visibleLoadError}</span></div>
    </div>}

    <div className="basket-admin-metrics">
      <article><span><Archive size={17} /></span><small>السلال المحفوظة في Firebase</small><strong>{baskets.length}</strong></article>
      <article><span><Check size={17} /></span><small>السلال المتاحة للموظفين</small><strong>{baskets.filter((basket) => basket.active).length}</strong></article>
      <article><span><Package size={17} /></span><small>الحد الأقصى لكل موظف</small><strong>{maxTotal} <small>سلة</small></strong></article>
    </div>

    <form className="basket-global-limit" onSubmit={(event) => void saveGlobalMaximum(event)}>
      <div className="basket-section-heading">
        <span className="basket-section-icon"><ShieldCheck size={17} /></span>
        <div><h3>الحد العام للموظف</h3><p>يطبق على مجموع السلال المختارة، بصرف النظر عن نوعها.</p></div>
      </div>
      <label className="basket-limit-control">
        <span>مجموع السلال المسموح</span>
        <select value={maxTotal} onChange={(event) => setMaxTotal(Number(event.target.value))} disabled={loadingSettings || working}>
          {Array.from({ length: 6 }, (_, index) => index + 1).map((value) =>
            <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <button type="submit" className="basket-save-button" disabled={working || loadingSettings}>
        {working ? <LoaderCircle size={15} className="basket-spinner" /> : <Save size={15} />} حفظ الحد
      </button>
    </form>

    <section className="basket-catalog-panel" aria-labelledby="basket-list-title">
      <div className="basket-list-heading">
        <div><h3 id="basket-list-title">السلال المعرفة في Firebase</h3><p>تظهر التغييرات مباشرة بعد الحفظ، وتنعكس على خيارات الموظفين.</p></div>
        <div className="basket-list-tools">
          <label className="basket-search"><Search size={15} /><input aria-label="بحث في السلال" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن سلة..." /></label>
          <div className="basket-csv-actions">
            <button type="button" className="basket-secondary-action" onClick={() => downloadCsv('natco-baskets.csv', basketCsv(baskets))} disabled={!baskets.length}><Download size={14} /> تصدير CSV</button>
            <button type="button" className="basket-secondary-action" onClick={() => downloadCsv('natco-baskets-template.csv', basketCsv(defaultBasketDefinitions))}><Download size={14} /> قالب CSV</button>
            <label className="basket-secondary-action basket-file-picker"><Upload size={14} /> رفع CSV<input type="file" accept=".csv,text/csv" onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) void prepareBasketImport(file)
              event.currentTarget.value = ''
            }} /></label>
          </div>
        </div>
      </div>
      <p className="basket-csv-note">القيم المقبولة: النوع essential أو family أو custom، وحالة active هي true أو false. افصل المنتجات والتصنيفات المتعددة بعلامة |، واستخدم معرّفات المنتجات والتصنيفات المطابقة للكتالوج. يتحقق الرفع من القيم قبل الحفظ. CSV لا يدعم القوائم المنسدلة داخل Google Sheets.</p>
      {importPreview && <section className={`basket-import-preview${importPreview.issues.length ? ' has-errors' : ''}`}>
        <div><strong>معاينة {importPreview.fileName}</strong><small>{importPreview.rows.length} سلة جاهزة · {importPreview.issues.length} مشكلة</small></div>
        {importPreview.issues.length > 0 && <ul>{importPreview.issues.slice(0, 8).map((issue) => <li key={issue}>{issue}</li>)}</ul>}
        {importPreview.issues.length > 8 && <small>و{importPreview.issues.length - 8} ملاحظات أخرى.</small>}
        <div className="basket-import-actions">
          <button type="button" className="basket-primary-action" disabled={working || importPreview.issues.length > 0 || !importPreview.rows.length} onClick={() => void importBaskets()}>
            {working ? <LoaderCircle size={14} className="basket-spinner" /> : <Upload size={14} />} استيراد وإضافة / تحديث
          </button>
          <button type="button" className="basket-secondary-action" onClick={() => setImportPreview(null)} disabled={working}><X size={14} /> إلغاء</button>
        </div>
      </section>}
      {loadingBaskets && firestore ? <div className="basket-empty-state"><LoaderCircle size={20} className="basket-spinner" /> جارٍ تحميل السلال من Firebase…</div>
        : visibleLoadError && baskets.length === 0 ? <div className="basket-empty-state">لا يمكن عرض السلال حتى تُحل مشكلة صلاحية الوصول إلى Firebase.</div>
          : baskets.length === 0 ? <div className="basket-empty-state">
          <span><Archive size={24} /></span><strong>لا توجد سلال محفوظة في Firebase بعد</strong>
          <p>السلال الافتراضية ما زالت متاحة للموظفين. أضف سجلات الإدارة إلى Firebase عند جاهزيتك.</p>
          <div>
            <button type="button" className="basket-secondary-action" onClick={() => void initializeDefaultBaskets()} disabled={working}>
              {working ? <LoaderCircle size={15} className="basket-spinner" /> : <Archive size={15} />} إنشاء السلال الافتراضية
            </button>
            <button type="button" className="basket-primary-action" onClick={startNewBasket} disabled={working}><Plus size={15} /> إنشاء سلة</button>
          </div>
        </div>
          : filteredBaskets.length === 0 ? <div className="basket-empty-state">لا توجد نتائج تطابق البحث.</div>
            : <div className="basket-definition-list">
              {filteredBaskets.map((basket) => {
                const categories = basket.includedSubcategories.map((key) => key.split('::').slice(1).join('::'))
                const count = productCount(basket, products)
                return <article className={`basket-definition-card${!basket.active ? ' is-inactive' : ''}`} key={basket.id}>
                  <div className="basket-card-main">
                    <span className="basket-card-mark"><Archive size={18} /></span>
                    <div className="basket-card-copy">
                      <div className="basket-card-title"><strong>{basket.name}</strong><span className={basket.active ? 'basket-status-active' : 'basket-status-inactive'}>{basket.active ? 'نشطة' : 'مخفاة'}</span></div>
                      <p>{basket.description || 'بدون وصف'}</p>
                      <div className="basket-card-tags">
                        <span>النوع: {basket.kind === 'essential' ? 'أساسية' : basket.kind === 'family' ? 'عائلية' : 'مخصصة'}</span>
                        <span>حد الموظف: {basket.maxPerEmployee}</span>
                        <span>{count} صنف</span>
                      </div>
                      {categories.length > 0 && <small className="basket-card-categories">التصنيفات: {categories.join('، ')}</small>}
                      {basket.excludedProductIds.length > 0 && <small className="basket-card-exclusions">استثناء {basket.excludedProductIds.length} صنف</small>}
                    </div>
                  </div>
                  <div className="basket-card-actions">
                    <button type="button" className="basket-view-button" aria-label={`عرض وتعديل ${basket.name}`} onClick={() => editBasket(basket)} disabled={working}><Eye size={15} /> عرض</button>
                    <button type="button" className="basket-delete-button" onClick={() => void removeBasket(basket)} disabled={working} aria-label={`حذف ${basket.name}`}><Trash2 size={16} /></button>
                  </div>
                </article>
              })}
            </div>}
    </section>

    <form id="basket-definition-form" className="basket-editor" onSubmit={(event) => void saveBasket(event)}>
      <div className="basket-editor-heading">
        <div><span className="basket-section-icon"><Edit3 size={17} /></span><div><h3>{editingId ? 'تعديل تعريف السلة' : 'إنشاء سلة جديدة'}</h3><p>حدد الاسم والنوع وحد الموظف ثم اختر الأقسام والتصنيفات والأصناف.</p></div></div>
        {editingId && <button type="button" className="basket-close-editor" onClick={resetDraft} aria-label="إلغاء التعديل"><X size={17} /></button>}
      </div>
      <div className="basket-editor-fields">
        <label className="basket-field"><span>اسم السلة <b>*</b></span><input required maxLength={80} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="مثال: سلة المواد الأساسية" /></label>
        <label className="basket-field"><span>نوع السلة</span><select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as Draft['kind'] }))}><option value="essential">أساسية</option><option value="family">عائلية</option><option value="custom">مخصصة</option></select></label>
        <label className="basket-field"><span>الحد الأقصى لهذا النوع لكل موظف</span><select value={draft.maxPerEmployee} onChange={(event) => setDraft((current) => ({ ...current, maxPerEmployee: Number(event.target.value) }))}>{Array.from({ length: 7 }, (_, value) => <option key={value} value={value}>{value === 0 ? 'غير متاح' : value}</option>)}</select><small>يطبق هذا الحد بالإضافة إلى الحد العام ({maxTotal})؛ ويسري الحد الأقل بينهما.</small></label>
        <label className="basket-field"><span>وصف السلة</span><textarea maxLength={160} rows={2} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="وصف مختصر يظهر للموظف" /></label>
      </div>

      <div className="basket-content-heading">
        <div><h4>محتويات السلة</h4><p>اختر تصنيفاً لإضافة منتجاته تلقائياً، ثم استبعد أي منتج غير مناسب.</p></div>
        <span>{selectedProductCount} منتج مختار</span>
      </div>
      <div className="basket-departments">
        {productDepartments.map((department) => {
          const departmentProducts = products.filter((product) => product.department === department.id)
          const chosenCount = departmentProducts.filter((product) => basketIncludesProduct(draft, product)).length
          return <details className="basket-department" key={department.id}>
            <summary><span><strong>{department.name}</strong><small>{chosenCount} من {departmentProducts.length} صنف مختار</small></span><ChevronDown size={16} /></summary>
            <div className="basket-subcategory-list">
              {department.categories.map((subcategory) => {
                const key = basketSubcategoryKey(department.id, subcategory)
                const categoryProducts = departmentProducts.filter((product) => product.subcategory === subcategory)
                const included = draft.includedSubcategories.includes(key)
                return <details className="basket-subcategory" key={key}>
                  <summary><span><strong>{subcategory}</strong><small>{categoryProducts.length} منتج</small></span><ChevronDown size={14} /></summary>
                  <div className="basket-subcategory-body">
                    <label className="basket-category-toggle"><input type="checkbox" checked={included} onChange={(event) => toggleSubcategory(department.id, subcategory, event.target.checked)} /><strong>إدراج جميع منتجات هذا التصنيف</strong></label>
                    {categoryProducts.length > 0 ? <div className="basket-product-options">
                      {categoryProducts.map((product) => {
                        const checked = basketIncludesProduct(draft, product)
                        return <label key={product.id} className={!product.active ? 'product-inactive' : ''}>
                          <input type="checkbox" checked={checked} onChange={(event) => toggleProduct(product, event.target.checked)} />
                          <span>{product.name}{!product.active && <small>غير نشط</small>}</span>
                        </label>
                      })}
                    </div> : <small className="basket-no-products">لا توجد أصناف في هذا التصنيف حتى الآن.</small>}
                  </div>
                </details>
              })}
            </div>
          </details>
        })}
      </div>
      <label className="basket-active-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} /><span><strong>إتاحة هذه السلة للموظفين</strong><small>إيقافها يخفيها من شاشة إنشاء الطلب دون حذف تعريفها.</small></span></label>
      <div className="basket-editor-actions">
        <button type="submit" className="basket-primary-action" disabled={working || loadingSettings}>
          {working ? <LoaderCircle size={15} className="basket-spinner" /> : <Save size={15} />} {editingId ? 'حفظ التعديلات في Firebase' : 'إضافة السلة إلى Firebase'}
        </button>
        {editingId && <button type="button" className="basket-secondary-action" onClick={resetDraft} disabled={working}><X size={15} /> إلغاء</button>}
      </div>
    </form>
  </section>
}
