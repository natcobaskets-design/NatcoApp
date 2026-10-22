import {
  orderStatusLabels,
  type CatalogProduct,
  type Order,
} from './domain'

export type EmployeeEntry = {
  email: string
  employeeCode: string
  name?: string
  phone?: string
  whatsapp?: string
  active: boolean
  company?: string
  branch?: string
  province?: string
  address?: string
  coordinates?: string
  monthlySpendingLimit?: number
  currentMonthlySpent?: number
  spendingPeriod?: string
}
export type CsvShareResult = 'shared' | 'downloaded' | 'cancelled'

function escapeCsvCell(value: string | number): string {
  let safeValue = String(value)
  if (/^\s*[=+\-@]/.test(safeValue)) safeValue = `'${safeValue}`
  return `"${safeValue.replace(/"/g, '""')}"`
}

export function encodeCsv(headers: string[], rows: Array<Array<string | number>>): string {
  return `\uFEFF${[headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n')}\r\n`
}

const orderSheetHeaders = [
  'معرف الطلب', 'رقم الطلب', 'تاريخ الطلب', 'الحالة', 'اسم الموظف',
  'الكود الوظيفي', 'البريد الإلكتروني', 'الشركة', 'الفرع', 'الهاتف',
  'واتساب', 'العنوان', 'فرع الاستلام', 'السلة الأساسية', 'السلة العائلية',
  'الأصناف والكميات', 'الأصناف المستبعدة', 'الإجمالي (ر.ي)', 'العملة',
  'نوع الحركة', 'عدد التعديلات', 'آخر تحديث',
]

function orderSheetStatus(status: Order['status']): string {
  const sheetLabels: Record<Order['status'], string> = {
    received: 'وصل الطلب (RECEIVED)',
    preparing: 'قيد التجهيز (PREPARING)',
    ready: 'جاهز للصرف (READY)',
    fulfilled: 'تم التسليم (FULFILLED)',
    cancelled: 'ملغي (CANCELLED)',
    deleted: 'محذوف (DELETED)',
  }
  return sheetLabels[status]
}

function orderSheetRows(orders: Order[], products: CatalogProduct[]): Array<Array<string | number>> {
  const productNames = new Map(products.map((product) => [product.id, product.name]))
  return orders.map((order) => [
    order.id,
    order.reference,
    order.createdAt,
    orderSheetStatus(order.status),
    order.profile.name,
    order.profile.employeeCode,
    order.profile.email,
    order.profile.company,
    order.profile.branch,
    order.profile.phone,
    order.profile.whatsapp,
    order.profile.address,
    order.pickupBranch ?? order.profile.branch,
    order.baskets.essential ?? 0,
    order.baskets.family ?? 0,
    Object.entries(order.items)
      .filter(([, quantity]) => quantity > 0)
      .map(([id, quantity]) => `${order.itemDetails[id]?.name ?? productNames.get(id) ?? id} × ${quantity}`)
      .join(' | '),
    order.excluded.map((id) => order.itemDetails[id]?.name ?? productNames.get(id) ?? id).join(' | '),
    order.totalAmount ?? '',
    order.currency ?? 'YER',
    order.editCount
      ? 'تم تعديل الطلب'
      : order.updatedAt && new Date(order.updatedAt).getTime() > new Date(order.createdAt).getTime() + 1000
        ? 'تم تحديث الحالة'
        : 'تم إنشاء الطلب',
    order.editCount ?? 0,
    order.updatedAt ?? order.createdAt,
  ])
}

export function ordersToCsv(orders: Order[], products: CatalogProduct[]): string {
  return encodeCsv(orderSheetHeaders, orderSheetRows(orders, products))
}

export function sapOrdersToCsv(orders: Order[], products: CatalogProduct[]): string {
  const productNames = new Map(products.map((product) => [product.id, product.name]))
  const headers = [
    'ExternalReference', 'DocumentDate', 'EmployeeCode', 'EmployeeName', 'Company',
    'PickupBranch', 'ProductCode', 'ProductDescription', 'Quantity', 'UnitPriceYER',
    'LineAmountYER', 'OrderTotalYER', 'Currency', 'OrderStatus',
  ]
  const rows = orders.filter((order) => order.status !== 'deleted').flatMap((order) =>
    Object.entries(order.items).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => {
      const detail = order.itemDetails[id]
      const unitPrice = detail?.agentPrice
      return [
        order.reference,
        order.createdAt,
        order.profile.employeeCode,
        order.profile.name,
        order.profile.company,
        order.pickupBranch ?? order.profile.branch,
        id,
        detail?.name ?? productNames.get(id) ?? id,
        quantity,
        unitPrice ?? '',
        detail?.lineTotal ?? (typeof unitPrice === 'number' ? unitPrice * quantity : ''),
        order.totalAmount ?? '',
        order.currency ?? 'YER',
        order.status.toUpperCase(),
      ]
    }),
  )
  return encodeCsv(headers, rows)
}

export function sapProductsToCsv(products: CatalogProduct[]): string {
  return encodeCsv(
    ['MaterialCode', 'MaterialDescription', 'ProductDetail', 'Department', 'Category', 'BasketType', 'AgentPriceYER', 'Currency', 'IsActive'],
    products.map((product) => [
      product.id,
      product.name,
      product.detail,
      product.department,
      product.subcategory,
      product.category,
      product.agentPrice ?? '',
      'YER',
      product.active ? 'true' : 'false',
    ]),
  )
}

export function productsToCsv(products: CatalogProduct[]): string {
  return encodeCsv(
    ['id', 'name', 'detail', 'department', 'subcategory', 'basket', 'agentPrice', 'companyAgentPrices', 'active'],
    products.map((product) => [
      product.id,
      product.name,
      product.detail,
      product.department,
      product.subcategory,
      product.category,
      product.agentPrice ?? '',
      JSON.stringify(product.companyAgentPrices ?? {}),
      product.active ? 'true' : 'false',
    ]),
  )
}

export function sapEmployeesToCsv(employees: EmployeeEntry[]): string {
  return encodeCsv(
    ['EmployeeCode', 'EmployeeName', 'Email', 'Company', 'Branch', 'Province', 'Phone', 'WhatsApp', 'Address', 'Coordinates', 'MonthlySpendingLimitYER', 'CurrentMonthlySpentYER', 'AccountStatus'],
    employees.map((employee) => [
      employee.employeeCode,
      employee.name ?? '',
      employee.email,
      employee.company ?? '',
      employee.branch ?? '',
      employee.province ?? '',
      employee.phone ?? '',
      employee.whatsapp ?? '',
      employee.address ?? '',
      employee.coordinates ?? '',
      employee.monthlySpendingLimit ?? '',
      employee.currentMonthlySpent ?? 0,
      employee.active ? 'ACTIVE' : 'INACTIVE',
    ]),
  )
}

export function printOrderReport(orders: Order[], products: CatalogProduct[]): void {
  const printFrame = document.createElement('iframe')
  printFrame.setAttribute('title', 'تقرير طلبات ناتكو للطباعة')
  printFrame.style.position = 'fixed'
  printFrame.style.width = '1px'
  printFrame.style.height = '1px'
  printFrame.style.opacity = '0'
  printFrame.style.pointerEvents = 'none'
  printFrame.style.insetInlineStart = '-10000px'
  document.body.append(printFrame)
  const printDocument = printFrame.contentDocument
  const printWindow = printFrame.contentWindow
  if (!printDocument || !printWindow) {
    printFrame.remove()
    throw new Error('تعذر تجهيز صفحة الطباعة. أعد المحاولة أو اسمح بالطباعة من إعدادات المتصفح.')
  }
  const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
  const rows = orderSheetRows(orders, products)
  const content = `<div class="table-wrap"><table><thead><tr>${orderSheetHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>`
  printDocument.open()
  printDocument.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير طلبات ناتكو</title><style>
    body{font:11px Arial,sans-serif;margin:20px;color:#182344}h1{font-size:20px}.table-wrap{overflow:visible}table{width:100%;border-collapse:collapse;margin:12px 0;table-layout:auto}th,td{border:1px solid #ccd2df;padding:5px;text-align:right;vertical-align:top;overflow-wrap:anywhere}th{background:#f1f3f8;white-space:nowrap}@media print{body{margin:8mm}table{font-size:8px}th,td{padding:3px}}
    </style></head><body><h1>تقرير طلبات ناتكو الكامل</h1><p>عدد الطلبات: ${orders.length} · تاريخ الطباعة: ${escapeHtml(new Date().toLocaleString('ar-YE'))}</p>${content || '<p>لا توجد طلبات للطباعة.</p>'}</body></html>`)
  printDocument.close()
  let removed = false
  const removeFrame = () => {
    if (removed) return
    removed = true
    window.setTimeout(() => printFrame.remove(), 1000)
  }
  printWindow.addEventListener('afterprint', removeFrame, { once: true })
  window.setTimeout(() => {
    if (!printFrame.isConnected) return
    printWindow.focus()
    printWindow.print()
    window.setTimeout(removeFrame, 60_000)
  }, 250)
}

export function employeesToCsv(employees: EmployeeEntry[]): string {
  return encodeCsv(
    ['البريد الإلكتروني', 'الاسم', 'الكود الوظيفي', 'الشركة', 'الفرع', 'المحافظة', 'الهاتف', 'واتساب', 'العنوان', 'الإحداثيات', 'السقف الشهري (ر.ي)', 'الإنفاق الحالي (ر.ي)', 'فترة الإنفاق', 'الحالة'],
    employees.map((employee) => [
      employee.email,
      employee.name ?? '',
      employee.employeeCode,
      employee.company ?? '',
      employee.branch ?? '',
      employee.province ?? '',
      employee.phone ?? '',
      employee.whatsapp ?? '',
      employee.address ?? '',
      employee.coordinates ?? '',
      employee.monthlySpendingLimit ?? '',
      employee.currentMonthlySpent ?? 0,
      employee.spendingPeriod ?? '',
      employee.active ? 'معتمد' : 'موقوف',
    ]),
  )
}

export function filterOrders(orders: Order[], search: string): Order[] {
  const term = search.trim().toLocaleLowerCase()
  if (!term) return orders
  return orders.filter((order) => [
    order.reference, order.createdAt, orderStatusLabels[order.status],
    order.profile.email, order.profile.employeeCode, order.profile.name,
    order.profile.company, order.profile.branch, order.profile.phone,
    order.profile.whatsapp, order.profile.address,
  ].some((value) => value.toLocaleLowerCase().includes(term)))
}

export function filterEmployees(employees: EmployeeEntry[], search: string): EmployeeEntry[] {
  const term = search.trim().toLocaleLowerCase()
  if (!term) return employees
  return employees.filter((employee) => [
    employee.email,
    employee.employeeCode,
    employee.phone ?? '',
    employee.company ?? '',
    employee.active ? 'معتمد active' : 'موقوف inactive',
  ].some((value) => value.toLocaleLowerCase().includes(term)))
}

export async function shareOrDownloadCsv(filename: string, csv: string, preferShare = false): Promise<CsvShareResult> {
  const file = new File([csv], filename, { type: 'text/csv;charset=utf-8' })
  if (preferShare && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      throw error
    }
  }

  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return 'downloaded'
}
