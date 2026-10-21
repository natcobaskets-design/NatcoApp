import { Droplets, Leaf, Package, ShoppingBasket, Wheat, type LucideIcon } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'

export type Screen = 'email' | 'profile' | 'baskets' | 'customize' | 'receipt' | 'admin'
export type EmployeeProfile = {
  email: string
  employeeCode: string
  name: string
  company: string
  branch: string
  province?: string
  address: string
  coordinates: string
  phone: string
  whatsapp: string
  monthlySpendingLimit?: number
  currentMonthlySpent?: number
  spendingPeriod?: string
}
export type BasketCounts = Record<string, number>
export type BasketDefinition = {
  id: string
  name: string
  kind: 'essential' | 'family' | 'custom'
  description: string
  maxPerEmployee: number
  productIds: string[]
  active: boolean
}
export type BasketSelectionSettings = { maxTotalPerEmployee: number }
export type OrderStatus = 'received' | 'preparing' | 'ready' | 'fulfilled' | 'cancelled' | 'deleted'
export const productDepartments = [
  {
    id: 'consumables',
    name: 'المواد الاستهلاكية',
    categories: [
      'مواد تموينية متنوعة', 'الأرز', 'الدقيق والحبوب', 'السكر والمحليات',
      'السمن والزيوت', 'الصلصات والمخللات', 'المعلبات الغذائية', 'المكرونة والنودلز',
      'الأجبان', 'الألبان والحليب والبيض',
    ],
  },
  {
    id: 'frozen',
    name: 'المجمدات واللحوم',
    categories: ['اللحوم', 'الدواجن', 'الأسماك والمأكولات البحرية', 'الخضروات المجمدة', 'الوجبات المجمدة', 'الآيس كريم والحلويات المجمدة'],
  },
  {
    id: 'beverages',
    name: 'المشروبات',
    categories: ['المياه', 'العصائر', 'المشروبات الغازية', 'الشاي والقهوة', 'المشروبات سريعة التحضير'],
  },
  {
    id: 'home-care',
    name: 'العناية بالمنزل',
    categories: ['منظفات المنزل', 'الغسيل', 'غسيل الأواني', 'معطرات الجو', 'المناديل والورقيات'],
  },
  {
    id: 'baby-care',
    name: 'العناية بالطفل',
    categories: ['الحفاضات', 'مناديل الأطفال', 'حليب وأغذية الأطفال', 'استحمام الطفل', 'مستلزمات الطفل'],
  },
  {
    id: 'personal-care',
    name: 'العناية الشخصية',
    categories: ['العناية بالبشرة', 'العناية بالشعر', 'العناية بالفم والأسنان', 'الحلاقة', 'العناية النسائية', 'النظافة الشخصية'],
  },
  {
    id: 'snacks',
    name: 'الوجبات الخفيفة',
    categories: ['الشيبس والمقرمشات', 'البسكويت', 'الشوكولاتة والحلويات', 'المكسرات'],
  },
  {
    id: 'spices-dates',
    name: 'البهارات والتمور',
    categories: ['البهارات والتوابل', 'التمور', 'القهوة ومستلزماتها', 'منتجات التمور'],
  },
] as const
export type ProductDepartmentId = (typeof productDepartments)[number]['id']
export type CatalogProduct = {
  id: string
  name: string
  detail: string
  category: 'essential' | 'family' | 'both'
  department: ProductDepartmentId
  subcategory: string
  tone: 'yellow' | 'green' | 'blue' | 'peach'
  iconKey: 'oil' | 'grain' | 'leaf' | 'package' | 'tuna'
  imageUrl: string
  imagePath: string
  active: boolean
  agentPrice?: number
  companyAgentPrices?: Record<string, number>
}
export type Order = {
  id: string
  uid: string
  reference: string
  createdAt: string
  profile: EmployeeProfile
  baskets: BasketCounts
  basketSelections?: string[]
  items: Record<string, number>
  itemDetails: Record<string, { name: string; imageUrl?: string; agentPrice?: number; lineTotal?: number }>
  excluded: string[]
  status: OrderStatus
  editCount?: number
  totalAmount?: number
  currency?: string
  pickupBranch?: string
}

export const companies = [
  'ناتكو الاستهلاكية', 'الشركة اليمنية للصناعة والتجارة YICOM', 'نادفود NADFOOD',
  'شركة أروى', 'المتحدة للصابون', 'السعيد', 'تهامة',
]
export const branches = ['صنعاء', 'عدن', 'تعز', 'الحديدة', 'المكلا', 'إب', 'مأرب']
export type OrganizationCompany = { name: string; branches: string[] }
export type OrganizationOptions = { companies: OrganizationCompany[]; branches: string[] }
export const defaultOrganizationOptions: OrganizationOptions = {
  companies: companies.map((name) => ({ name, branches: [...branches] })),
  branches: [...branches],
}

export function parseOrganizationOptions(data: Record<string, unknown>): OrganizationOptions | null {
  if (!Array.isArray(data.branches) || !data.branches.every((branch) => typeof branch === 'string')) return null
  const branchOptions = data.branches as string[]
  if (!Array.isArray(data.companies)) return null
  const companyOptions: OrganizationCompany[] = []
  for (const company of data.companies) {
    if (typeof company === 'string') {
      companyOptions.push({ name: company, branches: [...branchOptions] })
      continue
    }
    if (!company || typeof company !== 'object' || Array.isArray(company)) return null
    const entry = company as Record<string, unknown>
    if (typeof entry.name !== 'string' || !Array.isArray(entry.branches) ||
      !entry.branches.every((branch) => typeof branch === 'string')) return null
    companyOptions.push({ name: entry.name, branches: entry.branches })
  }
  if (!companyOptions.length || !branchOptions.length) return null
  return { companies: companyOptions, branches: branchOptions }
}
export const defaultBasketDefinitions: BasketDefinition[] = [
  { id: 'essential', name: 'السلة الأساسية', kind: 'essential', description: 'احتياجات البيت اليومية', maxPerEmployee: 2, productIds: ['oil', 'rice', 'sugar'], active: true },
  { id: 'family', name: 'السلة العائلية', kind: 'family', description: 'خيارات أكثر لجميع أفراد الأسرة', maxPerEmployee: 2, productIds: ['powder-milk', 'fresh-milk', 'pasta', 'tuna'], active: true },
]
export const defaultBasketSelectionSettings: BasketSelectionSettings = { maxTotalPerEmployee: 2 }
export const basketIcons: Record<string, LucideIcon> = {
  grain: Wheat,
  family: ShoppingBasket,
}
export const productIcons: Record<CatalogProduct['iconKey'], LucideIcon> = {
  oil: Droplets,
  grain: Wheat,
  leaf: Leaf,
  package: Package,
  tuna: ShoppingBasket,
}
export const productCatalogSeed: CatalogProduct[] = [
  { id: 'oil', name: 'زيت نباتي', detail: 'عبوة عائلية', category: 'essential', department: 'consumables', subcategory: 'السمن والزيوت', tone: 'yellow', iconKey: 'oil', imageUrl: '', imagePath: '', active: true },
  { id: 'rice', name: 'أرز بسمتي', detail: 'حبة طويلة ممتازة', category: 'essential', department: 'consumables', subcategory: 'الأرز', tone: 'green', iconKey: 'grain', imageUrl: '', imagePath: '', active: true },
  { id: 'sugar', name: 'سكر أبيض', detail: 'مكرر ناعم', category: 'essential', department: 'consumables', subcategory: 'السكر والمحليات', tone: 'blue', iconKey: 'leaf', imageUrl: '', imagePath: '', active: true },
  { id: 'powder-milk', name: 'حليب بودرة', detail: 'غني بالكالسيوم', category: 'family', department: 'consumables', subcategory: 'الألبان والحليب والبيض', tone: 'peach', iconKey: 'package', imageUrl: '', imagePath: '', active: true },
  { id: 'fresh-milk', name: 'حليب سائل', detail: 'طويل الأجل', category: 'family', department: 'consumables', subcategory: 'الألبان والحليب والبيض', tone: 'blue', iconKey: 'package', imageUrl: '', imagePath: '', active: true },
  { id: 'pasta', name: 'مكرونة', detail: 'اختيار عائلي', category: 'family', department: 'consumables', subcategory: 'المكرونة والنودلز', tone: 'yellow', iconKey: 'grain', imageUrl: '', imagePath: '', active: true },
  { id: 'tuna', name: 'تونة', detail: 'معلبة وجاهزة', category: 'family', department: 'consumables', subcategory: 'المعلبات الغذائية', tone: 'green', iconKey: 'tuna', imageUrl: '', imagePath: '', active: true },
]
export const blankProfile: EmployeeProfile = {
  email: '', employeeCode: '', name: '', company: '', branch: '', address: '',
  coordinates: '', phone: '', whatsapp: '',
}
export const emptyCounts = (): BasketCounts => ({ essential: 0, family: 0 })

export function parseBasketDefinition(id: string, data: Record<string, unknown>): BasketDefinition | null {
  if (typeof data.name !== 'string' || !data.name.trim() ||
    !['essential', 'family', 'custom'].includes(String(data.kind)) ||
    typeof data.description !== 'string' ||
    !Number.isInteger(data.maxPerEmployee) || Number(data.maxPerEmployee) < 0 ||
    Number(data.maxPerEmployee) > 10 ||
    !Array.isArray(data.productIds) || !data.productIds.every((value) => typeof value === 'string')) return null
  return {
    id,
    name: data.name.trim(),
    kind: data.kind as BasketDefinition['kind'],
    description: data.description,
    maxPerEmployee: Number(data.maxPerEmployee),
    productIds: data.productIds as string[],
    active: data.active !== false,
  }
}
export const orderStatusLabels: Record<OrderStatus, string> = {
  received: 'وصل الطلب',
  preparing: 'قيد التجهيز',
  ready: 'جاهز للصرف',
  fulfilled: 'تم التسليم',
  cancelled: 'ملغي',
  deleted: 'محذوف (DELETED)',
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function parseProfile(data: Record<string, unknown>): EmployeeProfile | null {
  const fields: (keyof EmployeeProfile)[] = [
    'email', 'employeeCode', 'name', 'company', 'branch',
    'address', 'coordinates', 'phone', 'whatsapp',
  ]
  if (fields.some((field) => typeof data[field] !== 'string') ||
    (data.province !== undefined && typeof data.province !== 'string')) return null
  return {
    ...Object.fromEntries(fields.map((field) => [field, data[field]])),
    ...(typeof data.province === 'string' ? { province: data.province } : {}),
    ...(typeof data.monthlySpendingLimit === 'number' && Number.isFinite(data.monthlySpendingLimit)
      ? { monthlySpendingLimit: data.monthlySpendingLimit } : {}),
    ...(typeof data.currentMonthlySpent === 'number' && Number.isFinite(data.currentMonthlySpent)
      ? { currentMonthlySpent: data.currentMonthlySpent } : {}),
    ...(typeof data.spendingPeriod === 'string' ? { spendingPeriod: data.spendingPeriod } : {}),
  } as EmployeeProfile
}

export function parseCatalogProduct(id: string, data: Record<string, unknown>): CatalogProduct | null {
  if (typeof data.name !== 'string' || typeof data.detail !== 'string') return null
  const category = data.category
  const tone = data.tone
  const iconKey = data.iconKey
  if (!['essential', 'family', 'both'].includes(String(category)) ||
    !['yellow', 'green', 'blue', 'peach'].includes(String(tone)) ||
    !['oil', 'grain', 'leaf', 'package', 'tuna'].includes(String(iconKey))) return null
  const department = productDepartments.find((item) => item.id === data.department)
  const subcategory = typeof data.subcategory === 'string' &&
    (department?.categories.some((item) => item === data.subcategory) ?? false)
    ? data.subcategory
    : department?.categories[0] ?? productDepartments[0].categories[0]
  return {
    id,
    name: data.name,
    detail: data.detail,
    category: category as CatalogProduct['category'],
    department: department?.id ?? 'consumables',
    subcategory,
    tone: tone as CatalogProduct['tone'],
    iconKey: iconKey as CatalogProduct['iconKey'],
    imageUrl: stringField(data.imageUrl),
    imagePath: stringField(data.imagePath),
    active: data.active !== false,
    ...(typeof data.agentPrice === 'number' && Number.isFinite(data.agentPrice) && data.agentPrice >= 0
      ? { agentPrice: data.agentPrice } : {}),
    ...(data.companyAgentPrices && typeof data.companyAgentPrices === 'object' && !Array.isArray(data.companyAgentPrices)
      ? { companyAgentPrices: Object.fromEntries(Object.entries(data.companyAgentPrices)
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0)) }
      : {}),
  }
}

export function productAgentPrice(product: CatalogProduct, company: string): number | null {
  const companyPrice = product.companyAgentPrices?.[company]
  if (typeof companyPrice === 'number' && Number.isFinite(companyPrice) && companyPrice >= 0) return companyPrice
  return typeof product.agentPrice === 'number' && Number.isFinite(product.agentPrice) && product.agentPrice >= 0
    ? product.agentPrice
    : null
}

export function formatYER(amount: number): string {
  return `${new Intl.NumberFormat('ar-YE', { maximumFractionDigits: 0 }).format(amount)} ر.ي`
}

export function parseOrder(id: string, data: Record<string, unknown>): Order | null {
  if (!data.profile || typeof data.profile !== 'object' || Array.isArray(data.profile) ||
    !data.baskets || typeof data.baskets !== 'object' || Array.isArray(data.baskets) ||
    !data.items || typeof data.items !== 'object' || Array.isArray(data.items) ||
    !data.itemDetails || typeof data.itemDetails !== 'object' || Array.isArray(data.itemDetails) ||
    !Array.isArray(data.excluded)) return null
  const uid = stringField(data.uid)
  const profile = parseProfile(data.profile as Record<string, unknown>)
  if (!uid || !profile ||
    !['received', 'preparing', 'ready', 'fulfilled', 'cancelled', 'deleted'].includes(String(data.status))) return null
  const baskets = data.baskets as Record<string, unknown>
  const items = data.items as Record<string, unknown>
  const rawDetails = data.itemDetails as Record<string, unknown>
  const quantities = Object.fromEntries(
    Object.entries(items).filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && Number(entry[1]) >= 0),
  )
  const itemDetails = Object.fromEntries(Object.entries(rawDetails).flatMap(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const detail = value as Record<string, unknown>
    return typeof detail.name === 'string'
      ? [[key, {
        name: detail.name,
        imageUrl: stringField(detail.imageUrl),
        ...(typeof detail.agentPrice === 'number' ? { agentPrice: detail.agentPrice } : {}),
        ...(typeof detail.lineTotal === 'number' ? { lineTotal: detail.lineTotal } : {}),
      }]]
      : []
  }))
  const createdAt = data.createdAt instanceof Timestamp
    ? data.createdAt.toDate().toISOString()
    : stringField(data.createdAt)
  const basketCounts = Object.fromEntries(
    Object.entries(baskets).filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && Number(entry[1]) >= 0),
  )
  return {
    id,
    uid,
    reference: stringField(data.reference) || id,
    createdAt,
    profile,
    baskets: basketCounts,
    ...(Array.isArray(data.basketSelections) &&
      data.basketSelections.every((item) => typeof item === 'string')
      ? { basketSelections: data.basketSelections as string[] } : {}),
    items: quantities,
    itemDetails,
    excluded: data.excluded.filter((item): item is string => typeof item === 'string'),
    status: data.status as OrderStatus,
    editCount: Number.isInteger(data.editCount) && Number(data.editCount) >= 0
      ? Number(data.editCount) : 0,
    ...(typeof data.totalAmount === 'number' && Number.isFinite(data.totalAmount)
      ? { totalAmount: data.totalAmount } : {}),
    ...(typeof data.currency === 'string' ? { currency: data.currency } : {}),
    ...(typeof data.pickupBranch === 'string' ? { pickupBranch: data.pickupBranch } : {}),
  }
}
