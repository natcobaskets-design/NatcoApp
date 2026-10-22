import { useEffect, useState, type FormEvent } from 'react'
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { Edit3, Plus, Save, Trash2, X } from 'lucide-react'
import { defaultBasketDefinitions, defaultBasketSelectionSettings, parseBasketDefinition, type BasketDefinition, type CatalogProduct } from './domain'
import { firebaseErrorMessage, firestore } from './firebase'

type Props = {
  products: CatalogProduct[]
  onNotice: (message: string) => void
  userId: string
}

type Draft = Omit<BasketDefinition, 'id'>

const emptyDraft: Draft = {
  name: '',
  kind: 'custom',
  description: '',
  maxPerEmployee: 1,
  productIds: [],
  active: true,
}

export function AdminBasketManagement({ products, onNotice, userId }: Props) {
  const [baskets, setBaskets] = useState<BasketDefinition[]>(defaultBasketDefinitions)
  const [maxTotal, setMaxTotal] = useState(defaultBasketSelectionSettings.maxTotalPerEmployee)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState('')
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!firestore) return
    const database = firestore
    let seedingDefaults = false
    const stopBaskets = onSnapshot(collection(database, 'basket_types'), (snapshot) => {
      if (snapshot.empty && !seedingDefaults) {
        seedingDefaults = true
        void Promise.all(defaultBasketDefinitions.map((basket) =>
          setDoc(doc(database, 'basket_types', basket.id), {
            ...basket,
            updatedAt: serverTimestamp(),
            updatedBy: userId,
          }, { merge: true })))
          .catch((error: unknown) => {
            console.error('Unable to initialize default basket definitions.', error)
            onNotice(firebaseErrorMessage(error))
          })
        return
      }
      setBaskets(snapshot.docs.flatMap((item) => {
        const basket = parseBasketDefinition(item.id, item.data())
        if (!basket) console.error(`Ignoring malformed basket definition ${item.id}.`)
        return basket ? [basket] : []
      }))
    }, (error) => {
      console.error('Unable to load basket definitions for administration.', error)
      onNotice(firebaseErrorMessage(error))
    })
    const stopSettings = onSnapshot(doc(database, 'admin_settings', 'basket_selection'), (snapshot) => {
      const maximum = snapshot.exists() ? snapshot.data().maxTotalPerEmployee : 2
      setMaxTotal(Number.isInteger(maximum) && Number(maximum) >= 1 && Number(maximum) <= 2
        ? Number(maximum)
        : defaultBasketSelectionSettings.maxTotalPerEmployee)
    }, (error) => {
      console.error('Unable to load basket selection settings.', error)
      onNotice(firebaseErrorMessage(error))
    })
    return () => {
      stopBaskets()
      stopSettings()
    }
  }, [onNotice, userId])

  function editBasket(basket: BasketDefinition) {
    setEditingId(basket.id)
    setDraft({
      name: basket.name,
      kind: basket.kind,
      description: basket.description,
      maxPerEmployee: basket.maxPerEmployee,
      productIds: [...basket.productIds],
      active: basket.active,
    })
  }

  function resetDraft() {
    setDraft(emptyDraft)
    setEditingId('')
  }

  function startNewBasket() {
    resetDraft()
    document.getElementById('basket-definition-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function saveBasket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!firestore) return
    const name = draft.name.trim()
    if (!name || name.length > 80 || draft.description.length > 160 ||
      !Number.isInteger(draft.maxPerEmployee) || draft.maxPerEmployee < 0 ||
      draft.maxPerEmployee > maxTotal || draft.productIds.length > 50) {
      onNotice('تحقق من اسم السلة ووصفها والحد المسموح وعدد الأصناف المرتبطة.')
      return
    }
    setWorking(true)
    try {
      const normalizeName = (value: string) => value.trim().toLocaleLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
        .replace(/[أإآ]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/\s+/g, ' ')
      const normalizedName = normalizeName(name)
      const duplicate = baskets.find((basket) =>
        basket.id !== editingId &&
        basket.kind === draft.kind &&
        normalizeName(basket.name) === normalizedName)
      if (duplicate) {
        onNotice(`توجد سلة من النوع نفسه باسم «${duplicate.name}». افتحها للتعديل بدلاً من إضافة نسخة مكررة.`)
        return
      }
      const id = editingId || `basket-${Date.now().toString(36)}`
      await setDoc(doc(firestore, 'basket_types', id), {
        ...draft,
        name,
        productIds: [...new Set(draft.productIds)],
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      }, { merge: true })
      onNotice(editingId ? 'تم تحديث السلة.' : 'تمت إضافة السلة.')
      resetDraft()
    } catch (error) {
      console.error('Unable to save basket definition.', error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function saveGlobalMaximum(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!firestore || !Number.isInteger(maxTotal) || maxTotal < 1 || maxTotal > 2) {
      onNotice('الحد الإجمالي يجب أن يكون سلة أو سلتين.')
      return
    }
    if (baskets.some((basket) => basket.maxPerEmployee > maxTotal)) {
      onNotice('اخفض الحد الفردي لأي سلة يتجاوز الحد الإجمالي قبل حفظ هذا التغيير.')
      return
    }
    setWorking(true)
    try {
      await setDoc(doc(firestore, 'admin_settings', 'basket_selection'), {
        maxTotalPerEmployee: maxTotal,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      })
      onNotice('تم حفظ الحد الإجمالي للسلال لكل موظف.')
    } catch (error) {
      console.error('Unable to save the global basket selection limit.', error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function removeBasket(basket: BasketDefinition) {
    if (!firestore || !window.confirm(`حذف «${basket.name}» من خيارات الطلب؟ ستبقى الطلبات السابقة كما هي.`)) return
    setWorking(true)
    try {
      await deleteDoc(doc(firestore, 'basket_types', basket.id))
      onNotice('تم حذف السلة. لم تتأثر الطلبات السابقة.')
      if (editingId === basket.id) resetDraft()
    } catch (error) {
      console.error(`Unable to delete basket definition ${basket.id}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  return <section className="admin-panel basket-management">
    <div className="admin-panel-heading"><div><h3>إدارة السلال الغذائية</h3><p>اعرض السلال المتاحة وعدّلها، أو أضف سلة جديدة وحدد أصنافها وحدود الاختيار.</p></div></div>
    <form className="basket-limit-form" onSubmit={(event) => void saveGlobalMaximum(event)}>
      <label className="field"><span>الحد الإجمالي للسلال لكل موظف</span><input type="number" min="1" max="2" value={maxTotal} onChange={(event) => setMaxTotal(Number(event.target.value))} /></label>
      <button className="admin-add-button" disabled={working}><Save size={14} /> حفظ الحد الإجمالي</button>
    </form>
    <div className="basket-definition-list">
      <div className="admin-panel-heading"><div><h3>السلال المعرفة حالياً ({baskets.length})</h3><p>اختر «تعديل» لتغيير الاسم أو الأصناف أو حالة إظهار السلة للموظفين.</p></div><button type="button" className="admin-add-button" disabled={working} onClick={startNewBasket}><Plus size={14} /> إضافة سلة جديدة</button></div>
      {baskets.map((basket) => <article className="basket-definition-card" key={basket.id}>
        <div><strong>{basket.name}</strong><span>{basket.kind === 'essential' ? 'أساسية' : basket.kind === 'family' ? 'عائلية' : 'مخصصة'} · حد الموظف {basket.maxPerEmployee} · {basket.active ? 'نشطة' : 'مخفاة'}</span>
          <small>{basket.productIds.map((id) => products.find((product) => product.id === id)?.name ?? id).join('، ') || 'لا توجد أصناف مرتبطة'}</small></div>
        <div><button type="button" disabled={working} onClick={() => editBasket(basket)} aria-label={`تعديل ${basket.name}`}><Edit3 size={15} /></button><button type="button" disabled={working} onClick={() => void removeBasket(basket)} aria-label={`حذف ${basket.name}`}><Trash2 size={15} /></button></div>
      </article>)}
    </div>
    <form id="basket-definition-form" className="basket-definition-form" onSubmit={(event) => void saveBasket(event)}>
      <div className="employee-single-heading"><strong>{editingId ? 'تعديل السلة' : 'إضافة سلة'}</strong></div>
      <div className="basket-definition-fields">
        <label className="field"><span>اسم السلة</span><input required maxLength={80} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="field"><span>النوع</span><select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as Draft['kind'] }))}><option value="essential">أساسية</option><option value="family">عائلية</option><option value="custom">مخصصة</option></select></label>
        <label className="field"><span>الحد الأقصى لكل موظف</span><input type="number" min="0" max={maxTotal} value={draft.maxPerEmployee} onChange={(event) => setDraft((current) => ({ ...current, maxPerEmployee: Number(event.target.value) }))} /></label>
        <label className="field"><span>الوصف</span><input maxLength={160} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
      </div>
      <fieldset className="basket-product-picker"><legend>الأصناف المتاحة في السلة</legend>
        {products.length ? products.map((product) => <label key={product.id}><input type="checkbox" checked={draft.productIds.includes(product.id)} onChange={(event) => setDraft((current) => ({
          ...current,
          productIds: event.target.checked
            ? [...current.productIds, product.id]
            : current.productIds.filter((id) => id !== product.id),
        }))} /> {product.name}</label>) : <small>لا توجد منتجات في الكتالوج بعد.</small>}
      </fieldset>
      <label className="basket-active-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} /> إظهار السلة للموظفين</label>
      <div className="basket-definition-actions"><button className="admin-add-button" disabled={working}><Save size={14} /> {editingId ? 'حفظ التعديلات' : 'إضافة السلة'}</button>{editingId && <button type="button" className="admin-export-button" onClick={resetDraft}><X size={14} /> إلغاء</button>}</div>
    </form>
  </section>
}
