import {
  productDepartments,
  type CatalogProduct,
  type ProductDepartmentId,
} from './domain'

export const productImportLimit = 1000

export type ProductImportRow = Omit<CatalogProduct, 'id' | 'imageUrl' | 'imagePath' | 'active'> & {
  id?: string
  active?: boolean
  providedFields: string[]
}

export type ProductImportPreview = {
  rows: ProductImportRow[]
  issues: string[]
  duplicatesRemoved: number
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim())
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  if (quoted) throw new Error('يحتوي الملف على حقل نصي غير مكتمل بعلامة اقتباس.')
  return rows
}

function headerKey(value: string): string {
  return value.trim().replace(/^\uFEFF/, '').toLowerCase().replace(/[\s_-]+/g, '')
}

function getColumn(columns: Map<string, number>, ...names: string[]): number {
  for (const name of names) {
    const index = columns.get(headerKey(name))
    if (index !== undefined) return index
  }
  return -1
}

function cell(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? '').trim() : ''
}

function parseDepartment(value: string): ProductDepartmentId | null {
  const department = productDepartments.find((item) =>
    item.id === value || item.name === value)
  return department?.id ?? null
}

function parseBasketCategory(value: string): CatalogProduct['category'] | null {
  const category = value.toLowerCase()
  if (['essential', 'أساسية', 'الأساسية'].includes(category)) return 'essential'
  if (['family', 'عائلية', 'العائلية'].includes(category)) return 'family'
  if (['both', 'all', 'كل السلال', 'الكل', ''].includes(category)) return 'both'
  return null
}

function parsePrice(value: string): number | undefined | null {
  if (!value) return undefined
  const price = Number(value.replace(/[,\s]/g, ''))
  return Number.isFinite(price) && price >= 0 ? price : null
}

function parseCompanyPrices(value: string, allowedCompanies?: string[]): Record<string, number> | null | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const entries = Object.entries(parsed)
    if (entries.some(([company, price]) =>
      (allowedCompanies && !allowedCompanies.includes(company)) ||
      typeof price !== 'number' || !Number.isFinite(price) || price < 0)) return null
    return Object.fromEntries(entries) as Record<string, number>
  } catch {
    return null
  }
}

export function parseProductCsv(text: string, allowedCompanies?: string[]): ProductImportPreview {
  const normalized = text.replace(/^\uFEFF/, '').replace(/^sep=[,;\t]\r?\n/i, '')
  const firstLine = normalized.split(/\r?\n/, 1)[0] ?? ''
  const delimiters = [',', ';', '\t']
  const delimiter = delimiters.sort((left, right) =>
    (firstLine.split(right).length - 1) - (firstLine.split(left).length - 1))[0]
  let csvRows: string[][]
  try {
    csvRows = parseCsv(normalized, delimiter)
  } catch (error) {
    return { rows: [], issues: [error instanceof Error ? error.message : 'تعذرت قراءة ملف CSV.'], duplicatesRemoved: 0 }
  }
  if (csvRows.length < 2) return { rows: [], issues: ['يجب أن يحتوي الملف على صف عناوين وصف منتج واحد على الأقل.'], duplicatesRemoved: 0 }

  const columns = new Map(csvRows[0].map((header, index) => [headerKey(header), index]))
  const nameColumn = getColumn(columns, 'name', 'اسم المنتج')
  const detailColumn = getColumn(columns, 'detail', 'description', 'الوصف', 'الوصف المختصر')
  const departmentColumn = getColumn(columns, 'department', 'القسم الرئيسي', 'القسم')
  const subcategoryColumn = getColumn(columns, 'subcategory', 'التصنيف الفرعي', 'الفئة')
  const basketColumn = getColumn(columns, 'basket', 'basketCategory', 'نوع السلة', 'السلة')
  const priceColumn = getColumn(columns, 'agentPrice', 'price', 'سعر الوكيل', 'السعر')
  const idColumn = getColumn(columns, 'id', 'productId', 'معرف المنتج')
  const activeColumn = getColumn(columns, 'active', 'نشط', 'حالة العرض')
  const companyPricesColumn = getColumn(columns, 'companyAgentPrices', 'أسعار الشركات')

  if (nameColumn < 0 || departmentColumn < 0 || subcategoryColumn < 0) {
    return {
      rows: [],
      issues: ['الأعمدة المطلوبة: name, department, subcategory. عمود detail اختياري. نزّل قالب CSV لمعرفة شكل الملف.'],
      duplicatesRemoved: 0,
    }
  }

  const rows: ProductImportRow[] = []
  const issues: string[] = []
  const ids = new Set<string>()
  const dataRows = csvRows.slice(1)
  if (dataRows.length > productImportLimit) {
    return { rows: [], issues: [`الحد الأقصى للاستيراد هو ${productImportLimit} منتج في الملف الواحد.`], duplicatesRemoved: 0 }
  }

  let duplicatesRemoved = 0
  dataRows.forEach((row, index) => {
    const line = index + 2
    const name = cell(row, nameColumn)
    const detail = cell(row, detailColumn)
    const department = parseDepartment(cell(row, departmentColumn))
    const subcategory = cell(row, subcategoryColumn)
    const productDepartment = productDepartments.find((item) => item.id === department)
    const basketCategory = parseBasketCategory(cell(row, basketColumn))
    const agentPrice = parsePrice(cell(row, priceColumn))
    const companyAgentPrices = parseCompanyPrices(cell(row, companyPricesColumn), allowedCompanies)
    const id = cell(row, idColumn)
    const activeText = cell(row, activeColumn).toLowerCase()
    const activeValues = ['true', 'false', '1', '0', 'yes', 'no', 'نعم', 'لا', 'نشط', 'مخفي']
    const active = activeText
      ? !['false', '0', 'no', 'لا', 'مخفي'].includes(activeText)
      : undefined
    const errors: string[] = []

    if (!name || name.length > 80) errors.push('اسم المنتج مطلوب وبحد أقصى ٨٠ حرفاً')
    if (detail.length > 120) errors.push('الوصف يتجاوز ١٢٠ حرفاً')
    if (activeText && !activeValues.includes(activeText)) errors.push('حالة العرض يجب أن تكون true أو false')
    if (!department || !productDepartment) errors.push('القسم الرئيسي غير معروف')
    else if (!productDepartment.categories.some((item) => item === subcategory)) errors.push('التصنيف الفرعي لا ينتمي للقسم المحدد')
    if (!basketCategory) errors.push('نوع السلة يجب أن يكون essential أو family أو both')
    if (agentPrice === null) errors.push('سعر الوكيل يجب أن يكون رقماً صفراً أو أكثر')
    if (companyAgentPrices === null) errors.push('أسعار الشركات يجب أن تكون JSON صالحاً بقيم رقمية غير سالبة')
    if (id && !/^[A-Za-z0-9_-]{1,100}$/.test(id)) errors.push('معرّف المنتج غير صالح')
    if (id && ids.has(id)) {
      duplicatesRemoved += 1
      return
    }
    if (errors.length || !department || !productDepartment || !basketCategory ||
      agentPrice === null || companyAgentPrices === null) {
      issues.push(`السطر ${line}: ${errors.join('، ')}`)
      return
    }

    if (id) ids.add(id)
    rows.push({
      ...(id ? { id } : {}),
      name,
      detail,
      category: basketCategory,
      department,
      subcategory,
      tone: 'yellow',
      iconKey: 'package',
      ...(active !== undefined ? { active } : {}),
      ...(agentPrice !== undefined ? { agentPrice } : {}),
      ...(companyAgentPrices ? { companyAgentPrices } : {}),
      providedFields: [
        ...(detailColumn >= 0 && detail ? ['detail'] : []),
        ...(basketColumn >= 0 && cell(row, basketColumn) ? ['category'] : []),
        ...(priceColumn >= 0 && cell(row, priceColumn) ? ['agentPrice'] : []),
        ...(companyPricesColumn >= 0 && cell(row, companyPricesColumn) ? ['companyAgentPrices'] : []),
        ...(activeColumn >= 0 && activeText ? ['active'] : []),
      ],
    })
  })

  return { rows, issues, duplicatesRemoved }
}
