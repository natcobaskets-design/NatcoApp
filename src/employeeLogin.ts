export function employeePasswordLoginEmail(phoneE164: string, projectId: string): string {
  const digits = phoneE164.replace(/\D/g, '')
  if (!/^\d{8,15}$/.test(digits) || !projectId) return ''
  return `employee.${digits}@${projectId.toLowerCase()}.firebaseapp.com`
}

export function isEmployeePasswordLoginEmail(email: string, projectId: string): boolean {
  const normalizedEmail = email.trim().toLowerCase()
  const suffix = `@${projectId.toLowerCase()}.firebaseapp.com`
  if (!projectId || !normalizedEmail.endsWith(suffix)) return false
  return /^employee\.\d{8,15}$/.test(normalizedEmail.slice(0, -suffix.length))
}
