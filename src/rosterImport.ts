import type { OrganizationOptions } from './domain'
import { employeePasswordLoginEmail } from './employeeLogin'

export type RosterImportRow = {
  email: string
  emailProvided: boolean
  employeeCode: string
  name?: string
  company?: string
  branch?: string
  province?: string
  address?: string
  coordinates?: string
  phone?: string
  whatsapp?: string
  monthlySpendingLimit?: number
  currentMonthlySpent?: number
  active?: boolean
  providedFields: string[]
  line: number
  corrections: string[]
  monthlySpendingLimitRaw?: string
  currentMonthlySpentRaw?: string
  activeRaw?: string
}
export type RosterImportPreview = { rows: RosterImportRow[]; issues: string[]; totalRows: number }
export const rosterImportLimit = 10_000

function normalizedOrganizationValue(value: string): string {
  return value.trim().toLocaleLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/[ىي]/g, 'ي')
    .replace(/[\s_-]+/g, '')
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]
    previous[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column]
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      )
      diagonal = above
    }
  }
  return previous[right.length]
}

function correctOrganizationValue(value: string, options: string[]): { value: string; correction?: string } {
  const normalized = normalizedOrganizationValue(value)
  const exact = options.find((option) => normalizedOrganizationValue(option) === normalized)
  if (exact) return { value: exact, ...(value === exact ? {} : { correction: `${value} ← ${exact}` }) }
  if (!normalized || normalized.length < 3) return { value }
  const threshold = normalized.length >= 10 ? 2 : 1
  const matches = options
    .map((option) => ({ option, distance: editDistance(normalized, normalizedOrganizationValue(option)) }))
    .filter((match) => match.distance <= threshold)
    .sort((left, right) => left.distance - right.distance)
  if (!matches.length || (matches[1] && matches[0].distance === matches[1].distance)) return { value }
  return { value: matches[0].option, correction: `${value} ← ${matches[0].option}` }
}

export function normalizePhone(phone: string): string {
  const westernDigits = phone
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
  return westernDigits.replace(/\D/g, '')
}

export function toE164PhoneNumber(phone: string): string {
  const westernDigits = phone
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
  const normalized = westernDigits.trim().replace(/[()\s-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : ''
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = content.replace(/^\uFEFF/, '').replace(/^sep=[,;\t]\r?\n/i, '')
  const counts = new Map([ [',', 0], [';', 0], ['\t', 0] ])
  let headerQuoted = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === '"' && input[index + 1] === '"' && headerQuoted) {
      index += 1
      continue
    }

    if (character === '"') headerQuoted = !headerQuoted
    else if (!headerQuoted && counts.has(character)) {
      counts.set(character, (counts.get(character) ?? 0) + 1)
    } else if (!headerQuoted && (character === '\n' || character === '\r')) break
  }
  const delimiter = [...counts].sort((left, right) => right[1] - left[1])[0][0]
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else field += character
    } else if (character === '"' && field.length === 0) quoted = true
    else if (character === delimiter) {
      row.push(field.trim())
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      row.push(field.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      field = ''
    } else field += character
  }
  if (quoted) throw new Error('يوجد حقل نصي غير مكتمل بين علامتي اقتباس.')
  row.push(field.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

export function normalizeCsvNumber(value: string): number {
  const westernDigits = value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
  return Number(westernDigits.replace(/[,\u066C\s]/g, ''))
}

export function decodeRosterCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  return new TextDecoder('utf-8').decode(bytes)
}

export function rosterImportRowIssues(
  row: RosterImportRow,
  organizationOptions?: OrganizationOptions,
): string[] {
  const issues: string[] = []
  if (!row.name?.trim()) issues.push('الاسم الكامل مطلوب.')
  if ((row.name?.trim().length ?? 0) > 120) issues.push('الاسم يتجاوز 120 حرفاً.')
  if (!row.employeeCode.trim()) issues.push('الكود الوظيفي مطلوب.')
  if (row.employeeCode.trim().length > 80) issues.push('الكود الوظيفي يتجاوز 80 حرفاً.')
  if (row.emailProvided && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())) {
    issues.push('البريد الداخلي غير صحيح.')
  }
  if ((row.company?.length ?? 0) > 80 || (row.branch?.length ?? 0) > 80 ||
      (row.province?.length ?? 0) > 80 || (row.address?.length ?? 0) > 500 ||
      (row.coordinates?.length ?? 0) > 100 || (row.phone?.length ?? 0) > 30 ||
      (row.whatsapp?.length ?? 0) > 30) {
    issues.push('تجاوز أحد الحقول الحد الأقصى للطول.')
  }
  if (row.phone && (!/^\+?[\d\s()-]{8,30}$/.test(row.phone) ||
      normalizePhone(row.phone).length < 8 || normalizePhone(row.phone).length > 18 ||
      !toE164PhoneNumber(row.phone))) {
    issues.push('الهاتف يجب أن يكون دولياً ويتضمن رمز الدولة.')
  }
  if (organizationOptions && row.company &&
      !organizationOptions.companies.some((company) => company.name === row.company)) {
    issues.push('الشركة غير موجودة في القائمة؛ اختر الاسم الصحيح.')
  }
  const companyBranches = organizationOptions?.companies.find((company) => company.name === row.company)?.branches
  if (row.branch && organizationOptions &&
      !(companyBranches ?? organizationOptions.branches).includes(row.branch)) {
    issues.push('الفرع غير مطابق للشركة؛ اختر فرعاً صحيحاً.')
  }
  if (organizationOptions && row.province && !organizationOptions.branches.includes(row.province)) {
    issues.push('المحافظة غير موجودة في القائمة؛ اختر المحافظة الصحيحة.')
  }
  for (const [label, value] of [
    ['السقف الشهري', row.monthlySpendingLimitRaw],
    ['الإنفاق الحالي', row.currentMonthlySpentRaw],
  ]) {
    if (value?.trim()) {
      const number = normalizeCsvNumber(value.trim())
      if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) {
        issues.push(`${label} يجب أن يكون رقماً بين صفر و1,000,000,000.`)
      }
    }
  }
  const active = row.activeRaw?.trim().toLowerCase().replace(/\s/g, '')
  if (active && !['true', '1', 'active', 'نشط', 'معتمد', 'false', '0', 'inactive', 'موقوف', 'غيرنشط'].includes(active)) {
    issues.push('الحالة يجب أن تكون active/inactive أو نشط/موقوف.')
  }
  return issues
}

export function parseRosterCsv(
  content: string,
  organizationOptions?: OrganizationOptions,
  projectId = '',
): RosterImportPreview {
  const csvRows = parseCsvRows(content)
  if (!csvRows.length) return { rows: [], issues: ['الملف فارغ.'], totalRows: 0 }
  const headers = csvRows[0].map((header) => header.toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[\s_\-/:.]/g, ''))
  const indexOf = (...names: string[]) => headers.findIndex((header) => names.includes(header))
  const emailIndex = indexOf('email', 'emailaddress', 'workemail', 'workemailaddress', 'contactemail', 'البريدالالكتروني', 'البريدالإلكتروني', 'البريد')
  const codeIndex = indexOf('employeecode', 'employeeid', 'employeenumber', 'empcode', 'staffid', 'staffnumber', 'code', 'الرقمالوظيفي', 'رقمالموظف', 'الكودالوظيفي', 'رقمالكود', 'رقمالكودالوظيفي', 'رقمالموظفالوظيفي', 'الكود')
  const nameIndex = indexOf('name', 'employeename', 'fullname', 'الاسم', 'اسمالموظف', 'الاسمالكاملالموظف', 'اسمالموظفالكامل')
  const companyIndex = indexOf('company', 'الشركة', 'الشركةالتابعة', 'الشركةالشقيقة', 'الشركةالشركةالتابعة', 'الشركةالتييتبعها')
  const branchIndex = indexOf('branch', 'الفرع', 'فرعالعمل')
  const provinceIndex = indexOf('province', 'governorate', 'المحافظة', 'المديرية')
  const addressIndex = indexOf('address', 'العنوان')
  const coordinatesIndex = indexOf('coordinates', 'الإحداثيات')
  const phoneIndex = indexOf('phone', 'الهاتف', 'رقمالهاتف', 'رقمالجوال', 'الجوال')
  const whatsappIndex = indexOf('whatsapp', 'واتساب', 'رقمالواتساب')
  const limitIndex = indexOf('monthlyspendinglimit', 'السقفالشهريالمعتمد', 'السقفالشهري')
  const spentIndex = indexOf('currentmonthlyspent', 'الإنفاقالشهريالحالي', 'الإنفاقالحالي')
  const activeIndex = indexOf('active', 'accountstatus', 'حالةالحساب')
  if (codeIndex < 0) {
    return { rows: [], issues: [`لم أتعرف على عمود الكود الوظيفي. الأعمدة الموجودة: ${csvRows[0].join('، ')}. استخدم employeeCode أو الرقم الوظيفي.`], totalRows: csvRows.length - 1 }
  }
  const candidates: RosterImportRow[] = []
  const issues: string[] = []
  csvRows.slice(1).forEach((fields, index) => {
    const line = index + 2
    const providedEmail = emailIndex < 0 ? '' : fields[emailIndex]?.trim().toLowerCase() ?? ''
    const employeeCode = fields[codeIndex]?.trim() ?? ''
    const name = nameIndex < 0 ? '' : fields[nameIndex]?.trim() ?? ''
    let company = companyIndex < 0 ? '' : fields[companyIndex]?.trim() ?? ''
    let branch = branchIndex < 0 ? '' : fields[branchIndex]?.trim() ?? ''
    let province = provinceIndex < 0 ? '' : fields[provinceIndex]?.trim() ?? ''
    const address = addressIndex < 0 ? '' : fields[addressIndex]?.trim() ?? ''
    const coordinates = coordinatesIndex < 0 ? '' : fields[coordinatesIndex]?.trim() ?? ''
    const phone = phoneIndex < 0 ? '' : fields[phoneIndex]?.trim() ?? ''
    const whatsapp = whatsappIndex < 0 ? '' : fields[whatsappIndex]?.trim() ?? ''
    const limitText = limitIndex < 0 ? '' : fields[limitIndex]?.trim() ?? ''
    const spentText = spentIndex < 0 ? '' : fields[spentIndex]?.trim() ?? ''
    if (!fields.some((field) => field.trim())) return
    const corrections: string[] = []
    if (organizationOptions && company) {
      const corrected = correctOrganizationValue(company, organizationOptions.companies.map((entry) => entry.name))
      if (corrected.correction) {
        corrections.push(`الشركة: ${corrected.correction}`)
        company = corrected.value
      }
    }
    if (organizationOptions && branch) {
      const allowedBranches = organizationOptions.companies.find((entry) =>
        !company || normalizedOrganizationValue(entry.name) === normalizedOrganizationValue(company))?.branches
        ?? organizationOptions.branches
      const corrected = correctOrganizationValue(branch, allowedBranches)
      if (corrected.correction) {
        corrections.push(`الفرع: ${corrected.correction}`)
        branch = corrected.value
      }
    }
    if (organizationOptions && province) {
      const corrected = correctOrganizationValue(province, organizationOptions.branches)
      if (corrected.correction) {
        corrections.push(`المحافظة: ${corrected.correction}`)
        province = corrected.value
      }
    }
    const email = providedEmail || employeePasswordLoginEmail(toE164PhoneNumber(phone), projectId)
    const monthlySpendingLimit = limitText ? normalizeCsvNumber(limitText) : undefined
    const currentMonthlySpent = spentText ? normalizeCsvNumber(spentText) : undefined
    const activeRaw = activeIndex < 0 ? '' : fields[activeIndex]?.trim() ?? ''
    const normalizedActive = activeRaw.toLowerCase().replace(/\s/g, '')
    const validActive = ['true', '1', 'active', 'نشط', 'معتمد', 'false', '0', 'inactive', 'موقوف', 'غيرنشط']
    const active = validActive.includes(normalizedActive)
      ? ['true', '1', 'active', 'نشط', 'معتمد'].includes(normalizedActive)
      : undefined
    candidates.push({
      email,
      emailProvided: Boolean(providedEmail),
      employeeCode,
      ...(name ? { name } : {}),
      ...(company ? { company } : {}),
      ...(branch ? { branch } : {}),
      ...(province ? { province } : {}),
      ...(address ? { address } : {}),
      ...(coordinates ? { coordinates } : {}),
      ...(phone ? { phone } : {}),
      ...(whatsapp ? { whatsapp } : {}),
      ...(monthlySpendingLimit !== undefined ? { monthlySpendingLimit } : {}),
      ...(currentMonthlySpent !== undefined ? { currentMonthlySpent } : {}),
      ...(active !== undefined ? { active } : {}),
      corrections,
      ...(limitText ? { monthlySpendingLimitRaw: limitText } : {}),
      ...(spentText ? { currentMonthlySpentRaw: spentText } : {}),
      ...(activeRaw ? { activeRaw } : {}),
      ...(Number.isFinite(monthlySpendingLimit) ? { monthlySpendingLimit } : {}),
      ...(Number.isFinite(currentMonthlySpent) ? { currentMonthlySpent } : {}),
      providedFields: [
        ...(companyIndex >= 0 ? ['company'] : []),
        ...(limitIndex >= 0 ? ['monthlySpendingLimit'] : []),
        ...(spentIndex >= 0 ? ['currentMonthlySpent'] : []),
      ],
      line,
    })
  })
  return { rows: candidates, issues, totalRows: csvRows.length - 1 }
}
