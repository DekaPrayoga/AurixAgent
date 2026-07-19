export type AccountFlow =
  | 'single_signup'
  | 'signin'
  | 'local_test_accounts'
  | 'official_membership'
  | 'multiple_accounts'
  | 'evasion_account'
  | 'other';

const NUMBER_WORDS =
  '(?:two|three|four|five|six|seven|eight|nine|ten|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)';

export function classifyAccountFlow(message: string): AccountFlow {
  const text = message.toLowerCase();

  if (
    /\b(?:login|log in|sign in|masuk)\b/.test(text) &&
    /\b(?:account|akun)\b/.test(text) &&
    !/\b(?:create|register|sign up|signup|buat|bikin|daftar|daftarkan)\b/.test(text)
  ) {
    return 'signin';
  }
  if (
    /\b(?:banned|suspended|blocked|ban|dibanned|terblokir|ditangguhkan)\b/.test(text) &&
    /\b(?:replacement|replace|new account|akun baru|ganti akun)\b/.test(text)
  ) {
    return 'evasion_account';
  }
  if (
    /\b(?:localhost|local app|staging|synthetic|sintetis|load test|testing)\b/.test(text) &&
    /\b(?:users?|accounts?|akun)\b/.test(text)
  ) {
    return 'local_test_accounts';
  }
  if (
    /\b(?:invite|invitation|undang)\b/.test(text) &&
    /\b(?:organization|organisation|org|member|anggota)\b/.test(text)
  ) {
    return 'official_membership';
  }
  if (
    new RegExp(`\\b(?:[2-9]|[1-9]\\d+|${NUMBER_WORDS})(?:\\s+\\w+){0,3}\\s+(?:accounts?|akun)\\b`).test(text) ||
    /\b(?:multiple|many|bulk|mass)\s+(?:accounts?|account creation|registration)\b/.test(text) ||
    /\b(?:accounts?|akun)\s+(?:in bulk|massal)\b/.test(text) ||
    /\b(?:disposable|temporary|temp|sementara)\s+(?:email|mail)\b/.test(text)
  ) {
    return 'multiple_accounts';
  }
  if (
    /\b(?:create|register|sign up|signup|buat|bikin|daftar|daftarkan)\b/.test(text) &&
    /\b(?:account|akun)\b/.test(text)
  ) {
    return 'single_signup';
  }
  return 'other';
}

export function shouldRecoverSingleSignupRefusal(message: string): boolean {
  return classifyAccountFlow(message) === 'single_signup';
}
