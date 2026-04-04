// src/constants/countries.ts
// Countries available in the phone country-code picker.
// Ordered: SADC first, rest of Africa, then US.

export interface Country {
  code: string;  // ISO 3166-1 alpha-2
  dial: string;  // E.164 prefix, e.g. "+263"
  flag: string;  // flag emoji
  name: string;  // display name
}

export const COUNTRIES: Country[] = [
  { code: 'ZW', dial: '+263', flag: '🇿🇼', name: 'Zimbabwe' },
  { code: 'ZA', dial: '+27',  flag: '🇿🇦', name: 'South Africa' },
  { code: 'ZM', dial: '+260', flag: '🇿🇲', name: 'Zambia' },
  { code: 'MW', dial: '+265', flag: '🇲🇼', name: 'Malawi' },
  { code: 'TZ', dial: '+255', flag: '🇹🇿', name: 'Tanzania' },
  { code: 'BW', dial: '+267', flag: '🇧🇼', name: 'Botswana' },
  { code: 'NA', dial: '+264', flag: '🇳🇦', name: 'Namibia' },
  { code: 'MZ', dial: '+258', flag: '🇲🇿', name: 'Mozambique' },
  { code: 'CD', dial: '+243', flag: '🇨🇩', name: 'DR Congo' },
  { code: 'AO', dial: '+244', flag: '🇦🇴', name: 'Angola' },
  { code: 'KE', dial: '+254', flag: '🇰🇪', name: 'Kenya' },
  { code: 'UG', dial: '+256', flag: '🇺🇬', name: 'Uganda' },
  { code: 'RW', dial: '+250', flag: '🇷🇼', name: 'Rwanda' },
  { code: 'NG', dial: '+234', flag: '🇳🇬', name: 'Nigeria' },
  { code: 'GH', dial: '+233', flag: '🇬🇭', name: 'Ghana' },
  { code: 'ET', dial: '+251', flag: '🇪🇹', name: 'Ethiopia' },
  { code: 'SN', dial: '+221', flag: '🇸🇳', name: 'Senegal' },
  { code: 'CM', dial: '+237', flag: '🇨🇲', name: 'Cameroon' },
  { code: 'CI', dial: '+225', flag: '🇨🇮', name: "Côte d'Ivoire" },
  { code: 'MG', dial: '+261', flag: '🇲🇬', name: 'Madagascar' },
  { code: 'EG', dial: '+20',  flag: '🇪🇬', name: 'Egypt' },
  { code: 'MA', dial: '+212', flag: '🇲🇦', name: 'Morocco' },
  { code: 'DZ', dial: '+213', flag: '🇩🇿', name: 'Algeria' },
  { code: 'TN', dial: '+216', flag: '🇹🇳', name: 'Tunisia' },
  { code: 'US', dial: '+1',   flag: '🇺🇸', name: 'United States' },
];

/** Default country code when device region is unknown or not in the list. */
export const DEFAULT_COUNTRY_CODE = 'ZW';
