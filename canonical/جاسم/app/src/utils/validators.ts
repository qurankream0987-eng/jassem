export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPhone(phone: string): boolean {
  return /^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/.test(phone);
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isValidKuwaitPhone(phone: string): boolean {
  return /^\+965[0-9]{8}$/.test(phone.replace(/\s/g, ''));
}

export function isValidCivilId(civilId: string): boolean {
  if (!/^\d{12}$/.test(civilId)) return false;
  const weights = [2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    sum += parseInt(civilId[i]) * weights[i];
  }
  const remainder = sum % 11;
  const checkDigit = 11 - remainder;
  return parseInt(civilId[11]) === (checkDigit === 11 ? 0 : checkDigit === 10 ? 1 : checkDigit);
}

export function isStrongPassword(password: string): boolean {
  return password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}
