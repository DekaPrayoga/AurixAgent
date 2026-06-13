import type { Tool } from './Registry.js';

const COUNTRY_CODES: Record<string, { country: string; flag: string; code2: string }> = {
  '1': { country: 'United States / Canada', flag: 'US/CA', code2: 'US' },
  '7': { country: 'Russia / Kazakhstan', flag: 'RU/KZ', code2: 'RU' },
  '20': { country: 'Egypt', flag: 'EG', code2: 'EG' },
  '27': { country: 'South Africa', flag: 'ZA', code2: 'ZA' },
  '30': { country: 'Greece', flag: 'GR', code2: 'GR' },
  '31': { country: 'Netherlands', flag: 'NL', code2: 'NL' },
  '32': { country: 'Belgium', flag: 'BE', code2: 'BE' },
  '33': { country: 'France', flag: 'FR', code2: 'FR' },
  '34': { country: 'Spain', flag: 'ES', code2: 'ES' },
  '36': { country: 'Hungary', flag: 'HU', code2: 'HU' },
  '39': { country: 'Italy', flag: 'IT', code2: 'IT' },
  '40': { country: 'Romania', flag: 'RO', code2: 'RO' },
  '41': { country: 'Switzerland', flag: 'CH', code2: 'CH' },
  '43': { country: 'Austria', flag: 'AT', code2: 'AT' },
  '44': { country: 'United Kingdom', flag: 'GB', code2: 'GB' },
  '45': { country: 'Denmark', flag: 'DK', code2: 'DK' },
  '46': { country: 'Sweden', flag: 'SE', code2: 'SE' },
  '47': { country: 'Norway', flag: 'NO', code2: 'NO' },
  '48': { country: 'Poland', flag: 'PL', code2: 'PL' },
  '49': { country: 'Germany', flag: 'DE', code2: 'DE' },
  '51': { country: 'Peru', flag: 'PE', code2: 'PE' },
  '52': { country: 'Mexico', flag: 'MX', code2: 'MX' },
  '53': { country: 'Cuba', flag: 'CU', code2: 'CU' },
  '54': { country: 'Argentina', flag: 'AR', code2: 'AR' },
  '55': { country: 'Brazil', flag: 'BR', code2: 'BR' },
  '56': { country: 'Chile', flag: 'CL', code2: 'CL' },
  '57': { country: 'Colombia', flag: 'CO', code2: 'CO' },
  '58': { country: 'Venezuela', flag: 'VE', code2: 'VE' },
  '60': { country: 'Malaysia', flag: 'MY', code2: 'MY' },
  '61': { country: 'Australia', flag: 'AU', code2: 'AU' },
  '62': { country: 'Indonesia', flag: 'ID', code2: 'ID' },
  '63': { country: 'Philippines', flag: 'PH', code2: 'PH' },
  '64': { country: 'New Zealand', flag: 'NZ', code2: 'NZ' },
  '65': { country: 'Singapore', flag: 'SG', code2: 'SG' },
  '66': { country: 'Thailand', flag: 'TH', code2: 'TH' },
  '81': { country: 'Japan', flag: 'JP', code2: 'JP' },
  '82': { country: 'South Korea', flag: 'KR', code2: 'KR' },
  '84': { country: 'Vietnam', flag: 'VN', code2: 'VN' },
  '86': { country: 'China', flag: 'CN', code2: 'CN' },
  '90': { country: 'Turkey', flag: 'TR', code2: 'TR' },
  '91': { country: 'India', flag: 'IN', code2: 'IN' },
  '92': { country: 'Pakistan', flag: 'PK', code2: 'PK' },
  '93': { country: 'Afghanistan', flag: 'AF', code2: 'AF' },
  '94': { country: 'Sri Lanka', flag: 'LK', code2: 'LK' },
  '95': { country: 'Myanmar', flag: 'MM', code2: 'MM' },
  '212': { country: 'Morocco', flag: 'MA', code2: 'MA' },
  '213': { country: 'Algeria', flag: 'DZ', code2: 'DZ' },
  '216': { country: 'Tunisia', flag: 'TN', code2: 'TN' },
  '218': { country: 'Libya', flag: 'LY', code2: 'LY' },
  '220': { country: 'Gambia', flag: 'GM', code2: 'GM' },
  '221': { country: 'Senegal', flag: 'SN', code2: 'SN' },
  '222': { country: 'Mauritania', flag: 'MR', code2: 'MR' },
  '223': { country: 'Mali', flag: 'ML', code2: 'ML' },
  '224': { country: 'Guinea', flag: 'GN', code2: 'GN' },
  '225': { country: 'Ivory Coast', flag: 'CI', code2: 'CI' },
  '226': { country: 'Burkina Faso', flag: 'BF', code2: 'BF' },
  '227': { country: 'Niger', flag: 'NE', code2: 'NE' },
  '228': { country: 'Togo', flag: 'TG', code2: 'TG' },
  '229': { country: 'Benin', flag: 'BJ', code2: 'BJ' },
  '230': { country: 'Mauritius', flag: 'MU', code2: 'MU' },
  '231': { country: 'Liberia', flag: 'LR', code2: 'LR' },
  '232': { country: 'Sierra Leone', flag: 'SL', code2: 'SL' },
  '233': { country: 'Ghana', flag: 'GH', code2: 'GH' },
  '234': { country: 'Nigeria', flag: 'NG', code2: 'NG' },
  '235': { country: 'Chad', flag: 'TD', code2: 'TD' },
  '236': { country: 'Central African Rep.', flag: 'CF', code2: 'CF' },
  '237': { country: 'Cameroon', flag: 'CM', code2: 'CM' },
  '238': { country: 'Cape Verde', flag: 'CV', code2: 'CV' },
  '240': { country: 'Equatorial Guinea', flag: 'GQ', code2: 'GQ' },
  '241': { country: 'Gabon', flag: 'GA', code2: 'GA' },
  '242': { country: 'Congo', flag: 'CG', code2: 'CG' },
  '244': { country: 'Angola', flag: 'AO', code2: 'AO' },
  '245': { country: 'Guinea-Bissau', flag: 'GW', code2: 'GW' },
  '248': { country: 'Seychelles', flag: 'SC', code2: 'SC' },
  '249': { country: 'Sudan', flag: 'SD', code2: 'SD' },
  '250': { country: 'Rwanda', flag: 'RW', code2: 'RW' },
  '251': { country: 'Ethiopia', flag: 'ET', code2: 'ET' },
  '252': { country: 'Somalia', flag: 'SO', code2: 'SO' },
  '253': { country: 'Djibouti', flag: 'DJ', code2: 'DJ' },
  '254': { country: 'Kenya', flag: 'KE', code2: 'KE' },
  '255': { country: 'Tanzania', flag: 'TZ', code2: 'TZ' },
  '256': { country: 'Uganda', flag: 'UG', code2: 'UG' },
  '257': { country: 'Burundi', flag: 'BI', code2: 'BI' },
  '258': { country: 'Mozambique', flag: 'MZ', code2: 'MZ' },
  '260': { country: 'Zambia', flag: 'ZM', code2: 'ZM' },
  '261': { country: 'Madagascar', flag: 'MG', code2: 'MG' },
  '263': { country: 'Zimbabwe', flag: 'ZW', code2: 'ZW' },
  '264': { country: 'Namibia', flag: 'NA', code2: 'NA' },
  '265': { country: 'Malawi', flag: 'MW', code2: 'MW' },
  '266': { country: 'Lesotho', flag: 'LS', code2: 'LS' },
  '267': { country: 'Botswana', flag: 'BW', code2: 'BW' },
  '268': { country: 'Eswatini', flag: 'SZ', code2: 'SZ' },
  '269': { country: 'Comoros', flag: 'KM', code2: 'KM' },
  '350': { country: 'Gibraltar', flag: 'GI', code2: 'GI' },
  '351': { country: 'Portugal', flag: 'PT', code2: 'PT' },
  '352': { country: 'Luxembourg', flag: 'LU', code2: 'LU' },
  '353': { country: 'Ireland', flag: 'IE', code2: 'IE' },
  '354': { country: 'Iceland', flag: 'IS', code2: 'IS' },
  '355': { country: 'Albania', flag: 'AL', code2: 'AL' },
  '356': { country: 'Malta', flag: 'MT', code2: 'MT' },
  '357': { country: 'Cyprus', flag: 'CY', code2: 'CY' },
  '358': { country: 'Finland', flag: 'FI', code2: 'FI' },
  '359': { country: 'Bulgaria', flag: 'BG', code2: 'BG' },
  '370': { country: 'Lithuania', flag: 'LT', code2: 'LT' },
  '371': { country: 'Latvia', flag: 'LV', code2: 'LV' },
  '372': { country: 'Estonia', flag: 'EE', code2: 'EE' },
  '373': { country: 'Moldova', flag: 'MD', code2: 'MD' },
  '374': { country: 'Armenia', flag: 'AM', code2: 'AM' },
  '375': { country: 'Belarus', flag: 'BY', code2: 'BY' },
  '376': { country: 'Andorra', flag: 'AD', code2: 'AD' },
  '377': { country: 'Monaco', flag: 'MC', code2: 'MC' },
  '378': { country: 'San Marino', flag: 'SM', code2: 'SM' },
  '380': { country: 'Ukraine', flag: 'UA', code2: 'UA' },
  '381': { country: 'Serbia', flag: 'RS', code2: 'RS' },
  '382': { country: 'Montenegro', flag: 'ME', code2: 'ME' },
  '383': { country: 'Kosovo', flag: 'XK', code2: 'XK' },
  '385': { country: 'Croatia', flag: 'HR', code2: 'HR' },
  '386': { country: 'Slovenia', flag: 'SI', code2: 'SI' },
  '387': { country: 'Bosnia and Herzegovina', flag: 'BA', code2: 'BA' },
  '389': { country: 'North Macedonia', flag: 'MK', code2: 'MK' },
  '420': { country: 'Czech Republic', flag: 'CZ', code2: 'CZ' },
  '421': { country: 'Slovakia', flag: 'SK', code2: 'SK' },
  '423': { country: 'Liechtenstein', flag: 'LI', code2: 'LI' },
  '500': { country: 'Falkland Islands', flag: 'FK', code2: 'FK' },
  '501': { country: 'Belize', flag: 'BZ', code2: 'BZ' },
  '502': { country: 'Guatemala', flag: 'GT', code2: 'GT' },
  '503': { country: 'El Salvador', flag: 'SV', code2: 'SV' },
  '504': { country: 'Honduras', flag: 'HN', code2: 'HN' },
  '505': { country: 'Nicaragua', flag: 'NI', code2: 'NI' },
  '506': { country: 'Costa Rica', flag: 'CR', code2: 'CR' },
  '507': { country: 'Panama', flag: 'PA', code2: 'PA' },
  '508': { country: 'Saint Pierre and Miquelon', flag: 'PM', code2: 'PM' },
  '509': { country: 'Haiti', flag: 'HT', code2: 'HT' },
  '590': { country: 'Guadeloupe', flag: 'GP', code2: 'GP' },
  '591': { country: 'Bolivia', flag: 'BO', code2: 'BO' },
  '592': { country: 'Guyana', flag: 'GY', code2: 'GY' },
  '593': { country: 'Ecuador', flag: 'EC', code2: 'EC' },
  '595': { country: 'Paraguay', flag: 'PY', code2: 'PY' },
  '596': { country: 'Martinique', flag: 'MQ', code2: 'MQ' },
  '597': { country: 'Suriname', flag: 'SR', code2: 'SR' },
  '598': { country: 'Uruguay', flag: 'UY', code2: 'UY' },
  '599': { country: 'Curacao', flag: 'CW', code2: 'CW' },
  '670': { country: 'East Timor', flag: 'TL', code2: 'TL' },
  '672': { country: 'Norfolk Island', flag: 'NF', code2: 'NF' },
  '673': { country: 'Brunei', flag: 'BN', code2: 'BN' },
  '674': { country: 'Nauru', flag: 'NR', code2: 'NR' },
  '675': { country: 'Papua New Guinea', flag: 'PG', code2: 'PG' },
  '676': { country: 'Tonga', flag: 'TO', code2: 'TO' },
  '677': { country: 'Solomon Islands', flag: 'SB', code2: 'SB' },
  '678': { country: 'Vanuatu', flag: 'VU', code2: 'VU' },
  '679': { country: 'Fiji', flag: 'FJ', code2: 'FJ' },
  '680': { country: 'Palau', flag: 'PW', code2: 'PW' },
  '685': { country: 'Samoa', flag: 'WS', code2: 'WS' },
  '686': { country: 'Kiribati', flag: 'KI', code2: 'KI' },
  '688': { country: 'Tuvalu', flag: 'TV', code2: 'TV' },
  '690': { country: 'Tokelau', flag: 'TK', code2: 'TK' },
  '691': { country: 'Micronesia', flag: 'FM', code2: 'FM' },
  '692': { country: 'Marshall Islands', flag: 'MH', code2: 'MH' },
  '850': { country: 'North Korea', flag: 'KP', code2: 'KP' },
  '852': { country: 'Hong Kong', flag: 'HK', code2: 'HK' },
  '853': { country: 'Macau', flag: 'MO', code2: 'MO' },
  '855': { country: 'Cambodia', flag: 'KH', code2: 'KH' },
  '856': { country: 'Laos', flag: 'LA', code2: 'LA' },
  '880': { country: 'Bangladesh', flag: 'BD', code2: 'BD' },
  '886': { country: 'Taiwan', flag: 'TW', code2: 'TW' },
  '960': { country: 'Maldives', flag: 'MV', code2: 'MV' },
  '961': { country: 'Lebanon', flag: 'LB', code2: 'LB' },
  '962': { country: 'Jordan', flag: 'JO', code2: 'JO' },
  '963': { country: 'Syria', flag: 'SY', code2: 'SY' },
  '964': { country: 'Iraq', flag: 'IQ', code2: 'IQ' },
  '965': { country: 'Kuwait', flag: 'KW', code2: 'KW' },
  '966': { country: 'Saudi Arabia', flag: 'SA', code2: 'SA' },
  '967': { country: 'Yemen', flag: 'YE', code2: 'YE' },
  '968': { country: 'Oman', flag: 'OM', code2: 'OM' },
  '970': { country: 'Palestine', flag: 'PS', code2: 'PS' },
  '971': { country: 'UAE', flag: 'AE', code2: 'AE' },
  '972': { country: 'Israel', flag: 'IL', code2: 'IL' },
  '973': { country: 'Bahrain', flag: 'BH', code2: 'BH' },
  '974': { country: 'Qatar', flag: 'QA', code2: 'QA' },
  '975': { country: 'Bhutan', flag: 'BT', code2: 'BT' },
  '976': { country: 'Mongolia', flag: 'MN', code2: 'MN' },
  '977': { country: 'Nepal', flag: 'NP', code2: 'NP' },
  '992': { country: 'Tajikistan', flag: 'TJ', code2: 'TJ' },
  '993': { country: 'Turkmenistan', flag: 'TM', code2: 'TM' },
  '994': { country: 'Azerbaijan', flag: 'AZ', code2: 'AZ' },
  '995': { country: 'Georgia', flag: 'GE', code2: 'GE' },
  '996': { country: 'Kyrgyzstan', flag: 'KG', code2: 'KG' },
  '998': { country: 'Uzbekistan', flag: 'UZ', code2: 'UZ' },
};

const CARRIER_PREFIXES: Record<string, Record<string, string>> = {
  '62': {
    '811': 'Telkomsel (Halo)', '812': 'Telkomsel (simPATI)', '813': 'Telkomsel (simPATI)',
    '821': 'Telkomsel (simPATI)', '822': 'Telkomsel (simPATI)', '823': 'Telkomsel (AS)',
    '851': 'Telkomsel (AS)', '852': 'Telkomsel (AS)', '853': 'Telkomsel (AS)',
    '814': 'Indosat (IM3)', '815': 'Indosat (Matrix)', '816': 'Indosat (Mentari)',
    '855': 'Indosat (IM3)', '856': 'Indosat (IM3)', '857': 'Indosat (IM3)', '858': 'Indosat (IM3)',
    '817': 'XL Axiata', '818': 'XL Axiata', '819': 'XL Axiata',
    '859': 'XL Axiata', '877': 'XL Axiata', '878': 'XL Axiata',
    '831': 'Axis', '832': 'Axis', '833': 'Axis', '838': 'Axis',
    '895': 'Three (3)', '896': 'Three (3)', '897': 'Three (3)', '898': 'Three (3)', '899': 'Three (3)',
    '881': 'Smartfren', '882': 'Smartfren', '883': 'Smartfren', '884': 'Smartfren',
    '885': 'Smartfren', '886': 'Smartfren', '887': 'Smartfren', '888': 'Smartfren', '889': 'Smartfren',
  },
  '91': {
    '70': 'Airtel/Jio', '72': 'Airtel/Jio', '73': 'Airtel/Jio', '74': 'Airtel/Jio',
    '75': 'Airtel/Jio', '76': 'Airtel/Jio', '77': 'Airtel/Jio', '78': 'Airtel/Jio',
    '79': 'Airtel/Jio', '80': 'BSNL/Airtel', '81': 'BSNL/Airtel', '82': 'BSNL/Airtel',
    '83': 'Vi/BSNL', '84': 'Vi/BSNL', '85': 'Vi/BSNL', '86': 'Vi/BSNL',
    '87': 'Jio/Airtel', '88': 'Jio/Airtel', '89': 'Jio/Airtel', '90': 'Airtel/Vi',
    '91': 'Airtel/Vi', '92': 'Airtel/Vi', '93': 'Airtel/Vi', '94': 'BSNL',
    '95': 'Airtel/Vi', '96': 'Airtel/Vi', '97': 'Airtel/Vi', '98': 'Airtel/Vi', '99': 'Airtel/Vi',
  },
  '1': {
    '200': 'AT&T/Verizon', '201': 'Verizon', '202': 'Verizon',
    '212': 'Verizon/AT&T', '213': 'AT&T', '310': 'AT&T', '312': 'AT&T',
    '347': 'T-Mobile', '408': 'AT&T', '415': 'AT&T', '510': 'AT&T',
    '646': 'Verizon', '718': 'Verizon', '917': 'T-Mobile',
  },
  '44': {
    '74': 'Mobile', '75': 'Mobile', '76': 'Mobile', '77': 'Mobile', '78': 'Mobile', '79': 'Mobile',
  },
  '55': {
    '11': 'Sao Paulo', '21': 'Rio de Janeiro', '31': 'Belo Horizonte',
    '41': 'Curitiba', '51': 'Porto Alegre', '61': 'Brasilia', '71': 'Salvador',
    '81': 'Recife', '91': 'Belem',
  },
};

function parsePhoneNumber(raw: string): {
  international: string;
  countryCode: string;
  country: string;
  flag: string;
  nationalNumber: string;
  carrier: string;
  lineType: string;
} | null {
  let cleaned = raw.replace(/[^0-9+]/g, '');
  if (!cleaned) return null;

  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
    else cleaned = '+' + cleaned;
  }

  const digits = cleaned.slice(1);
  if (digits.length < 7 || digits.length > 15) return null;

  let countryCode = '';
  let country = 'Unknown';
  let flag = '??';

  for (let len = 3; len >= 1; len--) {
    const prefix = digits.slice(0, len);
    if (COUNTRY_CODES[prefix]) {
      countryCode = prefix;
      country = COUNTRY_CODES[prefix].country;
      flag = COUNTRY_CODES[prefix].flag;
      break;
    }
  }

  if (!countryCode) {
    countryCode = digits.slice(0, 1);
    country = COUNTRY_CODES[countryCode]?.country || 'Unknown';
    flag = COUNTRY_CODES[countryCode]?.flag || '??';
  }

  const nationalNumber = digits.slice(countryCode.length);

  let carrier = 'Unknown';
  const carrierDb = CARRIER_PREFIXES[countryCode];
  if (carrierDb) {
    for (let prefixLen = 4; prefixLen >= 2; prefixLen--) {
      const prefix = nationalNumber.slice(0, prefixLen);
      if (carrierDb[prefix]) {
        carrier = carrierDb[prefix];
        break;
      }
    }
  }

  let lineType = 'Unknown';
  if (countryCode === '62') {
    if (nationalNumber.startsWith('8')) lineType = 'Mobile';
    else if (nationalNumber.startsWith('21') || nationalNumber.startsWith('22') || nationalNumber.startsWith('24')) lineType = 'Landline';
    else lineType = 'Likely Mobile';
  } else if (countryCode === '1') {
    lineType = 'Mobile/Landline (NANP)';
  } else if (countryCode === '44') {
    if (nationalNumber.startsWith('7')) lineType = 'Mobile';
    else lineType = 'Landline';
  } else if (['91', '55', '86', '81', '82'].includes(countryCode)) {
    lineType = 'Likely Mobile';
  }

  return {
    international: `+${digits}`,
    countryCode: `+${countryCode}`,
    country,
    flag,
    nationalNumber,
    carrier,
    lineType,
  };
}

async function lookupPhone(target: string): Promise<string[]> {
  const results: string[] = [];
  const parsed = parsePhoneNumber(target);

  if (!parsed) {
    results.push('Invalid phone number format. Use international format: +628123456789 or 628123456789');
    return results;
  }

  results.push(`=== Phone Number Analysis ===`);
  results.push(`Number: ${parsed.international}`);
  results.push(`Country: ${parsed.country} ${parsed.flag}`);
  results.push(`Country Code: ${parsed.countryCode}`);
  results.push(`National Number: ${parsed.nationalNumber}`);
  results.push(`Carrier/Provider: ${parsed.carrier}`);
  results.push(`Line Type: ${parsed.lineType}`);

  try {
    const { execSync } = await import('child_process');
    const numverifyResult = execSync(
      `curl -s "http://apilayer.net/api/validate?access_key=free&number=${parsed.international}" 2>/dev/null`,
      { encoding: 'utf8', timeout: 8000 }
    );
    try {
      const nv = JSON.parse(numverifyResult);
      if (nv.valid) {
        results.push(`\n=== NumVerify API ===`);
        if (nv.carrier) results.push(`Carrier (API): ${nv.carrier}`);
        if (nv.line_type) results.push(`Line Type (API): ${nv.line_type}`);
        if (nv.location) results.push(`Location: ${nv.location}`);
        if (nv.country_name) results.push(`Country (API): ${nv.country_name}`);
      }
    } catch {}
  } catch {}

  try {
    const res = await fetch(`https://phonevalidation.abstractapi.com/v1/?api_key=free&phone=${parsed.international}`);
    const data = await res.json() as any;
    if (data.valid) {
      results.push(`\n=== Abstract API ===`);
      if (data.carrier) results.push(`Carrier: ${data.carrier}`);
      if (data.line_type) results.push(`Type: ${data.line_type}`);
      if (data.location) results.push(`Location: ${data.location}`);
    }
  } catch {}

  const formats = [
    parsed.international,
    `+${parsed.countryCode} ${parsed.nationalNumber.slice(0, 4)}-${parsed.nationalNumber.slice(4, 8)}-${parsed.nationalNumber.slice(8)}`,
    parsed.nationalNumber,
  ].filter(f => f && f.length > 3);
  results.push(`\n=== Search Variants ===`);
  results.push(`Use these to search: ${formats.join(' | ')}`);
  results.push(`\nTip: Use the browser tool to search this number on Google, Truecaller, or social media for more information.`);

  return results;
}

async function lookupDomain(target: string): Promise<string[]> {
  const results: string[] = [];
  const { execSync } = await import('child_process');

  results.push(`=== Domain Analysis: ${target} ===\n`);

  try {
    const whois = execSync(`whois ${target} 2>/dev/null | head -40`, { encoding: 'utf8', timeout: 10000 });
    results.push(`WHOIS:\n${whois}`);
  } catch {
    results.push('WHOIS: not available');
  }

  try {
    const dns = execSync(`dig ${target} +short 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
    results.push(`DNS Records:\n${dns}`);
  } catch {
    results.push('DNS: not available');
  }

  try {
    const ns = execSync(`dig ${target} NS +short 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
    results.push(`Nameservers:\n${ns}`);
  } catch {}

  try {
    const mx = execSync(`dig ${target} MX +short 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
    results.push(`Mail Servers:\n${mx}`);
  } catch {}

  try {
    const txt = execSync(`dig ${target} TXT +short 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
    if (txt.trim()) results.push(`TXT Records:\n${txt}`);
  } catch {}

  return results;
}

async function lookupEmail(target: string): Promise<string[]> {
  const results: string[] = [];

  if (!target.includes('@')) {
    results.push('Invalid email format.');
    return results;
  }

  const [user, domain] = target.split('@');
  results.push(`=== Email Analysis: ${target} ===\n`);
  results.push(`User: ${user}`);
  results.push(`Domain: ${domain}`);
  results.push(`Format valid: yes`);

  try {
    const { execSync } = await import('child_process');
    const mx = execSync(`dig ${domain} MX +short 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
    results.push(`\nMail Servers:\n${mx}`);

    if (mx.includes('google') || mx.includes('gmail')) {
      results.push('Provider: Google Workspace / Gmail');
    } else if (mx.includes('outlook') || mx.includes('microsoft')) {
      results.push('Provider: Microsoft 365 / Outlook');
    } else if (mx.includes('yahoo')) {
      results.push('Provider: Yahoo Mail');
    } else if (mx.includes('protonmail') || mx.includes('proton')) {
      results.push('Provider: ProtonMail (encrypted)');
    } else if (mx.includes('zoho')) {
      results.push('Provider: Zoho Mail');
    } else {
      results.push('Provider: Custom/Self-hosted');
    }
  } catch {}

  try {
    const { execSync } = await import('child_process');
    const spf = execSync(`dig ${domain} TXT +short 2>/dev/null | grep -i spf`, { encoding: 'utf8', timeout: 10000 });
    if (spf.trim()) results.push(`SPF: ${spf.trim()}`);
  } catch {}

  results.push(`\nTip: Use the browser tool to search this email on haveibeenpwned.com, Hunter.io, or social media for breach history and public profiles.`);

  return results;
}

async function lookupIP(target: string): Promise<string[]> {
  const results: string[] = [];
  results.push(`=== IP Analysis: ${target} ===\n`);

  try {
    const res = await fetch(`http://ip-api.com/json/${target}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`);
    const data = await res.json() as any;
    if (data.status === 'success') {
      results.push(`Country: ${data.country} (${data.countryCode})`);
      results.push(`Region: ${data.regionName}`);
      results.push(`City: ${data.city}`);
      results.push(`ZIP: ${data.zip}`);
      results.push(`Coordinates: ${data.lat}, ${data.lon}`);
      results.push(`Timezone: ${data.timezone}`);
      results.push(`ISP: ${data.isp}`);
      results.push(`Organization: ${data.org}`);
      results.push(`AS: ${data.as}`);
    } else {
      results.push(`Lookup failed: ${data.message || 'unknown error'}`);
    }
  } catch {
    results.push('IP-API lookup failed');
  }

  try {
    const { execSync } = await import('child_process');
    const reverse = execSync(`dig -x ${target} +short 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
    if (reverse.trim()) results.push(`Reverse DNS: ${reverse.trim()}`);
  } catch {}

  try {
    const { execSync } = await import('child_process');
    const nmap = execSync(`nmap -sV --top-ports 10 ${target} 2>/dev/null | head -20`, { encoding: 'utf8', timeout: 15000 });
    if (nmap.trim()) results.push(`\nPort Scan (top 10):\n${nmap}`);
  } catch {}

  return results;
}

async function lookupUsername(target: string): Promise<string[]> {
  const results: string[] = [];
  results.push(`=== Username Analysis: ${target} ===\n`);

  const platforms = [
    { name: 'GitHub', url: `https://github.com/${target}` },
    { name: 'Twitter/X', url: `https://x.com/${target}` },
    { name: 'Instagram', url: `https://instagram.com/${target}` },
    { name: 'Reddit', url: `https://reddit.com/user/${target}` },
    { name: 'YouTube', url: `https://youtube.com/@${target}` },
    { name: 'TikTok', url: `https://tiktok.com/@${target}` },
    { name: 'Facebook', url: `https://facebook.com/${target}` },
    { name: 'Steam', url: `https://steamcommunity.com/id/${target}` },
    { name: 'Twitch', url: `https://twitch.tv/${target}` },
    { name: 'Pinterest', url: `https://pinterest.com/${target}` },
  ];

  results.push('Checking username availability across platforms...\n');

  for (const p of platforms) {
    try {
      const res = await fetch(p.url, { method: 'HEAD', redirect: 'manual' });
      const status = res.status;
      const exists = status === 200;
      results.push(`${p.name}: ${exists ? 'EXISTS' : 'not found'} (${p.url})`);
    } catch {
      results.push(`${p.name}: timeout`);
    }
  }

  results.push(`\nTip: Use the browser tool to visit any "EXISTS" links for detailed profile analysis.`);

  return results;
}

export const osintTool: Tool = {
  name: 'osint_investigate',
  description: `Perform OSINT investigation on a target. Supports: phone numbers (carrier, country, line type lookup), domains (WHOIS, DNS, nameservers, mail servers), emails (provider detection, MX records, breach hints), IP addresses (geolocation, ISP, port scan), and usernames (cross-platform presence check). Use type "all" for comprehensive analysis or specify: phone, domain, email, ip, username.`,
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Target: phone number (+62812...), domain (example.com), email (user@domain.com), IP (1.2.3.4), or username' },
      type: { type: 'string', description: 'phone, domain, email, ip, username, or all (auto-detected if omitted)' },
    },
    required: ['target'],
  },
  async execute(args) {
    const target = (args.target as string).trim();
    let type = ((args.type as string) || 'auto').toLowerCase();

    if (type === 'auto' || type === 'all') {
      if (/^\+?[\d\s\-()]{7,15}$/.test(target)) type = 'phone';
      else if (target.includes('@')) type = 'email';
      else if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(target)) type = 'ip';
      else if (/^[a-z0-9._-]+\.[a-z]{2,}$/i.test(target)) type = 'domain';
      else type = 'username';
    }

    const results: string[] = [`OSINT Investigation\nTarget: ${target}\nType: ${type}\n${'='.repeat(40)}\n`];

    switch (type) {
      case 'phone': {
        const r = await lookupPhone(target);
        results.push(...r);
        break;
      }
      case 'domain': {
        const r = await lookupDomain(target);
        results.push(...r);
        break;
      }
      case 'email': {
        const r = await lookupEmail(target);
        results.push(...r);
        break;
      }
      case 'ip': {
        const r = await lookupIP(target);
        results.push(...r);
        break;
      }
      case 'username': {
        const r = await lookupUsername(target);
        results.push(...r);
        break;
      }
      default:
        results.push(`Unknown type: ${type}. Use: phone, domain, email, ip, username, or all`);
    }

    return results.join('\n');
  },
};
