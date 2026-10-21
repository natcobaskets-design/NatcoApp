import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import {
  collection, deleteField, doc, getDoc, getDocs, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore'
import {
  Archive, Building2, Check, ClipboardList, Download, ImagePlus, LoaderCircle, Mail, Package,
  Plus, Search, Share2, ShieldCheck, Trash2, Upload, Users, X,
} from 'lucide-react'
import { AdminEmployeeProfiles } from './AdminEmployeeProfiles'
import { AdminIntegrationSettings } from './AdminIntegrationSettings'
import { AdminOrganizationSettings } from './AdminOrganizationSettings'
import { AdminBasketManagement } from './AdminBasketManagement'
import { firebaseErrorMessage, firebaseProjectId, firestore } from './firebase'
import {
  employeesToCsv, filterOrders, ordersToCsv, printOrderReport,
  sapCompletedOrdersToCsv, shareOrDownloadCsv, type EmployeeEntry,
} from './adminExports'
import {
  orderStatusLabels, parseCatalogProduct, parseOrder, productCatalogSeed,
  productDepartments, type CatalogProduct, type Order, type OrderStatus, type OrganizationOptions,
} from './domain'
import { normalizePhone, parseRosterCsv, rosterImportLimit, toE164PhoneNumber, type RosterImportPreview } from './rosterImport'
import { employeePasswordLoginEmail } from './employeeLogin'
import { parseProductCsv, productImportLimit, type ProductImportPreview } from './productImport'
import './AdminConsole.css'

type Props = {
  user: User
  onNotice: (message: string) => void
  onOrganizationOptionsChange: (options: OrganizationOptions) => void
  organizationOptions: OrganizationOptions
}

type ProductDraft = Omit<CatalogProduct, 'id'>
const emptyDraft: ProductDraft = {
  name: '', detail: '', category: 'essential', tone: 'yellow',
  department: 'consumables', subcategory: 'مواد تموينية متنوعة',
  iconKey: 'package', imageUrl: '', imagePath: '', active: true,
  agentPrice: undefined, companyAgentPrices: {},
}
const imageLimit = 600 * 1024
const productCsvLimit = 2 * 1024 * 1024

function currentSpendingPeriod(): string {
  return new Date().toISOString().slice(0, 7)
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('تعذرت قراءة ملف الصورة.'))
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('تعذر تحويل الصورة إلى صيغة قابلة للحفظ.'))
    }
    reader.readAsDataURL(file)
  })
}

export function AdminConsole({ user, onNotice, onOrganizationOptionsChange, organizationOptions }: Props) {
  const [tab, setTab] = useState<'orders' | 'products' | 'baskets' | 'employees' | 'settings' | 'organization'>('orders')
  const [orders, setOrders] = useState<Order[]>([])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [employees, setEmployees] = useState<EmployeeEntry[]>([])
  const [orderSearch, setOrderSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft)
  const [productDepartmentFilter, setProductDepartmentFilter] = useState('all')
  const [productSubcategoryFilter, setProductSubcategoryFilter] = useState('all')
  const [productCsvName, setProductCsvName] = useState('')
  const [productImportPreview, setProductImportPreview] = useState<ProductImportPreview | null>(null)
  const [productImportedRows, setProductImportedRows] = useState(0)
  const [editingId, setEditingId] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const previewRef = useRef('')
  const [email, setEmail] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')
  const [employeePhone, setEmployeePhone] = useState('')
  const [rosterFileName, setRosterFileName] = useState('')
  const [rosterPreview, setRosterPreview] = useState<RosterImportPreview | null>(null)
  const [importedRows, setImportedRows] = useState(0)
  const [issue, setIssue] = useState('')
  const filteredOrders = filterOrders(orders, orderSearch)
  const productSubcategories = productDepartments.find((item) => item.id === productDepartmentFilter)?.categories ?? []
  const filteredProducts = products.filter((product) =>
    (productDepartmentFilter === 'all' || product.department === productDepartmentFilter) &&
    (productSubcategoryFilter === 'all' || product.subcategory === productSubcategoryFilter))

  async function exportCompletedOrders() {
    setExporting(true)
    try {
      const completed = orders.filter((order) => order.status === 'fulfilled')
      if (!completed.length) {
        onNotice('لا توجد طلبات مكتملة بحالة تم التسليم لتصديرها إلى SAP.')
        return
      }
      const result = await shareOrDownloadCsv(
        `natco-sap-fulfilled-orders-${new Date().toISOString().slice(0, 10)}.csv`,
        sapCompletedOrdersToCsv(completed, products),
      )
      if (result === 'downloaded') onNotice(`تم تنزيل ${completed.length} طلب مكتمل بصيغة CSV عامة لإدخاله أو مراجعته في SAP.`)
    } catch (error) {
      console.error('Unable to export completed orders for SAP.', error)
      onNotice('تعذر تصدير طلبات SAP. حاول مجدداً.')
    } finally {
      setExporting(false)
    }
  }

  function printCompletedOrderReport() {
    try {
      printOrderReport(orders, products)
    } catch (error) {
      console.error('Unable to print the complete order report.', error)
      onNotice(error instanceof Error ? error.message : 'تعذرت طباعة الطلبات المكتملة.')
    }
  }

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
  }, [])

  useEffect(() => {
    if (!firestore) return
    const unsubscribeOrders = onSnapshot(
      query(collection(firestore, 'orders'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        const validOrders = snapshot.docs.flatMap((item) => {
          const order = parseOrder(item.id, item.data())
          if (!order) console.error(`Skipping malformed order ${item.id}.`)
          return order ? [order] : []
        })
        setOrders(validOrders)
        setLoading(false)
      },
      (error) => {
        console.error('Unable to subscribe to Firebase orders.', error)
        setIssue(firebaseErrorMessage(error))
        setLoading(false)
      },
    )
    const unsubscribeProducts = onSnapshot(collection(firestore, 'products'), (snapshot) => {
      setProducts(snapshot.docs.flatMap((item) => {
        const product = parseCatalogProduct(item.id, item.data())
        if (!product) console.error(`Skipping malformed product ${item.id}.`)
        return product ? [product] : []
      }))
    }, (error) => {
      console.error('Unable to subscribe to the Firebase product catalog.', error)
      setIssue(firebaseErrorMessage(error))
    })
    const unsubscribeEmployees = onSnapshot(collection(firestore, 'employee_roster'), (snapshot) => {
      setEmployees(snapshot.docs.map((item) => ({
        email: item.id,
        employeeCode: typeof item.data().employeeCode === 'string' ? item.data().employeeCode : '',
        ...(typeof item.data().name === 'string' ? { name: item.data().name } : {}),
        ...(typeof item.data().phone === 'string' ? { phone: item.data().phone } : {}),
        ...(typeof item.data().whatsapp === 'string' ? { whatsapp: item.data().whatsapp } : {}),
        active: item.data().active === true,
        ...(typeof item.data().company === 'string' ? { company: item.data().company } : {}),
        ...(typeof item.data().branch === 'string' ? { branch: item.data().branch } : {}),
        ...(typeof item.data().province === 'string' ? { province: item.data().province } : {}),
        ...(typeof item.data().address === 'string' ? { address: item.data().address } : {}),
        ...(typeof item.data().coordinates === 'string' ? { coordinates: item.data().coordinates } : {}),
        ...(typeof item.data().monthlySpendingLimit === 'number' ? { monthlySpendingLimit: item.data().monthlySpendingLimit } : {}),
        ...(typeof item.data().currentMonthlySpent === 'number' ? { currentMonthlySpent: item.data().currentMonthlySpent } : {}),
        ...(typeof item.data().spendingPeriod === 'string' ? { spendingPeriod: item.data().spendingPeriod } : {}),
      })))
    }, (error) => {
      console.error('Unable to subscribe to the employee roster.', error)
      setIssue(firebaseErrorMessage(error))
    })
    return () => {
      unsubscribeOrders()
      unsubscribeProducts()
      unsubscribeEmployees()
    }
  }, [])

  async function seedCatalog() {
    if (!firestore) return
    const database = firestore
    setWorking(true)
    try {
      const batch = writeBatch(database)
      const existing = await Promise.all(productCatalogSeed.map((product) =>
        getDoc(doc(database, 'products', product.id))))
      let added = 0
      productCatalogSeed.forEach((product, index) => {
        if (existing[index].exists()) return
        added += 1
        batch.set(doc(database, 'products', product.id), {
          ...product, companyAgentPrices: {},
          createdAt: serverTimestamp(), createdBy: user.uid,
        })
        batch.set(doc(database, 'catalog_sync_queue', product.id), {
          productId: product.id,
          action: 'upsert',
          status: 'pending',
          updatedAt: serverTimestamp(),
        })
      })
      if (!added) {
        onNotice('المنتجات الأساسية موجودة بالفعل؛ لم نغيّر صورها أو بياناتها.')
        return
      }
      await batch.commit()
      onNotice(`تم تجهيز ${added} من المنتجات الأساسية دون تغيير المنتجات الموجودة.`)
    } catch (error) {
      console.error('Unable to create the initial product catalog.', error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!firestore) return
    if (typeof draft.agentPrice !== 'number' || !Number.isFinite(draft.agentPrice) || draft.agentPrice < 0) {
      onNotice('أدخل سعراً أساسياً صالحاً بالريال اليمني.')
      return
    }
    const companyPrices = draft.companyAgentPrices ?? {}
    if (Object.entries(companyPrices).some(([company, price]) =>
      !organizationOptions.companies.some((entry) => entry.name === company) ||
      !Number.isFinite(price) || price < 0)) {
      onNotice('راجع الأسعار الخاصة بالشركات؛ يجب أن تكون الشركة معروفة والسعر صفراً أو أكثر.')
      return
    }
    if (imageFile && (!['image/jpeg', 'image/png', 'image/webp'].includes(imageFile.type) || imageFile.size > imageLimit)) {
      onNotice('استخدم صورة JPG أو PNG أو WebP بحجم لا يتجاوز ٦٠٠ كيلوبايت للحفاظ على الصورة الأصلية ضمن السعة المجانية.')
      return
    }
    setWorking(true)
    try {
      const isUpdating = Boolean(editingId && editingId !== 'new')
      const productRef = isUpdating
        ? doc(firestore, 'products', editingId)
        : doc(collection(firestore, 'products'))
      const imageUrl = imageFile ? await readImageAsDataUrl(imageFile) : draft.imageUrl
      const batch = writeBatch(firestore)
      batch.set(productRef, {
        ...draft,
        imageUrl,
        imagePath: imageFile ? '' : draft.imagePath,
        name: draft.name.trim(),
        detail: draft.detail.trim(),
        createdBy: user.uid,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      batch.set(doc(firestore, 'catalog_sync_queue', productRef.id), {
        productId: productRef.id,
        action: 'upsert',
        status: 'pending',
        updatedAt: serverTimestamp(),
      })
      await batch.commit()
      onNotice(isUpdating ? 'تم تحديث المنتج.' : 'تمت إضافة المنتج إلى الكتالوج.')
      closeProductEditor()
    } catch (error) {
      console.error('Unable to save product.', error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function removeProduct(product: CatalogProduct) {
    if (!firestore || !window.confirm(`هل تريد حذف المنتج «${product.name}»؟`)) return
    setWorking(true)
    try {
      const batch = writeBatch(firestore)
      batch.delete(doc(firestore, 'products', product.id))
      batch.set(doc(firestore, 'catalog_sync_queue', product.id), {
        productId: product.id,
        action: 'deleted',
        status: 'pending',
        updatedAt: serverTimestamp(),
      })
      await batch.commit()
      onNotice('تم حذف المنتج.')
    } catch (error) {
      console.error(`Unable to delete product ${product.id}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function setOrderStatus(order: Order, status: OrderStatus) {
    if (!firestore || status === order.status) return
    setWorking(true)
    try {
      const orderRef = doc(firestore, 'orders', order.id)
      const notificationRef = doc(firestore, 'order_notifications', order.id)
      const notificationSnapshot = await getDoc(notificationRef)
      const batch = writeBatch(firestore)
      batch.update(orderRef, { status, updatedAt: serverTimestamp() })
      if (notificationSnapshot.exists()) {
        batch.update(notificationRef, {
          status: 'pending',
          eventStatus: status,
          updatedAt: serverTimestamp(),
        })
      } else {
        batch.set(notificationRef, {
          orderId: order.id,
          uid: order.uid,
          status: 'pending',
          eventStatus: status,
          emailSentAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
      await batch.commit()
      onNotice(`تم التعديل على الطلب ${order.reference}.\nالحالة السابقة: ${orderStatusLabels[order.status]}.\nالحالة الحالية: ${orderStatusLabels[status]}.`)
    } catch (error) {
      console.error(`Unable to update order ${order.reference}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function permanentlyDeleteOrder(order: Order) {
    if (!firestore || !window.confirm(`حذف الطلب ${order.reference} نهائياً؟ سيُحذف من التطبيق وGoogle Sheets، ولا يمكن التراجع.`)) return
    const database = firestore
    setWorking(true)
    try {
      const orderRef = doc(database, 'orders', order.id)
      const notificationRef = doc(database, 'order_notifications', order.id)
      const rosterRef = doc(database, 'employee_roster', order.profile.email.toLowerCase())
      const currentPeriod = currentSpendingPeriod()
      await runTransaction(database, async (transaction) => {
        const orderSnapshot = await transaction.get(orderRef)
        const notificationSnapshot = await transaction.get(notificationRef)
        const rosterSnapshot = await transaction.get(rosterRef)
        if (!orderSnapshot.exists()) return
        const liveOrder = parseOrder(orderSnapshot.id, orderSnapshot.data())
        if (!liveOrder) throw new Error('بيانات الطلب غير صالحة للحذف.')
        transaction.delete(orderRef)
        if (notificationSnapshot.exists()) {
          transaction.set(notificationRef, {
            status: 'pending',
            eventStatus: 'deleted',
            updatedAt: serverTimestamp(),
          }, { merge: true })
        } else {
          transaction.set(notificationRef, {
            orderId: liveOrder.id,
            uid: liveOrder.uid,
            status: 'pending',
            eventStatus: 'deleted',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        }
        if (rosterSnapshot.exists() &&
          liveOrder.profile.spendingPeriod === currentPeriod &&
          rosterSnapshot.data().spendingPeriod === currentPeriod &&
          typeof liveOrder.totalAmount === 'number') {
          const spent = rosterSnapshot.data().currentMonthlySpent
          if (typeof spent !== 'number' || !Number.isFinite(spent)) {
            throw new Error('رصيد الإنفاق الشهري غير صالح؛ صححه قبل حذف الطلب.')
          }
          transaction.update(rosterRef, {
            currentMonthlySpent: Math.max(0, spent - liveOrder.totalAmount),
            updatedAt: serverTimestamp(),
          })
          transaction.set(doc(database, 'employee_sync_queue', liveOrder.profile.email.toLowerCase()), {
            email: liveOrder.profile.email.toLowerCase(),
            status: 'pending',
            updatedAt: serverTimestamp(),
          }, { merge: true })
        }
      })
      onNotice(`حُذف الطلب ${order.reference} نهائياً من النظام، وأُرسلت إشارة لحذفه من Google Sheets.`)
    } catch (error) {
      console.error(`Unable to permanently delete order ${order.reference}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!firestore) return
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedPhone = normalizePhone(employeePhone)
    const phoneE164 = toE164PhoneNumber(employeePhone)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !employeeCode.trim() ||
      employeeCode.trim().length > 80 ||
      !/^\+?[\d\s()-]{8,30}$/.test(employeePhone.trim()) ||
      normalizedPhone.length < 8 || normalizedPhone.length > 18 || !phoneE164) {
      onNotice('أدخل بريداً إلكترونياً صحيحاً وكوداً وظيفياً ورقم هاتف بالصيغة الدولية مع + ورمز الدولة.')
      return
    }
    setWorking(true)
    try {
      const duplicateCodes = await getDocs(query(
        collection(firestore, 'employee_roster'),
        where('employeeCode', '==', employeeCode.trim()),
      ))
      if (duplicateCodes.docs.some((item) => item.id !== normalizedEmail)) {
        onNotice('هذا الرقم الوظيفي مرتبط بسجل موظف آخر.')
        return
      }
      const duplicatePhones = await getDocs(query(
        collection(firestore, 'employee_roster'),
        where('phoneLookup', '==', normalizedPhone),
      ))
      if (duplicatePhones.docs.some((item) => item.id !== normalizedEmail)) {
        onNotice('رقم الهاتف مرتبط بسجل موظف آخر.')
        return
      }
      const rosterRef = doc(firestore, 'employee_roster', normalizedEmail)
      if ((await getDoc(rosterRef)).exists()) {
        onNotice('هذا البريد معتمد مسبقاً. استخدم زر التعديل في سجل الموظف.')
        return
      }
      const period = currentSpendingPeriod()
      const batch = writeBatch(firestore)
      batch.set(rosterRef, {
        email: normalizedEmail,
        employeeCode: employeeCode.trim(),
        phone: employeePhone.trim(),
        phoneE164,
        phoneLookup: normalizedPhone,
        currentMonthlySpent: 0,
        spendingPeriod: period,
        active: true,
        approvedBy: user.uid,
        updatedAt: serverTimestamp(),
      })
      batch.set(doc(firestore, 'employee_phone_lookup', phoneE164), {
        email: normalizedEmail,
        phoneNumber: phoneE164,
        updatedAt: serverTimestamp(),
      })
      batch.set(doc(firestore, 'employee_sync_queue', normalizedEmail), {
        email: normalizedEmail,
        status: 'pending',
        updatedAt: serverTimestamp(),
      })
      await batch.commit()
      setEmail('')
      setEmployeeCode('')
      setEmployeePhone('')
      onNotice('تم اعتماد سجل الموظف. أنشئ حساب Email/Password بعنوان الدخول الداخلي من Firebase Authentication، ثم فعّل ربطه من تعديل ملف الموظف.')
    } catch (error) {
      console.error('Unable to add employee to the approved roster.', error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  function downloadRosterTemplate() {
    const headers = [
      'email', 'employeeCode', 'name', 'company', 'branch', 'province',
      'monthlySpendingLimit', 'currentMonthlySpent', 'address', 'coordinates',
      'phone', 'whatsapp', 'active',
    ]
    const blob = new Blob([`\uFEFF${headers.join(',')}\r\n`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'natco-employee-roster-template.csv'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async function readRosterFile(file: File | null) {
    setRosterFileName('')
    setRosterPreview(null)
    setImportedRows(0)
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv') || file.size > 2 * 1024 * 1024) {
      onNotice('اختر ملف CSV صالحاً، على ألا يتجاوز حجمه ٢ ميغابايت.')
      return
    }
    try {
      const preview = parseRosterCsv(await file.text())
      if (preview.totalRows > rosterImportLimit) {
        preview.rows = []
        preview.issues.push(`يتجاوز الملف الحد الأعلى ${rosterImportLimit.toLocaleString('ar')} موظف في المرة الواحدة.`)
      }
      setRosterFileName(file.name)
      setRosterPreview(preview)
    } catch (error) {
      console.error('Unable to parse the employee roster CSV file.', error)
      onNotice(error instanceof Error ? error.message : 'تعذر قراءة الملف. تحقق من تنسيق CSV.')
    }
  }

  async function importEmployees() {
    if (!firestore || !rosterPreview || !rosterPreview.rows.length || rosterPreview.issues.length) return
    const database = firestore
    setWorking(true)
    setImportedRows(0)
    let committedRows = 0
    try {
      const rows = rosterPreview.rows
      const unknownCompany = rows.find((row) => row.company &&
        !organizationOptions.companies.some((company) => company.name === row.company))
      if (unknownCompany) {
        onNotice(`الشركة في الصف ${unknownCompany.line} غير موجودة في إعدادات الشركات والفروع.`)
        return
      }
      const invalidLocation = rows.find((row) => row.company && row.branch &&
        !organizationOptions.companies.find((company) => company.name === row.company)?.branches.includes(row.branch))
      if (invalidLocation) {
        onNotice(`الفرع في الصف ${invalidLocation.line} غير مرتبط بالشركة المحددة في إعدادات الشركات والفروع.`)
        return
      }
      const unknownProvince = rows.find((row) => row.province && !organizationOptions.branches.includes(row.province))
      if (unknownProvince) {
        onNotice(`المحافظة في الصف ${unknownProvince.line} غير موجودة في إعدادات المحافظات.`)
        return
      }
      for (let offset = 0; offset < rows.length; offset += 30) {
        const chunk = rows.slice(offset, offset + 30)
        const codeMatches = await getDocs(query(
          collection(database, 'employee_roster'),
          where('employeeCode', 'in', chunk.map((row) => row.employeeCode)),
        ))
        const emailsByCode = new Map(chunk.map((row) => [row.employeeCode, row.email]))
        const duplicateCode = codeMatches.docs.find((item) =>
          emailsByCode.get(String(item.data().employeeCode)) !== item.id)
        if (duplicateCode) {
          onNotice(`الكود الوظيفي ${duplicateCode.data().employeeCode} مرتبط ببريد آخر.`)
          return
        }
        const phoneRows = chunk.filter((row) => row.phone)
        if (phoneRows.length) {
          const phoneMatches = await getDocs(query(
            collection(database, 'employee_roster'),
            where('phoneLookup', 'in', phoneRows.map((row) => normalizePhone(row.phone ?? ''))),
          ))
          const emailsByPhone = new Map(phoneRows.map((row) => [normalizePhone(row.phone ?? ''), row.email]))
          const duplicatePhone = phoneMatches.docs.find((item) =>
            emailsByPhone.get(String(item.data().phoneLookup)) !== item.id)
          if (duplicatePhone) {
            onNotice(`رقم الهاتف في سجل ${duplicatePhone.id} مرتبط بموظف آخر.`)
            return
          }
        }
      }
      const period = currentSpendingPeriod()
      for (let offset = 0; offset < rows.length; offset += 25) {
        const batch = writeBatch(database)
        const chunk = rows.slice(offset, offset + 25)
        const profileSnapshot = await getDocs(query(
          collection(database, 'employees'),
          where('email', 'in', chunk.map((row) => row.email)),
        ))
        const rosterSnapshots = await Promise.all(chunk.map((row) =>
          getDoc(doc(database, 'employee_roster', row.email))))
        const rowsByEmail = new Map(chunk.map((row) => [row.email, row]))
        rosterSnapshots.forEach((snapshot) => {
          if (!snapshot.exists()) return
          const row = rowsByEmail.get(snapshot.id)
          if (!row?.phone) return
          const oldPhone = typeof snapshot.data().phoneE164 === 'string'
            ? snapshot.data().phoneE164
            : toE164PhoneNumber(String(snapshot.data().phone ?? ''))
          const nextPhone = toE164PhoneNumber(row.phone)
          if (oldPhone && oldPhone !== nextPhone) {
            batch.delete(doc(database, 'employee_phone_lookup', oldPhone))
            const oldLoginEmail = employeePasswordLoginEmail(oldPhone, firebaseProjectId)
            if (oldLoginEmail) batch.delete(doc(database, 'employee_auth_lookup', oldLoginEmail))
          }
        })
        chunk.forEach((row) => batch.set(doc(database, 'employee_roster', row.email), {
          email: row.email,
          employeeCode: row.employeeCode,
          ...(row.phone ? {
            phone: row.phone,
            phoneE164: toE164PhoneNumber(row.phone),
            phoneLookup: normalizePhone(row.phone),
          } : {}),
          ...(row.name ? { name: row.name } : {}),
          ...(row.providedFields.includes('company') ? { company: row.company || deleteField() } : {}),
          ...(row.branch ? { branch: row.branch } : {}),
          ...(row.province ? { province: row.province } : {}),
          ...(row.address ? { address: row.address } : {}),
          ...(row.coordinates ? { coordinates: row.coordinates } : {}),
          ...(row.phone ? { phone: row.phone } : {}),
          ...(row.whatsapp ? { whatsapp: row.whatsapp } : {}),
          ...(row.providedFields.includes('monthlySpendingLimit')
            ? { monthlySpendingLimit: row.monthlySpendingLimit ?? deleteField() } : {}),
          ...(row.providedFields.includes('currentMonthlySpent')
            ? { currentMonthlySpent: row.currentMonthlySpent ?? 0, spendingPeriod: period } : {}),
          active: row.active ?? true,
          approvedBy: user.uid,
          updatedAt: serverTimestamp(),
        }, { merge: true }))
        chunk.forEach((row) => {
          const phoneNumber = toE164PhoneNumber(row.phone ?? '')
          if (!phoneNumber) return
          batch.set(doc(database, 'employee_phone_lookup', phoneNumber), {
            email: row.email,
            phoneNumber,
            updatedAt: serverTimestamp(),
          })
        })
        profileSnapshot.docs.forEach((snapshot) => {
          const row = rowsByEmail.get(String(snapshot.data().email).toLowerCase())
          if (!row) return
          batch.update(snapshot.ref, {
            employeeCode: row.employeeCode,
            ...(row.name ? { name: row.name } : {}),
            ...(row.providedFields.includes('company') ? { company: row.company || deleteField() } : {}),
            ...(row.branch ? { branch: row.branch } : {}),
            ...(row.province ? { province: row.province } : {}),
            ...(row.address ? { address: row.address } : {}),
            ...(row.coordinates ? { coordinates: row.coordinates } : {}),
            ...(row.phone ? { phone: row.phone } : {}),
            ...(row.whatsapp ? { whatsapp: row.whatsapp } : {}),
            ...(row.providedFields.includes('monthlySpendingLimit')
              ? { monthlySpendingLimit: row.monthlySpendingLimit ?? deleteField() } : {}),
            ...(row.providedFields.includes('currentMonthlySpent')
              ? { currentMonthlySpent: row.currentMonthlySpent ?? 0, spendingPeriod: period } : {}),
          })
        })
        chunk.forEach((row) => batch.set(doc(database, 'employee_sync_queue', row.email), {
          email: row.email,
          status: 'pending',
          updatedAt: serverTimestamp(),
        }))
        await batch.commit()
        committedRows += chunk.length
        setImportedRows(committedRows)
      }

      setRosterPreview(null)
      setRosterFileName('')
      onNotice(`تم اعتماد ${committedRows.toLocaleString('ar')} سجل موظف. أنشئ حسابات Email/Password للموظفين في Firebase Authentication، ثم فعّل ربط كل حساب من ملفه الوظيفي.`)
    } catch (error) {
      console.error(`Employee roster import stopped after ${committedRows} records.`, error)
      onNotice(committedRows
        ? `تم اعتماد ${committedRows.toLocaleString('ar')} موظفاً، ثم توقف الاستيراد بسبب خطأ. راجع الصلاحيات وحاول استيراد الملف مجدداً.`
        : firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function deliverOrders(preferShare: boolean) {
    setExporting(true)
    try {
      const result = await shareOrDownloadCsv(
        `natco-orders-${new Date().toISOString().slice(0, 10)}.csv`,
        ordersToCsv(orders, products),
        preferShare,
      )
      if (result === 'cancelled') return
      onNotice(result === 'shared'
        ? 'تمت مشاركة ملف الطلبات.'
        : result === 'downloaded' && preferShare
          ? 'المشاركة المباشرة غير متاحة على هذا الجهاز؛ تم تنزيل CSV لفتحه أو استيراده في Google Sheets.'
          : 'تم تنزيل ملف الطلبات CSV؛ يمكنك فتحه أو استيراده في Google Sheets.')
    } catch (error) {
      console.error('Unable to export or share employee orders.', error)
      onNotice('تعذر تصدير الطلبات أو مشاركتها. حاول مجدداً.')
    } finally {
      setExporting(false)
    }
  }

  async function deliverEmployees(preferShare: boolean) {
    setExporting(true)
    try {
      const result = await shareOrDownloadCsv(
        `natco-employees-${new Date().toISOString().slice(0, 10)}.csv`,
        employeesToCsv(employees),
        preferShare,
      )
      if (result === 'cancelled') return
      onNotice(result === 'shared'
        ? 'تمت مشاركة ملف الموظفين.'
        : result === 'downloaded' && preferShare
          ? 'المشاركة المباشرة غير متاحة على هذا الجهاز؛ تم تنزيل CSV لفتحه أو استيراده في Google Sheets.'
          : 'تم تنزيل ملف الموظفين CSV؛ يمكنك فتحه أو استيراده في Google Sheets.')
    } catch (error) {
      console.error('Unable to export or share approved employees.', error)
      onNotice('تعذر تصدير الموظفين أو مشاركتهم. حاول مجدداً.')
    } finally {
      setExporting(false)
    }
  }

  function editProduct(product: CatalogProduct) {
    setEditingId(product.id)
    setDraft({
      name: product.name, detail: product.detail, category: product.category,
      department: product.department, subcategory: product.subcategory,
      tone: product.tone, iconKey: product.iconKey, imageUrl: product.imageUrl,
      imagePath: product.imagePath, active: product.active,
      agentPrice: product.agentPrice, companyAgentPrices: product.companyAgentPrices ?? {},
    })
    resetImage()
  }

  function resetImage() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = ''
    setPreviewUrl('')
    setImageFile(null)
  }

  function selectImage(file: File | null) {
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > imageLimit)) {
      onNotice('اختر صورة JPG أو PNG أو WebP لا يتجاوز حجمها ٦٠٠ كيلوبايت.')
      return
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = file ? URL.createObjectURL(file) : ''
    setPreviewUrl(previewRef.current)
    setImageFile(file)
  }

  function closeProductEditor() {
    setEditingId('')
    setDraft(emptyDraft)
    resetImage()
  }

  async function readProductCsv(file: File | null) {
    if (!file) return
    if (file.size > productCsvLimit) {
      onNotice('يجب ألا يتجاوز ملف CSV حجم ٢ ميغابايت.')
      return
    }
    try {
      const preview = parseProductCsv(
        await file.text(),
        organizationOptions.companies.map((company) => company.name),
      )
      setProductCsvName(file.name)
      setProductImportPreview(preview)
      setProductImportedRows(0)
      if (preview.issues.length) onNotice(`تمت قراءة الملف مع ${preview.issues.length} ملاحظة؛ راجع المعاينة قبل الاستيراد.`)
      else onNotice(`تمت معاينة ${preview.rows.length} منتجاً. راجع البيانات ثم اعتمد الاستيراد.`)
    } catch (error) {
      console.error('Unable to read product CSV.', error)
      onNotice('تعذرت قراءة ملف المنتجات. استخدم ملف CSV بترميز UTF-8.')
    }
  }

  async function importProducts() {
    if (!firestore || !productImportPreview?.rows.length || productImportPreview.issues.length) return
    const database = firestore
    setWorking(true)
    let imported = 0
    try {
      for (let offset = 0; offset < productImportPreview.rows.length; offset += 200) {
        const batch = writeBatch(database)
        const chunk = productImportPreview.rows.slice(offset, offset + 200)
        chunk.forEach((row) => {
          const { id: importedId, ...product } = row
          const productRef = importedId
            ? doc(database, 'products', importedId)
            : doc(collection(database, 'products'))
          batch.set(productRef, {
            ...product,
            ...(!importedId ? { imageUrl: '', imagePath: '' } : {}),
            createdBy: user.uid,
            updatedAt: serverTimestamp(),
          }, { merge: true })
          batch.set(doc(database, 'catalog_sync_queue', productRef.id), {
            productId: productRef.id,
            action: 'upsert',
            status: 'pending',
            updatedAt: serverTimestamp(),
          })
        })
        await batch.commit()
        imported += chunk.length
        setProductImportedRows(imported)
      }
      setProductImportPreview(null)
      setProductCsvName('')
      onNotice(`تم استيراد ${imported.toLocaleString('ar')} منتجاً. أضف صورها أو حدّثها من بطاقة المنتج.`)
    } catch (error) {
      console.error(`Product CSV import stopped after ${imported} records.`, error)
      onNotice(imported
        ? `تم استيراد ${imported.toLocaleString('ar')} منتجاً قبل توقف العملية. راجع الصلاحيات وأعد استيراد الجزء المتبقي.`
        : firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  function downloadProductTemplate() {
    const content = [
      'id,name,detail,department,subcategory,basket,agentPrice,companyAgentPrices,active',
      ',زيت نباتي,عبوة 1 لتر,consumables,السمن والزيوت,essential,2500,{},true',
    ].join('\r\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'natco-product-catalog-template.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="admin-console" dir="rtl">
      <section className="admin-hero">
        <div><span className="admin-eyebrow"><ShieldCheck size={15} /> مساحة الإدارة الآمنة</span>
          <h2>لوحة إدارة ناتكو</h2><p>أدر المنتجات، اعتمد حسابات الموظفين، وتابع الطلبات فور وصولها.</p>
        </div>
      </section>
      <div className="admin-metrics">
        <button type="button" onClick={() => setTab('orders')} aria-label="عرض طلبات الموظفين">
          <span><ClipboardList size={18} /></span><small>إجمالي الطلبات</small><strong>{orders.length}</strong>
        </button>
        <button type="button" onClick={() => setTab('products')} aria-label="عرض المنتجات النشطة">
          <span><Package size={18} /></span><small>المنتجات النشطة</small><strong>{products.filter((item) => item.active).length}</strong>
        </button>
        <button type="button" onClick={() => setTab('employees')} aria-label="عرض الموظفين المعتمدين">
          <span><Users size={18} /></span><small>الموظفون المعتمدون</small><strong>{employees.filter((item) => item.active).length}</strong>
        </button>
      </div>
      <div className="admin-toolbar">
        <nav className="admin-tabs" aria-label="أقسام لوحة المشرف">
          <button className={tab === 'orders' ? 'current' : ''} onClick={() => setTab('orders')}><ClipboardList size={16} /> الطلبات</button>
          <button className={tab === 'products' ? 'current' : ''} onClick={() => setTab('products')}><Package size={16} /> المنتجات والصور</button>
          <button className={tab === 'baskets' ? 'current' : ''} onClick={() => setTab('baskets')}><Archive size={16} /> إدارة السلال</button>
          <button className={tab === 'employees' ? 'current' : ''} onClick={() => setTab('employees')}><Users size={16} /> الموظفون</button>
          <button className={tab === 'organization' ? 'current' : ''} onClick={() => setTab('organization')}><Building2 size={16} /> الشركات والفروع</button>
          <button className={tab === 'settings' ? 'current' : ''} onClick={() => setTab('settings')}><Mail size={16} /> الإشعارات</button>
        </nav>
        <span className="live-indicator"><i /> تحديث مباشر</span>
      </div>

      {issue && <div className="admin-error" role="alert">{issue}<button onClick={() => setIssue('')}><X size={14} /></button></div>}
      {loading && <div className="admin-loading"><LoaderCircle size={19} /> جارٍ تحميل البيانات…</div>}

      {!loading && tab === 'orders' && <section className="admin-panel">
        <div className="admin-panel-heading"><div><h3>طلبات الموظفين</h3><p>تتحدث القائمة تلقائياً عند وصول طلب جديد.</p></div><div className="admin-data-actions"><span>{filteredOrders.length} من {orders.length} طلب</span><button type="button" className="admin-export-button" disabled={exporting || !orders.length} onClick={() => void deliverOrders(false)}><Download size={14} /> تصدير CSV</button><button type="button" className="admin-export-button" disabled={exporting || !orders.length} onClick={() => void deliverOrders(true)}><Share2 size={14} /> مشاركة</button><button type="button" className="admin-export-button" disabled={exporting || !orders.some((order) => order.status === 'fulfilled')} onClick={() => void exportCompletedOrders()}><Download size={14} /> تصدير SAP</button><button type="button" className="admin-export-button" disabled={!orders.length} onClick={printCompletedOrderReport}>طباعة التقرير الكامل</button></div></div>
        <label className="admin-search"><Search size={16} /><input type="search" value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="ابحث برقم الطلب أو اسم الموظف أو بريده أو كوده..." aria-label="البحث في طلبات الموظفين" /></label>
        <OrderActionRequests user={user} onNotice={onNotice} />
        {orders.length === 0 ? <div className="admin-empty"><ClipboardList size={33} /><strong>لا توجد طلبات حتى الآن</strong><small>تظهر الطلبات الجديدة هنا عند تأكيد الموظفين لها.</small></div> :
          filteredOrders.length === 0 ? <div className="admin-empty"><Search size={30} /><strong>لا توجد نتائج مطابقة</strong><small>جرّب البحث برقم الطلب أو بيانات الموظف.</small></div> :
          <div className="admin-order-list">{filteredOrders.map((order) => <article className={`admin-order status-${order.status}`} key={order.id}>
            <div className="admin-order-top"><div><strong>{order.reference}</strong><span className={`order-status status-${order.status}`}>{orderStatusLabels[order.status]}</span></div>
                <time>{order.createdAt && new Intl.DateTimeFormat('ar-YE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(order.createdAt))}</time></div>
            <div className="admin-order-employee"><b>{order.profile.name}</b><span>الكود الوظيفي: {order.profile.employeeCode}</span><span>{order.profile.company} · {order.profile.branch}</span><span>{order.profile.phone} · واتساب: {order.profile.whatsapp}</span><span>{order.profile.address}</span></div>
            <div className="admin-order-items">{Object.entries(order.items).filter(([, amount]) => amount > 0).map(([id, amount]) =>
              <span key={id}>{order.itemDetails[id]?.name ?? products.find((item) => item.id === id)?.name ?? 'منتج محذوف'} × {amount}</span>)}</div>
            <div className="admin-order-financials"><span>الاستلام: {order.pickupBranch ?? order.profile.branch}</span><strong>الإجمالي: {typeof order.totalAmount === 'number' ? `${new Intl.NumberFormat('ar-YE').format(order.totalAmount)} ر.ي` : 'غير متاح (طلب قديم)'}</strong></div>
            {order.excluded.length > 0 && <small className="admin-exclusions">مستبعد: {order.excluded.map((id) => order.itemDetails[id]?.name ?? products.find((item) => item.id === id)?.name ?? id).join('، ')}</small>}
            <div className="admin-order-actions">
              <label>حالة الطلب <select value={order.status} disabled={working || order.status === 'deleted'} onChange={(event) => void setOrderStatus(order, event.target.value as OrderStatus)}>{Object.entries(orderStatusLabels).filter(([value]) => value !== 'deleted').map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <button type="button" className="admin-delete-order" disabled={working} onClick={() => void permanentlyDeleteOrder(order)}><Trash2 size={14} /> حذف نهائي</button>
              {order.status !== 'deleted' && <a href={`https://wa.me/${order.profile.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`مرحباً ${order.profile.name}، تحديث طلبك ${order.reference}: ${orderStatusLabels[order.status]}.`)}`} target="_blank" rel="noreferrer">إشعار الموظف عبر واتساب</a>}
            </div>
          </article>)}</div>}
      </section>}

      {!loading && tab === 'products' && <section className="admin-panel">
        <div className="admin-panel-heading"><div><h3>كتالوج المنتجات</h3><p>صنّف المنتجات واستورد ملف CSV، ثم أضف الصور من محرر كل منتج. تتم مزامنة البيانات والأسعار إلى تبويب «كتالوج المنتجات» في Google Sheets.</p></div></div>
        <div className="admin-product-toolbar">
          <div className="admin-product-import-actions">
            <button className="roster-template-button" type="button" onClick={downloadProductTemplate}><Download size={14} /> تنزيل قالب CSV</button>
            <label className="roster-file-button"><Upload size={15} /> استيراد CSV<input type="file" accept=".csv,text/csv" disabled={working} onChange={(event) => { void readProductCsv(event.currentTarget.files?.[0] ?? null); event.currentTarget.value = '' }} /></label>
            <button className="admin-add-button" onClick={() => { closeProductEditor(); setEditingId('new') }}><Plus size={16} /> إضافة منتج</button>
          </div>
          <div className="admin-product-filters">
            <label className="field"><span>القسم الرئيسي</span><select value={productDepartmentFilter} onChange={(event) => { setProductDepartmentFilter(event.target.value); setProductSubcategoryFilter('all') }}><option value="all">كل الأقسام</option>{productDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
            <label className="field"><span>التصنيف الفرعي</span><select value={productSubcategoryFilter} onChange={(event) => setProductSubcategoryFilter(event.target.value)} disabled={productDepartmentFilter === 'all'}><option value="all">كل التصنيفات</option>{productSubcategories.map((subcategory) => <option key={subcategory}>{subcategory}</option>)}</select></label>
          </div>
        </div>
        {productImportPreview && <div className="roster-preview product-import-preview">
          <div className="roster-preview-summary"><strong>معاينة {productCsvName}</strong><span>{productImportPreview.rows.length} منتج</span><span className={productImportPreview.issues.length ? 'roster-invalid-count' : ''}>{productImportPreview.issues.length} مشكلة</span></div>
          <small className="employee-bulk-help">الحد الأقصى {productImportLimit} منتج. اترك id فارغاً للإضافة أو حدده لتحديث منتج موجود. لا يمسح الاستيراد صور المنتج الموجودة.</small>
          {productImportPreview.issues.length > 0 && <div className="roster-import-issues" role="alert">{productImportPreview.issues.slice(0, 6).map((item) => <small key={item}>{item}</small>)}{productImportPreview.issues.length > 6 && <small>و{productImportPreview.issues.length - 6} مشكلات أخرى. صحّح الملف ثم أعد اختياره.</small>}</div>}
          {productImportPreview.rows.length > 0 && <div className="roster-preview-list">{productImportPreview.rows.slice(0, 4).map((row, index) => <div key={`${row.id ?? 'new'}-${index}`}><span>{row.name}</span><span>{row.subcategory} · {row.agentPrice?.toLocaleString('ar') ?? 'السعر غير محدد'}</span></div>)}</div>}
          <div className="admin-product-import-actions">
            <button className="admin-cancel-button" type="button" onClick={() => { setProductImportPreview(null); setProductCsvName('') }}>إلغاء المعاينة</button>
            <button className="admin-add-button" type="button" disabled={working || !productImportPreview.rows.length || Boolean(productImportPreview.issues.length)} onClick={() => void importProducts()}>
              {working ? <><LoaderCircle size={14} /> جارٍ الاستيراد ({productImportedRows}/{productImportPreview.rows.length})</> : <><Package size={14} /> استيراد {productImportPreview.rows.length} منتج</>}
            </button>
          </div>
        </div>}
        {products.length === 0 && <div className="admin-empty"><Package size={31} /><strong>الكتالوج فارغ</strong><small>ابدأ باستيراد ملف CSV أو أضف المنتجات الأساسية.</small><button className="admin-add-button" disabled={working} onClick={() => void seedCatalog()}><Archive size={15} /> تجهيز المنتجات الأساسية</button></div>}
        {products.length > 0 && filteredProducts.length === 0 && <div className="admin-empty"><Search size={26} /><strong>لا توجد منتجات في هذا التصنيف</strong></div>}
        {filteredProducts.length > 0 && <div className="admin-product-grid">{filteredProducts.map((product) => <article className="admin-product" key={product.id}>
          <div className="admin-product-photo">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <ImagePlus size={26} />}<span>{product.active ? 'نشط' : 'مخفي'}</span></div>
          <div className="admin-product-info"><strong>{product.name}</strong><small>{product.detail}</small><small>{productDepartments.find((item) => item.id === product.department)?.name} · {product.subcategory}</small><small>{product.category === 'essential' ? 'السلة الأساسية' : product.category === 'family' ? 'السلة العائلية' : 'كل السلال'}</small><strong className="admin-product-price">{typeof product.agentPrice === 'number' ? `سعر الوكيل: ${new Intl.NumberFormat('ar-YE').format(product.agentPrice)} ر.ي` : 'السعر غير محدد'}</strong></div>
          <div className="admin-product-actions"><button onClick={() => editProduct(product)}>تعديل / صورة</button><button className="danger-action" disabled={working} onClick={() => void removeProduct(product)} aria-label={`حذف ${product.name}`}><Trash2 size={15} /></button></div>
        </article>)}</div>}
      </section>}

      {!loading && tab === 'baskets' && <AdminBasketManagement products={products} onNotice={onNotice} userId={user.uid} />}
      {!loading && tab === 'employees' && <section className="admin-panel">
        <div className="admin-panel-heading"><div><h3>إدارة الموظفين</h3><p>أضف الموظفين أو استورد بياناتهم، ثم افتح سجل الموظف لتعديل ملفه أو صلاحية الدخول.</p></div><span>{employees.filter((employee) => employee.active).length} نشط</span></div>
        <div className="employee-bulk-import">
          <div className="employee-bulk-heading"><div><strong>استيراد قائمة الموظفين</strong><small>ارفع ملف CSV من الموارد البشرية؛ تُحفظ القائمة على دفعات آمنة.</small></div><button className="roster-template-button" type="button" onClick={downloadRosterTemplate}><Download size={14} /> تنزيل قالب CSV</button></div>
          <div className="employee-bulk-controls">
            <label className="roster-file-button"><Upload size={15} /> اختيار ملف CSV<input type="file" accept=".csv,text/csv" disabled={working} onChange={(event) => { void readRosterFile(event.currentTarget.files?.[0] ?? null); event.currentTarget.value = '' }} /></label>
            {rosterFileName && <span className="roster-file-name" dir="auto">{rosterFileName}</span>}
          </div>
          <small className="employee-bulk-help">الأعمدة المطلوبة: <b dir="ltr">email, employeeCode</b>. البريد مفتاح داخلي لسجل الموارد البشرية فقط، ولا يحتاج الموظف إلى استخدامه لتسجيل الدخول. الأعمدة الاختيارية: <b dir="ltr">company, monthlySpendingLimit, currentMonthlySpent</b>. الخانة الفارغة للشركة أو السقف تمسح قيمتها؛ والإنفاق الفارغ يصفره. الأعمدة غير الموجودة لا تغيّر بياناتها. لا تضف كلمات مرور.</small>
          {rosterPreview && <div className="roster-preview">
            <div className="roster-preview-summary"><strong>معاينة {rosterFileName}</strong><span>{rosterPreview.rows.length} سجل صالح</span><span className={rosterPreview.issues.length ? 'roster-invalid-count' : ''}>{rosterPreview.issues.length} مشكلة</span></div>
            {rosterPreview.issues.length > 0 && <div className="roster-import-issues" role="alert">{rosterPreview.issues.slice(0, 6).map((item) => <small key={item}>{item}</small>)}{rosterPreview.issues.length > 6 && <small>و{rosterPreview.issues.length - 6} مشكلات أخرى. صحّح الملف ثم أعد اختياره.</small>}</div>}
            {rosterPreview.rows.length > 0 && <div className="roster-preview-list">{rosterPreview.rows.slice(0, 4).map((row) => <div key={`${row.email}-${row.line}`}><span dir="ltr">{row.email}</span><span>الكود: {row.employeeCode}</span></div>)}</div>}
            <button className="admin-add-button roster-import-button" type="button" disabled={working || !rosterPreview.rows.length || Boolean(rosterPreview.issues.length)} onClick={() => void importEmployees()}>
              {working ? <><LoaderCircle size={14} /> جارٍ الاعتماد ({importedRows}/{rosterPreview.rows.length})</> : <><Users size={14} /> اعتماد {rosterPreview.rows.length} موظف</>}
            </button>
          </div>}
        </div>
        <div className="employee-single-heading"><strong>اعتماد موظف واحد</strong><small>استخدم هذا النموذج لإضافة موظف منفرد أو تعديل سجله.</small></div>
        <form className="employee-approval-form" onSubmit={(event) => void saveEmployee(event)}>
          <label className="field"><span>البريد الداخلي لسجل الموظف</span><input required type="email" dir="ltr" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="employee@company.com" /><small>يُستخدم لربط سجل الموارد البشرية والطلبات فقط؛ الموظف يسجل الدخول برقم الهاتف وكلمة المرور.</small></label>
          <label className="field"><span>الكود الوظيفي</span><input required value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} placeholder="مثال: 10482" /></label>
          <label className="field"><span>رقم الهاتف مع رمز الدولة</span><input required type="tel" dir="ltr" value={employeePhone} onChange={(event) => setEmployeePhone(event.target.value)} placeholder="+967 7XX XXX XXX" /></label>
          <button className="admin-add-button" disabled={working}><Plus size={15} /> اعتماد الموظف</button>
        </form>
        <div className="admin-roster-toolbar"><div className="admin-data-actions"><span>{employees.length} موظف</span><button type="button" className="admin-export-button" disabled={exporting || !employees.length} onClick={() => void deliverEmployees(false)}><Download size={14} /> تصدير CSV</button><button type="button" className="admin-export-button" disabled={exporting || !employees.length} onClick={() => void deliverEmployees(true)}><Share2 size={14} /> مشاركة</button></div></div>
        <AdminEmployeeProfiles user={user} organizationOptions={organizationOptions} onNotice={onNotice} />
      </section>}

      {!loading && tab === 'settings' && <AdminIntegrationSettings user={user} onNotice={onNotice} />}
      {!loading && tab === 'organization' && <AdminOrganizationSettings
        user={user}
        onNotice={onNotice}
        onOptionsSaved={onOrganizationOptionsChange}
      />}

      {(editingId || editingId === 'new') && <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeProductEditor() }}>
        <form className="admin-product-form" onSubmit={(event) => void saveProduct(event)}>
          <div className="admin-form-heading"><div><h3>{editingId === 'new' ? 'إضافة منتج' : 'تعديل المنتج'}</h3><p>JPG أو PNG أو WebP حتى ٦٠٠ كيلوبايت؛ تُحفظ الصورة الأصلية دون ضغط أو تغيير أبعاد.</p></div><button type="button" aria-label="إغلاق" onClick={closeProductEditor}><X size={19} /></button></div>
          <label className="field"><span>اسم المنتج</span><input required maxLength={80} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="مثال: زيت نباتي" /></label>
          <label className="field"><span>الوصف المختصر</span><input required maxLength={120} value={draft.detail} onChange={(event) => setDraft((current) => ({ ...current, detail: event.target.value }))} placeholder="حجم العبوة أو معلومات المنتج" /></label>
          <label className="field"><span>سعر الوكيل الأساسي (ر.ي)</span><input required type="number" min="0" step="1" value={draft.agentPrice ?? ''} onChange={(event) => setDraft((current) => ({ ...current, agentPrice: event.target.value ? Number(event.target.value) : undefined }))} placeholder="أدخل السعر المعتمد" /></label>
          {organizationOptions.companies.map((company) => <label className="field" key={company.name}><span>سعر الوكيل — {company.name} (اختياري)</span><input type="number" min="0" step="1" value={draft.companyAgentPrices?.[company.name] ?? ''} onChange={(event) => setDraft((current) => {
            const prices = { ...(current.companyAgentPrices ?? {}) }
            if (event.target.value) prices[company.name] = Number(event.target.value)
            else delete prices[company.name]
            return { ...current, companyAgentPrices: prices }
          })} placeholder="اتركه فارغاً لاستخدام السعر الأساسي" /></label>)}
          <div className="admin-select-grid">
            <label className="field"><span>القسم الرئيسي</span><select value={draft.department} onChange={(event) => {
              const department = productDepartments.find((item) => item.id === event.target.value)
              if (!department) return
              setDraft((current) => ({ ...current, department: department.id, subcategory: department.categories[0] }))
            }}>{productDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
            <label className="field"><span>التصنيف الفرعي</span><select value={draft.subcategory} onChange={(event) => setDraft((current) => ({ ...current, subcategory: event.target.value }))}>{(productDepartments.find((item) => item.id === draft.department)?.categories ?? []).map((subcategory) => <option key={subcategory}>{subcategory}</option>)}</select></label>
          </div>
          <div className="admin-select-grid">
            <label className="field"><span>السلة</span><select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as ProductDraft['category'] }))}><option value="essential">الأساسية</option><option value="family">العائلية</option><option value="both">كل السلال</option></select></label>
            <label className="field"><span>أيقونة احتياطية</span><select value={draft.iconKey} onChange={(event) => setDraft((current) => ({ ...current, iconKey: event.target.value as ProductDraft['iconKey'] }))}><option value="package">صندوق</option><option value="oil">زيت</option><option value="grain">حبوب</option><option value="leaf">ورقة</option><option value="tuna">معلبات</option></select></label>
          </div>
          <label className="image-upload"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectImage(event.target.files?.[0] ?? null)} /><ImagePlus size={18} /><span>{imageFile?.name ?? (draft.imageUrl ? 'اختر صورة بديلة أو احتفظ بالصورة الحالية' : 'اختر صورة من جهازك')}</span></label>
          {(previewUrl || draft.imageUrl) && <img className="image-preview" src={previewUrl || draft.imageUrl} alt="معاينة صورة المنتج" />}
          <label className="admin-checkbox"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} /> عرض المنتج في كتالوج الموظفين</label>
          <div className="admin-form-actions"><button type="button" className="admin-cancel-button" onClick={closeProductEditor}>إلغاء</button><button className="admin-add-button" disabled={working}>{working ? <LoaderCircle size={15} /> : <Check size={15} />}{working ? 'جارٍ الحفظ…' : 'حفظ المنتج'}</button></div>
        </form>
      </div>}
    </div>
  )
}

type OrderActionRequest = {
  id: string
  uid: string
  email: string
  employeeCode: string
  orderId: string
  reference: string
  action: 'edit' | 'delete'
  message: string
}

function OrderActionRequests({ user, onNotice }: { user: User; onNotice: (message: string) => void }) {
  const [requests, setRequests] = useState<OrderActionRequest[]>([])
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!firestore) return
    return onSnapshot(query(collection(firestore, 'order_action_requests'), where('status', '==', 'pending')), (snapshot) => {
      setRequests(snapshot.docs.map((item) => {
        const data = item.data()
        return {
          id: item.id,
          uid: typeof data.uid === 'string' ? data.uid : '',
          email: typeof data.email === 'string' ? data.email : '',
          employeeCode: typeof data.employeeCode === 'string' ? data.employeeCode : '',
          orderId: typeof data.orderId === 'string' ? data.orderId : '',
          reference: typeof data.reference === 'string' ? data.reference : '',
          action: data.action === 'delete' ? 'delete' : 'edit',
          message: typeof data.message === 'string' ? data.message : '',
        }
      }))
    }, (error) => {
      console.error('Unable to load employee order action requests.', error)
      onNotice(firebaseErrorMessage(error))
    })
  }, [onNotice])

  async function resolveRequest(request: OrderActionRequest, status: 'reviewed' | 'rejected') {
    if (!firestore || working) return
    setWorking(true)
    try {
      await updateDoc(doc(firestore, 'order_action_requests', request.id), {
        status,
        reviewedBy: user.uid,
        reviewedAt: serverTimestamp(),
      })
      onNotice(status === 'reviewed'
        ? `تم تعليم طلب ${request.action === 'edit' ? 'تعديل' : 'حذف'} ${request.reference} بأنه عولج. نفّذ التغيير من بطاقة الطلب عند الحاجة.`
        : `تم رفض طلب ${request.action === 'edit' ? 'تعديل' : 'حذف'} ${request.reference}.`)
    } catch (error) {
      console.error(`Unable to resolve employee order action request ${request.id}.`, error)
      onNotice(firebaseErrorMessage(error))
    } finally {
      setWorking(false)
    }
  }

  return <section className="order-action-requests">
    <h4>طلبات تعديل أو حذف الطلبات ({requests.length})</h4>
    {!requests.length ? <small>لا توجد طلبات معلقة من الموظفين.</small> : requests.map((request) => <article key={request.id}>
      <div><strong>{request.action === 'edit' ? 'طلب تعديل' : 'طلب حذف'} · {request.reference}</strong>
        <span>{request.email} · الكود الوظيفي: {request.employeeCode}</span>
        <p>{request.message}</p>
        <small>معرّف الطلب: {request.orderId}</small>
      </div>
      <div className="order-action-request-buttons">
        <button type="button" disabled={working} onClick={() => void resolveRequest(request, 'reviewed')}>تمت المعالجة</button>
        <button type="button" disabled={working} onClick={() => void resolveRequest(request, 'rejected')}>رفض الطلب</button>
      </div>
    </article>)}
  </section>
}
