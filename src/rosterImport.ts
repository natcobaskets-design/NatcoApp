export type RosterImportRow = {
  email: string
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
}
export type RosterImportPreview = { rows: RosterImportRow[]; issues: string[]; totalRows: number }
export const rosterImportLimit = 10_000

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = content.replace(/^\uFEFF/, '')
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else field += character
    } else if (character === '"' && field.length === 0) quoted = true
    else if (character === ',') {
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

export function parseRosterCsv(content: string): RosterImportPreview {
  const csvRows = parseCsvRows(content)
  if (!csvRows.length) return { rows: [], issues: ['الملف فارغ.'], totalRows: 0 }
  const headers = csvRows[0].map((header) => header.toLowerCase().replace(/[\s_\-/]/g, ''))
  const indexOf = (...names: string[]) => headers.findIndex((header) => names.includes(header))
  const emailIndex = indexOf('email', 'البريدالإلكتروني', 'البريد')
  const codeIndex = indexOf('employeecode', 'code', 'staffid', 'الرقمالوظيفي', 'رقمالموظف', 'الكودالوظيفي')
  const nameIndex = indexOf('name', 'employeename', 'الاسم', 'اسمالموظف', 'الاسمالكاملالموظف')
  const companyIndex = indexOf('company', 'الشركة', 'الشركةالتابعة', 'الشركةالشقيقة', 'الشركةالشركةالتابعة')
  const branchIndex = indexOf('branch', 'الفرع')
  const provinceIndex = indexOf('province', 'governorate', 'المحافظة')
  const addressIndex = indexOf('address', 'العنوان')
  const coordinatesIndex = indexOf('coordinates', 'الإحداثيات')
  const phoneIndex = indexOf('phone', 'الهاتف', 'رقمالهاتف')
  const whatsappIndex = indexOf('whatsapp', 'واتساب', 'رقمالواتساب')
  const limitIndex = indexOf('monthlyspendinglimit', 'السقفالشهريالمعتمد', 'السقفالشهري')
  const spentIndex = indexOf('currentmonthlyspent', 'الإنفاقالشهريالحالي', 'الإنفاقالحالي')
  const activeIndex = indexOf('active', 'accountstatus', 'حالةالحساب')
  if (emailIndex < 0 || codeIndex < 0) {
    return { rows: [], issues: ['يجب أن يحتوي الصف الأول على عمود email وعمود employeeCode.'], totalRows: csvRows.length - 1 }
  }
  const candidates: RosterImportRow[] = []
  const issues: string[] = []
  csvRows.slice(1).forEach((fields, index) => {
    const line = index + 2
    const email = fields[emailIndex]?.trim().toLowerCase() ?? ''
    const employeeCode = fields[codeIndex]?.trim() ?? ''
    const name = nameIndex < 0 ? '' : fields[nameIndex]?.trim() ?? ''
    const company = companyIndex < 0 ? '' : fields[companyIndex]?.trim() ?? ''
    const branch = branchIndex < 0 ? '' : fields[branchIndex]?.trim() ?? ''
    const province = provinceIndex < 0 ? '' : fields[provinceIndex]?.trim() ?? ''
    const address = addressIndex < 0 ? '' : fields[addressIndex]?.trim() ?? ''
    const coordinates = coordinatesIndex < 0 ? '' : fields[coordinatesIndex]?.trim() ?? ''
    const phone = phoneIndex < 0 ? '' : fields[phoneIndex]?.trim() ?? ''
    const phoneLookup = normalizePhone(phone)
    const whatsapp = whatsappIndex < 0 ? '' : fields[whatsappIndex]?.trim() ?? ''
    const limitText = limitIndex < 0 ? '' : fields[limitIndex]?.trim() ?? ''
    const spentText = spentIndex < 0 ? '' : fields[spentIndex]?.trim() ?? ''
    if (!email && !employeeCode) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      issues.push(`الصف ${line}: البريد الإلكتروني غير صحيح.`)
      return
    }
    if (!employeeCode || employeeCode.length > 80) {
      issues.push(`الصف ${line}: الكود الوظيفي مطلوب وبحد أقصى 80 حرفاً.`)
      return
    }
    const monthlySpendingLimit = limitText ? Number(limitText) : undefined
    const currentMonthlySpent = spentText ? Number(spentText) : undefined
    const activeText = activeIndex < 0 ? '' : fields[activeIndex]?.trim().toLowerCase().replace(/\s/g, '') ?? ''
    const active = activeText ? ['true', '1', 'active', 'نشط', 'معتمد'].includes(activeText) : undefined
    if (activeText && !['true', '1', 'active', 'نشط', 'معتمد', 'false', '0', 'inactive', 'موقوف', 'غيرنشط'].includes(activeText)) {
      issues.push(`الصف ${line}: حالة الحساب يجب أن تكون active/inactive أو نشط/موقوف.`)
      return
    }
    if (name.length > 120 || company.length > 80 || branch.length > 80 || province.length > 80 ||
      address.length > 500 || coordinates.length > 100 || phone.length > 30 || whatsapp.length > 30) {
      issues.push(`الصف ${line}: تجاوز أحد الحقول طوله المسموح (الاسم 120، الشركة/الفرع/المحافظة 80، العنوان 500، الإحداثيات 100، الهاتف 30 حرفاً).`)
      return
    }
    if (phone && (!/^\+?[\d\s()-]{8,30}$/.test(phone) ||
      phoneLookup.length < 8 || phoneLookup.length > 18)) {
      issues.push(`الصف ${line}: رقم الهاتف يجب أن يتضمن من 8 إلى 18 رقماً مع رمز الدولة.`)
      return
    }
    if ((limitText && (!Number.isFinite(monthlySpendingLimit) || Number(monthlySpendingLimit) < 0)) ||
      (spentText && (!Number.isFinite(currentMonthlySpent) || Number(currentMonthlySpent) < 0 ||
        Number(currentMonthlySpent) > 1_000_000_000)) ||
      (limitText && Number(monthlySpendingLimit) > 1_000_000_000)) {
      issues.push(`الصف ${line}: السقف الشهري والإنفاق الحالي يجب أن يكونا أرقاماً موجبة أو صفراً.`)
      return
    }
    candidates.push({
      email,
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
      providedFields: [
        ...(companyIndex >= 0 ? ['company'] : []),
        ...(limitIndex >= 0 ? ['monthlySpendingLimit'] : []),
        ...(spentIndex >= 0 ? ['currentMonthlySpent'] : []),
      ],
      line,
    })
  })
  const emailCounts = new Map<string, number>()
  const employeeCodeCounts = new Map<string, number>()
  const phoneCounts = new Map<string, number>()
  candidates.forEach((candidate) => {
    emailCounts.set(candidate.email, (emailCounts.get(candidate.email) ?? 0) + 1)
    employeeCodeCounts.set(candidate.employeeCode, (employeeCodeCounts.get(candidate.employeeCode) ?? 0) + 1)
    if (candidate.phone) {
      const phone = normalizePhone(candidate.phone)
      phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1)
    }
  })
  const rows = candidates.filter((candidate) => {
    const duplicateEmail = (emailCounts.get(candidate.email) ?? 0) > 1
    if (duplicateEmail) issues.push(`الصف ${candidate.line}: البريد مكرر في الملف.`)
    const duplicateCode = (employeeCodeCounts.get(candidate.employeeCode) ?? 0) > 1
    if (duplicateCode) issues.push(`الصف ${candidate.line}: الكود الوظيفي مكرر في الملف.`)
    const duplicatePhone = candidate.phone && (phoneCounts.get(normalizePhone(candidate.phone)) ?? 0) > 1
    if (duplicatePhone) issues.push(`الصف ${candidate.line}: رقم الهاتف مكرر في الملف.`)
    return !duplicateEmail && !duplicateCode && !duplicatePhone
  })
  return { rows, issues, totalRows: csvRows.length - 1 }
}
